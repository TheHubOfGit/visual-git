import { describe, expect, it } from "vitest";
import { resolveRefs, tagKey } from "./refs";
import type { GitCommit, GitRepositorySnapshot } from "./types";

function commit(partial: Partial<GitCommit> & Pick<GitCommit, "hash">): GitCommit {
  return {
    shortHash: partial.hash.slice(0, 7),
    parents: [],
    authorName: "Demo",
    authorEmail: "demo@example.local",
    date: "2026-06-09T16:00:00-04:00",
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
    head: "",
    remotes: [],
    status: { clean: true, files: [] },
    commits: [],
    ...partial
  };
}

describe("resolveRefs", () => {
  it("resolves branches that are substrings of one another to the correct commit", () => {
    const snap = snapshot({
      commits: [
        commit({ hash: "aaa1111", refs: ["feature"] }),
        commit({ hash: "bbb2222", refs: ["feature/older"] })
      ]
    });

    const resolved = resolveRefs(snap);

    expect(resolved.local).toEqual(["feature", "feature/older"]);
    expect(resolved.refToHash.get("feature")).toBe("aaa1111");
    expect(resolved.refToHash.get("feature/older")).toBe("bbb2222");
  });

  it("strips the tag: prefix and keys tags separately from branches", () => {
    const snap = snapshot({
      commits: [commit({ hash: "ccc3333", refs: ["tag: v1.0.0", "release"] })]
    });

    const resolved = resolveRefs(snap);

    expect(resolved.tags).toEqual(["v1.0.0"]);
    expect(resolved.local).toEqual(["release"]);
    expect(resolved.refToHash.get(tagKey("v1.0.0"))).toBe("ccc3333");
    expect(resolved.refToHash.get("release")).toBe("ccc3333");
  });

  it("classifies remote refs using origin/ and the configured remotes", () => {
    const snap = snapshot({
      remotes: ["origin", "upstream"],
      commits: [
        commit({ hash: "ddd4444", refs: ["origin/main"] }),
        commit({ hash: "eee5555", refs: ["upstream/dev"] }),
        commit({ hash: "fff6666", refs: ["main"] })
      ]
    });

    const resolved = resolveRefs(snap);

    expect(resolved.remote).toEqual(["origin/main", "upstream/dev"]);
    expect(resolved.local).toEqual(["main"]);
    expect(resolved.refToHash.get("origin/main")).toBe("ddd4444");
    expect(resolved.refToHash.get("upstream/dev")).toBe("eee5555");
  });

  it("strips HEAD -> decoration and ignores a bare detached HEAD", () => {
    const snap = snapshot({
      currentBranch: "main",
      commits: [
        commit({ hash: "1112221", refs: ["HEAD -> main"] }),
        commit({ hash: "3334443", refs: ["HEAD"] })
      ]
    });

    const resolved = resolveRefs(snap);

    expect(resolved.local).toEqual(["main"]);
    expect(resolved.refToHash.get("main")).toBe("1112221");
    expect(resolved.refToHash.has("HEAD")).toBe(false);
    expect(resolved.currentBranch).toBe("main");
  });
});
