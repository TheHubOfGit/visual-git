import { describe, expect, it } from "vitest";
import { layoutCommitDiagram } from "./lib/diagramLayout";
import type { GitCommit } from "./lib/types";

function makeCommit(partial: Partial<GitCommit> & Pick<GitCommit, "hash">): GitCommit {
  const date = partial.date ?? "2026-06-09T16:00:00-04:00";
  return {
    shortHash: partial.hash.slice(0, 7),
    parents: [],
    authorName: "Visual Git Demo",
    authorEmail: "demo@example.local",
    date,
    committerDate: partial.committerDate ?? date,
    refs: [],
    subject: partial.hash,
    body: "",
    ...partial
  };
}

const commits: GitCommit[] = [
  makeCommit({
    hash: "merge-two",
    parents: ["main-work", "feature-work"],
    date: "2026-06-09T16:20:00-04:00",
    refs: [{ kind: "local", name: "main", isCurrent: true }],
    subject: "Merge feature/example"
  }),
  makeCommit({
    hash: "main-work",
    parents: ["merge-one"],
    date: "2026-06-09T16:15:00-04:00",
    subject: "Main work"
  }),
  makeCommit({
    hash: "feature-work",
    parents: ["merge-one"],
    date: "2026-06-09T16:14:00-04:00",
    refs: [{ kind: "local", name: "feature/example", isCurrent: false }],
    subject: "Feature work"
  }),
  makeCommit({
    hash: "merge-one",
    parents: ["root"],
    date: "2026-06-09T16:10:00-04:00",
    subject: "Earlier merge"
  }),
  makeCommit({
    hash: "root",
    parents: [],
    date: "2026-06-09T16:00:00-04:00",
    subject: "Initial app"
  })
];

