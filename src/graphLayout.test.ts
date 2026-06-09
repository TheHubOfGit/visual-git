import { describe, expect, it } from "vitest";
import { layoutCommitGraph } from "./lib/graphLayout";
import type { GitCommit } from "./lib/types";

const commits: GitCommit[] = [
  {
    hash: "m",
    shortHash: "m",
    parents: ["f", "b"],
    authorName: "Ada",
    authorEmail: "ada@example.com",
    date: "2026-01-04T10:00:00-05:00",
    refs: ["HEAD -> main"],
    subject: "Merge feature",
    body: ""
  },
  {
    hash: "f",
    shortHash: "f",
    parents: ["r"],
    authorName: "Grace",
    authorEmail: "grace@example.com",
    date: "2026-01-03T10:00:00-05:00",
    refs: ["feature"],
    subject: "Feature work",
    body: ""
  },
  {
    hash: "b",
    shortHash: "b",
    parents: ["r"],
    authorName: "Linus",
    authorEmail: "linus@example.com",
    date: "2026-01-02T10:00:00-05:00",
    refs: ["main"],
    subject: "Base work",
    body: ""
  },
  {
    hash: "r",
    shortHash: "r",
    parents: [],
    authorName: "Ada",
    authorEmail: "ada@example.com",
    date: "2026-01-01T10:00:00-05:00",
    refs: [],
    subject: "Root",
    body: ""
  }
];

describe("layoutCommitGraph", () => {
  it("assigns stable lanes and paths for branch and merge history", () => {
    const graph = layoutCommitGraph(commits);

    expect(graph.rows.map((row) => row.hash)).toEqual(["m", "f", "b", "r"]);
    expect(graph.rows.map((row) => row.lane)).toEqual([0, 0, 1, 0]);
    expect(graph.lanes).toBe(2);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "m", to: "f", fromLane: 0, toLane: 0 }),
        expect.objectContaining({ from: "m", to: "b", fromLane: 0, toLane: 1 }),
        expect.objectContaining({ from: "b", to: "r", fromLane: 1, toLane: 0 })
      ])
    );
  });
});
