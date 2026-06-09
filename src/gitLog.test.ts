import { describe, expect, it } from "vitest";
import { parseGitLog } from "./lib/gitLog";

const sampleLog = [
  "a1\u001fb0 c0\u001fAda Lovelace\u001fada@example.com\u001f2026-01-04T10:00:00-05:00\u001fHEAD -> main, tag: v1.0\u001fMerge branch 'feature'\u001f",
  "b0\u001fd9\u001fGrace Hopper\u001fgrace@example.com\u001f2026-01-03T09:00:00-05:00\u001ffeature\u001fAdd graph lanes\u001fMore body text",
  "c0\u001fd9\u001fLinus Torvalds\u001flinus@example.com\u001f2026-01-02T08:00:00-05:00\u001f\u001fTighten API\u001f",
  "d9\u001f\u001fAda Lovelace\u001fada@example.com\u001f2026-01-01T07:00:00-05:00\u001fmain\u001fInitial commit\u001f"
].join("\u001e");

describe("parseGitLog", () => {
  it("parses commits, parents, refs, and subject fields from git log delimiters", () => {
    const commits = parseGitLog(sampleLog);

    expect(commits).toHaveLength(4);
    expect(commits[0]).toMatchObject({
      hash: "a1",
      parents: ["b0", "c0"],
      authorName: "Ada Lovelace",
      subject: "Merge branch 'feature'"
    });
    expect(commits[0].refs).toEqual(["HEAD -> main", "tag: v1.0"]);
    expect(commits[1].body).toBe("More body text");
    expect(commits[3].parents).toEqual([]);
  });

  it("ignores empty records from trailing separators", () => {
    expect(parseGitLog(`${sampleLog}\u001e`)).toHaveLength(4);
  });

  it("removes git log record newlines so parent hashes match commit hashes", () => {
    const commits = parseGitLog("parent\u001f\u001fA\u001fa@example.com\u001f2026-01-01T00:00:00Z\u001f\u001fParent\u001f\u001e\nchild\u001fparent\u001fA\u001fa@example.com\u001f2026-01-02T00:00:00Z\u001f\u001fChild\u001f");

    expect(commits[1].hash).toBe("child");
    expect(commits[1].parents).toEqual(["parent"]);
  });
});
