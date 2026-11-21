import { execFile } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { access, open, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { gitLogFormat, parseChangedFiles, parseGitLog } from "../src/lib/gitLog";
import type {
  CommitIdentity,
  DirectoryEntry,
  DirectoryListing,
  FolderPlace,
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
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(os.homedir(), value.slice(2));
  return value;
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoPath,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 15000,
      windowsHide: true
    });
    return stdout.toString();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Either git itself or the folder is missing; say which.
      const folderExists = await stat(repoPath).then(() => true).catch(() => false);
      throw new Error(
        folderExists
          ? "Git is not installed on this computer, or Visual Git cannot find it. Run the Visual Git installer again and it will set Git up for you."
          : `That folder does not exist: ${repoPath}`
      );
    }
    throw error;
  }
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

/* -------------------------------------------------------------------------
   Safe write actions. Every action is something git itself can undo or
   refuses to do destructively: no force flags, no discards, no network.
   ------------------------------------------------------------------------- */

export type GitActionResult = {
  ok: true;
  /** One plain sentence for a git newcomer. */
  summary: string;
  /** The equivalent command a person could type. */
  command: string;
  hash?: string;
};

function quoteArg(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

/** Turn git's stderr into a sentence a newcomer can act on. */
export function explainGitError(error: unknown, fallback: string): string {
  const raw =
    (error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "") ||
    (error instanceof Error ? error.message : "");
  const text = raw.trim();
  if (!text) return fallback;

  if (/index\.lock/.test(text)) {
    return "Another git program is busy in this project. Try again in a moment.";
  }
  if (/would be overwritten by (checkout|switch)/i.test(text)) {
    const files = text
      .split("\n")
      .filter((line) => /^\s+\S/.test(line))
      .map((line) => line.trim())
      .slice(0, 5);
    const list = files.length > 0 ? ` in ${files.join(", ")}` : "";
    return `You have unsaved changes${list} that would be lost. Commit them first, then switch.`;
  }
  if (/Please tell me who you are|user\.email|empty ident/i.test(text)) {
    return "Git does not know who you are yet. Open Settings (top right) and add the name and email to put on your saves.";
  }
  if (/nothing (added )?to commit|no changes added to commit/i.test(text)) {
    return "Nothing is marked ready to save yet. Include at least one file first.";
  }
  if (/already exists/i.test(text)) {
    return "A branch with that name already exists. Pick a different name.";
  }
  if (/not a valid (branch|ref) name|is not a valid branch name/i.test(text)) {
    return "That branch name is not allowed. Use letters, numbers, dashes and slashes, with no spaces.";
  }
  if (/invalid reference|did not match any|unknown revision|not a commit/i.test(text)) {
    return "Git could not find that branch or save point.";
  }

  const firstLine = text
    .split("\n")
    .map((line) => line.replace(/^(error|fatal|hint):\s*/i, "").trim())
    .find(Boolean);
  return firstLine || fallback;
}

function safeRepoFiles(repoPath: string, files: string[]): string[] {
  return files.map((file) => {
    if (!file || file.startsWith("-") || file.includes("\0")) {
      throw new Error("Invalid file path.");
    }
    const target = path.resolve(repoPath, file);
    if (!target.startsWith(`${repoPath}${path.sep}`)) {
      throw new Error("Invalid file path.");
    }
    return file;
  });
}

async function hasHeadCommit(repoPath: string): Promise<boolean> {
  return runGit(repoPath, ["rev-parse", "--verify", "HEAD"])
    .then(() => true)
    .catch(() => false);
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export async function stageFiles(repoPath: string, files: string[]): Promise<GitActionResult> {
  const resolvedPath = await assertGitRepository(repoPath);
  const safeFiles = safeRepoFiles(resolvedPath, files);
  await runGit(resolvedPath, ["add", "--", ...safeFiles]);
  return {
    ok: true,
    summary: `${countLabel(safeFiles.length, "file")} will be included in your next save point.`,
    command: `git add -- ${safeFiles.map(quoteArg).join(" ")}`
  };
}

export async function unstageFiles(repoPath: string, files: string[]): Promise<GitActionResult> {
  const resolvedPath = await assertGitRepository(repoPath);
  const safeFiles = safeRepoFiles(resolvedPath, files);
  const args = (await hasHeadCommit(resolvedPath))
    ? ["restore", "--staged", "--", ...safeFiles]
    : ["rm", "--cached", "-q", "--", ...safeFiles];
  await runGit(resolvedPath, args);
  return {
    ok: true,
    summary: `${countLabel(safeFiles.length, "file")} left out of your next save point. Your edits are untouched.`,
    command: `git ${args.filter((arg) => arg !== "-q").map(quoteArg).join(" ")}`
  };
}

export async function commitStaged(repoPath: string, message: string): Promise<GitActionResult> {
  const resolvedPath = await assertGitRepository(repoPath);
  const trimmed = message.trim();
  if (!trimmed) throw new Error("Write a short note describing what you changed.");

  const staged = (await runGit(resolvedPath, ["diff", "--cached", "--name-only", "-z"])).split("\0").filter(Boolean);
  if (staged.length === 0) {
    throw new Error("Nothing is marked ready to save yet. Include at least one file first.");
  }

  await runGit(resolvedPath, ["commit", "-m", trimmed]);
  const hash = (await runGit(resolvedPath, ["rev-parse", "HEAD"])).trim();
  return {
    ok: true,
    summary: `Saved a new save point with ${countLabel(staged.length, "file")}. It exists only on this computer until you push.`,
    command: `git commit -m ${quoteArg(trimmed.split("\n")[0])}`,
    hash
  };
}

export async function switchBranch(repoPath: string, branch: string): Promise<GitActionResult> {
  const resolvedPath = await assertGitRepository(repoPath);
  const safeBranch = validateRefName(branch);
  const exists = await runGit(resolvedPath, ["show-ref", "--verify", "--quiet", `refs/heads/${safeBranch}`])
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    throw new Error(`There is no branch named ${safeBranch} on this computer.`);
  }
  await runGit(resolvedPath, ["switch", safeBranch]);
  return {
    ok: true,
    summary: `Switched to ${safeBranch}. Your files now match that line of work.`,
    command: `git switch ${quoteArg(safeBranch)}`
  };
}

export async function createBranch(repoPath: string, name: string, startPoint?: string): Promise<GitActionResult> {
  const resolvedPath = await assertGitRepository(repoPath);
  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.startsWith("-")) {
    throw new Error("That branch name is not allowed. Use letters, numbers, dashes and slashes, with no spaces.");
  }
  try {
    await runGit(resolvedPath, ["check-ref-format", "--branch", trimmedName]);
  } catch {
    throw new Error("That branch name is not allowed. Use letters, numbers, dashes and slashes, with no spaces.");
  }
  const exists = await runGit(resolvedPath, ["show-ref", "--verify", "--quiet", `refs/heads/${trimmedName}`])
    .then(() => true)
    .catch(() => false);
  if (exists) {
    throw new Error("A branch with that name already exists. Pick a different name.");
  }

  const args = ["switch", "-c", trimmedName];
  if (startPoint && startPoint.trim()) {
    const safeStart = HASH_PATTERN.test(startPoint.trim()) ? validateHash(startPoint) : validateRefName(startPoint);
    await runGit(resolvedPath, ["rev-parse", "--verify", "--quiet", `${safeStart}^{commit}`]);
    args.push(safeStart);
  }
  await runGit(resolvedPath, args);
  return {
    ok: true,
    summary: `Created ${trimmedName} and switched to it. New save points will go on this line of work.`,
    command: `git ${args.map(quoteArg).join(" ")}`
  };
}

