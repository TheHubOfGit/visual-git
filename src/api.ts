import type {
  AppConfig,
  DirectoryEntry,
  GitBranchComparison,
  GitCommitDetails,
  GitFileDiff,
  GitRepositorySnapshot
} from "./lib/types";

async function postJson<T>(url: string, body: unknown, fallbackError: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? fallbackError);
  }
  return data as T;
}

export async function loadConfig(): Promise<AppConfig> {
  const response = await fetch("/api/config");
  if (!response.ok) {
    return { defaultRepoPath: null };
  }
  return (await response.json()) as AppConfig;
}

export function loadRepository(path: string, maxCount = 300): Promise<GitRepositorySnapshot> {
  return postJson<GitRepositorySnapshot>("/api/repository", { path, maxCount }, "Unable to load repository.");
}

export function loadCommitDetails(
  path: string,
  hash: string,
  signal?: AbortSignal
): Promise<GitCommitDetails> {
  return postJson<GitCommitDetails>("/api/commit", { path, hash }, "Unable to load commit details.", signal);
}

export function loadCommitFileDiff(
  path: string,
  hash: string,
  filePath: string,
  oldPath?: string,
  signal?: AbortSignal
): Promise<GitFileDiff> {
  return postJson<GitFileDiff>(
    "/api/commit/diff",
    { path, hash, filePath, oldPath },
    "Unable to load file diff.",
    signal
  );
}

export function loadWorkingFileDiff(
  path: string,
  filePath: string,
  signal?: AbortSignal
): Promise<GitFileDiff> {
  return postJson<GitFileDiff>(
    "/api/working-diff",
    { path, filePath },
    "Unable to load working tree diff.",
    signal
  );
}

export function compareBranches(
  path: string,
  base: string,
  head: string,
  signal?: AbortSignal
): Promise<GitBranchComparison> {
  return postJson<GitBranchComparison>(
    "/api/compare",
    { path, base, head },
    "Unable to compare branches.",
    signal
  );
}

export function loadBranchFileDiff(
  path: string,
  base: string,
  head: string,
  filePath: string,
  oldPath?: string,
  signal?: AbortSignal
): Promise<GitFileDiff> {
  return postJson<GitFileDiff>(
    "/api/compare/diff",
    { path, base, head, filePath, oldPath },
    "Unable to load comparison diff.",
    signal
  );
}

export async function suggestDirectories(prefix: string, signal?: AbortSignal): Promise<DirectoryEntry[]> {
  const data = await postJson<{ entries: DirectoryEntry[] }>(
    "/api/directories",
    { prefix },
    "Unable to list directories.",
    signal
  );
  return data.entries;
}
