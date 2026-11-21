import { createApp } from "./app";
import { isGitRepository } from "./git";

const port = Number(process.env.PORT ?? 4127);

async function main() {
  const cwd = process.cwd();
  const defaultRepoPath = (await isGitRepository(cwd)) ? cwd : null;
  const app = createApp({ defaultRepoPath, readOnly: process.env.VISUAL_GIT_READ_ONLY === "1" });

  app.listen(port, "127.0.0.1", () => {
    console.log(`Visual Git API listening on http://127.0.0.1:${port}`);
  });
}

void main();
