import type { GitRepositorySnapshot } from "./lib/types";

export async function loadRepository(path: string, maxCount = 300): Promise<GitRepositorySnapshot> {
  const response = await fetch("/api/repository", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, maxCount })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Unable to load repository.");
  }

  return data as GitRepositorySnapshot;
}
