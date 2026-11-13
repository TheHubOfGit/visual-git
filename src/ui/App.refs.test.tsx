import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitCommitDetails, GitFileDiff, GitRepositorySnapshot } from "../lib/types";

const loadConfig = vi.fn();
const loadRepository = vi.fn();
const loadCommitDetails = vi.fn();
const loadCommitFileDiff = vi.fn();
const loadWorkingFileDiff = vi.fn();
const compareBranches = vi.fn();
const loadBranchFileDiff = vi.fn();
const suggestDirectories = vi.fn();

vi.mock("../api", () => ({
  loadConfig: () => loadConfig(),
  loadRepository: (path: string, maxCount?: number) => loadRepository(path, maxCount),
  loadCommitDetails: (path: string, hash: string) => loadCommitDetails(path, hash),
  loadCommitFileDiff: (path: string, hash: string, filePath: string, oldPath?: string) =>
    loadCommitFileDiff(path, hash, filePath, oldPath),
  loadWorkingFileDiff: (path: string, filePath: string) => loadWorkingFileDiff(path, filePath),
  compareBranches: (path: string, base: string, head: string) => compareBranches(path, base, head),
  loadBranchFileDiff: (path: string, base: string, head: string, filePath: string, oldPath?: string) =>
    loadBranchFileDiff(path, base, head, filePath, oldPath),
  suggestDirectories: (prefix: string) => suggestDirectories(prefix)
}));

import { App } from "./App";

