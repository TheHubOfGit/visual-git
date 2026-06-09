import { useMemo, useState } from "react";
import { AlertCircle, GitBranch, GitCommitHorizontal, GitMerge, Loader2, RefreshCw, Search } from "lucide-react";
import { loadRepository } from "../api";
import { layoutCommitGraph } from "../lib/graphLayout";
import type { GitRepositorySnapshot } from "../lib/types";
import { CommitGraph } from "./CommitGraph";

const examplePath = "/Users/you/projects/visual-git";

function formatDate(value: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function App() {
  const [repoPath, setRepoPath] = useState(examplePath);
  const [snapshot, setSnapshot] = useState<GitRepositorySnapshot | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const graph = useMemo(() => (snapshot ? layoutCommitGraph(snapshot.commits) : null), [snapshot]);
  const selectedCommit = useMemo(() => graph?.rows.find((row) => row.hash === selectedHash) ?? graph?.rows[0] ?? null, [graph, selectedHash]);
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

  async function handleLoad() {
    setLoading(true);
    setError("");
    try {
      const data = await loadRepository(repoPath);
      setSnapshot(data);
      setSelectedHash(data.commits[0]?.hash ?? null);
    } catch (loadError) {
      setSnapshot(null);
      setSelectedHash(null);
      setError(loadError instanceof Error ? loadError.message : "Unable to load repository.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="topbar" aria-label="Repository controls">
        <div>
          <div className="brand">
            <GitBranch size={24} />
            <span>Visual Git</span>
          </div>
          <p>Open any local folder that already has Git initialized and inspect its real commit graph.</p>
        </div>
        <form
          className="repo-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleLoad();
          }}
        >
          <label htmlFor="repo-path">Repository path</label>
          <div className="path-row">
            <input
              id="repo-path"
              value={repoPath}
              onChange={(event) => setRepoPath(event.target.value)}
              placeholder="/absolute/path/to/project"
              spellCheck={false}
            />
            <button type="submit" disabled={loading}>
              {loading ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
              Load
            </button>
          </div>
        </form>
      </section>

      {error ? (
        <div className="message error" role="alert">
          <AlertCircle size={18} />
          {error}
        </div>
      ) : null}

      {snapshot && graph && visibleGraph ? (
        <section className="workspace">
          <aside className="sidebar" aria-label="Repository summary">
            <div className="repo-title">
              <h1>{snapshot.name}</h1>
              <span>{snapshot.currentBranch}</span>
            </div>
            <div className="stat-grid">
              <div>
                <strong>{snapshot.commits.length}</strong>
                <span>commits loaded</span>
              </div>
              <div>
                <strong>{graph.lanes}</strong>
                <span>lanes</span>
              </div>
              <div>
                <strong>{snapshot.status.clean ? "Clean" : snapshot.status.files.length}</strong>
                <span>{snapshot.status.clean ? "working tree" : "changed files"}</span>
              </div>
            </div>

            <label className="search-box" htmlFor="commit-search">
              <Search size={16} />
              <input
                id="commit-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter commits"
              />
            </label>

            <div className="detail-panel">
              {selectedCommit ? (
                <>
                  <div className="commit-icon">
                    {selectedCommit.parents.length > 1 ? <GitMerge size={18} /> : <GitCommitHorizontal size={18} />}
                  </div>
                  <h2>{selectedCommit.subject}</h2>
                  <dl>
                    <div>
                      <dt>Hash</dt>
                      <dd>{selectedCommit.shortHash}</dd>
                    </div>
                    <div>
                      <dt>Author</dt>
                      <dd>{selectedCommit.authorName}</dd>
                    </div>
                    <div>
                      <dt>Date</dt>
                      <dd>{formatDate(selectedCommit.date)}</dd>
                    </div>
                    <div>
                      <dt>Parents</dt>
                      <dd>{selectedCommit.parents.length ? selectedCommit.parents.map((parent) => parent.slice(0, 7)).join(", ") : "None"}</dd>
                    </div>
                  </dl>
                  {selectedCommit.refs.length ? (
                    <div className="ref-list">
                      {selectedCommit.refs.map((ref) => (
                        <span key={ref}>{ref}</span>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <p>No commit selected.</p>
              )}
            </div>
          </aside>

          <CommitGraph
            graph={visibleGraph}
            selectedHash={selectedCommit?.hash ?? null}
            onSelect={setSelectedHash}
          />
        </section>
      ) : (
        <section className="empty-state">
          <GitBranch size={48} />
          <h1>Point Visual Git at a local repository.</h1>
          <p>The graph is generated from `git log --all`, so existing commits, branches, tags, merges, and detached states show up from real project history.</p>
        </section>
      )}
    </main>
  );
}
