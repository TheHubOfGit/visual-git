import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, ChevronRight, Folder, FolderGit2, HardDrive, Home, Loader2, Monitor, X } from "lucide-react";
import { browseFolder } from "../api";
import type { DirectoryListing, FolderPlace } from "../lib/types";

type FolderBrowserProps = {
  /** Folder to start in; falls back to the last folder browsed, then the home folder. */
  startPath?: string;
  onPick: (path: string) => void;
  onClose: () => void;
};

const LAST_FOLDER_KEY = "visual-git:last-browsed-folder";

function readLastFolder(): string | undefined {
  try {
    return localStorage.getItem(LAST_FOLDER_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function rememberFolder(path: string) {
  try {
    localStorage.setItem(LAST_FOLDER_KEY, path);
  } catch {
    // Storage can be unavailable; remembering the folder is only a convenience.
  }
}

type Crumb = { label: string; path: string };

/** Split an absolute path (Unix, Windows drive or network share) into clickable steps. */
export function pathCrumbs(fullPath: string): Crumb[] {
  const windows = /^[A-Za-z]:[\\/]/.test(fullPath) || fullPath.startsWith("\\\\");
  const sep = windows ? "\\" : "/";
  const parts = fullPath.split(/[\\/]+/).filter(Boolean);
  const crumbs: Crumb[] = [];
  let current: string;
  if (fullPath.startsWith("\\\\") && parts.length >= 2) {
    current = `\\\\${parts[0]}\\${parts[1]}\\`;
    crumbs.push({ label: `\\\\${parts[0]}\\${parts[1]}`, path: current });
    parts.splice(0, 2);
  } else if (windows) {
    current = `${parts[0]}\\`;
    crumbs.push({ label: parts[0], path: current });
    parts.splice(0, 1);
  } else {
    current = "/";
    crumbs.push({ label: "/", path: "/" });
  }
  for (const part of parts) {
    current = current.endsWith(sep) ? `${current}${part}` : `${current}${sep}${part}`;
    crumbs.push({ label: part, path: current });
  }
  return crumbs;
}

function placeIcon(place: FolderPlace) {
  if (/^[A-Za-z]:\\$/.test(place.path) || place.path === "/") return <HardDrive size={15} aria-hidden="true" />;
  if (place.label === "Home") return <Home size={15} aria-hidden="true" />;
  if (place.label === "Desktop") return <Monitor size={15} aria-hidden="true" />;
  return <Folder size={15} aria-hidden="true" />;
}

/** Point-and-click folder picker for people who do not want to type a path. */
export function FolderBrowser({ startPath, onPick, onClose }: FolderBrowserProps) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [target, setTarget] = useState<string | undefined>(() => startPath || readLastFolder());
  const filterRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const fellBack = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    browseFolder(target, showHidden, controller.signal)
      .then((data) => {
        setListing(data);
        setFilter("");
        if (data.path) rememberFolder(data.path);
        listRef.current?.scrollTo?.({ top: 0 });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        // A remembered or typed start folder may be gone; start at home instead of showing nothing.
        if (!listing && !fellBack.current && target !== undefined) {
          fellBack.current = true;
          setTarget(undefined);
          return;
        }
        setError(err instanceof Error ? err.message : "Unable to open that folder.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, showHidden]);

  useEffect(() => {
    filterRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const entries = useMemo(() => {
    const all = listing?.entries ?? [];
    const needle = filter.trim().toLowerCase();
    const shown = needle ? all.filter((entry) => entry.name.toLowerCase().includes(needle)) : all;
    // Projects first, so the folders that can be opened are easy to spot.
    return [...shown].sort((a, b) => Number(b.isGitRepo) - Number(a.isGitRepo));
  }, [listing, filter]);

  const projectCount = entries.filter((entry) => entry.isGitRepo).length;
  const crumbs = listing?.path ? pathCrumbs(listing.path) : [];
  const atDrives = listing !== null && listing.path === null;

  function pick(path: string) {
    rememberFolder(path);
    onPick(path);
  }

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="folder-browser" role="dialog" aria-modal="true" aria-labelledby="folder-browser-title">
        <header className="folder-browser-head">
          <div>
            <h2 id="folder-browser-title">Choose a project folder</h2>
            <p className="folder-browser-sub">Folders marked &ldquo;has history&rdquo; are projects Visual Git can open.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close folder browser">
            <X size={16} />
          </button>
        </header>

        <div className="folder-browser-body">
          <nav className="folder-places" aria-label="Places">
            {listing?.places.map((place) => (
              <button
                key={place.path}
                type="button"
                className={`folder-place ${listing.path === place.path ? "active" : ""}`}
                onClick={() => setTarget(place.path)}
              >
                {placeIcon(place)}
                <span>{place.label}</span>
              </button>
            ))}
          </nav>

          <div className="folder-main">
            <div className="folder-bar">
              <button
                type="button"
                className="icon-btn bordered"
                disabled={!listing || listing.parent === null}
                onClick={() => listing?.parent !== null && listing?.parent !== undefined && setTarget(listing.parent)}
                aria-label="Up one folder"
                title="Up one folder"
              >
                <ArrowUp size={15} />
              </button>
              <ol className="folder-crumbs" aria-label="Current folder">
                {atDrives && <li className="folder-crumb current">This PC</li>}
                {crumbs.map((crumb, index) => (
                  <li key={crumb.path}>
                    {index > 0 && <ChevronRight size={12} aria-hidden="true" className="crumb-sep" />}
                    {index === crumbs.length - 1 ? (
                      <span className="folder-crumb current" aria-current="location">
                        {crumb.label}
                      </span>
                    ) : (
                      <button type="button" className="folder-crumb" onClick={() => setTarget(crumb.path)}>
                        {crumb.label}
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </div>

            <div className="folder-filter-row">
              <label htmlFor="folder-filter" className="sr-only">
                Filter folders
              </label>
              <input
                id="folder-filter"
                ref={filterRef}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                onKeyDown={(event) => {
                  // Enter with exactly one match: open it if it is a project, otherwise look inside.
                  if (event.key !== "Enter" || entries.length !== 1) return;
                  event.preventDefault();
                  const only = entries[0];
                  if (only.isGitRepo) pick(only.path);
                  else setTarget(only.path);
                }}
                placeholder="Type to narrow the list"
                aria-describedby="folder-filter-help"
                autoComplete="off"
                spellCheck={false}
              />
              <label className="folder-hidden-toggle">
                <input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} />
                <span>Show hidden</span>
              </label>
              <span id="folder-filter-help" className="sr-only">
                Press Enter when only one folder is left to open it.
              </span>
            </div>

            <div className="folder-list-wrap" aria-busy={loading}>
              {error ? (
                <p className="folder-empty" role="alert">
                  {error}
                </p>
              ) : loading && !listing ? (
                <p className="folder-empty">
                  <Loader2 size={14} className="spin" aria-hidden="true" /> Looking in this folder…
                </p>
              ) : entries.length === 0 ? (
                <p className="folder-empty">{filter ? "No folders match that." : "No folders in here."}</p>
              ) : (
                <ul className="folder-list" ref={listRef} aria-label={atDrives ? "Drives" : "Folders"}>
                  {entries.map((entry) => (
                    <li key={entry.path} className={entry.isGitRepo ? "is-project" : ""}>
                      <button type="button" className="folder-row" onClick={() => setTarget(entry.path)} title={`Look inside ${entry.name}`}>
                        {atDrives ? (
                          <HardDrive size={16} aria-hidden="true" />
                        ) : entry.isGitRepo ? (
                          <FolderGit2 size={16} aria-hidden="true" />
                        ) : (
                          <Folder size={16} aria-hidden="true" />
                        )}
                        <span className="folder-name">{entry.name}</span>
                        {entry.isGitRepo && <span className="suggest-mark">has history</span>}
                      </button>
                      {entry.isGitRepo && (
                        <button type="button" className="btn small" onClick={() => pick(entry.path)} aria-label={`Open ${entry.name}`}>
                          Open
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {listing?.truncated && <p className="folder-note">Showing the first 400 folders. Type above to find others.</p>}
            </div>
          </div>
        </div>

        <footer className="folder-browser-foot">
          {listing?.path && listing.isGitRepo ? (
            <>
              <p>
                <strong>This folder is a project.</strong> Open it to see its history.
              </p>
              <button type="button" className="btn primary" onClick={() => listing.path && pick(listing.path)}>
                Open this project
              </button>
            </>
          ) : (
            <>
              <p>
                {atDrives
                  ? "Pick a drive to look inside."
                  : projectCount > 0
                    ? `${projectCount === 1 ? "1 project" : `${projectCount} projects`} in this folder. Click Open next to one.`
                    : "Click a folder to look inside. Projects show a “has history” tag."}
              </p>
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body
  );
}
