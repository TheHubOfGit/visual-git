// @vitest-environment node
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";

const repoRoot = path.resolve(import.meta.dirname, "..");

describe("server API", () => {
  let baseUrl = "";
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    const app = createApp({ defaultRepoPath: repoRoot });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    closeServer = () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
  });

  afterAll(async () => {
    await closeServer();
  });

  it("returns defaultRepoPath from /api/config", async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ defaultRepoPath: repoRoot });
  });

  it("rejects non-loopback Host headers to prevent DNS rebinding", async () => {
    const address = new URL(baseUrl);
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          hostname: address.hostname,
          port: Number(address.port),
          path: "/api/health",
          method: "GET",
          headers: { Host: "evil.example.com" }
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      req.on("error", reject);
      req.end();
    });

    expect(status).toBe(403);
  });

  it("reads repository snapshot with structured refs and defaultBranch", async () => {
    const res = await fetch(`${baseUrl}/api/repository`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: repoRoot, maxCount: 50 })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.defaultBranch).toBe("main");
    expect(Array.isArray(data.commits)).toBe(true);
    expect(data.commits.length).toBeGreaterThan(0);
    // Ensure hidden checkpoint refs are excluded from the log
    expect(data.commits.some((c: { subject: string }) => c.subject.includes("t3 checkpoint"))).toBe(false);

    const headHash = data.commits[0].hash;
    const detailsRes = await fetch(`${baseUrl}/api/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: repoRoot, hash: headHash })
    });
    expect(detailsRes.status).toBe(200);
    const details = await detailsRes.json();
    expect(details.hash).toBe(headHash);
    expect(Array.isArray(details.files)).toBe(true);

    if (details.files.length > 0) {
      const firstFile = details.files[0];
      const diffRes = await fetch(`${baseUrl}/api/commit/diff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: repoRoot,
          hash: headHash,
          filePath: firstFile.path,
          oldPath: firstFile.oldPath
        })
      });
      expect(diffRes.status).toBe(200);
      const diff = await diffRes.json();
      expect(typeof diff.patch).toBe("string");
    }
  });
});
