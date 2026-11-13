import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitRepositorySnapshot } from "../lib/types";

const loadRepository = vi.fn();
vi.mock("../api", () => ({
  loadRepository: (path: string) => loadRepository(path)
}));

import { App } from "./App";

// Two branches where one name is a substring of the other, on different commits.
const snapshot: GitRepositorySnapshot = {
  path: "/repo",
  name: "repo",
  currentBranch: "main",
  head: "aaa1111",
  remotes: ["origin"],
  status: { clean: true, files: [] },
  commits: [
    {
      hash: "aaa1111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      shortHash: "aaa1111",
      parents: ["bbb2222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
      authorName: "Demo",
      authorEmail: "demo@example.local",
      date: "2026-06-09T16:20:00-04:00",
      refs: ["HEAD -> main", "feature"],
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
      refs: ["feature/older"],
      subject: "Older feature work",
      body: ""
    }
  ]
};

async function loadApp() {
  loadRepository.mockResolvedValue(snapshot);
  render(<App />);
  const loadButtons = screen.getAllByRole("button", { name: /^Load$/i });
  fireEvent.click(loadButtons[0]);
  await waitFor(() => expect(screen.getByRole("tablist")).toBeInTheDocument());
}

describe("App ref navigation", () => {
  beforeEach(() => {
    localStorage.clear();
    loadRepository.mockReset();
  });

  afterEach(cleanup);

  it("resolves a substring branch name to its own commit, not the longer branch's", async () => {
    await loadApp();

    // Clicking "feature/older" should select the older commit, even though
    // "feature" is a substring of it.
    fireEvent.click(screen.getByRole("button", { name: "feature/older" }));

    const inspector = document.querySelector(".sidebar-commit-inspector") as HTMLElement;
    await waitFor(() => {
      expect(within(inspector).getByText("Older feature work")).toBeInTheDocument();
    });

    // And "feature" resolves to the tip of main.
    fireEvent.click(screen.getByRole("button", { name: "feature" }));
    await waitFor(() => {
      expect(within(inspector).getByText("Tip of main")).toBeInTheDocument();
    });
  });

  it("toggles aria-selected on the sidebar tabs", async () => {
    await loadApp();

    const refsTab = screen.getByRole("tab", { name: /References/i });
    const infoTab = screen.getByRole("tab", { name: /Info/i });

    expect(refsTab).toHaveAttribute("aria-selected", "true");
    expect(infoTab).toHaveAttribute("aria-selected", "false");

    fireEvent.click(infoTab);

    expect(infoTab).toHaveAttribute("aria-selected", "true");
    expect(refsTab).toHaveAttribute("aria-selected", "false");
  });
});

describe("App empty state", () => {
  beforeEach(() => {
    localStorage.clear();
    loadRepository.mockReset();
  });

  afterEach(cleanup);

  it("shows the load form before any repository is loaded", () => {
    render(<App />);
    expect(screen.getByText("Open a local repository")).toBeInTheDocument();
    expect(screen.getByLabelText("Repository path")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Load this project/i })).toBeInTheDocument();
  });
});
