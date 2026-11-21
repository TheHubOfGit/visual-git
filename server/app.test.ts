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
    expect(await res.json()).toEqual({ defaultRepoPath: repoRoot, readOnly: false });
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

describe("safe write actions", () => {
  let baseUrl = "";
  let readOnlyUrl = "";
  let repo = "";
  const closers: Array<() => Promise<void>> = [];

  async function listen(app: ReturnType<typeof createApp>): Promise<string> {
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    closers.push(() => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  let fakeHome = "";
  let savedEnv: Record<string, string | undefined> = {};

  function post(url: string, body: unknown, headers: Record<string, string> = {}) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body)
    });
  }

  async function status() {
    const res = await post(`${baseUrl}/api/repository`, { path: repo, maxCount: 50 });
    return (await res.json()) as {
      currentBranch: string;
      commits: Array<{ hash: string }>;
      status: { files: Array<{ path: string; index: string; workingTree: string }> };
    };
  }

  beforeAll(async () => {
    const { mkdtemp, writeFile, realpath } = await import("node:fs/promises");
    const { execFileSync } = await import("node:child_process");
    const os = await import("node:os");
    repo = await realpath(await mkdtemp(path.join(os.tmpdir(), "visual-git-test-")));
    // Never touch the real ~/.gitconfig: point HOME at a throwaway folder.
    fakeHome = await realpath(await mkdtemp(path.join(os.tmpdir(), "visual-git-home-")));
    savedEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL };
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    delete process.env.GIT_CONFIG_GLOBAL;
    await (await import("node:fs/promises")).mkdir(path.join(fakeHome, "Projects", ".hidden"), { recursive: true });
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.local");
    git("config", "commit.gpgsign", "false");
    await writeFile(path.join(repo, "a.txt"), "one\n");
    git("add", "a.txt");
    git("commit", "-q", "-m", "First");
    await writeFile(path.join(repo, "b.txt"), "two\n");

    baseUrl = await listen(createApp());
    readOnlyUrl = await listen(createApp({ readOnly: true }));
  });

  afterAll(async () => {
    await Promise.all(closers.map((close) => close()));
    const { rm } = await import("node:fs/promises");
    await rm(repo, { recursive: true, force: true });
    await rm(fakeHome, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("stages and unstages a file without touching its contents", async () => {
    const staged = await post(`${baseUrl}/api/actions/stage`, { path: repo, files: ["b.txt"] });
    expect(staged.status).toBe(200);
    expect((await staged.json()).command).toBe("git add -- b.txt");
    expect((await status()).status.files).toEqual([{ path: "b.txt", index: "A", workingTree: " " }]);

    const unstaged = await post(`${baseUrl}/api/actions/unstage`, { path: repo, files: ["b.txt"] });
    expect(unstaged.status).toBe(200);
    expect((await status()).status.files).toEqual([{ path: "b.txt", index: "?", workingTree: "?" }]);
  });

  it("refuses to commit when nothing is staged, then commits staged files", async () => {
    const empty = await post(`${baseUrl}/api/actions/commit`, { path: repo, message: "Nothing" });
    expect(empty.status).toBe(422);
    expect((await empty.json()).error).toMatch(/Nothing is marked ready/);

    await post(`${baseUrl}/api/actions/stage`, { path: repo, files: ["b.txt"] });
    const res = await post(`${baseUrl}/api/actions/commit`, { path: repo, message: "Add b" });
    expect(res.status).toBe(200);
    const data = await res.json();
    const snapshot = await status();
    expect(snapshot.commits[0].hash).toBe(data.hash);
    expect(snapshot.status.files).toEqual([]);
  });

  it("creates a branch, switches back, and rejects unknown branches", async () => {
    const created = await post(`${baseUrl}/api/actions/create-branch`, { path: repo, name: "feature/try" });
    expect(created.status).toBe(200);
    expect((await status()).currentBranch).toBe("feature/try");

    const duplicate = await post(`${baseUrl}/api/actions/create-branch`, { path: repo, name: "feature/try" });
    expect(duplicate.status).toBe(422);

    const back = await post(`${baseUrl}/api/actions/switch`, { path: repo, branch: "main" });
    expect(back.status).toBe(200);
    expect((await status()).currentBranch).toBe("main");

    const missing = await post(`${baseUrl}/api/actions/switch`, { path: repo, branch: "nope" });
    expect(missing.status).toBe(422);

    const badName = await post(`${baseUrl}/api/actions/create-branch`, { path: repo, name: "bad name" });
    expect(badName.status).toBe(422);
  });

  it("rejects paths outside the repository, foreign origins, and read-only mode", async () => {
    const escape = await post(`${baseUrl}/api/actions/stage`, { path: repo, files: ["../x"] });
    expect(escape.status).toBe(422);

    const foreign = await post(
      `${baseUrl}/api/actions/stage`,
      { path: repo, files: ["a.txt"] },
      { Origin: "http://evil.example.com" }
    );
    expect(foreign.status).toBe(403);

    const readOnly = await post(`${readOnlyUrl}/api/actions/stage`, { path: repo, files: ["a.txt"] });
    expect(readOnly.status).toBe(403);
  });

  it("browses folders, marks projects, and hides dot-folders", async () => {
    const home = await post(`${baseUrl}/api/browse`, {});
    expect(home.status).toBe(200);
    const listing = await home.json();
    expect(listing.path).toBe(fakeHome);
    expect(listing.entries.map((entry: { name: string }) => entry.name)).toContain("Projects");
    expect(listing.places[0]).toEqual({ label: "Home", path: fakeHome });

    const inside = await (await post(`${baseUrl}/api/browse`, { path: path.join(fakeHome, "Projects") })).json();
    expect(inside.entries).toEqual([]);
    expect(inside.parent).toBe(fakeHome);

    const withHidden = await (await post(`${baseUrl}/api/browse`, { path: path.join(fakeHome, "Projects"), showHidden: true })).json();
    expect(withHidden.entries.map((entry: { name: string }) => entry.name)).toEqual([".hidden"]);

    const project = await (await post(`${baseUrl}/api/browse`, { path: repo })).json();
    expect(project.isGitRepo).toBe(true);

    const missing = await post(`${baseUrl}/api/browse`, { path: path.join(fakeHome, "nope") });
    expect(missing.status).toBe(422);
    expect((await missing.json()).error).toMatch(/does not exist/);
  });

  it("reads and saves the name and email used on saves", async () => {
    const before = await (await fetch(`${baseUrl}/api/identity?path=${encodeURIComponent(repo)}`)).json();
    expect(before.global).toEqual({ name: "", email: "" });
    expect(before.project).toMatchObject({ name: "Test", email: "test@example.local" });
    expect(before.effective).toEqual({ name: "Test", email: "test@example.local" });

    const bad = await post(`${baseUrl}/api/identity`, { name: "Ada", email: "not-an-email", scope: "global" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/email address/);

    const saved = await post(`${baseUrl}/api/identity`, { name: "Ada Lovelace", email: "ada@example.com", scope: "global", path: repo });
    expect(saved.status).toBe(200);
    const savedData = await saved.json();
    expect(savedData.command).toBe('git config --global user.name "Ada Lovelace" && git config --global user.email ada@example.com');
    expect(savedData.identity.global).toEqual({ name: "Ada Lovelace", email: "ada@example.com" });
    // The project still has its own override.
    expect(savedData.identity.effective.name).toBe("Test");

    const cleared = await (await post(`${baseUrl}/api/identity/clear`, { path: repo })).json();
    expect(cleared.identity.project).toMatchObject({ name: "", email: "" });
    expect(cleared.identity.effective).toEqual({ name: "Ada Lovelace", email: "ada@example.com" });

    const local = await (await post(`${baseUrl}/api/identity`, { name: "Test", email: "test@example.local", scope: "project", path: repo })).json();
    expect(local.identity.effective.name).toBe("Test");

    const readOnly = await post(`${readOnlyUrl}/api/identity`, { name: "X", email: "x@y.z", scope: "global" });
    expect(readOnly.status).toBe(403);
  });
});
