import { execFile } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { access, open, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { gitLogFormat, parseChangedFiles, parseGitLog } from "../src/lib/gitLog";
import type {
  DirectoryEntry,
  GitBranchComparison,
  GitCommitDetails,
  GitFileDiff,
  GitRepositorySnapshot,
  GitStatusFile
} from "../src/lib/types";

const execFileAsync = promisify(execFile);

const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_PATCH_CHARS = 200_000;
const HASH_PATTERN = /^[0-9a-f]{4,64}$/i;
const DEFAULT_BRANCH_CANDIDATES = ["main", "master", "trunk", "develop", "dev"];

const repoPathSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => path.resolve(expandHome(value)));

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoPath,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 15000
  });
  return stdout.toString();
}

export async function isGitRepository(repoPath: string): Promise<boolean> {
  try {
    const resolved = repoPathSchema.parse(repoPath);
    const pathStat = await stat(resolved);
    if (!pathStat.isDirectory()) return false;
    const gitDir = (await runGit(resolved, ["rev-parse", "--git-dir"])).trim();
    return Boolean(gitDir);
  } catch {
    return false;
  }
}

export async function assertGitRepository(repoPath: string): Promise<string> {
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

async function detectDefaultBranch(repoPath: string, currentBranch: string): Promise<string> {
  try {
    const remoteHead = (await runGit(repoPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim();
    if (remoteHead) {
      const slash = remoteHead.indexOf("/");
      return slash > 0 ? remoteHead.slice(slash + 1) : remoteHead;
    }
  } catch {
    // No origin/HEAD symbolic ref.
  }

  try {
    const branchesRaw = await runGit(repoPath, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]);
    const branches = new Set(
      branchesRaw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    );
    const match = DEFAULT_BRANCH_CANDIDATES.find((candidate) => branches.has(candidate));
    if (match) return match;
  } catch {
    // Ignore errors listing local refs.
  }

  if (currentBranch && currentBranch !== "(detached)") {
    return currentBranch;
  }
  return "main";
}

function validateHash(hash: string): string {
  const trimmed = hash.trim();
  if (!HASH_PATTERN.test(trimmed)) {
    throw new Error("Invalid commit hash.");
  }
  return trimmed;
}

function validateRefName(ref: string): string {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.startsWith("-") || trimmed.includes("\0") || trimmed.includes("..")) {
    throw new Error(`Invalid ref name: ${ref}`);
  }
  return trimmed;
}

function truncatePatch(patch: string): GitFileDiff {
  if (patch.length <= MAX_PATCH_CHARS) {
    return { patch, truncated: false };
  }
  return {
    patch: patch.slice(0, MAX_PATCH_CHARS),
    truncated: true
  };
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
      "--branches",
      "--remotes",
      "--tags",
      "HEAD",
      "--topo-order",
      "--date-order",
      "--decorate=full",
      `--max-count=${maxCount + 1}`,
      "--date=iso-strict",
      `--pretty=format:${gitLogFormat}`
    ]).catch(() => "")
  ]);

  const currentBranch = branch.trim() || "(detached)";
  const defaultBranch = await detectDefaultBranch(resolvedPath, currentBranch);
  const statusFiles = parseStatus(statusRaw);
  const remotes = Array.from(
    new Set(
      remotesRaw
        .split("\n")
        .map((line) => line.trim().split(/\s+/)[0])
        .filter(Boolean)
    )
  );

  const parsedCommits = parseGitLog(logRaw);
  const truncated = parsedCommits.length > maxCount;
  const commits = truncated ? parsedCommits.slice(0, maxCount) : parsedCommits;

  return {
    path: resolvedPath,
    name: path.basename(resolvedPath),
    currentBranch,
    defaultBranch,
    head: head.trim(),
    remotes,
    status: {
      clean: statusFiles.length === 0,
      files: statusFiles
    },
    commits,
    truncated
  };
}

async function resolveCommitAndParents(repoPath: string, hash: string): Promise<{ hash: string; parents: string[] }> {
  const validHash = validateHash(hash);
  const line = (await runGit(repoPath, ["rev-list", "--parents", "-n", "1", `${validHash}^{commit}`])).trim();
  if (!line) {
    throw new Error(`Commit not found: ${hash}`);
  }
  const [resolvedHash, ...parents] = line.split(/\s+/);
  return { hash: resolvedHash, parents };
}

