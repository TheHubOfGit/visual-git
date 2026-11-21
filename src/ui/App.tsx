import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, BookOpen, Check, Settings, ChevronDown, ChevronUp, Folder, Search, X } from "lucide-react";
import {
  commitStaged,
  compareBranches,
  createBranch,
  loadBranchFileDiff,
  loadCommitDetails,
  loadCommitFileDiff,
  loadConfig,
  loadIdentity,
  loadRepository,
  loadWorkingFileDiff,
  stageFiles,
  switchBranch,
  unstageFiles
} from "../api";
import { compactMetrics, layoutCommitDiagram, roomyMetrics } from "../lib/diagramLayout";
import { plural, type TermKey } from "../lib/glossary";
import { resolveRefs } from "../lib/refs";
import type {
  CommitIdentity,
  GitActionResult,
  GitBranchComparison,
  GitChangedFile,
  GitCommitDetails,
  GitFileDiff,
  GitRepositorySnapshot
} from "../lib/types";
import { DiffViewer, type DiffModalTarget } from "./DiffViewer";
import { GuidePanel } from "./GuidePanel";
import { SettingsPanel } from "./SettingsPanel";
import { OpenProject } from "./OpenProject";
import { BranchesPanel, ChangesPanel, ComparePanel, Inspector, ProjectPanel, type ActionApi } from "./panels";
import { RailMap, type CompareHighlight, type MapDensity } from "./RailMap";
import { GuideContext, Term } from "./Term";
import { THEMES, useTheme } from "./useTheme";

const INITIAL_MAX_COUNT = 300;
const LOAD_MORE_STEP = 300;

type TabId = "lines" | "changes" | "compare" | "project";

const TABS: Array<{ id: TabId; label: string; sub: string }> = [
  { id: "lines", label: "Lines", sub: "branches" },
  { id: "changes", label: "Edits", sub: "changes" },
  { id: "compare", label: "Compare", sub: "diff" },
  { id: "project", label: "Project", sub: "repository" }
];

function readUrlParams(): { path: string | null; commit: string | null } {
  if (typeof window === "undefined") return { path: null, commit: null };
  const params = new URLSearchParams(window.location.search);
  const path = params.get("path");
  const commit = params.get("commit");
  return { path: path && path.trim() ? path : null, commit: commit && commit.trim() ? commit : null };
}

function syncUrlParams(repoPath: string | null, commitHash: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (repoPath) url.searchParams.set("path", repoPath);
    else url.searchParams.delete("path");
    if (repoPath && commitHash) url.searchParams.set("commit", commitHash);
    else url.searchParams.delete("commit");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Ignore history API errors in restricted contexts.
  }
}

function readStored<T>(key: string, fallback: T, parse: (raw: string) => T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : parse(raw);
  } catch {
    return fallback;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures.
  }
}

