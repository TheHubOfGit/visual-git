#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createApp } from "./app";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const distDir = path.join(projectRoot, "dist");

type CliOptions = {
  repoPath: string;
  port?: number;
  open: boolean;
  help: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { repoPath: process.cwd(), open: true, help: false };
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--no-open") {
      options.open = false;
    } else if (arg === "-p" || arg === "--port") {
      const value = argv[++i];
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        throw new Error(`Invalid port: ${value ?? "(missing)"}`);
      }
      options.port = parsed;
    } else if (arg.startsWith("--port=")) {
      const parsed = Number(arg.slice("--port=".length));
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        throw new Error(`Invalid port: ${arg}`);
      }
      options.port = parsed;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  if (positionals[0]) {
    options.repoPath = path.resolve(positionals[0]);
  }
  return options;
}

function printHelp(): void {
  console.log(`visualgit — view a local Git repository in the browser

Usage:
  visualgit [path] [options]

Arguments:
  path              Repository to open (default: current directory)

Options:
  -p, --port <n>    Port to listen on (default: first free port from 4127)
      --no-open     Do not open the browser automatically
  -h, --help        Show this help
`);
}

async function isGitRepository(repoPath: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--git-dir"], { cwd: repoPath, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => tester.close(() => resolve(true)));
    tester.listen(port, "127.0.0.1");
  });
}

async function findPort(preferred?: number): Promise<number> {
  if (preferred !== undefined) {
    if (preferred === 0 || (await isPortFree(preferred))) return preferred;
    throw new Error(`Port ${preferred} is already in use.`);
  }
  for (let port = 4127; port < 4127 + 100; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error("Could not find a free port in range 4127–4226.");
}

async function openBrowser(url: string): Promise<void> {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    await execFileAsync(command, args, { timeout: 5000 });
  } catch {
    // Opening the browser is best-effort; the URL is always printed.
  }
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    printHelp();
    return;
  }

  if (!(await isGitRepository(options.repoPath))) {
    console.error(`Error: ${options.repoPath} is not a Git repository.`);
    console.error("Pass a path to a repository, or run inside one.");
    process.exitCode = 1;
    return;
  }

  const app = createApp({ staticDir: distDir });

  let port: number;
  try {
    port = await findPort(options.port);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const server = app.listen(port, "127.0.0.1", () => {
    const actualPort = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${actualPort}/?path=${encodeURIComponent(options.repoPath)}`;
    console.log(`\n  Visual Git is running.\n`);
    console.log(`  Repository:  ${options.repoPath}`);
    console.log(`  Open:        ${url}\n`);
    console.log(`  Press Ctrl+C to stop.\n`);
    if (options.open) void openBrowser(url);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
