import express from "express";
import { z } from "zod";
import { readRepositorySnapshot } from "./git";

const app = express();
const port = Number(process.env.PORT ?? 4127);

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

app.listen(port, "127.0.0.1", () => {
  console.log(`Visual Git API listening on http://127.0.0.1:${port}`);
});
