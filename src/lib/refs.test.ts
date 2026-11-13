import { describe, expect, it } from "vitest";
import { refClass, refLabel, resolveRefs, sortRefsForDisplay, tagKey } from "./refs";
import type { GitCommit, GitRef, GitRepositorySnapshot } from "./types";

function commit(partial: Partial<GitCommit> & Pick<GitCommit, "hash">): GitCommit {
  const date = partial.date ?? "2026-06-09T16:00:00-04:00";
  return {
    shortHash: partial.hash.slice(0, 7),
    parents: [],
    authorName: "Demo",
    authorEmail: "demo@example.local",
    date,
    committerDate: partial.committerDate ?? date,
    refs: [],
    subject: "subject",
    body: "",
    ...partial
  };
}

function snapshot(partial: Partial<GitRepositorySnapshot>): GitRepositorySnapshot {
  return {
    path: "/repo",
    name: "repo",
    currentBranch: "main",
    defaultBranch: "main",
    head: "",
    remotes: [],
    status: { clean: true, files: [] },
    commits: [],
    truncated: false,
    ...partial
  };
}

describe("resolveRefs", () => {
  it("resolves branches that are substrings of one another to the correct commit", () => {
    const snap = snapshot({
      commits: [
        commit({ hash: "aaa1111", refs: [{ kind: "local", name: "feature", isCurrent: false }] }),
        commit({ hash: "bbb2222", refs: [{ kind: "local", name: "feature/older", isCurrent: false }] })
      ]
    });

    const resolved = resolveRefs(snap);

    expect(resolved.local).toEqual(["feature", "feature/older"]);
    expect(resolved.refToHash.get("feature")).toBe("aaa1111");
    expect(resolved.refToHash.get("feature/older")).toBe("bbb2222");
  });

  it("keys tags separately from branches", () => {
    const snap = snapshot({
      commits: [
        commit({
          hash: "ccc3333",
          refs: [
            { kind: "tag", name: "v1.0.0" },
            { kind: "local", name: "release", isCurrent: false }
          ]
        })
      ]
    });

    const resolved = resolveRefs(snap);

    expect(resolved.tags).toEqual(["v1.0.0"]);
    expect(resolved.local).toEqual(["release"]);
    expect(resolved.refToHash.get(tagKey("v1.0.0"))).toBe("ccc3333");
    expect(resolved.refToHash.get("release")).toBe("ccc3333");
  });

  it("separates remote and local refs using structured ref kinds", () => {
    const snap = snapshot({
      remotes: ["origin", "upstream"],
      commits: [
        commit({
          hash: "ddd4444",
          refs: [{ kind: "remote", name: "origin/main", remote: "origin", branch: "main" }]
        }),
        commit({
          hash: "eee5555",
          refs: [{ kind: "remote", name: "upstream/dev", remote: "upstream", branch: "dev" }]
        }),
        commit({ hash: "fff6666", refs: [{ kind: "local", name: "main", isCurrent: false }] })
      ]
    });

    const resolved = resolveRefs(snap);

    expect(resolved.remote).toEqual(["origin/main", "upstream/dev"]);
    expect(resolved.local).toEqual(["main"]);
    expect(resolved.refToHash.get("origin/main")).toBe("ddd4444");
    expect(resolved.refToHash.get("upstream/dev")).toBe("eee5555");
  });

  it("tracks current branch and ignores bare detached HEAD in refToHash", () => {
    const snap = snapshot({
      currentBranch: "main",
      commits: [
        commit({ hash: "1112221", refs: [{ kind: "local", name: "main", isCurrent: true }] }),
        commit({ hash: "3334443", refs: [{ kind: "head", name: "HEAD" }] })
      ]
    });

    const resolved = resolveRefs(snap);

    expect(resolved.local).toEqual(["main"]);
    expect(resolved.refToHash.get("main")).toBe("1112221");
    expect(resolved.refToHash.has("HEAD")).toBe(false);
    expect(resolved.currentBranch).toBe("main");
  });

  it("sorts and formats refs for display badges", () => {
    const refs: GitRef[] = [
      { kind: "head", name: "HEAD" },
      { kind: "remote", name: "origin/main", remote: "origin", branch: "main" },
      { kind: "tag", name: "v1.0" },
      { kind: "local", name: "other", isCurrent: false },
      { kind: "local", name: "main", isCurrent: true }
    ];

    const sorted = sortRefsForDisplay(refs);
    expect(sorted.map(refLabel)).toEqual(["main", "other", "v1.0", "origin/main", "HEAD"]);
    expect(sorted.map(refClass)).toEqual(["ref-head", "ref-local", "ref-tag", "ref-remote", "ref-head"]);
  });
});