describe("layoutCommitDiagram", () => {
  it("places each commit into a node and keeps parent links as diagram edges", () => {
    const diagram = layoutCommitDiagram(commits);

    expect(diagram.nodes.map((node) => node.hash)).toEqual([
      "root",
      "merge-one",
      "feature-work",
      "main-work",
      "merge-two"
    ]);
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

  it("never places a rebased child above its parent even when author date is older", () => {
    const rebased: GitCommit[] = [
      makeCommit({
        hash: "rebased-child",
        parents: ["newer-parent"],
        date: "2026-01-01T10:00:00Z", // Older author date (preserved by rebase)
        committerDate: "2026-01-05T10:00:00Z",
        refs: [{ kind: "local", name: "main", isCurrent: true }]
      }),
      makeCommit({
        hash: "newer-parent",
        parents: ["root"],
        date: "2026-01-04T10:00:00Z",
        committerDate: "2026-01-04T10:00:00Z"
      }),
      makeCommit({
        hash: "root",
        parents: [],
        date: "2026-01-02T10:00:00Z"
      })
    ];

    const diagram = layoutCommitDiagram(rebased);
    expect(diagram.nodes.map((node) => node.hash)).toEqual(["root", "newer-parent", "rebased-child"]);
    expect(diagram.edges.every((edge) => edge.fromY < edge.toY)).toBe(true);
  });

  it("enforces topological order even if committer dates have clock skew", () => {
    const skewed: GitCommit[] = [
      makeCommit({
        hash: "child",
        parents: ["parent"],
        date: "2026-01-01T00:00:00Z",
        committerDate: "2026-01-01T00:00:00Z",
        refs: [{ kind: "local", name: "main", isCurrent: true }]
      }),
      makeCommit({
        hash: "parent",
        parents: [],
        date: "2026-06-01T00:00:00Z",
        committerDate: "2026-06-01T00:00:00Z"
      })
    ];

    const diagram = layoutCommitDiagram(skewed);
    expect(diagram.nodes.map((node) => node.hash)).toEqual(["parent", "child"]);
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

  it("uses the repository's defaultBranch instead of creating an empty main lane", () => {
    const masterCommits: GitCommit[] = [
      makeCommit({
        hash: "m2",
        parents: ["m1"],
        date: "2026-06-09T16:10:00-04:00",
        refs: [{ kind: "local", name: "master", isCurrent: true }]
      }),
      makeCommit({
        hash: "m1",
        parents: [],
        date: "2026-06-09T16:00:00-04:00"
      })
    ];

    const diagram = layoutCommitDiagram(masterCommits, { defaultBranch: "master" });
    expect(diagram.lanes.map((lane) => lane.name)).toEqual(["master"]);
    expect(diagram.nodes.every((node) => node.laneName === "master")).toBe(true);
  });

  it("keeps a merge-from-main commit on its feature branch instead of forcing it to main", () => {
    const featureMergeCommits: GitCommit[] = [
      makeCommit({
        hash: "feat-tip",
        parents: ["feat-merge"],
        date: "2026-06-09T16:30:00-04:00",
        refs: [{ kind: "local", name: "feature/x", isCurrent: true }]
      }),
      makeCommit({
        hash: "feat-merge",
        parents: ["feat-1", "main-tip"],
        date: "2026-06-09T16:25:00-04:00",
        subject: "Merge main into feature/x"
      }),
      makeCommit({
        hash: "main-tip",
        parents: ["root"],
        date: "2026-06-09T16:20:00-04:00",
        refs: [{ kind: "local", name: "main", isCurrent: false }]
      }),
      makeCommit({
        hash: "feat-1",
        parents: ["root"],
        date: "2026-06-09T16:10:00-04:00"
      }),
      makeCommit({
        hash: "root",
        parents: [],
        date: "2026-06-09T16:00:00-04:00"
      })
    ];

    const diagram = layoutCommitDiagram(featureMergeCommits, { defaultBranch: "main" });
    const featMerge = diagram.nodes.find((node) => node.hash === "feat-merge");
    expect(featMerge?.laneName).toBe("feature/x");
  });

  it("derives a deleted branch lane name from merge subjects", () => {
    const mergedBranch: GitCommit[] = [
      makeCommit({
        hash: "merge",
        parents: ["root", "branch-tip"],
        date: "2026-06-09T16:20:00-04:00",
        refs: [{ kind: "local", name: "main", isCurrent: true }],
        subject: "Merge branch 'feature/cleanup'"
      }),
      makeCommit({
        hash: "branch-tip",
        parents: ["root"],
        date: "2026-06-09T16:10:00-04:00"
      }),
      makeCommit({
        hash: "root",
        parents: [],
        date: "2026-06-09T16:00:00-04:00"
      })
    ];

    const diagram = layoutCommitDiagram(mergedBranch);
    expect(diagram.lanes.map((lane) => lane.name)).toEqual(["main", "feature/cleanup"]);
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
      makeCommit({
        hash: "head",
        parents: ["root"],
        date: "2026-06-09T12:00:00-04:00",
        refs: [{ kind: "local", name: "main", isCurrent: true }],
        subject: "Main head"
      }),
      makeCommit({
        hash: "feature-new",
        parents: ["root"],
        date: "2026-06-08T12:00:00-04:00",
        refs: [{ kind: "local", name: "feature/newer", isCurrent: false }],
        subject: "Newer feature"
      }),
      makeCommit({
        hash: "hotfix",
        parents: ["root"],
        date: "2026-06-05T12:00:00-04:00",
        refs: [{ kind: "local", name: "hotfix/patch", isCurrent: false }],
        subject: "Hotfix"
      }),
      makeCommit({
        hash: "feature-old",
        parents: ["root"],
        date: "2026-06-01T12:00:00-04:00",
        refs: [{ kind: "local", name: "feature/older", isCurrent: false }],
        subject: "Older feature"
      }),
      makeCommit({
        hash: "release",
        parents: ["root"],
        date: "2026-06-03T12:00:00-04:00",
        refs: [{ kind: "local", name: "release/candidate", isCurrent: false }],
        subject: "Release"
      }),
      makeCommit({
        hash: "experiment",
        parents: ["root"],
        date: "2026-06-02T12:00:00-04:00",
        refs: [{ kind: "local", name: "experiment/spike", isCurrent: false }],
        subject: "Experiment"
      }),
      makeCommit({
        hash: "root",
        parents: [],
        date: "2026-05-30T12:00:00-04:00",
        subject: "Root"
      })
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
