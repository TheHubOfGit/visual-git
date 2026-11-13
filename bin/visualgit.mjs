#!/usr/bin/env node
// Entry point for the `visualgit` command. Registers the tsx ESM loader so the
// TypeScript server/CLI can run directly without a separate build step.
import { register } from "tsx/esm/api";

register();
await import("../server/cli.ts");