/* ---- Folder browser ---- */

const HIDDEN_WINDOWS_FOLDERS = new Set(["system volume information", "recovery", "config.msi", "perflogs", "msocache"]);

async function isDirectory(target: string): Promise<boolean> {
  return stat(target)
    .then((info) => info.isDirectory())
    .catch(() => false);
}

async function hasGitFolder(target: string): Promise<boolean> {
  return access(path.join(target, ".git"))
    .then(() => true)
    .catch(() => false);
}

async function listWindowsDrives(): Promise<FolderPlace[]> {
  const letters = "CDEFGHIJKLMNOPQRSTUVWXYZAB".split("");
  const found = await Promise.all(
    letters.map(async (letter) => ((await isDirectory(`${letter}:\\`)) ? `${letter}:\\` : null))
  );
  return found.filter((drive): drive is string => Boolean(drive)).map((drive) => ({ label: `Drive ${drive.slice(0, 2)}`, path: drive }));
}

async function folderPlaces(): Promise<FolderPlace[]> {
  const home = os.homedir();
  const candidates: FolderPlace[] = [
    { label: "Home", path: home },
    { label: "Desktop", path: path.join(home, "Desktop") },
    { label: "Documents", path: path.join(home, "Documents") },
    { label: "Downloads", path: path.join(home, "Downloads") }
  ];
  const oneDrive = process.env.OneDrive;
  if (oneDrive) {
    candidates.push({ label: "OneDrive", path: oneDrive }, { label: "OneDrive Documents", path: path.join(oneDrive, "Documents") });
  }
  const existing: FolderPlace[] = [];
  const seen = new Set<string>();
  for (const place of candidates) {
    const key = place.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (await isDirectory(place.path)) existing.push(place);
  }
  if (process.platform === "win32") {
    existing.push(...(await listWindowsDrives()));
  } else {
    existing.push({ label: "Computer", path: "/" });
  }
  return existing;
}

/**
 * List the folders inside one folder so the app can offer a point-and-click
 * folder picker. An empty target opens the home folder. On Windows the
 * special target "" with `drives: true` lists the drives.
 */
