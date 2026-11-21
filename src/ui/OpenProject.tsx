import { useEffect, useRef, useState } from "react";
import { Folder, FolderOpen, FolderSearch, Loader2 } from "lucide-react";
import { suggestDirectories } from "../api";
import { FolderBrowser } from "./FolderBrowser";
import type { DirectoryEntry } from "../lib/types";

type OpenProjectProps = {
  inputId: string;
  value: string;
  onChange: (value: string) => void;
  onOpen: (path: string) => void;
  loading: boolean;
  autoFocus?: boolean;
};

/** Folder path field with live folder suggestions; folders that are git projects are marked. */
export function OpenProject({ inputId, value, onChange, onOpen, loading, autoFocus }: OpenProjectProps) {
  const [suggestions, setSuggestions] = useState<DirectoryEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [browsing, setBrowsing] = useState(false);
  const browseButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const trimmed = value.trim();
    // Absolute paths only: /unix, ~/home, C:\windows, or \\network\share.
    if (!open || !/^(\/|~|[A-Za-z]:[\\/]|\\\\)/.test(trimmed)) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      suggestDirectories(trimmed, controller.signal)
        .then((entries) => {
          setSuggestions(entries ?? []);
          setActive(-1);
        })
        .catch(() => {
          if (!controller.signal.aborted) setSuggestions([]);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, open]);

  function choose(entry: DirectoryEntry) {
    const separator = entry.path.includes("\\") && !entry.path.includes("/") ? "\\" : "/";
    onChange(entry.isGitRepo ? entry.path : `${entry.path}${separator}`);
    if (entry.isGitRepo) {
      setOpen(false);
      onOpen(entry.path);
    }
  }

  const showList = open && suggestions.length > 0;

  return (
    <form
      className="open-project"
      onSubmit={(event) => {
        event.preventDefault();
        setOpen(false);
        onOpen(value);
      }}
    >
      <label htmlFor={inputId} className="field-label">
        Project folder
      </label>
      <div className="open-project-row">
        <div className="open-project-field">
          <Folder size={15} aria-hidden="true" />
          <input
            id={inputId}
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
              if (!showList) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((prev) => Math.min(suggestions.length - 1, prev + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((prev) => Math.max(-1, prev - 1));
              } else if (event.key === "Enter" && active >= 0) {
                event.preventDefault();
                choose(suggestions[active]);
              }
            }}
            placeholder={typeof navigator !== "undefined" && /Win/i.test(navigator.platform) ? "C:\\Users\\you\\Documents\\my-project" : "/Users/you/Documents/my-project"}
            spellCheck={false}
            autoComplete="off"
            autoFocus={autoFocus}
            role="combobox"
            aria-expanded={showList}
            aria-controls={`${inputId}-list`}
            aria-autocomplete="list"
          />
          {showList && (
            <div className="suggest-list" role="listbox" id={`${inputId}-list`} aria-label="Matching folders">
              {suggestions.map((entry, index) => (
                <button
                  key={entry.path}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={`suggest-item ${index === active ? "active" : ""}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(entry);
                  }}
                >
                  {entry.isGitRepo ? <FolderOpen size={14} aria-hidden="true" /> : <Folder size={14} aria-hidden="true" />}
                  <span className="suggest-path">{entry.path}</span>
                  {entry.isGitRepo && <span className="suggest-mark">has history</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          ref={browseButton}
          className="btn"
          onClick={() => {
            setOpen(false);
            setBrowsing(true);
          }}
          title="Pick the folder by clicking through your computer"
        >
          <FolderSearch size={15} aria-hidden="true" />
          <span>Browse…</span>
        </button>
        <button type="submit" className="btn primary" disabled={loading || !value.trim()}>
          {loading && <Loader2 size={14} className="spin" />}
          <span>{loading ? "Opening…" : "Open project"}</span>
        </button>
      </div>
      <p className="field-help">
        Click <strong>Browse…</strong> to pick the folder, or type its full path. Folders with history are marked.
      </p>
      {browsing && (
        <FolderBrowser
          startPath={/^(\/|~|[A-Za-z]:[\\/]|\\\\)/.test(value.trim()) ? value.trim() : undefined}
          onClose={() => {
            setBrowsing(false);
            browseButton.current?.focus();
          }}
          onPick={(path) => {
            setBrowsing(false);
            onChange(path);
            onOpen(path);
          }}
        />
      )}
    </form>
  );
}
