#!/usr/bin/env node
// Entry point for the `visualgit` command.
//
// An installed copy ships build/cli.mjs: the whole server bundled into one
// file with no dependencies, so it runs on plain Node. In a development
// checkout that file may not exist yet, so fall back to running the
// TypeScript source through tsx.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const bundled = new URL("../build/cli.mjs", import.meta.url);

if (existsSync(fileURLToPath(bundled)) && !process.env.VISUAL_GIT_DEV) {
  await import(bundled.href);
} else {
  const { register } = await import("tsx/esm/api");
  register();
  await import("../server/cli.ts");
}
