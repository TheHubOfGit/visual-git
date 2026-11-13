import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronRight,
  Clock,
  FileCode,
  Folder,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Globe,
  Loader2,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Sun,
  Tag,
  X,
  Database,
  Info,
  Layers,
  FileDiff,
  CheckCircle
} from "lucide-react";
import { loadRepository } from "../api";
import { layoutCommitGraph } from "../lib/graphLayout";
import { resolveRefs, tagKey } from "../lib/refs";
import type { GitRepositorySnapshot } from "../lib/types";
import { CommitGraph } from "./CommitGraph";
import { useTheme } from "./useTheme";

const examplePath = "/Users/you/projects/visual-git";

/** A repository path supplied via the URL, e.g. by the `visualgit` CLI. */
function pathFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("path");
  return value && value.trim() ? value : null;
}

function formatDate(value: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function App() {
  const { theme, toggleTheme } = useTheme();

  const [repoPath, setRepoPath] = useState(() => pathFromUrl() ?? examplePath);
  const [snapshot, setSnapshot] = useState<GitRepositorySnapshot | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Navigation tabs: 'refs' (Branches & Tags), 'changes' (Working Copy), 'info' (Repo Details)
  const [activeTab, setActiveTab] = useState<"refs" | "changes" | "info">("refs");

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
        // Ignore storage failures; in-memory state still works.
      }
      return next;
    });
  };

  const [recentRepos, setRecentRepos] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("visual-git-recent");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const addToRecent = (path: string) => {
    setRecentRepos((prev) => {
      const filtered = prev.filter((p) => p !== path);
      const updated = [path, ...filtered].slice(0, 5);
      localStorage.setItem("visual-git-recent", JSON.stringify(updated));
      return updated;
    });
  };

  const removeFromRecent = (path: string) => {
    setRecentRepos((prev) => {
      const updated = prev.filter((p) => p !== path);
      localStorage.setItem("visual-git-recent", JSON.stringify(updated));
      return updated;
    });
  };

  const graph = useMemo(() => (snapshot ? layoutCommitGraph(snapshot.commits) : null), [snapshot]);
  const selectedCommit = useMemo(
    () => graph?.rows.find((row) => row.hash === selectedHash) ?? graph?.rows[0] ?? null,
    [graph, selectedHash]
  );

  const visibleGraph = useMemo(() => {
    if (!snapshot || !graph) return null;
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return graph;
    const visibleCommits = snapshot.commits.filter((commit) =>
      [commit.hash, commit.subject, commit.authorName, commit.refs.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
    return layoutCommitGraph(visibleCommits);
  }, [graph, query, snapshot]);

  const refs = useMemo(() => (snapshot ? resolveRefs(snapshot) : null), [snapshot]);

  async function handleLoadExplicit(path: string) {
    setLoading(true);
    setError("");
    try {
      const data = await loadRepository(path);
      setSnapshot(data);
      setSelectedHash(data.commits[0]?.hash ?? null);
      addToRecent(path);
      setActiveTab("refs");
    } catch (loadError) {
      setSnapshot(null);
      setSelectedHash(null);
      setError(loadError instanceof Error ? loadError.message : "Unable to load repository.");
    } finally {
      setLoading(false);
    }
  }

  function handleLoad() {
    void handleLoadExplicit(repoPath);
  }

  // Auto-load a repository supplied through the URL (e.g. the `visualgit` CLI),
  // once on mount.
  useEffect(() => {
    const urlPath = pathFromUrl();
    if (urlPath) {
      void handleLoadExplicit(urlPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
                onChange={(event) => setRepoPath(event.target.value)}
                placeholder="Absolute path to a local repository"
                spellCheck={false}
                id="repo-path"
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
                      void handleLoadExplicit(path);
                    }}
                    title={path}
                  >
                    {path.split("/").pop()}
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

      {snapshot && graph && visibleGraph && refs ? (
        <div className={`workspace-layout ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
          <aside className="workspace-sidebar" aria-label="Repository inspector">
            <div className="sidebar-group repo-meta-card">
              <div className="repo-meta-main">
                <Folder size={15} />
                <h1 className="repo-display-name">{snapshot.name}</h1>
              </div>
              <div className="active-branch-indicator">
                <span className="indicator-dot" />
                <GitBranch size={11} />
                <span className="branch-name-text">{snapshot.currentBranch}</span>
              </div>
            </div>

            <div className="sidebar-group search-panel">
              <div className="search-field-wrapper">
                <Search size={14} className="search-icon" />
                <input
                  id="commit-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter commits by text, hash, or author"
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
                <div className="search-metrics">
                  Matched {visibleGraph.rows.length} of {snapshot.commits.length} commits
                </div>
              )}
            </div>

            <div className="sidebar-tabs-container">
              <div className="tabs-header-bar" role="tablist">
                <button
                  role="tab"
                  aria-selected={activeTab === "refs"}
                  className={`tab-header-btn ${activeTab === "refs" ? "active" : ""}`}
                  onClick={() => setActiveTab("refs")}
                >
                  <Layers size={13} />
                  <span>References</span>
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
                        {refs.local.length > 0 && (
                          <div className="pill-group">
                            <h4 className="pill-group-title">Local branches</h4>
                            <div className="pill-grid">
                              {refs.local.map((branch) => {
                                const isCurrent = branch === refs.currentBranch;
                                const hash = refs.refToHash.get(branch);
                                return (
                                  <button
                                    key={branch}
                                    className={`pill-btn ${isCurrent ? "active" : ""}`}
                                    disabled={!hash}
                                    onClick={() => {
                                      if (hash) setSelectedHash(hash);
                                    }}
                                  >
                                    <GitBranch size={10} />
                                    <span>{branch}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {refs.remote.length > 0 && (
                          <div className="pill-group">
                            <h4 className="pill-group-title">Remote branches</h4>
                            <div className="pill-grid">
                              {refs.remote.map((branch) => {
                                const hash = refs.refToHash.get(branch);
                                return (
                                  <button
                                    key={branch}
                                    className="pill-btn"
                                    disabled={!hash}
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
                            <h4 className="pill-group-title">Tags</h4>
                            <div className="pill-grid">
                              {refs.tags.map((tag) => {
                                const hash = refs.refToHash.get(tagKey(tag));
                                return (
                                  <button
                                    key={tag}
                                    className="pill-btn"
                                    disabled={!hash}
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
                        <span className="status-heading">Working tree clean</span>
                        <span className="status-sub">No uncommitted changes in the index or working tree.</span>
                      </div>
                    ) : (
                      <ul className="changes-file-list">
                        {snapshot.status.files.map((file) => {
                          const isUntracked = file.index === "?" && file.workingTree === "?";
                          const isStaged = file.index !== " " && file.index !== "?";
                          const isUnstaged = file.workingTree !== " " && file.workingTree !== "?";

                          return (
                            <li key={file.path} className="file-change-row">
                              <FileCode size={13} className="file-icon" />
                              <span className="file-path-text" title={file.path}>
                                {file.path}
                              </span>
                              <div className="status-pills-row">
                                {isStaged && (
                                  <span className="badge-status stage" title={`Staged: ${file.index}`}>
                                    Staged
                                  </span>
                                )}
                                {isUnstaged && (
                                  <span className="badge-status unstage" title={`Unstaged: ${file.workingTree}`}>
                                    Unstaged
                                  </span>
                                )}
                                {isUntracked && (
                                  <span className="badge-status untrack" title="Untracked">
                                    Untracked
                                  </span>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}

                {activeTab === "info" && (
                  <div className="tab-pane-content info-tab-view">
                    <div className="stats-dashboard-grid">
                      <div className="dashboard-metric-box">
                        <span className="box-val font-mono">{snapshot.commits.length}</span>
                        <span className="box-lbl">Commits loaded</span>
                      </div>
                      <div className="dashboard-metric-box">
                        <span className="box-val font-mono">{graph.lanes}</span>
                        <span className="box-lbl">Parallel branches</span>
                      </div>
                      <div className="dashboard-metric-box">
                        <span className={`box-val font-mono ${snapshot.status.clean ? "success-text" : "warning-text"}`}>
                          {snapshot.status.clean ? "Clean" : snapshot.status.files.length}
                        </span>
                        <span className="box-lbl">Modified files</span>
                      </div>
                    </div>

                    <div className="repo-details-list">
                      <div className="detail-row">
                        <span className="detail-lbl">Repository path</span>
                        <span className="detail-val font-mono" title={snapshot.path}>
                          {snapshot.path}
                        </span>
                      </div>

                      {snapshot.remotes.length > 0 && (
                        <div className="detail-row">
                          <span className="detail-lbl">Configured remotes</span>
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
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="sidebar-commit-inspector">
              {selectedCommit ? (
                <div className="inspector-card">
                  <div className="inspector-header">
                    <div className="author-badge-area">
                      <div
                        className={`avatar-container avatar-bg-${
                          (selectedCommit.authorName.length + selectedCommit.authorEmail.length) % 6
                        }`}
                      >
                        {selectedCommit.authorName.trim().charAt(0).toUpperCase() || "?"}
                      </div>
                      <div className="author-details-meta">
                        <span className="author-display-name">{selectedCommit.authorName}</span>
                        <span className="author-email-address font-mono">{selectedCommit.authorEmail}</span>
                      </div>
                    </div>

                    <div className="inspector-commit-type">
                      {selectedCommit.parents.length > 1 ? (
                        <span className="type-badge merge">
                          <GitMerge size={10} />
                          <span>Merge</span>
                        </span>
                      ) : (
                        <span className="type-badge regular">
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
                        <span className="lbl">Commit hash</span>
                        <span className="val font-mono selectable" title={selectedCommit.hash}>
                          {selectedCommit.hash}
                        </span>
                      </div>

                      <div className="inspector-meta-item">
                        <span className="lbl">Authored</span>
                        <div className="val flex-align-center text-secondary">
                          <Clock size={11} />
                          <span className="margin-l-6">{formatDate(selectedCommit.date)}</span>
                        </div>
                      </div>

                      <div className="inspector-meta-item">
                        <span className="lbl">Parents</span>
                        <div className="parents-list-row font-mono">
                          {selectedCommit.parents.length > 0 ? (
                            selectedCommit.parents.map((parent) => (
                              <button
                                key={parent}
                                className="parent-link-badge"
                                onClick={() => setSelectedHash(parent)}
                                title="Jump to parent commit"
                              >
                                <span>{parent.slice(0, 7)}</span>
                                <ChevronRight size={10} />
                              </button>
                            ))
                          ) : (
                            <span className="no-parents-text">Root commit (no parents)</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {selectedCommit.refs.length > 0 && (
                      <div className="inspector-tags-list">
                        <span className="lbl">References</span>
                        <div className="tags-flex">
                          {selectedCommit.refs.map((ref) => {
                            const isHead = ref.includes("HEAD");
                            const isTag = ref.startsWith("tag: ");
                            const cleanRef = isTag ? ref.slice(5) : ref.replace("HEAD -> ", "");
                            const refClass = isHead
                              ? "ref-head"
                              : isTag
                              ? "ref-tag"
                              : ref.startsWith("origin/")
                              ? "ref-remote"
                              : "ref-local";

                            return (
                              <span key={ref} className={`ref-item ${refClass}`}>
                                {cleanRef}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="inspector-empty-state">
                  <Database size={20} />
                  <span>No commit selected</span>
                  <span className="sub">Select a commit in the graph to see its details here.</span>
                </div>
              )}
            </div>
          </aside>

          <main className="workspace-graph-viewer">
            <CommitGraph graph={visibleGraph} selectedHash={selectedCommit?.hash ?? null} onSelect={setSelectedHash} />
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
                      onChange={(event) => setRepoPath(event.target.value)}
                      placeholder="/absolute/path/to/repository"
                      spellCheck={false}
                      autoFocus
                    />
                  </div>
                  <button type="submit" className="onboarding-submit-btn" disabled={loading}>
                    {loading ? <Loader2 className="spin-icon" size={16} /> : <RefreshCw size={16} />}
                    <span>{loading ? "Reading" : "Load"}</span>
                  </button>
                </div>
              </form>

              <div className="onboarding-demo-row">
                <div className="onboarding-demo-text">
                  <span className="label">Try it on this project</span>
                  <span className="sub">Loads the Visual Git repository itself.</span>
                </div>
                <button
                  type="button"
                  className="demo-load-button"
                  onClick={() => {
                    setRepoPath(examplePath);
                    void handleLoadExplicit(examplePath);
                  }}
                >
                  <GitBranch size={13} />
                  <span>Load this project</span>
                </button>
              </div>
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
                          void handleLoadExplicit(path);
                        }}
                      >
                        <Folder size={14} className="folder-icon" />
                        <div className="card-info">
                          <span className="name">{path.split("/").pop()}</span>
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
    </div>
  );
}
