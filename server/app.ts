import express from "express";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  browseDirectory,
  clearProjectIdentity,
  commitStaged,
  compareBranches,
  createBranch,
  explainGitError,
  identitySchema,
  readBranchFileDiff,
  readCommitDetails,
  readCommitFileDiff,
  readRepositorySnapshot,
  readIdentity,
  readWorkingFileDiff,
  saveIdentity,
  stageFiles,
  suggestDirectories,
  switchBranch,
  unstageFiles,
  watchRepository,
  type GitActionResult
} from "./git";

export type CreateAppOptions = {
  /** When set, serve the built frontend (dist) and SPA fallback from this directory. */
  staticDir?: string;
  /** Default repository path supplied by CLI or server working directory. */
  defaultRepoPath?: string | null;
  /** When true, every write action is refused. */
  readOnly?: boolean;
};

const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * Build the Express app. The API is always mounted; the static frontend is
 * served only when `staticDir` is provided (production / CLI mode). In dev the
 * Vite server serves the frontend and proxies `/api` here.
 */
export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();

  // Guard against DNS rebinding attacks: only accept loopback Host headers.
  app.use((request, response, next) => {
    const host = request.headers.host;
    if (host && !LOCAL_HOST_PATTERN.test(host)) {
      response.status(403).json({ error: "Forbidden host." });
      return;
    }
    next();
  });

  // Guard against cross-site requests: a web page on another origin must not
  // be able to drive this local server.
  app.use((request, response, next) => {
    if (request.method === "GET" || request.method === "HEAD") {
      next();
      return;
    }
    const origin = request.headers.origin;
    if (origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = "";
      }
      if (!LOCAL_HOST_PATTERN.test(originHost)) {
        response.status(403).json({ error: "Forbidden origin." });
        return;
      }
    }
    next();
  });

  app.use(express.json({ limit: "128kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/api/config", (_request, response) => {
    response.json({
      defaultRepoPath: options.defaultRepoPath ?? null,
      readOnly: Boolean(options.readOnly)
    });
  });

  /* ---- Safe write actions ---- */
  const filesSchema = z.object({
    path: z.string().min(1),
    files: z.array(z.string().min(1)).min(1).max(500)
  });

  function action<T>(
    route: string,
    schema: z.ZodType<T>,
    badInput: string,
    run: (data: T) => Promise<GitActionResult>
  ) {
    app.post(route, async (request, response) => {
      if (options.readOnly) {
        response.status(403).json({ error: "Visual Git was started in read-only mode." });
        return;
      }
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: badInput });
        return;
      }
      try {
        response.json(await run(parsed.data));
      } catch (error) {
        response.status(422).json({ error: explainGitError(error, "Git could not do that.") });
      }
    });
  }

  action("/api/actions/stage", filesSchema, "Provide a repository path and a list of files.", (data) =>
    stageFiles(data.path, data.files)
  );
  action("/api/actions/unstage", filesSchema, "Provide a repository path and a list of files.", (data) =>
    unstageFiles(data.path, data.files)
  );
  action(
    "/api/actions/commit",
    z.object({ path: z.string().min(1), message: z.string().trim().min(1).max(5000) }),
    "Provide a repository path and a message.",
    (data) => commitStaged(data.path, data.message)
  );
  action(
    "/api/actions/switch",
    z.object({ path: z.string().min(1), branch: z.string().min(1).max(250) }),
    "Provide a repository path and a branch name.",
    (data) => switchBranch(data.path, data.branch)
  );
  action(
    "/api/actions/create-branch",
    z.object({
      path: z.string().min(1),
      name: z.string().trim().min(1).max(250),
      startPoint: z.string().min(1).max(250).optional()
    }),
    "Provide a repository path and a new branch name.",
    (data) => createBranch(data.path, data.name, data.startPoint)
  );

  /* ---- Folder browser ---- */
  app.post("/api/browse", async (request, response) => {
    const parsed = z
      .object({ path: z.string().max(4096).optional(), showHidden: z.boolean().optional() })
      .safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: "Provide a folder path." });
      return;
    }
    const requested = parsed.data.path;
    // undefined → home folder; "" → the list of drives on Windows (home elsewhere).
    const target = requested === undefined ? os.homedir() : requested === "" ? null : requested;
    try {
      response.json(await browseDirectory(target, parsed.data.showHidden));
    } catch (error) {
      response.status(422).json({ error: error instanceof Error ? error.message : "Unable to open that folder." });
    }
  });

  /* ---- Name and email on saves ---- */
  app.get("/api/identity", async (request, response) => {
    const repoPath = typeof request.query.path === "string" ? request.query.path : null;
    response.json(await readIdentity(repoPath));
  });

  app.post("/api/identity", async (request, response) => {
    if (options.readOnly) {
      response.status(403).json({ error: "Visual Git was started in read-only mode." });
      return;
    }
    const parsed = z
      .object({
        name: z.string(),
        email: z.string(),
        scope: z.enum(["global", "project"]),
        path: z.string().min(1).optional()
      })
      .safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Provide a name, an email and where to use them." });
      return;
    }
    const valid = identitySchema.safeParse(parsed.data);
    if (!valid.success) {
      response.status(400).json({ error: valid.error.issues[0]?.message ?? "Check the name and email." });
      return;
    }
    try {
      const result = await saveIdentity({ ...parsed.data, repoPath: parsed.data.path });
      response.json({ ...result, identity: await readIdentity(parsed.data.path) });
    } catch (error) {
      response.status(422).json({ error: explainGitError(error, "Git could not save your name and email.") });
    }
  });

  app.post("/api/identity/clear", async (request, response) => {
    if (options.readOnly) {
      response.status(403).json({ error: "Visual Git was started in read-only mode." });
      return;
    }
    const parsed = z.object({ path: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Provide a repository path." });
      return;
    }
    try {
      const result = await clearProjectIdentity(parsed.data.path);
      response.json({ ...result, identity: await readIdentity(parsed.data.path) });
    } catch (error) {
      response.status(422).json({ error: explainGitError(error, "Git could not change that setting.") });
    }
  });

  app.post("/api/repository", async (request, response) => {
    const schema = z.object({
      path: z.string().min(1),
      maxCount: z.number().int().min(25).max(5000).optional()
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Provide a repository path and optional maxCount between 25 and 5000." });
      return;
    }

    try {
      const snapshot = await readRepositorySnapshot(parsed.data.path, parsed.data.maxCount);
      response.json(snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read repository.";
      response.status(422).json({ error: message });
    }
  });

  app.post("/api/commit", async (request, response) => {
    const schema = z.object({
      path: z.string().min(1),
      hash: z.string().min(4).max(64)
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Provide a repository path and commit hash." });
      return;
    }

    try {
      const details = await readCommitDetails(parsed.data.path, parsed.data.hash);
      response.json(details);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read commit details.";
      response.status(422).json({ error: message });
    }
  });

  app.post("/api/commit/diff", async (request, response) => {
    const schema = z.object({
      path: z.string().min(1),
      hash: z.string().min(4).max(64),
      filePath: z.string().min(1),
      oldPath: z.string().min(1).optional()
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Provide repository path, commit hash, and filePath." });
      return;
    }

    try {
      const diff = await readCommitFileDiff(
        parsed.data.path,
        parsed.data.hash,
        parsed.data.filePath,
        parsed.data.oldPath
      );
      response.json(diff);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read file diff.";
      response.status(422).json({ error: message });
    }
  });

  app.post("/api/working-diff", async (request, response) => {
    const schema = z.object({
      path: z.string().min(1),
      filePath: z.string().min(1)
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Provide repository path and filePath." });
      return;
    }

    try {
      const diff = await readWorkingFileDiff(parsed.data.path, parsed.data.filePath);
      response.json(diff);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read working tree diff.";
      response.status(422).json({ error: message });
    }
  });

  app.post("/api/compare", async (request, response) => {
    const schema = z.object({
      path: z.string().min(1),
      base: z.string().min(1),
      head: z.string().min(1)
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Provide repository path, base branch, and head branch." });
      return;
    }

    try {
      const comparison = await compareBranches(parsed.data.path, parsed.data.base, parsed.data.head);
      response.json(comparison);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to compare branches.";
      response.status(422).json({ error: message });
    }
  });

  app.post("/api/compare/diff", async (request, response) => {
    const schema = z.object({
      path: z.string().min(1),
      base: z.string().min(1),
      head: z.string().min(1),
      filePath: z.string().min(1),
      oldPath: z.string().min(1).optional()
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Provide repository path, base, head, and filePath." });
      return;
    }

    try {
      const diff = await readBranchFileDiff(
        parsed.data.path,
        parsed.data.base,
        parsed.data.head,
        parsed.data.filePath,
        parsed.data.oldPath
      );
      response.json(diff);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read branch comparison diff.";
      response.status(422).json({ error: message });
    }
  });

  app.post("/api/directories", async (request, response) => {
    const schema = z.object({
      prefix: z.string()
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Provide a path prefix." });
      return;
    }

    const entries = await suggestDirectories(parsed.data.prefix);
    response.json({ entries });
  });

  app.get("/api/watch", async (request, response) => {
    const repoPath = typeof request.query.path === "string" ? request.query.path : "";
    if (!repoPath.trim()) {
      response.status(400).json({ error: "Provide a path query parameter." });
      return;
    }

    let stopWatching: (() => void) | undefined;
    try {
      stopWatching = await watchRepository(repoPath, () => {
        if (!response.writableEnded) {
          response.write("event: changed\ndata: {}\n\n");
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to watch repository.";
      response.status(422).json({ error: message });
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    response.write(": connected\n\n");

    const keepAlive = setInterval(() => {
      if (!response.writableEnded) {
        response.write(": ping\n\n");
      }
    }, 25_000);

    request.on("close", () => {
      clearInterval(keepAlive);
      stopWatching?.();
    });
  });

  if (options.staticDir && existsSync(options.staticDir)) {
    const indexFile = path.join(options.staticDir, "index.html");
    app.use(express.static(options.staticDir));
    // SPA fallback for any non-API GET request.
    app.use((request, response, next) => {
      if (request.method !== "GET" || request.path.startsWith("/api/")) {
        next();
        return;
      }
      response.sendFile(indexFile);
    });
  }

  return app;
}
