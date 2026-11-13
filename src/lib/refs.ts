import type { GitRepositorySnapshot } from "./types";

/**
 * Categorized, exactly-resolvable view of a repository's refs.
 *
 * `refToHash` is keyed by normalized identifiers so a click maps to exactly
 * one commit (no substring matching):
 *   - local branches:  the branch name            e.g. "feature/older"
 *   - remote branches: the full remote ref         e.g. "origin/main"
 *   - tags:            `tag:<name>`                e.g. "tag:v1.0.0"
 */
export type ResolvedRefs = {
  local: string[];
  remote: string[];
  tags: string[];
  currentBranch: string;
  refToHash: Map<string, string>;
};

const HEAD_PREFIX = "HEAD -> ";
const TAG_PREFIX = "tag: ";

export function tagKey(name: string): string {
  return `tag:${name}`;
}

function isRemoteRef(ref: string, remotes: string[]): boolean {
  if (ref.startsWith("origin/")) return true;
  return remotes.some((remote) => ref.startsWith(`${remote}/`));
}

/**
 * Build a categorized, exact-resolution view of the snapshot's refs.
 * Pure: depends only on the provided snapshot.
 */
export function resolveRefs(snapshot: GitRepositorySnapshot): ResolvedRefs {
  const local = new Set<string>();
  const remote = new Set<string>();
  const tags = new Set<string>();
  const refToHash = new Map<string, string>();

  for (const commit of snapshot.commits) {
    for (const rawRef of commit.refs) {
      const ref = rawRef.trim();
      if (!ref) continue;

      if (ref.startsWith(TAG_PREFIX)) {
        const name = ref.slice(TAG_PREFIX.length).trim();
        if (!name) continue;
        tags.add(name);
        refToHash.set(tagKey(name), commit.hash);
        continue;
      }

      // Strip a leading "HEAD -> " (current branch decoration).
      const name = ref.startsWith(HEAD_PREFIX) ? ref.slice(HEAD_PREFIX.length).trim() : ref;

      // A bare detached HEAD carries no branch identity.
      if (!name || name === "HEAD") continue;

      if (isRemoteRef(name, snapshot.remotes)) {
        remote.add(name);
      } else {
        local.add(name);
      }
      refToHash.set(name, commit.hash);
    }
  }

  return {
    local: Array.from(local).sort(),
    remote: Array.from(remote).sort(),
    tags: Array.from(tags).sort(),
    currentBranch: snapshot.currentBranch,
    refToHash
  };
}
