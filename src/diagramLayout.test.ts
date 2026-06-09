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

    expect(diagram.nodes.map((node) => node.hash)).toEqual(["root", "merge-one", "feature-work", "main-work", "merge-two"]);
    expect(diagram.nodes).toHaveLength(5);
    expect(diagram.edges).toHaveLength(5);
    expect(diagram.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "main-work", to: "merge-two", merge: true }),
        expect.objectContaining({ from: "feature-work", to: "merge-two", merge: true }),
        expect.objectContaining({ from: "merge-one", to: "feature-work", merge: false })
      ])
    );
  });

  it("positions parent commits above their child commits", () => {
    const diagram = layoutCommitDiagram(commits);
    const root = diagram.nodes.find((node) => node.hash === "root");
    const mergeOne = diagram.nodes.find((node) => node.hash === "merge-one");
    const mergeTwo = diagram.nodes.find((node) => node.hash === "merge-two");

    expect(root?.y).toBeLessThan(mergeOne?.y ?? 0);
    expect(mergeOne?.y).toBeLessThan(mergeTwo?.y ?? 0);
    expect(diagram.edges.every((edge) => edge.fromY < edge.toY)).toBe(true);
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

  it("creates named vertical lanes from branch refs and keeps merges on main", () => {
    const diagram = layoutCommitDiagram(commits);
    const mergeTwo = diagram.nodes.find((node) => node.hash === "merge-two");
    const featureWork = diagram.nodes.find((node) => node.hash === "feature-work");

    expect(diagram.lanes.map((lane) => lane.name)).toEqual(["main", "feature/example"]);
    expect(mergeTwo?.laneName).toBe("main");
    expect(featureWork?.laneName).toBe("feature/example");
    expect(featureWork?.column).toBe(diagram.lanes.find((lane) => lane.name === "feature/example")?.column);
  });

  it("orders lanes by absolute oldest visible commit date after main", () => {
    const branchOrderCommits: GitCommit[] = [
      {
        hash: "head",
        shortHash: "head",
        parents: ["root"],
        authorName: "Visual Git Demo",
        authorEmail: "demo@example.local",
        date: "2026-06-09T12:00:00-04:00",
        refs: ["HEAD -> main"],
        subject: "Main head",
        body: ""
      },
      {
        hash: "feature-new",
        shortHash: "feature",
        parents: ["root"],
        authorName: "Visual Git Demo",
        authorEmail: "demo@example.local",
        date: "2026-06-08T12:00:00-04:00",
        refs: ["feature/newer"],
        subject: "Newer feature",
        body: ""
      },
      {
        hash: "hotfix",
        shortHash: "hotfix",
        parents: ["root"],
        authorName: "Visual Git Demo",
        authorEmail: "demo@example.local",
        date: "2026-06-05T12:00:00-04:00",
        refs: ["hotfix/patch"],
        subject: "Hotfix",
        body: ""
      },
      {
        hash: "feature-old",
        shortHash: "feature",
        parents: ["root"],
        authorName: "Visual Git Demo",
        authorEmail: "demo@example.local",
        date: "2026-06-01T12:00:00-04:00",
        refs: ["feature/older"],
        subject: "Older feature",
        body: ""
      },
      {
        hash: "release",
        shortHash: "release",
        parents: ["root"],
        authorName: "Visual Git Demo",
        authorEmail: "demo@example.local",
        date: "2026-06-03T12:00:00-04:00",
        refs: ["release/candidate"],
        subject: "Release",
        body: ""
      },
      {
        hash: "experiment",
        shortHash: "experim",
        parents: ["root"],
        authorName: "Visual Git Demo",
        authorEmail: "demo@example.local",
        date: "2026-06-02T12:00:00-04:00",
        refs: ["experiment/spike"],
        subject: "Experiment",
        body: ""
      },
      {
        hash: "root",
        shortHash: "root",
        parents: [],
        authorName: "Visual Git Demo",
        authorEmail: "demo@example.local",
        date: "2026-05-30T12:00:00-04:00",
        refs: [],
        subject: "Root",
        body: ""
      }
    ];

    const diagram = layoutCommitDiagram(branchOrderCommits);

    expect(diagram.lanes.map((lane) => lane.name)).toEqual([
      "main",
      "feature/older",
      "experiment/spike",
      "release/candidate",
      "hotfix/patch",
      "feature/newer"
    ]);
  });
});