export function App() {
  const { theme, setTheme } = useTheme();

  const initialUrl = useMemo(() => readUrlParams(), []);
  const pendingUrlCommitRef = useRef<string | null>(initialUrl.commit);
  const lastHeadRef = useRef<string | null>(null);

  const [defaultRepoPath, setDefaultRepoPath] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [repoPath, setRepoPath] = useState(() => initialUrl.path ?? "");
  const [snapshot, setSnapshot] = useState<GitRepositorySnapshot | null>(null);
  const [maxCount, setMaxCount] = useState(INITIAL_MAX_COUNT);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [matchCursor, setMatchCursor] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [liveConnected, setLiveConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("lines");
  const [tracedLane, setTracedLane] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [guide, setGuide] = useState<{ open: boolean; term: TermKey | null }>({ open: false, term: null });
  const [notice, setNotice] = useState<GitActionResult | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [identity, setIdentity] = useState<CommitIdentity | null>(null);

  const [density, setDensity] = useState<MapDensity>(() =>
    readStored<MapDensity>("visual-git-density", "roomy", (raw) => (raw === "compact" ? "compact" : "roomy"))
  );
  const handleDensityChange = useCallback((next: MapDensity) => {
    setDensity(next);
    store("visual-git-density", next);
  }, []);

  const [recentRepos, setRecentRepos] = useState<string[]>(() =>
    readStored<string[]>("visual-git-recent", [], (raw) => {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
    })
  );
  const addToRecent = useCallback((path: string) => {
    setRecentRepos((prev) => {
      const updated = [path, ...prev.filter((p) => p !== path)].slice(0, 5);
      store("visual-git-recent", JSON.stringify(updated));
      return updated;
    });
  }, []);
  const removeFromRecent = (path: string) => {
    setRecentRepos((prev) => {
      const updated = prev.filter((p) => p !== path);
      store("visual-git-recent", JSON.stringify(updated));
      return updated;
    });
  };

  const openGuide = useCallback((term?: TermKey) => {
    setSettingsOpen(false);
    setGuide({ open: true, term: term ?? null });
  }, []);
  const openSettings = useCallback(() => {
    setGuide({ open: false, term: null });
    setSettingsOpen(true);
  }, []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const closeGuide = useCallback(() => setGuide({ open: false, term: null }), []);

  /* ---- Derived repository state ---- */

  const headHash = useMemo(() => {
    if (!snapshot) return null;
    const short = snapshot.head?.trim();
    const byHash = short ? snapshot.commits.find((commit) => commit.hash.startsWith(short)) : undefined;
    const byRef = snapshot.commits.find((commit) =>
      commit.refs.some((ref) => ref.kind === "head" || (ref.kind === "local" && ref.isCurrent))
    );
    return (byHash ?? byRef)?.hash ?? null;
  }, [snapshot]);

  const dirtyCount = snapshot && !snapshot.status.clean ? snapshot.status.files.length : 0;

  const diagram = useMemo(() => {
    if (!snapshot) return null;
    return layoutCommitDiagram(snapshot.commits, {
      defaultBranch: snapshot.defaultBranch,
      metrics: density === "compact" ? compactMetrics : roomyMetrics,
      pendingAfter: dirtyCount > 0 ? headHash : null
    });
  }, [snapshot, density, dirtyCount, headHash]);

  const selectedCommit = useMemo(() => {
    if (!diagram) return null;
    return (
      diagram.nodes.find((node) => node.hash === selectedHash) ??
      diagram.nodes.find((node) => node.hash === headHash) ??
      diagram.nodes[diagram.nodes.length - 1] ??
      null
    );
  }, [diagram, selectedHash, headHash]);

  const refs = useMemo(() => (snapshot ? resolveRefs(snapshot) : null), [snapshot]);

  useEffect(() => {
    if (tracedLane && diagram && !diagram.lanes.some((lane) => lane.name === tracedLane)) setTracedLane(null);
  }, [diagram, tracedLane]);

  /* ---- Search ---- */

  const matchedNodes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!diagram || !needle) return [];
    return diagram.nodes.filter((commit) =>
      [commit.hash, commit.subject, commit.body, commit.authorName, commit.authorEmail, commit.refs.map((ref) => ref.name).join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [diagram, query]);

  const matchedHashes = useMemo(
    () => (query.trim() ? new Set(matchedNodes.map((node) => node.hash)) : null),
    [matchedNodes, query]
  );

  useEffect(() => setMatchCursor(0), [query]);

  const stepMatch = useCallback(
    (delta: number) => {
      if (matchedNodes.length === 0) return;
      const next = (matchCursor + delta + matchedNodes.length) % matchedNodes.length;
      setMatchCursor(next);
      setSelectedHash(matchedNodes[next].hash);
    },
    [matchedNodes, matchCursor]
  );

  /* ---- Selected commit details ---- */

  const [commitDetails, setCommitDetails] = useState<GitCommitDetails | null>(null);
  const [commitDetailsLoading, setCommitDetailsLoading] = useState(false);
  const [commitDetailsError, setCommitDetailsError] = useState("");

  useEffect(() => {
    if (!snapshot || !selectedCommit) {
      setCommitDetails(null);
      setCommitDetailsError("");
      return;
    }
    const controller = new AbortController();
    setCommitDetailsLoading(true);
    setCommitDetailsError("");
    loadCommitDetails(snapshot.path, selectedCommit.hash, controller.signal)
      .then((details) => setCommitDetails(details))
      .catch((err) => {
        if (controller.signal.aborted) return;
        setCommitDetails(null);
        setCommitDetailsError(err instanceof Error ? err.message : "Could not load the changed files.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setCommitDetailsLoading(false);
      });
    return () => controller.abort();
  }, [snapshot?.path, selectedCommit?.hash]);

  /* ---- Compare ---- */

  const branchOptions = useMemo(() => (refs ? [...refs.local, ...refs.remote] : []), [refs]);
  const [compareBase, setCompareBase] = useState("");
  const [compareHead, setCompareHead] = useState("");
  const [comparison, setComparison] = useState<GitBranchComparison | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState("");
  const [highlightComparison, setHighlightComparison] = useState(true);

  useEffect(() => {
    if (!snapshot || !refs) {
      setComparison(null);
      return;
    }
    const branches = [...refs.local, ...refs.remote];
    if (branches.length === 0) return;
    setCompareBase((prev) => (prev && branches.includes(prev) ? prev : branches.includes(snapshot.defaultBranch) ? snapshot.defaultBranch : branches[0]));
    setCompareHead((prev) => {
      if (prev && branches.includes(prev)) return prev;
      if (snapshot.currentBranch !== snapshot.defaultBranch && branches.includes(snapshot.currentBranch)) return snapshot.currentBranch;
      return branches.find((branch) => branch !== snapshot.defaultBranch) ?? branches[0];
    });
  }, [snapshot?.path, snapshot?.defaultBranch, snapshot?.currentBranch, refs]);

  useEffect(() => {
    if (activeTab !== "compare" || !snapshot || !compareBase || !compareHead) return;
    let cancelled = false;
    setCompareLoading(true);
    setCompareError("");
    compareBranches(snapshot.path, compareBase, compareHead)
      .then((result) => {
        if (!cancelled) setComparison(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setComparison(null);
        setCompareError(err instanceof Error ? err.message : "Could not compare these lines.");
      })
      .finally(() => {
        if (!cancelled) setCompareLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, snapshot?.path, snapshot?.head, compareBase, compareHead]);

  const compareHighlight: CompareHighlight | null = useMemo(() => {
    if (activeTab !== "compare" || !highlightComparison || !comparison) return null;
    return { ahead: new Set(comparison.aheadCommits), behind: new Set(comparison.behindCommits) };
  }, [activeTab, highlightComparison, comparison]);

  /* ---- Diff viewer ---- */

  const [diffTarget, setDiffTarget] = useState<DiffModalTarget | null>(null);
  const [diffData, setDiffData] = useState<GitFileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState("");
  const diffAbortRef = useRef<AbortController | null>(null);

  const openDiff = useCallback((target: DiffModalTarget, fetcher: (signal: AbortSignal) => Promise<GitFileDiff>) => {
    diffAbortRef.current?.abort();
    const controller = new AbortController();
    diffAbortRef.current = controller;
    setDiffTarget(target);
    setDiffData(null);
    setDiffError("");
    setDiffLoading(true);
    fetcher(controller.signal)
      .then((result) => setDiffData(result))
      .catch((err) => {
        if (!controller.signal.aborted) setDiffError(err instanceof Error ? err.message : "Could not load the changes.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDiffLoading(false);
      });
  }, []);

  const closeDiff = useCallback(() => {
    diffAbortRef.current?.abort();
    setDiffTarget(null);
    setDiffData(null);
    setDiffError("");
  }, []);

  /* ---- Loading ---- */

  const openRepository = useCallback(
    async (targetPath: string, nextMaxCount = INITIAL_MAX_COUNT, preserve = false, selectAfter?: string) => {
      const trimmed = targetPath.trim();
      if (!trimmed) return;
      if (!preserve) setLoading(true);
      setError("");
      try {
        const data = await loadRepository(trimmed, nextMaxCount);
        setSnapshot(data);
        setMaxCount(nextMaxCount);
        setRepoPath(data.path);
        addToRecent(data.path);
        setSwitcherOpen(false);

        const requested = selectAfter ?? pendingUrlCommitRef.current;
        pendingUrlCommitRef.current = null;
        // When "you are here" moves (a save, a switch, or something done in a terminal), follow it.
        const headMoved = lastHeadRef.current !== null && lastHeadRef.current !== `${data.path}@${data.head}`;
        lastHeadRef.current = `${data.path}@${data.head}`;
        setSelectedHash((prev) => {
          const wanted = requested ? data.commits.find((c) => c.hash === requested || c.shortHash === requested) : undefined;
          if (wanted) return wanted.hash;
          if (preserve && !headMoved && prev && data.commits.some((c) => c.hash === prev)) return prev;
          return null;
        });
        if (!preserve) {
          setComparison(null);
          setTracedLane(null);
          setNotice(null);
          setQuery("");
        }
      } catch (loadError) {
        if (!preserve) {
          setSnapshot(null);
          setSelectedHash(null);
        }
        setError(loadError instanceof Error ? loadError.message : "Could not open that folder.");
      } finally {
        setLoading(false);
      }
    },
    [addToRecent]
  );

  async function handleLoadMore() {
    if (!snapshot || loadingMore) return;
    const nextLimit = maxCount + LOAD_MORE_STEP;
    setLoadingMore(true);
    try {
      const data = await loadRepository(snapshot.path, nextLimit);
      setSnapshot(data);
      setMaxCount(nextLimit);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load older save points.");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    let active = true;
    loadConfig()
      .then((cfg) => {
        if (!active || !cfg) return;
        setDefaultRepoPath(cfg.defaultRepoPath ?? null);
        setReadOnly(Boolean(cfg.readOnly));
        if (!initialUrl.path && cfg.defaultRepoPath) setRepoPath((prev) => prev || cfg.defaultRepoPath!);
      })
      .catch(() => {
        // Ignore config fetch failures (e.g. mocked tests).
      });
    if (initialUrl.path) void openRepository(initialUrl.path);
    return () => {
      active = false;
    };
  }, [initialUrl.path, openRepository]);

  useEffect(() => {
    syncUrlParams(snapshot?.path ?? null, selectedCommit?.hash ?? null);
  }, [snapshot?.path, selectedCommit?.hash]);

  // Redraw by itself when .git changes on disk.
  useEffect(() => {
    if (!snapshot || typeof EventSource === "undefined") {
      setLiveConnected(false);
      return;
    }
    const source = new EventSource(`/api/watch?path=${encodeURIComponent(snapshot.path)}`);
    source.addEventListener("open", () => setLiveConnected(true));
    source.addEventListener("changed", () => void openRepository(snapshot.path, maxCount, true));
    source.addEventListener("error", () => setLiveConnected(false));
    return () => {
      setLiveConnected(false);
      source.close();
    };
  }, [snapshot?.path, maxCount, openRepository]);

  /* ---- Actions that change the repository ---- */

  const canAct = !readOnly;
  const snapshotPath = snapshot?.path ?? "";

  // Who saves are signed as, so the save box can warn before git refuses.
  useEffect(() => {
    let cancelled = false;
    loadIdentity(snapshotPath || null)
      .then((data) => !cancelled && setIdentity(data))
      .catch(() => !cancelled && setIdentity(null));
    return () => {
      cancelled = true;
    };
  }, [snapshotPath]);

  const api: ActionApi = useMemo(
    () => ({
      stage: (files) => stageFiles(snapshotPath, files),
      unstage: (files) => unstageFiles(snapshotPath, files),
      commit: (message) => commitStaged(snapshotPath, message),
      switchTo: (branch) => switchBranch(snapshotPath, branch),
      createBranch: (name, startPoint) => createBranch(snapshotPath, name, startPoint)
    }),
    [snapshotPath]
  );

  const runAction = useCallback(
    async (run: () => Promise<GitActionResult>) => {
      const result = await run();
      setNotice(result);
      if (snapshotPath) await openRepository(snapshotPath, maxCount, true, result.hash);
    },
    [snapshotPath, maxCount, openRepository]
  );

  /* ---- Keyboard ---- */

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!diagram || diagram.nodes.length === 0) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (diffTarget || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const editable =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (event.key === "Escape") {
        if (query) setQuery("");
        setSwitcherOpen(false);
        return;
      }
      if (editable) return;

      const index = diagram.nodes.findIndex((node) => node.hash === selectedCommit?.hash);
      if (event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (event.key === "d") {
        event.preventDefault();
        handleDensityChange(density === "roomy" ? "compact" : "roomy");
      } else if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedHash(diagram.nodes[Math.min(diagram.nodes.length - 1, index + 1)].hash);
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedHash(diagram.nodes[Math.max(0, index - 1)].hash);
      } else if (event.key === "p" && selectedCommit && selectedCommit.parents.length > 0) {
        event.preventDefault();
        setSelectedHash(selectedCommit.parents[0]);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [diagram, diffTarget, query, density, handleDensityChange, selectedCommit]);

  /* ---- Diff openers ---- */

  const openCommitFile = (file: GitChangedFile) => {
    if (!snapshot || !selectedCommit) return;
    openDiff(
      {
        filePath: file.path,
        oldPath: file.oldPath,
        subtitle: `Save point ${selectedCommit.shortHash}: ${selectedCommit.subject}`,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions
      },
      (signal) => loadCommitFileDiff(snapshot.path, selectedCommit.hash, file.path, file.oldPath, signal)
    );
  };

  const openWorkingFile = (filePath: string) => {
    if (!snapshot) return;
    openDiff({ filePath, subtitle: "Your unsaved edits, compared with the last save point" }, (signal) =>
      loadWorkingFileDiff(snapshot.path, filePath, signal)
    );
  };

  const openCompareFile = (file: GitChangedFile) => {
    if (!snapshot || !comparison) return;
    openDiff(
      {
        filePath: file.path,
        oldPath: file.oldPath,
        subtitle: `${comparison.head} compared with ${comparison.base}`,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions
      },
      (signal) => loadBranchFileDiff(snapshot.path, comparison.base, comparison.head, file.path, file.oldPath, signal)
    );
  };

  /* ---- Situation summary ---- */

  const situation = useMemo(() => {
    if (!snapshot) return null;
    const files = snapshot.status.files;
    const staged = files.filter((file) => file.index !== " " && file.index !== "?").length;
    const detached = snapshot.currentBranch === "(detached)";
    let next = "";
    if (files.length > 0 && !readOnly) {
      next = staged > 0 ? "Next: write a short note and save." : "Next: choose which files to include.";
    }
    return { detached, staged, total: files.length, next };
  }, [snapshot, readOnly]);

  const recentList = (onPick: (path: string) => void) =>
    recentRepos.length > 0 && (
      <div className="recents">
        <h3 className="panel-heading">Opened recently</h3>
        <ul className="recent-list">
          {recentRepos.map((path) => (
            <li key={path}>
              <button type="button" className="recent-btn" onClick={() => onPick(path)}>
                <Folder size={14} aria-hidden="true" />
                <span className="recent-name">{path.split(/[\\/]/).filter(Boolean).pop() || path}</span>
                <span className="recent-path">{path}</span>
              </button>
              <button type="button" className="icon-btn" onClick={() => removeFromRecent(path)} aria-label={`Forget ${path}`} title="Remove from this list">
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    );

  const themePicker = (
    <div className="theme-picker segmented" role="group" aria-label="Look">
      {THEMES.map((option) => (
        <button
          key={option.id}
          type="button"
          className={theme === option.id ? "active" : ""}
          aria-pressed={theme === option.id}
          title={option.hint}
          onClick={() => setTheme(option.id)}
        >
          <i className={`theme-swatch swatch-${option.id}`} aria-hidden="true" />
          <span>{option.name}</span>
        </button>
      ))}
    </div>
  );

  const loaded = snapshot && diagram && refs && situation;

  return (
    <GuideContext.Provider value={openGuide}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <img className="brand-mark" src="/favicon.svg" width="28" height="28" alt="" aria-hidden="true" />
            <span className="brand-name">Visual Git</span>
          </div>

          {loaded && (
            <button
              type="button"
              className="project-switch"
              aria-expanded={switcherOpen}
              onClick={() => setSwitcherOpen((prev) => !prev)}
              title="Open a different project"
            >
              <Folder size={15} aria-hidden="true" />
              <span className="project-switch-name">{snapshot.name}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          )}

          <div className="topbar-end">
            {themePicker}
            <button type="button" className="btn on-bar" onClick={() => (guide.open ? closeGuide() : openGuide())} aria-pressed={guide.open}>
              <BookOpen size={15} aria-hidden="true" />
              <span>Guide</span>
            </button>
            <button
              type="button"
              className="btn on-bar"
              onClick={() => (settingsOpen ? closeSettings() : openSettings())}
              aria-pressed={settingsOpen}
              title="Your name on saves, and the look of the app"
            >
              <Settings size={15} aria-hidden="true" />
              <span>Settings</span>
            </button>
          </div>
        </header>

        {loaded && switcherOpen && (
          <div className="switcher" role="region" aria-label="Open a different project">
            <OpenProject inputId="repo-path" value={repoPath} onChange={setRepoPath} onOpen={(path) => void openRepository(path)} loading={loading} autoFocus />
            {recentList((path) => void openRepository(path))}
          </div>
        )}

        {error && (
          <div className="banner error" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{error}</span>
            <button type="button" className="icon-btn" onClick={() => setError("")} aria-label="Dismiss message">
              <X size={14} />
            </button>
          </div>
        )}

        {loaded ? (
          <>
            <div className="situation" role="status" aria-label="Where you are">
              <p className="situation-where">
                {situation.detached ? (
                  <>
                    <Term k="detached">You are visiting an old save point</Term>, not on a line of work.
                  </>
                ) : (
                  <>
                    You are on <strong className="situation-branch">{snapshot.currentBranch}</strong>
                    {snapshot.currentBranch === snapshot.defaultBranch ? ", the main line of this project." : ", a side line of work."}
                  </>
                )}
              </p>
              <p className="situation-state">
                {situation.total === 0 ? (
                  <>
                    <Check size={15} aria-hidden="true" /> Everything is saved.
                  </>
                ) : (
                  <>
                    <span className="unsaved-mark" aria-hidden="true" />
                    {plural(situation.total, "file")} changed since your last save point
                    {situation.staged > 0 ? `, ${situation.staged} ready to save.` : "."}{" "}
                    <span className="situation-next">{situation.next}</span>
                    <button type="button" className="link-btn" onClick={() => setActiveTab("changes")}>
                      Review your edits
                    </button>
                  </>
                )}
              </p>
            </div>

            {notice && (
              <div className="banner done" role="status">
                <Check size={16} aria-hidden="true" />
                <span>
                  {notice.summary} <code>{notice.command}</code>
                </span>
                <button type="button" className="icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss message">
                  <X size={14} />
                </button>
              </div>
            )}

            <div className="workspace">
              <aside className="sidebar" aria-label="Project">
                <div className="search">
                  <label htmlFor="commit-search" className="visually-hidden">
                    Search save points
                  </label>
                  <Search size={15} aria-hidden="true" />
                  <input
                    ref={searchInputRef}
                    id="commit-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        stepMatch(event.shiftKey ? -1 : 1);
                      }
                    }}
                    placeholder="Search notes, people, IDs"
                    spellCheck={false}
                  />
                  {query && (
                    <button type="button" className="icon-btn" onClick={() => setQuery("")} aria-label="Clear search">
                      <X size={14} />
                    </button>
                  )}
                </div>
                {query && (
                  <div className="search-result">
                    <span>
                      {matchedNodes.length > 0
                        ? `Match ${Math.min(matchCursor + 1, matchedNodes.length)} of ${matchedNodes.length}`
                        : "No save points match"}
                    </span>
                    {matchedNodes.length > 0 && (
                      <span className="search-steps">
                        <button type="button" className="icon-btn bordered" onClick={() => stepMatch(-1)} aria-label="Previous match" title="Previous match (Shift+Enter)">
                          <ChevronUp size={14} />
                        </button>
                        <button type="button" className="icon-btn bordered" onClick={() => stepMatch(1)} aria-label="Next match" title="Next match (Enter)">
                          <ChevronDown size={14} />
                        </button>
                      </span>
                    )}
                  </div>
                )}

                <div className="tabs" role="tablist" aria-label="Project sections">
                  {TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      id={`tab-${tab.id}`}
                      aria-selected={activeTab === tab.id}
                      aria-controls="tab-panel"
                      className={activeTab === tab.id ? "active" : ""}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      <span className="tab-label">
                        {tab.label}
                        {tab.id === "changes" && dirtyCount > 0 && <span className="tab-count">{dirtyCount}</span>}
                      </span>
                      <span className="tab-sub">{tab.sub}</span>
                    </button>
                  ))}
                </div>

                <div className="tab-panel" role="tabpanel" id="tab-panel" aria-labelledby={`tab-${activeTab}`}>
                  {activeTab === "lines" && (
                    <BranchesPanel
                      refs={refs}
                      diagram={diagram}
                      snapshot={snapshot}
                      tracedLane={tracedLane}
                      onTrace={setTracedLane}
                      onJump={setSelectedHash}
                      canAct={canAct}
                      runAction={runAction}
                      api={api}
                    />
                  )}
                  {activeTab === "changes" && (
                    <ChangesPanel
                      snapshot={snapshot}
                      onOpenFile={openWorkingFile}
                      canAct={canAct}
                      runAction={runAction}
                      api={api}
                      signedAs={identity?.effective ?? null}
                      onOpenSettings={openSettings}
                    />
                  )}
                  {activeTab === "compare" && (
                    <ComparePanel
                      branches={branchOptions}
                      base={compareBase}
                      head={compareHead}
                      onBase={setCompareBase}
                      onHead={setCompareHead}
                      loading={compareLoading}
                      error={compareError}
                      comparison={comparison}
                      highlight={highlightComparison}
                      onHighlight={setHighlightComparison}
                      onJump={setSelectedHash}
                      onOpenFile={openCompareFile}
                    />
                  )}
                  {activeTab === "project" && <ProjectPanel snapshot={snapshot} laneCount={diagram.lanes.length} canAct={canAct} />}
                </div>
              </aside>

              <main className="map-area">
                <RailMap
                  theme={theme}
                  repoKey={snapshot.path}
                  diagram={diagram}
                  density={density}
                  onDensityChange={handleDensityChange}
                  selectedHash={selectedCommit?.hash ?? null}
                  onSelect={setSelectedHash}
                  headHash={headHash}
                  matchedHashes={matchedHashes}
                  compareHighlight={compareHighlight}
                  compareMergeBase={compareHighlight ? comparison?.mergeBase ?? null : null}
                  tracedLane={tracedLane}
                  onClearTrace={() => setTracedLane(null)}
                  dirtyCount={dirtyCount}
                  onOpenChanges={() => setActiveTab("changes")}
                  truncated={snapshot.truncated}
                  loadingMore={loadingMore}
                  onLoadMore={() => void handleLoadMore()}
                  liveConnected={liveConnected}
                />
              </main>

              <Inspector
                commit={selectedCommit}
                isHead={selectedCommit !== null && selectedCommit.hash === headHash}
                details={commitDetails}
                detailsLoading={commitDetailsLoading}
                detailsError={commitDetailsError}
                onJump={setSelectedHash}
                onOpenFile={openCommitFile}
                canAct={canAct}
                runAction={runAction}
                api={api}
              />
            </div>
          </>
        ) : (
          <main className="welcome">
            <div className="welcome-inner">
              <h1>See your project&rsquo;s history as a map</h1>
              <p className="welcome-lede">
                Point Visual Git at a folder that uses git. It draws every save point and line of work, explains
                each in plain words, and shows where you are right now.
              </p>

              <div className="welcome-open">
                <OpenProject inputId="repo-path" value={repoPath} onChange={setRepoPath} onOpen={(path) => void openRepository(path)} loading={loading} autoFocus />
                {defaultRepoPath && (
                  <div className="welcome-here">
                    <div>
                      <p className="welcome-here-label">Visual Git was started inside this project</p>
                      <p className="welcome-here-path">{defaultRepoPath}</p>
                    </div>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setRepoPath(defaultRepoPath);
                        void openRepository(defaultRepoPath);
                      }}
                    >
                      Open this project
                    </button>
                  </div>
                )}
              </div>

              {recentList((path) => {
                setRepoPath(path);
                void openRepository(path);
              })}

              <p className="welcome-safety">
                Looking around never changes your files.{" "}
                {readOnly
                  ? "Read-only mode is on, so nothing here can change the project at all."
                  : "The few actions that do change something always ask first and show the git command they stand for."}
              </p>
            </div>
          </main>
        )}

        {guide.open && <GuidePanel focusTerm={guide.term} canAct={canAct} onClose={closeGuide} />}

        {settingsOpen && (
          <SettingsPanel
            repoPath={snapshot?.path ?? null}
            projectName={snapshot?.name ?? null}
            readOnly={readOnly}
            theme={theme}
            onTheme={setTheme}
            onIdentityChange={setIdentity}
            onClose={closeSettings}
          />
        )}

        {diffTarget && <DiffViewer target={diffTarget} diff={diffData} loading={diffLoading} error={diffError} onClose={closeDiff} />}
      </div>
    </GuideContext.Provider>
  );
}
