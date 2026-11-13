import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { readRepositorySnapshot } from "./git";

export type CreateAppOptions = {
  /** When set, serve the built frontend (dist) and SPA fallback from this directory. */
  staticDir?: string;
};

/**
 * Build the Express app. The API is always mounted; the static frontend is
 * served only when `staticDir` is provided (production / CLI mode). In dev the
 * Vite server serves the frontend and proxies `/api` here.
 */
export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();
  app.use(express.json({ limit: "128kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.post("/api/repository", async (request, response) => {
    const schema = z.object({
      path: z.string().min(1),
      maxCount: z.number().int().min(25).max(1000).optional()
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Provide a repository path and optional maxCount between 25 and 1000." });
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
