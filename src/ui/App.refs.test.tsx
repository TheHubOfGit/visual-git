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
const stageFiles = vi.fn();
const unstageFiles = vi.fn();
const commitStaged = vi.fn();
const switchBranch = vi.fn();
const createBranch = vi.fn();
const loadIdentity = vi.fn();
const saveIdentity = vi.fn();
const clearProjectIdentity = vi.fn();
const browseFolder = vi.fn();

const knownIdentity = {
  global: { name: "Ada Lovelace", email: "ada@example.com" },
  project: null,
  effective: { name: "Ada Lovelace", email: "ada@example.com" }
};

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
  suggestDirectories: (prefix: string) => suggestDirectories(prefix),
  stageFiles: (path: string, files: string[]) => stageFiles(path, files),
  unstageFiles: (path: string, files: string[]) => unstageFiles(path, files),
  commitStaged: (path: string, message: string) => commitStaged(path, message),
  switchBranch: (path: string, branch: string) => switchBranch(path, branch),
  createBranch: (path: string, name: string, startPoint?: string) => createBranch(path, name, startPoint),
  loadIdentity: (path?: string | null) => loadIdentity(path),
  saveIdentity: (input: unknown) => saveIdentity(input),
  clearProjectIdentity: (path: string) => clearProjectIdentity(path),
  browseFolder: (path?: string, showHidden?: boolean) => browseFolder(path, showHidden)
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

async function loadApp(data: GitRepositorySnapshot = snapshot, config = { defaultRepoPath: "/repo", readOnly: false }) {
  loadConfig.mockResolvedValue(config);
  loadRepository.mockResolvedValue(data);
  loadCommitDetails.mockResolvedValue(defaultDetails);
  loadCommitFileDiff.mockResolvedValue(sampleDiff);
  suggestDirectories.mockResolvedValue([]);

  render(<App />);
  await waitFor(() => expect(screen.getByLabelText("Project folder")).toHaveValue("/repo"));
  fireEvent.click(screen.getByRole("button", { name: "Open project" }));
  await waitFor(() => expect(screen.getByRole("tablist")).toBeInTheDocument());
}

function resetMocks() {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  for (const mock of [
    loadConfig,
    loadRepository,
    loadCommitDetails,
    loadCommitFileDiff,
    loadWorkingFileDiff,
    compareBranches,
    loadBranchFileDiff,
    suggestDirectories,
    stageFiles,
    unstageFiles,
    commitStaged,
    switchBranch,
    createBranch,
    loadIdentity,
    saveIdentity,
    clearProjectIdentity,
    browseFolder
  ]) {
    mock.mockReset();
  }
  loadIdentity.mockResolvedValue(knownIdentity);
}

const inspector = () => screen.getByRole("complementary", { name: "Selected save point" });
const mapRows = () => document.querySelectorAll(".map-row:not(.is-pending)");