export async function readCommitDetails(repoPath: string, hash: string): Promise<GitCommitDetails> {
  const resolvedPath = await assertGitRepository(repoPath);
  const { hash: resolvedHash, parents } = await resolveCommitAndParents(resolvedPath, hash);
  const base = parents[0] ?? null;

  const [nameStatusRaw, numstatRaw] = await Promise.all([
    runGit(resolvedPath, [
      "diff-tree",
      "--no-commit-id",
      "--root",
      "--first-parent",
      "-m",
      "-r",
      "-M",
      "-z",
      "--name-status",
      resolvedHash
    ]),
    runGit(resolvedPath, [
      "diff-tree",
      "--no-commit-id",
      "--root",
      "--first-parent",
      "-m",
      "-r",
      "-M",
      "-z",
      "--numstat",
      resolvedHash
    ])
  ]);

  return {
    hash: resolvedHash,
    base,
    files: parseChangedFiles(nameStatusRaw, numstatRaw)
  };
}

export async function readCommitFileDiff(
  repoPath: string,
  hash: string,
  filePath: string,
  oldPath?: string
): Promise<GitFileDiff> {
  const resolvedPath = await assertGitRepository(repoPath);
  const { hash: resolvedHash, parents } = await resolveCommitAndParents(resolvedPath, hash);
  const base = parents[0] ?? EMPTY_TREE_HASH;

  const paths = oldPath && oldPath !== filePath ? [oldPath, filePath] : [filePath];
  const patch = await runGit(resolvedPath, [
    "diff",
    "-M",
    "--no-color",
    "--unified=3",
    base,
    resolvedHash,
    "--",
    ...paths
  ]);

  return truncatePatch(patch);
}

export async function readWorkingFileDiff(repoPath: string, filePath: string): Promise<GitFileDiff> {
  const resolvedPath = await assertGitRepository(repoPath);
  const targetPath = path.resolve(resolvedPath, filePath);
  if (targetPath !== resolvedPath && !targetPath.startsWith(`${resolvedPath}${path.sep}`)) {
    throw new Error("Invalid file path.");
  }

  const statusRaw = await runGit(resolvedPath, ["status", "--porcelain=v1", "-z", "--", filePath]).catch(() => "");
  const isUntracked = statusRaw.startsWith("?? ");

  if (!isUntracked) {
    const hasHead = await runGit(resolvedPath, ["rev-parse", "--verify", "HEAD"])
      .then(() => true)
      .catch(() => false);
    const args = hasHead
      ? ["diff", "--no-color", "--unified=3", "HEAD", "--", filePath]
      : ["diff", "--no-color", "--unified=3", "--cached", "--", filePath];
    const patch = await runGit(resolvedPath, args);
    if (patch.trim()) {
      return truncatePatch(patch);
    }
  }

  // Fallback for untracked files or empty index diff: read up to MAX_PATCH_CHARS.
  const handle = await open(targetPath, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      return { patch: "", truncated: false };
    }
    const readSize = Math.min(info.size, MAX_PATCH_CHARS);
    const buffer = Buffer.alloc(readSize);
    await handle.read(buffer, 0, readSize, 0);
    if (buffer.includes(0)) {
      return {
        patch: `Binary file ${filePath} (${info.size} bytes)`,
        truncated: false
      };
    }
    const text = buffer.toString("utf8");
    const lines = text.split("\n");
    const header = [
      `diff --git a/${filePath} b/${filePath}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${filePath}`,
      `@@ -0,0 +1,${lines.length} @@`
    ];
    const body = lines.map((line) => `+${line}`).join("\n");
    return {
      patch: `${header.join("\n")}\n${body}`,
      truncated: info.size > MAX_PATCH_CHARS
    };
  } finally {
    await handle.close();
  }
}

export async function compareBranches(
  repoPath: string,
  base: string,
  head: string
): Promise<GitBranchComparison> {
  const resolvedPath = await assertGitRepository(repoPath);
  const safeBase = validateRefName(base);
  const safeHead = validateRefName(head);

  await Promise.all([
    runGit(resolvedPath, ["rev-parse", "--verify", `${safeBase}^{commit}`]),
    runGit(resolvedPath, ["rev-parse", "--verify", `${safeHead}^{commit}`])
  ]);

  const range = `${safeBase}...${safeHead}`;
  const [mergeBaseRaw, countsRaw, revListRaw, nameStatusRaw, numstatRaw] = await Promise.all([
    runGit(resolvedPath, ["merge-base", safeBase, safeHead]).catch(() => ""),
    runGit(resolvedPath, ["rev-list", "--left-right", "--count", range]).catch(() => "0\t0"),
    runGit(resolvedPath, ["rev-list", "--left-right", "--max-count=1000", range]).catch(() => ""),
    runGit(resolvedPath, ["diff", "-M", "-z", "--name-status", range]).catch(() => ""),
    runGit(resolvedPath, ["diff", "-M", "-z", "--numstat", range]).catch(() => "")
  ]);

  const [behindStr = "0", aheadStr = "0"] = countsRaw.trim().split(/\s+/);
  const behindCommits: string[] = [];
  const aheadCommits: string[] = [];

  for (const line of revListRaw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("<")) {
      behindCommits.push(trimmed.slice(1));
    } else if (trimmed.startsWith(">")) {
      aheadCommits.push(trimmed.slice(1));
    }
  }

  return {
    base: safeBase,
    head: safeHead,
    mergeBase: mergeBaseRaw.trim() || null,
    aheadCount: Number(aheadStr) || 0,
    behindCount: Number(behindStr) || 0,
    aheadCommits,
    behindCommits,
    files: parseChangedFiles(nameStatusRaw, numstatRaw)
  };
}

