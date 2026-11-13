import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeftRight,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Database,
  FileCode,
  FileDiff,
  Folder,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Globe,
  Info,
  Layers,
  Loader2,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Sun,
  Tag,
  X
} from "lucide-react";
import {
  compareBranches,
  loadBranchFileDiff,
  loadCommitDetails,
  loadCommitFileDiff,
  loadConfig,
  loadRepository,
  loadWorkingFileDiff,
  suggestDirectories
} from "../api";
import { compactDiagramMetrics, diagramNodeMetrics, layoutCommitDiagram } from "../lib/diagramLayout";
import { refClass, refLabel, resolveRefs, sortRefsForDisplay, tagKey } from "../lib/refs";
import type {
  DirectoryEntry,
  GitBranchComparison,
  GitChangedFile,
  GitChangeStatus,
  GitCommitDetails,
  GitFileDiff,
  GitRepositorySnapshot
} from "../lib/types";
import { CommitGraph, type CompareHighlight, type GraphDensity } from "./CommitGraph";
import { DiffViewer, type DiffModalTarget } from "./DiffViewer";
import { useTheme } from "./useTheme";

const INITIAL_MAX_COUNT = 300;
const LOAD_MORE_STEP = 300;

function porcelainStatusLabel(code: string): string {
  switch (code) {
    case "A":
      return "Added";
    case "D":
      return "Deleted";
    case "R":
      return "Renamed";
    case "C":
      return "Copied";
    case "U":
      return "Conflict";
    case "?":
      return "New";
    default:
      return "Modified";
  }
}

const CHANGE_STATUS_TITLE: Record<GitChangeStatus, string> = {
  A: "Added",
  M: "Modified",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  T: "Type changed",
  U: "Unmerged",
  X: "Changed"
};

function formatCompareSummary(c: GitBranchComparison): string {
  if (c.aheadCount === 0 && c.behindCount === 0) {
    return `${c.head} and ${c.base} point to the exact same code.`;
  }
  if (c.aheadCount > 0 && c.behindCount === 0) {
    return `${c.head} has ${c.aheadCount} new ${c.aheadCount === 1 ? "commit" : "commits"} not yet in ${c.base}.`;
  }
  if (c.aheadCount === 0 && c.behindCount > 0) {
    return `${c.head} is ${c.behindCount} ${c.behindCount === 1 ? "commit" : "commits"} behind ${c.base}.`;
  }
  return `${c.head} and ${c.base} split from a shared point: ${c.aheadCount} new in ${c.head}, ${c.behindCount} only in ${c.base}.`;
}

function readUrlParams(): { path: string | null; commit: string | null } {
  if (typeof window === "undefined") return { path: null, commit: null };
  const params = new URLSearchParams(window.location.search);
  const path = params.get("path");
  const commit = params.get("commit");
  return {
    path: path && path.trim() ? path : null,
    commit: commit && commit.trim() ? commit : null
  };
}

function syncUrlParams(repoPath: string | null, commitHash: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (repoPath) {
      url.searchParams.set("path", repoPath);
    } else {
      url.searchParams.delete("path");
    }
    if (repoPath && commitHash) {
      url.searchParams.set("commit", commitHash);
    } else {
      url.searchParams.delete("commit");
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Ignore history API errors in restricted contexts.
  }
}

