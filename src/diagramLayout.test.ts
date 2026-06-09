import { describe, expect, it } from "vitest";
import { layoutCommitDiagram } from "./lib/diagramLayout";
import type { GitCommit } from "./lib/types";

const commits: GitCommit[] = [
  {
    hash: "merge-two",
    shortHash: "merge-t",
    parents: ["main-work", "feature-work"],
    authorName: "Visual Git Demo",
    authorEmail: "demo@example.local",
    date: "2026-06-09T16:20:00-04:00",
    refs: ["HEAD -> main"],
    subject: "Merge feature/example",
    body: ""
  },
  {
    hash: "main-work",
    shortHash: "main-wo",
    parents: ["merge-one"],
    authorName: "Visual Git Demo",
    authorEmail: "demo@example.local",
    date: "2026-06-09T16:15:00-04:00",
    refs: [],
    subject: "Main work",
    body: ""
  },
  {
    hash: "feature-work",
    shortHash: "feature",
    parents: ["merge-one"],
    authorName: "Visual Git Demo",
    authorEmail: "demo@example.local",
    date: "2026-06-09T16:14:00-04:00",
    refs: ["feature/example"],
    subject: "Feature work",
    body: ""
  },
  {
    hash: "merge-one",
    shortHash: "merge-o",
    parents: ["root"],
    authorName: "Visual Git Demo",
    authorEmail: "demo@example.local",
    date: "2026-06-09T16:10:00-04:00",
    refs: [],
    subject: "Earlier merge",
    body: ""
  },
  {
    hash: "root",
    shortHash: "root",
    parents: [],
    authorName: "Visual Git Demo",
    authorEmail: "demo@example.local",
    date: "2026-06-09T16:00:00-04:00",
    refs: [],
    subject: "Initial app",
    body: ""
  }
];

describe("layoutCommitDiagram", () => {
  it("places each commit into a node and keeps parent links as diagram edges", () => {
    const diagram = layoutCommitDiagram(commits);

    expect(diagram.nodes.map((node) => node.hash)).toEqual(["merge-two", "main-work", "feature-work", "merge-one", "root"]);
    expect(diagram.nodes).toHaveLength(5);
    expect(diagram.edges).toHaveLength(5);
    expect(diagram.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "merge-two", to: "main-work", merge: true }),
        expect.objectContaining({ from: "merge-two", to: "feature-work", merge: true }),
        expect.objectContaining({ from: "feature-work", to: "merge-one", merge: false })
      ])
    );
  });

  it("moves alternate merge parents into another column like a node diagram branch", () => {
    const diagram = layoutCommitDiagram(commits);
    const mainWork = diagram.nodes.find((node) => node.hash === "main-work");
    const featureWork = diagram.nodes.find((node) => node.hash === "feature-work");
    const root = diagram.nodes.find((node) => node.hash === "root");

    expect(mainWork?.column).toBe(0);
    expect(featureWork?.column).toBeGreaterThan(0);
    expect(root?.column).toBe(0);
    expect(diagram.width).toBeGreaterThan(600);
    expect(diagram.height).toBeGreaterThan(500);
  });
});