export async function readBranchFileDiff(
  repoPath: string,
  base: string,
  head: string,
  filePath: string,
  oldPath?: string
): Promise<GitFileDiff> {
  const resolvedPath = await assertGitRepository(repoPath);
  const safeBase = validateRefName(base);
  const safeHead = validateRefName(head);
  const paths = oldPath && oldPath !== filePath ? [oldPath, filePath] : [filePath];

  const patch = await runGit(resolvedPath, [
    "diff",
    "-M",
    "--no-color",
    "--unified=3",
    `${safeBase}...${safeHead}`,
    "--",
    ...paths
  ]);
  return truncatePatch(patch);
}

export async function suggestDirectories(prefix: string): Promise<DirectoryEntry[]> {
  const expanded = expandHome(prefix.trim() || os.homedir());
  const trailingSep = expanded.endsWith("/") || expanded.endsWith(path.sep);
  const parentDir = trailingSep ? path.resolve(expanded) : path.dirname(path.resolve(expanded));
  const needle = trailingSep ? "" : path.basename(expanded).toLowerCase();

  let dirents;
  try {
    dirents = await readdir(parentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const dirs = dirents.filter((entry) => {
    if (!entry.isDirectory()) return false;
    if (!needle.startsWith(".") && entry.name.startsWith(".")) return false;
    if (!needle) return true;
    return entry.name.toLowerCase().startsWith(needle);
  });

  const checked = await Promise.all(
    dirs.slice(0, 40).map(async (entry) => {
      const fullPath = path.join(parentDir, entry.name);
      const hasGit = await access(path.join(fullPath, ".git"))
        .then(() => true)
        .catch(() => false);
      return {
        name: entry.name,
        path: fullPath,
        isGitRepo: hasGit
      };
    })
  );

  return checked
    .sort((left, right) => {
      if (left.isGitRepo !== right.isGitRepo) return left.isGitRepo ? -1 : 1;
      return left.name.localeCompare(right.name);
    })
    .slice(0, 12);
}

export async function watchRepository(repoPath: string, onChange: () => void): Promise<() => void> {
  const resolvedPath = await assertGitRepository(repoPath);
  const gitDirRaw = (await runGit(resolvedPath, ["rev-parse", "--git-dir"])).trim();
  const gitCommonRaw = (await runGit(resolvedPath, ["rev-parse", "--git-common-dir"])).trim();
  const gitDir = path.resolve(resolvedPath, gitDirRaw);
  const gitCommonDir = path.resolve(resolvedPath, gitCommonRaw || gitDirRaw);

  const dirsToWatch = new Set<string>([
    gitDir,
    path.join(gitCommonDir, "refs"),
    path.join(gitCommonDir, "refs", "heads"),
    path.join(gitCommonDir, "refs", "tags"),
    path.join(gitCommonDir, "refs", "remotes")
  ]);

  const watchers: FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  const scheduleNotify = (filename?: string | Buffer | null) => {
    if (closed) return;
    const name = filename ? String(filename) : "";
    if (name.endsWith(".lock")) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (!closed) onChange();
    }, 250);
  };

  for (const dir of dirsToWatch) {
    try {
      const info = await stat(dir);
      if (!info.isDirectory()) continue;
      const watcher = watch(dir, { recursive: false }, (_event, filename) => {
        scheduleNotify(filename);
      });
      watcher.on("error", () => {
        // Ignore transient watcher errors (e.g. directory removed).
      });
      watchers.push(watcher);
    } catch {
      // Optional ref directory may not exist yet.
    }
  }

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch {
        // Ignore close errors.
      }
    }
  };
}