function formatDate(value: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function hashColorIndex(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 6;
}

export function App() {
  const { theme, toggleTheme } = useTheme();

  const initialUrl = useMemo(() => readUrlParams(), []);
  const pendingUrlCommitRef = useRef<string | null>(initialUrl.commit);

  const [defaultRepoPath, setDefaultRepoPath] = useState<string | null>(null);
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

  const [density, setDensity] = useState<GraphDensity>(() => {
    try {
      return localStorage.getItem("visual-git-density") === "compact" ? "compact" : "cards";
    } catch {
      return "cards";
    }
  });

  const handleDensityChange = useCallback((next: GraphDensity) => {
    setDensity(next);
    try {
      localStorage.setItem("visual-git-density", next);
    } catch {
      // Ignore storage failures.
    }
  }, []);

  // Navigation tabs: 'refs' | 'changes' | 'compare' | 'info'
  const [activeTab, setActiveTab] = useState<"refs" | "changes" | "compare" | "info">("refs");

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("visual-git-sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("visual-git-sidebar-collapsed", String(next));
      } catch {
        // Ignore storage failures.
      }
      return next;
    });
  };

  const sidebarRef = useRef<HTMLElement | null>(null);
  const [inspectorHeight, setInspectorHeight] = useState<number>(() => {
    try {
      const raw = Number(localStorage.getItem("visual-git-inspector-height"));
      return Number.isFinite(raw) && raw >= 160 && raw <= 700 ? raw : 320;
    } catch {
      return 320;
    }
  });

  const startInspectorResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = inspectorHeight;
    const maxAllowed = sidebarRef.current ? Math.max(240, Math.round(sidebarRef.current.clientHeight * 0.68)) : 600;
    let latestHeight = startHeight;

    const handleMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      latestHeight = Math.min(maxAllowed, Math.max(160, startHeight + delta));
      setInspectorHeight(latestHeight);
    };

    const handleUp = () => {
      try {
        localStorage.setItem("visual-git-inspector-height", String(latestHeight));
      } catch {
        // Ignore storage failures.
      }
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const [recentRepos, setRecentRepos] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("visual-git-recent");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const addToRecent = useCallback((path: string) => {
    setRecentRepos((prev) => {
      const filtered = prev.filter((p) => p !== path);
      const updated = [path, ...filtered].slice(0, 5);
      try {
        localStorage.setItem("visual-git-recent", JSON.stringify(updated));
      } catch {
        // Ignore storage failures.
      }
      return updated;
    });
  }, []);

  const removeFromRecent = (path: string) => {
    setRecentRepos((prev) => {
      const updated = prev.filter((p) => p !== path);
      try {
        localStorage.setItem("visual-git-recent", JSON.stringify(updated));
      } catch {
        // Ignore storage failures.
      }
      return updated;
    });
  };

  // Directory autocomplete state
  const [dirSuggestions, setDirSuggestions] = useState<DirectoryEntry[]>([]);
  const [dirDropdownOpen, setDirDropdownOpen] = useState(false);
  const [dirActiveIndex, setDirActiveIndex] = useState(-1);

  useEffect(() => {
    const trimmed = repoPath.trim();
    if (!dirDropdownOpen || !trimmed || (!trimmed.startsWith("/") && !trimmed.startsWith("~"))) {
      setDirSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      suggestDirectories(trimmed, controller.signal)
        .then((entries) => {
          setDirSuggestions(entries);
          setDirActiveIndex(-1);
        })
        .catch(() => {
          if (!controller.signal.aborted) setDirSuggestions([]);
        });
    }, 150);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [repoPath, dirDropdownOpen]);

  // Single unified layout engine
  const diagram = useMemo(() => {
    if (!snapshot) return null;
    return layoutCommitDiagram(snapshot.commits, {
      defaultBranch: snapshot.defaultBranch,
      metrics: density === "compact" ? compactDiagramMetrics : diagramNodeMetrics
    });
  }, [snapshot, density]);

  const selectedCommit = useMemo(
    () => diagram?.nodes.find((node) => node.hash === selectedHash) ?? diagram?.nodes[diagram.nodes.length - 1] ?? null,
    [diagram, selectedHash]
  );

  // Search matches (preserve full graph, highlight & step matches)
  const matchedNodes = useMemo(() => {
    if (!diagram) return [];
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];
    return diagram.nodes.filter((commit) => {
      const refNames = commit.refs.map((ref) => ref.name).join(" ");
      return [commit.hash, commit.shortHash, commit.subject, commit.body, commit.authorName, commit.authorEmail, refNames]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [diagram, query]);

  const matchedHashes = useMemo(() => {
    if (!query.trim()) return null;
    return new Set(matchedNodes.map((node) => node.hash));
  }, [matchedNodes, query]);

  useEffect(() => {
    setMatchCursor(0);
  }, [query]);

  const stepMatch = useCallback(
    (delta: number) => {
      if (matchedNodes.length === 0) return;
      const nextIndex = (matchCursor + delta + matchedNodes.length) % matchedNodes.length;
      setMatchCursor(nextIndex);
      setSelectedHash(matchedNodes[nextIndex].hash);
    },
    [matchedNodes, matchCursor]
  );

  const refs = useMemo(() => (snapshot ? resolveRefs(snapshot) : null), [snapshot]);

  // Commit details (changed files for selected commit)
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
      .then((details) => {
        setCommitDetails(details);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setCommitDetails(null);
        setCommitDetailsError(err instanceof Error ? err.message : "Unable to load changed files.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setCommitDetailsLoading(false);
      });

    return () => controller.abort();
  }, [snapshot, selectedCommit?.hash]);

  // Branch comparison state
  const allBranchOptions = useMemo(() => {
    if (!refs) return [];
    return [...refs.local, ...refs.remote];
  }, [refs]);

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

    setCompareBase((prev) => (prev && branches.includes(prev) ? prev : snapshot.defaultBranch));
    setCompareHead((prev) => {
      if (prev && branches.includes(prev)) return prev;
      if (snapshot.currentBranch !== "(detached)" && snapshot.currentBranch !== snapshot.defaultBranch) {
        return snapshot.currentBranch;
      }
      return branches.find((b) => b !== snapshot.defaultBranch) ?? branches[0];
    });
  }, [snapshot?.path, snapshot?.defaultBranch, snapshot?.currentBranch, refs]);

  const runComparison = useCallback(async () => {
    if (!snapshot || !compareBase || !compareHead) return;
    setCompareLoading(true);
    setCompareError("");
    try {
      const result = await compareBranches(snapshot.path, compareBase, compareHead);
      setComparison(result);
    } catch (err) {
      setComparison(null);
      setCompareError(err instanceof Error ? err.message : "Unable to compare branches.");
    } finally {
      setCompareLoading(false);
    }
  }, [snapshot, compareBase, compareHead]);

  useEffect(() => {
    if (activeTab === "compare" && snapshot && compareBase && compareHead) {
      void runComparison();
    }
  }, [activeTab, snapshot?.path, compareBase, compareHead, runComparison]);

  const compareHighlight: CompareHighlight | null = useMemo(() => {
    if (activeTab !== "compare" || !highlightComparison || !comparison) return null;
    return {
      ahead: new Set(comparison.aheadCommits),
      behind: new Set(comparison.behindCommits)
    };
  }, [activeTab, highlightComparison, comparison]);

  // Diff viewer modal state
  const [diffTarget, setDiffTarget] = useState<DiffModalTarget | null>(null);
  const [diffData, setDiffData] = useState<GitFileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState("");
  const diffAbortRef = useRef<AbortController | null>(null);

  const openDiffModal = useCallback(
    (target: DiffModalTarget, fetcher: (signal: AbortSignal) => Promise<GitFileDiff>) => {
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
          if (controller.signal.aborted) return;
          setDiffError(err instanceof Error ? err.message : "Unable to load diff.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setDiffLoading(false);
        });
    },
    []
  );

  const closeDiffModal = useCallback(() => {
    diffAbortRef.current?.abort();
    setDiffTarget(null);
    setDiffData(null);
    setDiffError("");
  }, []);

  // Load repository
  const handleLoadExplicit = useCallback(
    async (targetPath: string, nextMaxCount = INITIAL_MAX_COUNT, preserveSelection = false) => {
      const trimmed = targetPath.trim();
      if (!trimmed) return;

      if (!preserveSelection) {
        setLoading(true);
      }
      setError("");
      setDirDropdownOpen(false);

      try {
        const data = await loadRepository(trimmed, nextMaxCount);
        setSnapshot(data);
        setMaxCount(nextMaxCount);
        setRepoPath(data.path);
        addToRecent(data.path);

        const requestedCommit = pendingUrlCommitRef.current;
        pendingUrlCommitRef.current = null;

        setSelectedHash((prev) => {
          if (requestedCommit && data.commits.some((c) => c.hash === requestedCommit || c.shortHash === requestedCommit)) {
            return data.commits.find((c) => c.hash === requestedCommit || c.shortHash === requestedCommit)!.hash;
          }
          if (preserveSelection && prev && data.commits.some((c) => c.hash === prev)) {
            return prev;
          }
          return data.commits[0]?.hash ?? null;
        });

        if (!preserveSelection) {
          setComparison(null);
        }
      } catch (loadError) {
        if (!preserveSelection) {
          setSnapshot(null);
          setSelectedHash(null);
        }
        setError(loadError instanceof Error ? loadError.message : "Unable to load repository.");
      } finally {
        setLoading(false);
      }
    },
    [addToRecent]
  );

  function handleLoad() {
    void handleLoadExplicit(repoPath, INITIAL_MAX_COUNT, false);
  }

  async function handleLoadMore() {
    if (!snapshot || loadingMore) return;
    const nextLimit = maxCount + LOAD_MORE_STEP;
    setLoadingMore(true);
    try {
      const data = await loadRepository(snapshot.path, nextLimit);
      setSnapshot(data);
      setMaxCount(nextLimit);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load more commits.");
    } finally {
      setLoadingMore(false);
    }
  }

  // On mount: load server config and auto-load URL ?path= if present.
  useEffect(() => {
    let active = true;
    loadConfig()
      .then((cfg) => {
        if (!active) return;
        setDefaultRepoPath(cfg.defaultRepoPath);
        if (!initialUrl.path && cfg.defaultRepoPath) {
          setRepoPath((prev) => (prev ? prev : cfg.defaultRepoPath!));
        }
      })
      .catch(() => {
        // Ignore config fetch failures (e.g. mocked tests).
      });

    if (initialUrl.path) {
      void handleLoadExplicit(initialUrl.path, INITIAL_MAX_COUNT, false);
    }

    return () => {
      active = false;
    };
  }, [initialUrl.path, handleLoadExplicit]);

  // Sync URL query params with current repository and selected commit.
  useEffect(() => {
    syncUrlParams(snapshot?.path ?? null, selectedCommit?.hash ?? null);
  }, [snapshot?.path, selectedCommit?.hash]);

  // Live SSE watcher for .git updates.
  useEffect(() => {
    if (!snapshot || typeof EventSource === "undefined") {
      setLiveConnected(false);
      return;
    }

    const watchUrl = `/api/watch?path=${encodeURIComponent(snapshot.path)}`;
    const source = new EventSource(watchUrl);

    const handleOpen = () => setLiveConnected(true);
    const handleChanged = () => {
      void handleLoadExplicit(snapshot.path, maxCount, true);
    };
    const handleError = () => setLiveConnected(false);

    source.addEventListener("open", handleOpen);
    source.addEventListener("changed", handleChanged);
    source.addEventListener("error", handleError);

    return () => {
      setLiveConnected(false);
      source.close();
    };
  }, [snapshot?.path, maxCount, handleLoadExplicit]);

  // Keyboard navigation shortcuts (j/k, p, /, d, Esc)
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!diagram || diagram.nodes.length === 0) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (diffTarget) return;
      const target = event.target as HTMLElement | null;
      const isEditable =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);

      if (event.key === "Escape") {
        if (query) {
          setQuery("");
        }
        return;
      }

      if (isEditable) return;

      if (event.key === "/") {
        event.preventDefault();
        if (sidebarCollapsed) setSidebarCollapsed(false);
        setTimeout(() => searchInputRef.current?.focus(), 0);
        return;
      }

      if (event.key === "d") {
        event.preventDefault();
        handleDensityChange(density === "cards" ? "compact" : "cards");
        return;
      }

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        const currentIndex = diagram.nodes.findIndex((n) => n.hash === selectedCommit?.hash);
        const nextIndex = currentIndex === -1 ? 0 : Math.min(diagram.nodes.length - 1, currentIndex + 1);
        setSelectedHash(diagram.nodes[nextIndex].hash);
        return;
      }

      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        const currentIndex = diagram.nodes.findIndex((n) => n.hash === selectedCommit?.hash);
        const prevIndex = currentIndex === -1 ? 0 : Math.max(0, currentIndex - 1);
        setSelectedHash(diagram.nodes[prevIndex].hash);
        return;
      }

      if (event.key === "p" && selectedCommit && selectedCommit.parents.length > 0) {
        event.preventDefault();
        setSelectedHash(selectedCommit.parents[0]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [diagram, diffTarget, query, sidebarCollapsed, density, handleDensityChange, selectedCommit]);

  const handleOpenCommitFile = (file: GitChangedFile) => {
    if (!snapshot || !selectedCommit) return;
    openDiffModal(
      {
        filePath: file.path,
        oldPath: file.oldPath,
        subtitle: `Commit ${selectedCommit.shortHash} · ${selectedCommit.subject}`,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions
      },
      (signal) => loadCommitFileDiff(snapshot.path, selectedCommit.hash, file.path, file.oldPath, signal)
    );
  };

  const handleOpenWorkingFile = (filePath: string) => {
    if (!snapshot) return;
    openDiffModal(
      {
        filePath,
        subtitle: "Working tree vs HEAD"
      },
      (signal) => loadWorkingFileDiff(snapshot.path, filePath, signal)
    );
  };

  const handleOpenCompareFile = (file: GitChangedFile) => {
    if (!snapshot || !comparison) return;
    openDiffModal(
      {
        filePath: file.path,
        oldPath: file.oldPath,
        subtitle: `${comparison.base} ... ${comparison.head}`,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions
      },
      (signal) =>
        loadBranchFileDiff(snapshot.path, comparison.base, comparison.head, file.path, file.oldPath, signal)
    );
  };

  const renderDirDropdown = () => {
    if (!dirDropdownOpen || dirSuggestions.length === 0) return null;
    return (
      <div className="dir-autocomplete-menu" role="listbox" aria-label="Directory suggestions">
        {dirSuggestions.map((entry, idx) => (
          <button
            key={entry.path}
            type="button"
            role="option"
            aria-selected={idx === dirActiveIndex}
            className={`dir-autocomplete-item ${idx === dirActiveIndex ? "active" : ""}`}
            onMouseDown={(event) => {
              event.preventDefault();
              setRepoPath(entry.path);
              setDirDropdownOpen(false);
              if (entry.isGitRepo) {
                void handleLoadExplicit(entry.path, INITIAL_MAX_COUNT, false);
              }
            }}
          >
            <Folder size={13} className="dir-item-icon" />
            <span className="dir-item-path font-mono">{entry.path}</span>
            {entry.isGitRepo && <span className="dir-git-badge">git</span>}
          </button>
        ))}
      </div>
    );
  };

  const handlePathInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!dirDropdownOpen || dirSuggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setDirActiveIndex((prev) => Math.min(dirSuggestions.length - 1, prev + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setDirActiveIndex((prev) => Math.max(-1, prev - 1));
    } else if (event.key === "Enter" && dirActiveIndex >= 0) {
      event.preventDefault();
      const chosen = dirSuggestions[dirActiveIndex];
      setRepoPath(chosen.path);
      setDirDropdownOpen(false);
      if (chosen.isGitRepo) {
        void handleLoadExplicit(chosen.path, INITIAL_MAX_COUNT, false);
      }
    } else if (event.key === "Escape") {
      setDirDropdownOpen(false);
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-brand">
          {snapshot && (
            <button
              type="button"
              className="sidebar-toggle"
              onClick={toggleSidebar}
              title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
              aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
              aria-pressed={!sidebarCollapsed}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
          )}
          <div className="logo-badge">
            <GitBranch className="logo-icon" size={17} />
          </div>
          <div className="brand-titles">
            <span className="logo-title">Visual Git</span>
            <span className="logo-subtitle">Local repository viewer</span>
          </div>
        </div>

        <div className="header-actions">
          <form
            className="repo-input-form"
            onSubmit={(event) => {
              event.preventDefault();
              handleLoad();
            }}
          >
            <div className="input-field-group">
              <Folder className="field-icon" size={14} />
              <input
                value={repoPath}
                onChange={(event) => {
                  setRepoPath(event.target.value);
                  setDirDropdownOpen(true);
                }}
                onFocus={() => setDirDropdownOpen(true)}
                onBlur={() => setTimeout(() => setDirDropdownOpen(false), 120)}
                onKeyDown={handlePathInputKeyDown}
                placeholder="Absolute path to a local repository"
                spellCheck={false}
                id="repo-path"
                autoComplete="off"
              />
              {repoPath && (
                <button
                  type="button"
                  className="clear-input-btn"
                  onClick={() => setRepoPath("")}
                  title="Clear field"
                  aria-label="Clear path"
                >
                  <X size={12} />
                </button>
              )}
              {renderDirDropdown()}
            </div>
            <button type="submit" className="load-btn-compact" disabled={loading}>
              {loading ? <Loader2 className="spin-icon" size={14} /> : <RefreshCw size={14} />}
              <span>{loading ? "Reading" : "Load"}</span>
            </button>
          </form>

          {recentRepos.length > 0 && (
            <div className="quick-history">
              <span className="history-label">Recent</span>
              <div className="history-pills">
                {recentRepos.slice(0, 3).map((path) => (
                  <button
                    key={path}
                    className="history-pill"
                    type="button"
                    onClick={() => {
                      setRepoPath(path);
                      void handleLoadExplicit(path, INITIAL_MAX_COUNT, false);
                    }}
                    title={path}
                  >
                    {path.split("/").pop() || path}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
            aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </div>
      </header>

      {error && (
        <div className="global-error-banner" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button className="error-close-btn" onClick={() => setError("")} aria-label="Dismiss error">
            <X size={14} />
          </button>
        </div>
      )}

      {snapshot && diagram && refs ? (
        <div className={`workspace-layout ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
          <aside
            ref={sidebarRef}
            className="workspace-sidebar"
            aria-label="Repository inspector"
            style={{ "--inspector-height": `${inspectorHeight}px` } as React.CSSProperties}
          >
            <div className="sidebar-group repo-meta-card">
              <div className="repo-meta-main">
                <Folder size={15} />
                <h1 className="repo-display-name">{snapshot.name}</h1>
              </div>
              <div
                className="active-branch-indicator"
                title={
                  snapshot.currentBranch === "(detached)"
                    ? "Viewing an older commit directly rather than a named branch"
                    : `Currently checked-out branch: ${snapshot.currentBranch}`
                }
              >
                <span className="indicator-dot" />
                <GitBranch size={11} />
                <span className="branch-name-text">
                  {snapshot.currentBranch === "(detached)" ? "Detached commit" : snapshot.currentBranch}
                </span>
              </div>
            </div>

            <div className="sidebar-group search-panel">
              <div className="search-field-wrapper">
                <Search size={14} className="search-icon" />
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
                  placeholder="Filter commits by text, hash, or author (/)"
                  spellCheck={false}
                />
                {query && (
                  <button
                    type="button"
                    className="clear-search-btn"
                    onClick={() => setQuery("")}
                    title="Clear filter"
                    aria-label="Clear filter"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              {query && (
                <div className="search-metrics-row">
                  <span className="search-metrics">
                    {matchedNodes.length > 0
                      ? `Match ${Math.min(matchCursor + 1, matchedNodes.length)} of ${matchedNodes.length} (${snapshot.commits.length} loaded)`
                      : `Matched 0 of ${snapshot.commits.length} commits`}
                  </span>
                  {matchedNodes.length > 0 && (
                    <div className="search-step-btns">
                      <button
                        type="button"
                        className="step-match-btn"
                        onClick={() => stepMatch(-1)}
                        title="Previous match (Shift+Enter)"
                        aria-label="Previous match"
                      >
                        <ChevronUp size={13} />
                      </button>
                      <button
                        type="button"
                        className="step-match-btn"
                        onClick={() => stepMatch(1)}
                        title="Next match (Enter)"
                        aria-label="Next match"
                      >
                        <ChevronDown size={13} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="sidebar-tabs-container">
              <div className="tabs-header-bar four-cols" role="tablist">
                <button
                  role="tab"
                  aria-selected={activeTab === "refs"}
                  aria-label="Branches and Refs"
                  className={`tab-header-btn ${activeTab === "refs" ? "active" : ""}`}
                  onClick={() => setActiveTab("refs")}
                >
                  <Layers size={13} />
                  <span>Branches</span>
                </button>

                <button
                  role="tab"
                  aria-selected={activeTab === "changes"}
                  className={`tab-header-btn ${activeTab === "changes" ? "active" : ""}`}
                  onClick={() => setActiveTab("changes")}
                >
                  <FileDiff size={13} />
                  <span>Changes</span>
                  {snapshot.status.files.length > 0 && (
                    <span className="tab-badge-notification">{snapshot.status.files.length}</span>
                  )}
                </button>

                <button
                  role="tab"
                  aria-selected={activeTab === "compare"}
                  className={`tab-header-btn ${activeTab === "compare" ? "active" : ""}`}
                  onClick={() => setActiveTab("compare")}
                >
                  <ArrowLeftRight size={13} />
                  <span>Compare</span>
                </button>

                <button
                  role="tab"
                  aria-selected={activeTab === "info"}
                  className={`tab-header-btn ${activeTab === "info" ? "active" : ""}`}
                  onClick={() => setActiveTab("info")}
                >
                  <Info size={13} />
                  <span>Info</span>
                </button>
              </div>

              <div className="tabs-content-area">
                {activeTab === "refs" && (
                  <div className="tab-pane-content">
                    {refs.local.length === 0 && refs.remote.length === 0 && refs.tags.length === 0 ? (
                      <div className="pane-empty-state">
                        <Layers size={18} />
                        <span>No branches or tags found</span>
                      </div>
                    ) : (
                      <>
                        <p className="tab-helper-hint">
                          Click any branch or tag to jump to its commit on the timeline.
                        </p>

                        {refs.local.length > 0 && (
                          <div className="pill-group">
                            <h4 className="pill-group-title" title="Branches saved on your computer">
                              Local branches
                            </h4>
                            <div className="pill-grid">
                              {refs.local.map((branch) => {
                                const isCurrent = branch === refs.currentBranch;
                                const hash = refs.refToHash.get(branch);
                                return (
                                  <button
                                    key={branch}
                                    aria-label={branch}
                                    className={`pill-btn ${isCurrent ? "active" : ""}`}
                                    disabled={!hash}
                                    title={isCurrent ? `${branch} (currently checked out)` : `Jump to ${branch}`}
                                    onClick={() => {
                                      if (hash) setSelectedHash(hash);
                                    }}
                                  >
                                    <GitBranch size={10} />
                                    <span>{branch}</span>
                                    {isCurrent && <span className="pill-current-dot" aria-hidden="true" />}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {refs.remote.length > 0 && (
                          <div className="pill-group">
                            <h4 className="pill-group-title" title="Branches synced from a remote server such as GitHub">
                              Remote branches
                            </h4>
                            <div className="pill-grid">
                              {refs.remote.map((branch) => {
                                const hash = refs.refToHash.get(branch);
                                return (
                                  <button
                                    key={branch}
                                    aria-label={branch}
                                    className="pill-btn"
                                    disabled={!hash}
                                    title={`Jump to remote branch ${branch}`}
                                    onClick={() => {
                                      if (hash) setSelectedHash(hash);
                                    }}
                                  >
                                    <Globe size={10} />
                                    <span>{branch}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {refs.tags.length > 0 && (
                          <div className="pill-group">
                            <h4 className="pill-group-title" title="Named milestone snapshots such as releases">
                              Tags (milestones)
                            </h4>
                            <div className="pill-grid">
                              {refs.tags.map((tag) => {
                                const hash = refs.refToHash.get(tagKey(tag));
                                return (
                                  <button
                                    key={tag}
                                    aria-label={tag}
                                    className="pill-btn"
                                    disabled={!hash}
                                    title={`Jump to tag ${tag}`}
                                    onClick={() => {
                                      if (hash) setSelectedHash(hash);
                                    }}
                                  >
                                    <Tag size={10} />
                                    <span>{tag}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {activeTab === "changes" && (
                  <div className="tab-pane-content">
                    {snapshot.status.clean ? (
                      <div className="working-copy-clean">
                        <CheckCircle size={22} />
                        <span className="status-heading">Everything saved in Git</span>
                        <span className="status-sub">
                          All files match the current commit — no uncommitted edits on disk.
                        </span>
                      </div>
                    ) : (
                      (() => {
                        const stagedFiles = snapshot.status.files.filter(
                          (f) => f.index !== " " && f.index !== "?"
                        );
                        const unstagedFiles = snapshot.status.files.filter(
                          (f) => f.workingTree !== " " && f.workingTree !== "?"
                        );
                        const untrackedFiles = snapshot.status.files.filter(
                          (f) => f.index === "?" && f.workingTree === "?"
                        );

                        return (
                          <>
                            {stagedFiles.length > 0 && (
                              <div className="changes-section-group">
                                <div className="changes-section-header">
                                  <span className="changes-section-dot stage" />
                                  <span className="changes-section-title">Ready to commit (Staged)</span>
                                  <span className="files-count-pill font-mono">{stagedFiles.length}</span>
                                </div>
                                <p className="changes-section-sub">Included in your next commit.</p>
                                <ul className="changes-file-list">
                                  {stagedFiles.map((file) => (
                                    <li key={`staged-${file.path}`}>
                                      <button
                                        type="button"
                                        className="file-change-row clickable"
                                        onClick={() => handleOpenWorkingFile(file.path)}
                                        title={`View diff for ${file.path}`}
                                      >
                                        <FileCode size={13} className="file-icon" />
                                        <span className="file-path-text">{file.path}</span>
                                        <span className="badge-status stage">{porcelainStatusLabel(file.index)}</span>
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {unstagedFiles.length > 0 && (
                              <div className="changes-section-group">
                                <div className="changes-section-header">
                                  <span className="changes-section-dot unstage" />
                                  <span className="changes-section-title">Modified (Not staged yet)</span>
                                  <span className="files-count-pill font-mono">{unstagedFiles.length}</span>
                                </div>
                                <p className="changes-section-sub">Edited on disk; not staged for commit yet.</p>
                                <ul className="changes-file-list">
                                  {unstagedFiles.map((file) => (
                                    <li key={`unstaged-${file.path}`}>
                                      <button
                                        type="button"
                                        className="file-change-row clickable"
                                        onClick={() => handleOpenWorkingFile(file.path)}
                                        title={`View diff for ${file.path}`}
                                      >
                                        <FileCode size={13} className="file-icon" />
                                        <span className="file-path-text">{file.path}</span>
                                        <span className="badge-status unstage">
                                          {porcelainStatusLabel(file.workingTree)}
                                        </span>
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {untrackedFiles.length > 0 && (
                              <div className="changes-section-group">
                                <div className="changes-section-header">
                                  <span className="changes-section-dot untrack" />
                                  <span className="changes-section-title">New files (Untracked)</span>
                                  <span className="files-count-pill font-mono">{untrackedFiles.length}</span>
                                </div>
                                <p className="changes-section-sub">Brand-new files Git isn't tracking yet.</p>
                                <ul className="changes-file-list">
                                  {untrackedFiles.map((file) => (
                                    <li key={`untracked-${file.path}`}>
                                      <button
                                        type="button"
                                        className="file-change-row clickable"
                                        onClick={() => handleOpenWorkingFile(file.path)}
                                        title={`View diff for ${file.path}`}
                                      >
                                        <FileCode size={13} className="file-icon" />
                                        <span className="file-path-text">{file.path}</span>
                                        <span className="badge-status untrack">New</span>
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </>
                        );
                      })()
                    )}
                  </div>
                )}

                {activeTab === "compare" && (
                  <div className="tab-pane-content compare-tab-view">
                    {allBranchOptions.length < 2 ? (
                      <div className="pane-empty-state">
                        <ArrowLeftRight size={18} />
                        <span>Need at least two branches to compare.</span>
                      </div>
                    ) : (
                      <>
                        <div className="compare-selectors">
                          <label className="compare-field">
                            <span className="detail-lbl">Starting from (Base)</span>
                            <select
                              className="compare-select font-mono"
                              value={compareBase}
                              onChange={(event) => setCompareBase(event.target.value)}
                            >
                              {allBranchOptions.map((branch) => (
                                <option key={branch} value={branch}>
                                  {branch}
                                </option>
                              ))}
                            </select>
                          </label>

                          <button
                            type="button"
                            className="compare-swap-btn"
                            onClick={() => {
                              setCompareBase(compareHead);
                              setCompareHead(compareBase);
                            }}
                            title="Swap base and compare branches"
                            aria-label="Swap base and compare branches"
                          >
                            <ArrowLeftRight size={13} />
                          </button>

                          <label className="compare-field">
                            <span className="detail-lbl">Comparing with</span>
                            <select
                              className="compare-select font-mono"
                              value={compareHead}
                              onChange={(event) => setCompareHead(event.target.value)}
                            >
                              {allBranchOptions.map((branch) => (
                                <option key={branch} value={branch}>
                                  {branch}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        {compareLoading ? (
                          <div className="compare-loading-row">
                            <Loader2 size={14} className="spin-icon" />
                            <span>Comparing {compareBase}…{compareHead}</span>
                          </div>
                        ) : compareError ? (
                          <div className="compare-error-box">{compareError}</div>
                        ) : comparison ? (
                          <>
                            <p className="compare-summary-sentence">{formatCompareSummary(comparison)}</p>

                            <div className="compare-summary-grid">
                              <div className="compare-stat-box ahead">
                                <span className="box-val font-mono">+{comparison.aheadCount}</span>
                                <span className="box-lbl">New on {comparison.head}</span>
                              </div>
                              <div className="compare-stat-box behind">
                                <span className="box-val font-mono">-{comparison.behindCount}</span>
                                <span className="box-lbl">Only on {comparison.base}</span>
                              </div>
                            </div>

                            <label className="compare-highlight-toggle">
                              <input
                                type="checkbox"
                                checked={highlightComparison}
                                onChange={(event) => setHighlightComparison(event.target.checked)}
                              />
                              <span>Highlight differences on timeline</span>
                            </label>

                            {comparison.mergeBase && (
                              <button
                                type="button"
                                className="merge-base-btn font-mono"
                                onClick={() => setSelectedHash(comparison.mergeBase)}
                                title="The shared commit where these two branches split apart"
                              >
                                <span>Split point: {comparison.mergeBase.slice(0, 7)}</span>
                                <ChevronRight size={12} />
                              </button>
                            )}

                            <div className="compare-files-section">
                              <span className="detail-lbl">
                                File differences ({comparison.files.length})
                              </span>
                              {comparison.files.length === 0 ? (
                                <span className="sub-muted">No file differences between these branches.</span>
                              ) : (
                                <ul className="commit-files-list">
                                  {comparison.files.map((file) => (
                                    <li key={`${file.status}-${file.path}`}>
                                      <button
                                        type="button"
                                        className="commit-file-btn"
                                        onClick={() => handleOpenCompareFile(file)}
                                        title={
                                          file.oldPath
                                            ? `${CHANGE_STATUS_TITLE[file.status]}: ${file.oldPath} → ${file.path}`
                                            : `${CHANGE_STATUS_TITLE[file.status]}: ${file.path}`
                                        }
                                      >
                                        <span
                                          className={`change-status-pill status-${file.status}`}
                                          title={CHANGE_STATUS_TITLE[file.status]}
                                        >
                                          {file.status}
                                        </span>
                                        <span className="commit-file-path font-mono">{file.path}</span>
                                        <span className="commit-file-stats font-mono">
                                          {file.additions !== null && <span className="stat-add">+{file.additions}</span>}
                                          {file.deletions !== null && <span className="stat-del">-{file.deletions}</span>}
                                        </span>
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </>
                        ) : null}
                      </>
                    )}
                  </div>
                )}

                {activeTab === "info" && (
                  <div className="tab-pane-content info-tab-view">
                    <div className="stats-dashboard-grid">
                      <div className="dashboard-metric-box">
                        <span className="box-val font-mono">
                          {snapshot.commits.length}
                          {snapshot.truncated ? "+" : ""}
                        </span>
                        <span className="box-lbl">Commits loaded</span>
                      </div>
                      <div className="dashboard-metric-box">
                        <span className="box-val font-mono">{diagram.lanes.length}</span>
                        <span className="box-lbl">Branch lanes</span>
                      </div>
                      <div className="dashboard-metric-box">
                        <span className={`box-val font-mono ${snapshot.status.clean ? "success-text" : "warning-text"}`}>
                          {snapshot.status.clean ? "Clean" : snapshot.status.files.length}
                        </span>
                        <span className="box-lbl">Uncommitted files</span>
                      </div>
                    </div>

                    <div className="repo-details-list">
                      <div className="detail-row">
                        <span className="detail-lbl">Main (default) branch</span>
                        <span className="detail-val font-mono">{snapshot.defaultBranch}</span>
                      </div>

                      <div className="detail-row">
                        <span className="detail-lbl">Repository path</span>
                        <span className="detail-val font-mono" title={snapshot.path}>
                          {snapshot.path}
                        </span>
                      </div>

                      {snapshot.remotes.length > 0 && (
                        <div className="detail-row">
                          <span className="detail-lbl">Connected servers (Remotes)</span>
                          <div className="remotes-links-list">
                            {snapshot.remotes.map((remote) => (
                              <div key={remote} className="remote-item font-mono">
                                <Globe size={11} />
                                <span>{remote}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="detail-row">
                        <span className="detail-lbl">Shortcuts</span>
                        <div className="shortcuts-hint-grid font-mono">
                          <span><kbd>j</kbd> / <kbd>k</kbd> next / prev commit</span>
                          <span><kbd>p</kbd> previous commit · <kbd>/</kbd> search · <kbd>d</kbd> density</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div
              className="sidebar-split-handle"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize commit inspector"
              title="Drag to resize commit inspector (double-click to reset)"
              onMouseDown={startInspectorResize}
              onDoubleClick={() => {
                setInspectorHeight(320);
                try {
                  localStorage.setItem("visual-git-inspector-height", "320");
                } catch {
                  // Ignore storage failures.
                }
              }}
            >
              <span className="split-handle-grip" />
            </div>

            <div className="sidebar-commit-inspector">
              {selectedCommit ? (
                <div className="inspector-card">
                  <div className="inspector-header">
                    <div className="author-badge-area">
                      <div
                        className={`avatar-container avatar-bg-${hashColorIndex(
                          selectedCommit.authorEmail || selectedCommit.authorName
                        )}`}
                      >
                        {selectedCommit.authorName.trim().charAt(0).toUpperCase() || "?"}
                      </div>
                      <div className="author-details-meta">
                        <span className="author-display-name">{selectedCommit.authorName}</span>
                        <span className="author-email-address font-mono">{selectedCommit.authorEmail}</span>
                      </div>
                    </div>

                    <div className="inspector-commit-type">
                      {(selectedCommit.hash === snapshot.head ||
                        selectedCommit.shortHash === snapshot.head ||
                        (snapshot.head && selectedCommit.hash.startsWith(snapshot.head)) ||
                        selectedCommit.refs.some((r) => r.kind === "head" || (r.kind === "local" && r.isCurrent))) && (
                        <span className="type-badge you-are-here" title="This commit is currently checked out (HEAD)">
                          You are here
                        </span>
                      )}
                      {selectedCommit.parents.length > 1 ? (
                        <span className="type-badge merge" title="Combined changes from two branches">
                          <GitMerge size={10} />
                          <span>Merge</span>
                        </span>
                      ) : (
                        <span className="type-badge regular" title="A saved snapshot of changes">
                          <GitCommitHorizontal size={10} />
                          <span>Commit</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="inspector-body">
                    <h2 className="inspector-subject" title={selectedCommit.subject}>
                      {selectedCommit.subject}
                    </h2>

                    {selectedCommit.body && (
                      <div className="inspector-desc-scroller">
                        <pre className="font-mono">{selectedCommit.body}</pre>
                      </div>
                    )}

                    <div className="inspector-meta-fields">
                      <div className="inspector-meta-item">
                        <span className="lbl">Commit ID (Hash)</span>
                        <span className="val font-mono selectable" title={selectedCommit.hash}>
                          {selectedCommit.hash}
                        </span>
                      </div>

                      <div className="inspector-meta-item">
                        <span className="lbl">Saved on</span>
                        <div className="val flex-align-center text-secondary">
                          <Clock size={11} />
                          <span className="margin-l-6">{formatDate(selectedCommit.date)}</span>
                        </div>
                      </div>

                      <div className="inspector-meta-item">
                        <span className="lbl">
                          {selectedCommit.parents.length > 1
                            ? "Combined from (Merged branches)"
                            : "Built from (Previous commit)"}
                        </span>
                        <div className="parents-list-row font-mono">
                          {selectedCommit.parents.length > 0 ? (
                            selectedCommit.parents.map((parent, idx) => (
                              <button
                                key={parent}
                                className="parent-link-badge"
                                onClick={() => setSelectedHash(parent)}
                                title="Jump to this earlier commit"
                              >
                                {selectedCommit.parents.length > 1 && (
                                  <span className="parent-role-tag font-sans">
                                    {idx === 0 ? "Target" : "Merged"}
                                  </span>
                                )}
                                <span>{parent.slice(0, 7)}</span>
                                <ChevronRight size={10} />
                              </button>
                            ))
                          ) : (
                            <span className="no-parents-text">Initial commit (start of history)</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {selectedCommit.refs.length > 0 && (
                      <div className="inspector-tags-list">
                        <span className="lbl">Branches & tags pointing here</span>
                        <div className="tags-flex">
                          {sortRefsForDisplay(selectedCommit.refs).map((ref, idx) => (
                            <span key={`${ref.kind}-${ref.name}-${idx}`} className={`ref-item ${refClass(ref)}`}>
                              {refLabel(ref)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="inspector-files-section">
                      <div className="inspector-files-header">
                        <span className="lbl">Files changed in this commit</span>
                        {commitDetails && (
                          <span className="files-count-pill font-mono">{commitDetails.files.length}</span>
                        )}
                      </div>

                      {commitDetailsLoading ? (
                        <div className="files-loading-state">
                          <Loader2 size={13} className="spin-icon" />
                          <span>Loading changed files…</span>
                        </div>
                      ) : commitDetailsError ? (
                        <div className="files-error-state">{commitDetailsError}</div>
                      ) : commitDetails && commitDetails.files.length === 0 ? (
                        <span className="no-parents-text">Empty commit (no file changes)</span>
                      ) : commitDetails ? (
                        <ul className="commit-files-list">
                          {commitDetails.files.map((file) => (
                            <li key={`${file.status}-${file.path}`}>
                              <button
                                type="button"
                                className="commit-file-btn"
                                onClick={() => handleOpenCommitFile(file)}
                                title={
                                  file.oldPath
                                    ? `${CHANGE_STATUS_TITLE[file.status]}: ${file.oldPath} → ${file.path}`
                                    : `${CHANGE_STATUS_TITLE[file.status]}: ${file.path}`
                                }
                              >
                                <span
                                  className={`change-status-pill status-${file.status}`}
                                  title={CHANGE_STATUS_TITLE[file.status]}
                                >
                                  {file.status}
                                </span>
                                <span className="commit-file-path font-mono">{file.path}</span>
                                <span className="commit-file-stats font-mono">
                                  {file.additions !== null && <span className="stat-add">+{file.additions}</span>}
                                  {file.deletions !== null && <span className="stat-del">-{file.deletions}</span>}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="inspector-empty-state">
                  <Database size={20} />
                  <span>No commit selected</span>
                  <span className="sub">Select a commit in the timeline to inspect its changes.</span>
                </div>
              )}
            </div>
          </aside>

          <main className="workspace-graph-viewer">
            <CommitGraph
              repoKey={snapshot.path}
              diagram={diagram}
              density={density}
              onDensityChange={handleDensityChange}
              selectedHash={selectedCommit?.hash ?? null}
              onSelect={setSelectedHash}
              matchedHashes={matchedHashes}
              compareHighlight={compareHighlight}
              compareMergeBase={compareHighlight ? comparison?.mergeBase ?? null : null}
              headHash={snapshot.head}
              workingStatus={snapshot.status}
              onOpenChanges={() => setActiveTab("changes")}
              truncated={snapshot.truncated}
              loadingMore={loadingMore}
              onLoadMore={() => void handleLoadMore()}
              liveConnected={liveConnected}
            />
          </main>
        </div>
      ) : (
        <section className="onboarding-container">
          <div className="onboarding-panel">
            <div className="onboarding-intro">
              <h2>Open a local repository</h2>
              <p>
                Visual Git reads commit history through the local <code>git</code> CLI and renders it as a branch graph.
                It is read-only and never writes to the selected repository.
              </p>
            </div>

            <div className="onboarding-card">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  handleLoad();
                }}
                className="onboarding-form"
              >
                <label htmlFor="repo-path-onboard" className="field-label">
                  Repository path
                </label>
                <div className="onboarding-input-row">
                  <div className="onboarding-input-wrapper">
                    <Folder size={14} className="input-icon" />
                    <input
                      id="repo-path-onboard"
                      value={repoPath}
                      onChange={(event) => {
                        setRepoPath(event.target.value);
                        setDirDropdownOpen(true);
                      }}
                      onFocus={() => setDirDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setDirDropdownOpen(false), 120)}
                      onKeyDown={handlePathInputKeyDown}
                      placeholder="/absolute/path/to/repository"
                      spellCheck={false}
                      autoComplete="off"
                      autoFocus
                    />
                    {renderDirDropdown()}
                  </div>
                  <button type="submit" className="onboarding-submit-btn" disabled={loading}>
                    {loading ? <Loader2 className="spin-icon" size={16} /> : <RefreshCw size={16} />}
                    <span>{loading ? "Reading" : "Load"}</span>
                  </button>
                </div>
              </form>

              {defaultRepoPath && (
                <div className="onboarding-demo-row">
                  <div className="onboarding-demo-text">
                    <span className="label">Current workspace repository</span>
                    <span className="sub font-mono">{defaultRepoPath}</span>
                  </div>
                  <button
                    type="button"
                    className="demo-load-button"
                    onClick={() => {
                      setRepoPath(defaultRepoPath);
                      void handleLoadExplicit(defaultRepoPath, INITIAL_MAX_COUNT, false);
                    }}
                  >
                    <GitBranch size={13} />
                    <span>Load current project</span>
                  </button>
                </div>
              )}
            </div>

            {recentRepos.length > 0 && (
              <div className="onboarding-history">
                <h3>Recent repositories</h3>
                <div className="history-cards-grid">
                  {recentRepos.map((path) => (
                    <div key={path} className="history-card">
                      <button
                        type="button"
                        className="history-card-main-btn"
                        onClick={() => {
                          setRepoPath(path);
                          void handleLoadExplicit(path, INITIAL_MAX_COUNT, false);
                        }}
                      >
                        <Folder size={14} className="folder-icon" />
                        <div className="card-info">
                          <span className="name">{path.split("/").pop() || path}</span>
                          <span className="path font-mono">{path}</span>
                        </div>
                      </button>
                      <button
                        type="button"
                        className="history-card-delete-btn"
                        onClick={() => removeFromRecent(path)}
                        title="Remove from history"
                        aria-label="Remove from history"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {diffTarget && (
        <DiffViewer
          target={diffTarget}
          diff={diffData}
          loading={diffLoading}
          error={diffError}
          onClose={closeDiffModal}
        />
      )}
    </div>
  );
}
