import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { gitLogFormat, parseGitLog } from "../src/lib/gitLog";
import type { GitRepositorySnapshot, GitStatusFile } from "../src/lib/types";

const execFileAsync = promisify(execFile);

const repoPathSchema = z.string().trim().min(1).transform((value) => path.resolve(value));

async function runGit(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoPath,
    maxBuffer: 12 * 1024 * 1024,
    timeout: 15000
  });
  return stdout.toString();
}

async function assertGitRepository(repoPath: string): Promise<string> {
  const parsed = repoPathSchema.parse(repoPath);
  const pathStat = await stat(parsed);
  if (!pathStat.isDirectory()) {
    throw new Error("Path must be a directory.");
  }

  await access(parsed);
  const gitDir = (await runGit(parsed, ["rev-parse", "--git-dir"])).trim();
  if (!gitDir) {
    throw new Error("Path is not a Git repository.");
  }
  return parsed;
}

function parseStatus(rawStatus: string): GitStatusFile[] {
  return rawStatus
    .split("\0")
    .filter(Boolean)
    .map((entry) => ({
      index: entry.slice(0, 1).trim() || " ",
      workingTree: entry.slice(1, 2).trim() || " ",
      path: entry.slice(3)
    }));
}

export async function readRepositorySnapshot(repoPath: string, maxCount = 300): Promise<GitRepositorySnapshot> {
  const resolvedPath = await assertGitRepository(repoPath);
  const [branch, head, remotesRaw, statusRaw, logRaw] = await Promise.all([
    runGit(resolvedPath, ["branch", "--show-current"]).catch(() => ""),
    runGit(resolvedPath, ["rev-parse", "--short", "HEAD"]).catch(() => ""),
    runGit(resolvedPath, ["remote", "-v"]).catch(() => ""),
    runGit(resolvedPath, ["status", "--porcelain=v1", "-z"]),
    runGit(resolvedPath, [
      "log",
      "--all",
      "--topo-order",
      "--date-order",
      `--max-count=${maxCount}`,
      "--date=iso-strict",
      `--pretty=format:${gitLogFormat}`
    ]).catch(() => "")
  ]);

  const statusFiles = parseStatus(statusRaw);
  const remotes = Array.from(
    new Set(
      remotesRaw
        .split("\n")
        .map((line) => line.trim().split(/\s+/)[0])
        .filter(Boolean)
    )
  );

  return {
    path: resolvedPath,
    name: path.basename(resolvedPath),
    currentBranch: branch.trim() || "(detached)",
    head: head.trim(),
    remotes,
    status: {
      clean: statusFiles.length === 0,
      files: statusFiles
    },
    commits: parseGitLog(logRaw)
  };
}
