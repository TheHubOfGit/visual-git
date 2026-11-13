import { describe, expect, it } from "vitest";
import { parseChangedFiles, parseDecoration, parseGitLog } from "./lib/gitLog";

const sampleLog = [
  "a1\u001fb0 c0\u001fAda Lovelace\u001fada@example.com\u001f2026-01-04T10:00:00-05:00\u001f2026-01-04T10:05:00-05:00\u001fHEAD -> refs/heads/main, tag: refs/tags/v1.0, refs/remotes/origin/main, refs/remotes/origin/HEAD\u001fMerge branch 'feature'\u001f",
  "b0\u001fd9\u001fGrace Hopper\u001fgrace@example.com\u001f2026-01-03T09:00:00-05:00\u001f2026-01-03T09:00:00-05:00\u001frefs/heads/feature\u001fAdd graph lanes\u001fMore body text",
  "c0\u001fd9\u001fLinus Torvalds\u001flinus@example.com\u001f2026-01-02T08:00:00-05:00\u001f2026-01-02T08:00:00-05:00\u001f\u001fTighten API\u001f",
  "d9\u001f\u001fAda Lovelace\u001fada@example.com\u001f2026-01-01T07:00:00-05:00\u001f2026-01-01T07:00:00-05:00\u001frefs/heads/main\u001fInitial commit\u001f"
].join("\u001e");

describe("parseGitLog", () => {
  it("parses commits, parents, structured refs, committerDate, and subject fields", () => {
    const commits = parseGitLog(sampleLog);

    expect(commits).toHaveLength(4);
    expect(commits[0]).toMatchObject({
      hash: "a1",
      parents: ["b0", "c0"],
      authorName: "Ada Lovelace",
      date: "2026-01-04T10:00:00-05:00",
      committerDate: "2026-01-04T10:05:00-05:00",
      subject: "Merge branch 'feature'"
    });
    expect(commits[0].refs).toEqual([
      { kind: "local", name: "main", isCurrent: true },
      { kind: "tag", name: "v1.0" },
      { kind: "remote", name: "origin/main", remote: "origin", branch: "main" }
    ]);
    expect(commits[1].body).toBe("More body text");
    expect(commits[3].parents).toEqual([]);
  });

  it("ignores empty records from trailing separators", () => {
    expect(parseGitLog(`${sampleLog}\u001e`)).toHaveLength(4);
  });

  it("removes git log record newlines so parent hashes match commit hashes", () => {
    const commits = parseGitLog(
      "parent\u001f\u001fA\u001fa@example.com\u001f2026-01-01T00:00:00Z\u001f2026-01-01T00:00:00Z\u001f\u001fParent\u001f\u001e\nchild\u001fparent\u001fA\u001fa@example.com\u001f2026-01-02T00:00:00Z\u001f2026-01-02T00:00:00Z\u001f\u001fChild\u001f"
    );

    expect(commits[1].hash).toBe("child");
    expect(commits[1].parents).toEqual(["parent"]);
  });
});

describe("parseDecoration", () => {
  it("classifies local, remote, tag, and detached HEAD, and skips internal/symbolic refs", () => {
    expect(parseDecoration("HEAD -> refs/heads/feat/x")).toEqual({
      kind: "local",
      name: "feat/x",
      isCurrent: true
    });
    expect(parseDecoration("refs/remotes/upstream/dev/main")).toEqual({
      kind: "remote",
      name: "upstream/dev/main",
      remote: "upstream",
      branch: "dev/main"
    });
    expect(parseDecoration("tag: refs/tags/v2.0.0")).toEqual({ kind: "tag", name: "v2.0.0" });
    expect(parseDecoration("HEAD")).toEqual({ kind: "head", name: "HEAD" });
    expect(parseDecoration("refs/remotes/origin/HEAD")).toBeNull();
    expect(parseDecoration("refs/stash")).toBeNull();
    expect(parseDecoration("refs/t3/checkpoints/abc")).toBeNull();
  });
});

describe("parseChangedFiles", () => {
  it("merges name-status and numstat outputs including renames and binary files", () => {
    const nameStatus = [
      "M",
      "src/app.ts",
      "R100",
      "src/old.ts",
      "src/new.ts",
      "A",
      "assets/logo.png",
      ""
    ].join("\0");

    const numstat = [
      "12\t3\tsrc/app.ts",
      "4\t2\t",
      "src/old.ts",
      "src/new.ts",
      "-\t-\tassets/logo.png",
      ""
    ].join("\0");

    expect(parseChangedFiles(nameStatus, numstat)).toEqual([
      { path: "src/app.ts", status: "M", additions: 12, deletions: 3 },
      { path: "src/new.ts", oldPath: "src/old.ts", status: "R", additions: 4, deletions: 2 },
      { path: "assets/logo.png", status: "A", additions: null, deletions: null }
    ]);
  });
});