export async function browseDirectory(target: string | null, showHidden = false): Promise<DirectoryListing> {
  const places = await folderPlaces();

  if (target === null && process.platform === "win32") {
    // "This PC": the list of drives.
    const drives = places.filter((place) => /^[A-Z]:\\$/i.test(place.path));
    return {
      path: null,
      parent: null,
      isGitRepo: false,
      entries: drives.map((drive) => ({ name: drive.label, path: drive.path, isGitRepo: false })),
      places,
      truncated: false
    };
  }

  const resolved = path.resolve(expandHome((target ?? "").trim() || os.homedir()));
  let dirents;
  try {
    dirents = await readdir(resolved, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(`That folder does not exist: ${resolved}`);
    if (code === "ENOTDIR") throw new Error(`That is a file, not a folder: ${resolved}`);
    if (code === "EACCES" || code === "EPERM") throw new Error("You do not have permission to open that folder.");
    throw error;
  }

  const folders = dirents.filter((entry) => {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) return false;
    const lower = entry.name.toLowerCase();
    if (!showHidden && entry.name.startsWith(".")) return false;
    if (process.platform === "win32" && (entry.name.startsWith("$") || HIDDEN_WINDOWS_FOLDERS.has(lower))) return false;
    return true;
  });

  const LIMIT = 400;
  const checked = await Promise.all(
    folders.slice(0, LIMIT).map(async (entry) => {
      const fullPath = path.join(resolved, entry.name);
      if (entry.isSymbolicLink() && !(await isDirectory(fullPath))) return null;
      return { name: entry.name, path: fullPath, isGitRepo: await hasGitFolder(fullPath) };
    })
  );
  const entries = checked
    .filter((entry): entry is DirectoryEntry => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true }));

  const up = path.dirname(resolved);
  const atRoot = up === resolved;
  return {
    path: resolved,
    // On Windows, going up from a drive root shows the list of drives.
    parent: atRoot ? (process.platform === "win32" ? "" : null) : up,
    isGitRepo: await hasGitFolder(resolved),
    entries,
    places,
    truncated: folders.length > LIMIT
  };
}

/* ---- Commit identity (user.name / user.email) ---- */

async function readConfigValue(cwd: string, args: string[]): Promise<string> {
  // `git config --get` exits with 1 when the key is not set; that is not an error here.
  return runGit(cwd, ["config", ...args])
    .then((value) => value.trim())
    .catch(() => "");
}

export async function readIdentity(repoPath?: string | null): Promise<CommitIdentity> {
  const home = os.homedir();
  const globalName = await readConfigValue(home, ["--global", "--get", "user.name"]);
  const globalEmail = await readConfigValue(home, ["--global", "--get", "user.email"]);

  let project: CommitIdentity["project"] = null;
  if (repoPath && repoPath.trim()) {
    try {
      const resolved = await assertGitRepository(repoPath);
      project = {
        path: resolved,
        name: await readConfigValue(resolved, ["--local", "--get", "user.name"]),
        email: await readConfigValue(resolved, ["--local", "--get", "user.email"])
      };
    } catch {
      project = null;
    }
  }

  return {
    global: { name: globalName, email: globalEmail },
    project,
    effective: {
      name: project?.name || globalName,
      email: project?.email || globalEmail
    }
  };
}

export const identitySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .max(100, "That name is too long.")
    .refine((value) => !/[\n\r\0<>]/.test(value), "Names cannot contain line breaks or angle brackets."),
  email: z
    .string()
    .trim()
    .max(200, "That email is too long.")
    .regex(/^[^\s@<>]+@[^\s@<>]+$/, "Enter an email address like you@example.com.")
});

export async function saveIdentity(input: {
  name: string;
  email: string;
  scope: "global" | "project";
  repoPath?: string | null;
}): Promise<GitActionResult> {
  const { name, email } = identitySchema.parse(input);
  if (input.scope === "project") {
    if (!input.repoPath) throw new Error("Open a project first to set a name just for it.");
    const resolved = await assertGitRepository(input.repoPath);
    await runGit(resolved, ["config", "--local", "user.name", name]);
    await runGit(resolved, ["config", "--local", "user.email", email]);
    return {
      ok: true,
      summary: `Saves in this project will now be signed ${name} <${email}>.`,
      command: `git config user.name ${quoteArg(name)} && git config user.email ${quoteArg(email)}`
    };
  }
  const home = os.homedir();
  await runGit(home, ["config", "--global", "user.name", name]);
  await runGit(home, ["config", "--global", "user.email", email]);
  return {
    ok: true,
    summary: `Your saves will now be signed ${name} <${email}>.`,
    command: `git config --global user.name ${quoteArg(name)} && git config --global user.email ${quoteArg(email)}`
  };
}

/** Remove a project-only name and email so the project falls back to the everywhere setting. */
export async function clearProjectIdentity(repoPath: string): Promise<GitActionResult> {
  const resolved = await assertGitRepository(repoPath);
  // --unset exits 5 when the key is missing; that is fine.
  await runGit(resolved, ["config", "--local", "--unset", "user.name"]).catch(() => undefined);
  await runGit(resolved, ["config", "--local", "--unset", "user.email"]).catch(() => undefined);
  return {
    ok: true,
    summary: "This project now uses your everywhere name and email.",
    command: "git config --unset user.name && git config --unset user.email"
  };
}
