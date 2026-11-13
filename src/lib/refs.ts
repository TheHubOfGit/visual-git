import type { GitRef, GitRepositorySnapshot } from "./types";

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

export function tagKey(name: string): string {
  return `tag:${name}`;
}

/** Short display label for a ref badge. */
export function refLabel(ref: GitRef): string {
  return ref.name;
}

/** CSS modifier for a ref badge. */
export function refClass(ref: GitRef): string {
  if (ref.kind === "head" || (ref.kind === "local" && ref.isCurrent)) return "ref-head";
  if (ref.kind === "tag") return "ref-tag";
  if (ref.kind === "remote") return "ref-remote";
  return "ref-local";
}

/** Badge order: current branch, other locals, tags, remotes, detached HEAD. */
export function sortRefsForDisplay(refs: GitRef[]): GitRef[] {
  const rank = (ref: GitRef) =>
    ref.kind === "local" ? (ref.isCurrent ? 0 : 1) : ref.kind === "tag" ? 2 : ref.kind === "remote" ? 3 : 4;
  return [...refs].sort((left, right) => rank(left) - rank(right));
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
    for (const ref of commit.refs) {
      if (ref.kind === "tag") {
        tags.add(ref.name);
        refToHash.set(tagKey(ref.name), commit.hash);
      } else if (ref.kind === "remote") {
        remote.add(ref.name);
        refToHash.set(ref.name, commit.hash);
      } else if (ref.kind === "local") {
        local.add(ref.name);
        refToHash.set(ref.name, commit.hash);
      }
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