describe("App navigation and inspector", () => {
  beforeEach(resetMocks);
  afterEach(cleanup);

  it("resolves a substring branch name to its own commit, not the longer branch's", async () => {
    await loadApp();

    fireEvent.click(screen.getByRole("button", { name: "feature/older" }));
    await waitFor(() => expect(within(inspector()).getByText("Older feature work")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "feature" }));
    await waitFor(() => expect(within(inspector()).getByText("Tip of main")).toBeInTheDocument());
  });

  it("toggles aria-selected on the sidebar tabs", async () => {
    await loadApp();

    const linesTab = screen.getByRole("tab", { name: /Lines/i });
    const projectTab = screen.getByRole("tab", { name: /Project/i });
    expect(linesTab).toHaveAttribute("aria-selected", "true");

    fireEvent.click(projectTab);
    expect(projectTab).toHaveAttribute("aria-selected", "true");
    expect(linesTab).toHaveAttribute("aria-selected", "false");
  });

  it("highlights search matches without removing other save points from the map", async () => {
    await loadApp();

    fireEvent.change(screen.getByLabelText("Search save points"), { target: { value: "Older" } });

    expect(screen.getByText(/Match 1 of 1/i)).toBeInTheDocument();
    expect(mapRows()).toHaveLength(2);
    expect(document.querySelectorAll(".map-row.is-match")).toHaveLength(1);
  });

  it("loads changed files for the selected commit and opens the diff viewer in both layouts", async () => {
    await loadApp();

    fireEvent.click(await screen.findByRole("button", { name: /index\.ts/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("src/index.ts")).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByText("+const b = 3;")).toBeInTheDocument());
    expect(within(dialog).getByText("Lines 1–3")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /Side-by-side/i }));
    expect(within(dialog).getByText("Before")).toBeInTheDocument();
    expect(within(dialog).getByText("const b = 2;")).toBeInTheDocument();
    expect(within(dialog).getByText("const b = 3;")).toBeInTheDocument();
  });

  it("says where you are in plain words and marks HEAD on the map", async () => {
    await loadApp();

    const situation = screen.getByRole("status", { name: "Where you are" });
    expect(situation).toHaveTextContent("You are on main, the main line of this project.");
    expect(situation).toHaveTextContent("Everything is saved.");
    expect(document.querySelectorAll(".map-row.is-head")).toHaveLength(1);
    expect(within(inspector()).getByText("You are here")).toBeInTheDocument();
  });

  it("pairs plain words with git terms and opens the glossary entry for a term", async () => {
    await loadApp();

    expect(within(inspector()).getByText(/Save point/)).toBeInTheDocument();
    fireEvent.click(within(inspector()).getByRole("button", { name: "What does commit mean?" }));

    const guide = screen.getByRole("complementary", { name: "Guide" });
    expect(within(guide).getByText("How to read the map")).toBeInTheDocument();
    expect(guide.querySelector(".glossary-entry.focused")).toHaveTextContent("Save point");
  });

  it("follows a line of work on the map and stops when asked", async () => {
    await loadApp();

    fireEvent.click(screen.getByRole("button", { name: "main" }));
    const chip = screen.getByRole("button", { name: /Following: main/ });
    fireEvent.click(chip);
    expect(screen.queryByText("Following: main")).not.toBeInTheDocument();
  });

  it("draws one joining track for a merge and keeps the legend visible", async () => {
    const mergeSnapshot: GitRepositorySnapshot = {
      ...snapshot,
      head: "ccc3333",
      commits: [
        {
          ...snapshot.commits[0],
          hash: "ccc3333ccccccccccccccccccccccccccccccccc",
          shortHash: "ccc3333",
          parents: ["bbb2222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "ddd4444ddddddddddddddddddddddddddddddddd"],
          date: "2026-06-09T16:30:00-04:00",
          committerDate: "2026-06-09T16:30:00-04:00",
          refs: [{ kind: "local", name: "main", isCurrent: true }],
          subject: "Merge feature into main"
        },
        {
          ...snapshot.commits[0],
          hash: "ddd4444ddddddddddddddddddddddddddddddddd",
          shortHash: "ddd4444",
          parents: ["bbb2222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
          date: "2026-06-09T16:15:00-04:00",
          committerDate: "2026-06-09T16:15:00-04:00",
          refs: [{ kind: "local", name: "feature/side", isCurrent: false }],
          subject: "Side feature work"
        },
        { ...snapshot.commits[1], refs: [], subject: "Base main commit" }
      ]
    };
    await loadApp(mergeSnapshot);

    const legend = screen.getByRole("region", { name: "Map legend" });
    expect(within(legend).getByText("Unsaved edits")).toBeInTheDocument();
    expect(document.querySelectorAll(".map-canvas path.track.joining")).toHaveLength(1);
    expect(document.querySelectorAll(".map-canvas path.track:not(.joining)")).toHaveLength(2);
    expect(screen.getByText("joins two lines")).toBeInTheDocument();
  });
});