const snapshot: GitRepositorySnapshot = {
  path: "/repo",
  name: "repo",
  currentBranch: "main",
  defaultBranch: "main",
  head: "aaa1111",
  remotes: ["origin"],
  status: { clean: true, files: [] },
  truncated: false,
  commits: [
    {
      hash: "aaa1111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      shortHash: "aaa1111",
      parents: ["bbb2222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
      authorName: "Demo",
      authorEmail: "demo@example.local",
      date: "2026-06-09T16:20:00-04:00",
      committerDate: "2026-06-09T16:20:00-04:00",
      refs: [
        { kind: "local", name: "main", isCurrent: true },
        { kind: "local", name: "feature", isCurrent: false }
      ],
      subject: "Tip of main",
      body: ""
    },
    {
      hash: "bbb2222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      shortHash: "bbb2222",
      parents: [],
      authorName: "Demo",
      authorEmail: "demo@example.local",
      date: "2026-06-09T16:00:00-04:00",
      committerDate: "2026-06-09T16:00:00-04:00",
      refs: [{ kind: "local", name: "feature/older", isCurrent: false }],
      subject: "Older feature work",
      body: ""
    }
  ]
};

const defaultDetails: GitCommitDetails = {
  hash: "aaa1111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  base: "bbb2222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  files: [{ path: "src/index.ts", status: "M", additions: 4, deletions: 1 }]
};

const sampleDiff: GitFileDiff = {
  patch: "diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,2 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;\n",
  truncated: false
};

async function loadApp() {
  loadConfig.mockResolvedValue({ defaultRepoPath: "/repo" });
  loadRepository.mockResolvedValue(snapshot);
  loadCommitDetails.mockResolvedValue(defaultDetails);
  loadCommitFileDiff.mockResolvedValue(sampleDiff);

  render(<App />);
  await waitFor(() => expect(screen.getByLabelText("Repository path")).toHaveValue("/repo"));
  const loadButtons = screen.getAllByRole("button", { name: /^Load$/i });
  fireEvent.click(loadButtons[0]);
  await waitFor(() => expect(screen.getByRole("tablist")).toBeInTheDocument());
}

describe("App ref navigation and inspector", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
    loadConfig.mockReset();
    loadRepository.mockReset();
    loadCommitDetails.mockReset();
    loadCommitFileDiff.mockReset();
    loadWorkingFileDiff.mockReset();
    compareBranches.mockReset();
    loadBranchFileDiff.mockReset();
    suggestDirectories.mockReset();
  });

  afterEach(cleanup);

  it("resolves a substring branch name to its own commit, not the longer branch's", async () => {
    await loadApp();

    fireEvent.click(screen.getByRole("button", { name: "feature/older" }));

    const inspector = document.querySelector(".sidebar-commit-inspector") as HTMLElement;
    await waitFor(() => {
      expect(within(inspector).getByText("Older feature work")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "feature" }));
    await waitFor(() => {
      expect(within(inspector).getByText("Tip of main")).toBeInTheDocument();
    });
  });

  it("toggles aria-selected on the sidebar tabs", async () => {
    await loadApp();

    const refsTab = screen.getByRole("tab", { name: /Refs/i });
    const infoTab = screen.getByRole("tab", { name: /Info/i });

    expect(refsTab).toHaveAttribute("aria-selected", "true");
    expect(infoTab).toHaveAttribute("aria-selected", "false");

    fireEvent.click(infoTab);

    expect(infoTab).toHaveAttribute("aria-selected", "true");
    expect(refsTab).toHaveAttribute("aria-selected", "false");
  });

  it("highlights search matches without removing non-matching commits from the diagram", async () => {
    await loadApp();

    const searchInput = screen.getByPlaceholderText(/Filter commits/i);
    fireEvent.change(searchInput, { target: { value: "Older" } });

    expect(screen.getByText(/Match 1 of 1/i)).toBeInTheDocument();
    const nodes = document.querySelectorAll(".diagram-node");
    expect(nodes).toHaveLength(2);
    expect(document.querySelectorAll(".diagram-node.search-match")).toHaveLength(1);
  });

  it("loads changed files for the selected commit and opens the diff modal with inline and side-by-side views", async () => {
    await loadApp();

    const fileBtn = await screen.findByRole("button", { name: /src\/index\.ts/i });
    fireEvent.click(fileBtn);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("src/index.ts")).toBeInTheDocument();
    await waitFor(() => {
      expect(within(dialog).getByText("+const b = 3;")).toBeInTheDocument();
    });
    expect(within(dialog).getByText("Lines 1–3")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /Side-by-side/i }));
    expect(within(dialog).getByText("Before")).toBeInTheDocument();
    expect(within(dialog).getByText("After")).toBeInTheDocument();
    expect(within(dialog).getByText("const b = 2;")).toBeInTheDocument();
    expect(within(dialog).getByText("const b = 3;")).toBeInTheDocument();
  });

  it("shows 'You are here' on HEAD and toggles the timeline reading guide", async () => {
    await loadApp();

    expect(screen.getAllByText("You are here").length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole("button", { name: /How to read this graph/i }));
    expect(screen.getByText("How to read this timeline")).toBeInTheDocument();
    expect(screen.getByText("Older at top, newer below")).toBeInTheDocument();
  });

  it("renders a virtual Uncommitted changes node when dirty and jumps to grouped Changes on click", async () => {
    const dirtySnapshot: GitRepositorySnapshot = {
      ...snapshot,
      status: {
        clean: false,
        files: [
          { path: "staged.ts", index: "A", workingTree: " " },
          { path: "modified.ts", index: " ", workingTree: "M" },
          { path: "newfile.ts", index: "?", workingTree: "?" }
        ]
      }
    };
    loadConfig.mockResolvedValue({ defaultRepoPath: "/repo" });
    loadRepository.mockResolvedValue(dirtySnapshot);
    loadCommitDetails.mockResolvedValue(defaultDetails);

    render(<App />);
    await waitFor(() => expect(screen.getByLabelText("Repository path")).toHaveValue("/repo"));
    fireEvent.click(screen.getAllByRole("button", { name: /^Load$/i })[0]);

    const workingNodeBtn = await screen.findByRole("button", { name: /Uncommitted changes/i });
    fireEvent.click(workingNodeBtn);

    expect(screen.getByText("Ready to commit (Staged)")).toBeInTheDocument();
    expect(screen.getByText("Modified (Not staged yet)")).toBeInTheDocument();
    expect(screen.getByText("New files (Untracked)")).toBeInTheDocument();
    expect(screen.getByText("staged.ts")).toBeInTheDocument();
    expect(screen.getByText("modified.ts")).toBeInTheDocument();
    expect(screen.getByText("newfile.ts")).toBeInTheDocument();
  });

  it("traces branch history when clicking a lane header", async () => {
    await loadApp();

    const laneBtn = screen.getByRole("button", { name: "Trace branch main" });
    fireEvent.click(laneBtn);

    expect(screen.getByText("Tracing: main")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Tracing: main"));
    expect(screen.queryByText("Tracing: main")).not.toBeInTheDocument();
  });
});

describe("App empty state", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
    loadConfig.mockReset();
    loadConfig.mockResolvedValue({ defaultRepoPath: "/workspace/demo" });
    loadRepository.mockReset();
  });

  afterEach(cleanup);

  it("shows the load form and dynamic workspace repo button before any repository is loaded", async () => {
    render(<App />);
    expect(screen.getByText("Open a local repository")).toBeInTheDocument();
    expect(screen.getByLabelText("Repository path")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Load current project/i })).toBeInTheDocument();
  });
});