describe("App actions on unsaved edits", () => {
  beforeEach(resetMocks);
  afterEach(cleanup);

  it("shows an unsaved-edits stop on the map that opens the grouped edits list", async () => {
    await loadApp(dirtySnapshot);

    expect(screen.getByRole("status", { name: "Where you are" })).toHaveTextContent(
      "3 files changed since your last save point, 1 ready to save."
    );
    fireEvent.click(screen.getByRole("button", { name: /Unsaved edits: 3 files changed/ }));

    expect(screen.getByText("Ready to save")).toBeInTheDocument();
    expect(screen.getByText("Not included yet")).toBeInTheDocument();
    expect(screen.getByText("New files")).toBeInTheDocument();
    for (const name of ["staged.ts", "modified.ts", "newfile.ts"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("includes a file right away and reports the git command it ran", async () => {
    stageFiles.mockResolvedValue({ ok: true, summary: "1 file will be included.", command: "git add -- modified.ts" });
    await loadApp(dirtySnapshot);
    fireEvent.click(screen.getByRole("tab", { name: /Edits/ }));

    fireEvent.click(screen.getByRole("button", { name: "Include modified.ts in the next save point" }));

    await waitFor(() => expect(stageFiles).toHaveBeenCalledWith("/repo", ["modified.ts"]));
    expect(await screen.findByText("git add -- modified.ts")).toBeInTheDocument();
  });

  it("asks before saving a save point and only commits after confirmation", async () => {
    commitStaged.mockResolvedValue({ ok: true, summary: "Saved.", command: 'git commit -m "Fix it"', hash: "aaa1111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    await loadApp(dirtySnapshot);
    fireEvent.click(screen.getByRole("tab", { name: /Edits/ }));

    const saveButton = screen.getByRole("button", { name: "Save 1 file…" });
    expect(saveButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("What did you change?"), { target: { value: "Fix it" } });
    fireEvent.click(saveButton);

    const confirm = screen.getByRole("group", { name: "Save 1 file to main?" });
    expect(within(confirm).getByText('git commit -m "Fix it"')).toBeInTheDocument();
    expect(commitStaged).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole("button", { name: "Save now" }));
    await waitFor(() => expect(commitStaged).toHaveBeenCalledWith("/repo", "Fix it"));
  });

  it("explains a refused switch in place instead of failing silently", async () => {
    switchBranch.mockRejectedValue(new Error("You have unsaved changes that would be lost."));
    await loadApp(dirtySnapshot);

    fireEvent.click(screen.getByRole("button", { name: "Switch to feature" }));
    const confirm = screen.getByRole("group", { name: "Switch to feature?" });
    expect(switchBranch).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Switch to feature" }));

    expect(await within(confirm).findByRole("alert")).toHaveTextContent("would be lost");
  });

  it("warns before saving when git does not know the user's name, and opens Settings to fix it", async () => {
    const empty = { global: { name: "", email: "" }, project: null, effective: { name: "", email: "" } };
    loadIdentity.mockResolvedValue(empty);
    saveIdentity.mockResolvedValue({
      ok: true,
      summary: "Your saves will now be signed Grace Hopper <grace@example.com>.",
      command: 'git config --global user.name "Grace Hopper" && git config --global user.email grace@example.com',
      identity: {
        global: { name: "Grace Hopper", email: "grace@example.com" },
        project: { path: "/repo", name: "", email: "" },
        effective: { name: "Grace Hopper", email: "grace@example.com" }
      }
    });
    await loadApp(dirtySnapshot);
    fireEvent.click(screen.getByRole("tab", { name: /Edits/ }));
    fireEvent.change(screen.getByLabelText("What did you change?"), { target: { value: "Fix it" } });

    expect(await screen.findByText("Git needs your name and email before it can save.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Save/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Add my name" }));
    const settings = await screen.findByRole("complementary", { name: "Settings" });
    fireEvent.change(await within(settings).findByLabelText("Name"), { target: { value: "Grace Hopper" } });
    fireEvent.change(within(settings).getByLabelText("Email"), { target: { value: "grace@example.com" } });
    expect(within(settings).getByText(/git config --global user.name "Grace Hopper"/)).toBeInTheDocument();
    fireEvent.click(within(settings).getByRole("button", { name: "Save name and email" }));

    await waitFor(() =>
      expect(saveIdentity).toHaveBeenCalledWith({ name: "Grace Hopper", email: "grace@example.com", scope: "global", path: "/repo" })
    );
    expect(await within(settings).findByText(/signed Grace Hopper/)).toBeInTheDocument();
    expect(await screen.findByText("Grace Hopper", { selector: ".signed-as strong" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Save 1 file/ })).toBeEnabled();
  });

  it("shows a long save point note as readable text that unfolds, not a cramped scroll box", async () => {
    const body = Array.from({ length: 10 }, (_, i) => `- Detail line ${i + 1}`).join("\n");
    await loadApp({ ...snapshot, commits: [{ ...snapshot.commits[0], body }, ...snapshot.commits.slice(1)] });

    const note = await within(inspector()).findByText(/Detail line 1\b/);
    expect(note.tagName).toBe("P");
    expect(note).toHaveClass("folded");
    const toggle = within(inspector()).getByRole("button", { name: "Show the whole note" });
    fireEvent.click(toggle);
    expect(note).not.toHaveClass("folded");
    expect(within(inspector()).getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
  });

  it("hides every changing action in read-only mode", async () => {
    await loadApp(dirtySnapshot, { defaultRepoPath: "/repo", readOnly: true });

    expect(screen.queryByRole("button", { name: "Switch to feature" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Start a new line of work")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Edits/ }));
    expect(screen.queryByLabelText("What did you change?")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Include modified\.ts/ })).not.toBeInTheDocument();
  });
});

describe("App welcome screen", () => {
  beforeEach(resetMocks);
  afterEach(cleanup);

  it("offers the folder field and the project the server was started in", async () => {
    loadConfig.mockResolvedValue({ defaultRepoPath: "/workspace/demo", readOnly: false });
    suggestDirectories.mockResolvedValue([]);
    render(<App />);
    expect(screen.getByText(/history as a map/)).toBeInTheDocument();
    expect(screen.getByLabelText("Project folder")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Open this project" })).toBeInTheDocument();
  });
});

describe("Folder browser", () => {
  beforeEach(resetMocks);
  afterEach(cleanup);

  const places = [
    { label: "Home", path: "/home/ada" },
    { label: "Computer", path: "/" }
  ];

  it("lets people click through folders and open a project without typing a path", async () => {
    loadConfig.mockResolvedValue({ defaultRepoPath: null, readOnly: false });
    loadRepository.mockResolvedValue(snapshot);
    loadCommitDetails.mockResolvedValue(defaultDetails);
    suggestDirectories.mockResolvedValue([]);
    browseFolder.mockImplementation(async (path?: string) => {
      if (path === "/home/ada/Projects") {
        return {
          path: "/home/ada/Projects",
          parent: "/home/ada",
          isGitRepo: false,
          entries: [
            { name: "notes", path: "/home/ada/Projects/notes", isGitRepo: false },
            { name: "website", path: "/home/ada/Projects/website", isGitRepo: true }
          ],
          places,
          truncated: false
        };
      }
      return {
        path: "/home/ada",
        parent: "/home",
        isGitRepo: false,
        entries: [{ name: "Projects", path: "/home/ada/Projects", isGitRepo: false }],
        places,
        truncated: false
      };
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Browse/ }));
    const dialog = await screen.findByRole("dialog", { name: "Choose a project folder" });
    fireEvent.click(await within(dialog).findByRole("button", { name: /Projects/ }));
    await waitFor(() => expect(browseFolder).toHaveBeenLastCalledWith("/home/ada/Projects", false));
    expect(await within(dialog).findByText("1 project in this folder. Click Open next to one.")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Open website" }));
    await waitFor(() => expect(loadRepository).toHaveBeenCalledWith("/home/ada/Projects/website", expect.any(Number)));
    expect(screen.queryByRole("dialog", { name: "Choose a project folder" })).not.toBeInTheDocument();
  });
});
