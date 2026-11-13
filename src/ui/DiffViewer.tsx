import { useEffect, useMemo, useState } from "react";
import { Check, Columns2, Copy, FileDiff, List, Loader2, X } from "lucide-react";
import type { GitChangeStatus, GitFileDiff } from "../lib/types";

export type DiffModalTarget = {
  filePath: string;
  oldPath?: string;
  subtitle: string;
  status?: GitChangeStatus;
  additions?: number | null;
  deletions?: number | null;
};

type DiffViewerProps = {
  target: DiffModalTarget;
  diff: GitFileDiff | null;
  loading: boolean;
  error: string;
  onClose: () => void;
};

type ParsedDiffLine = {
  kind: "meta" | "hunk" | "add" | "del" | "context";
  text: string;
  oldLine?: number;
  newLine?: number;
  friendlyHunk?: string;
};

type SplitDiffRow =
  | { kind: "meta"; text: string }
  | { kind: "hunk"; label: string; raw: string }
  | {
      kind: "code";
      left?: { line?: number; text: string; kind: "del" | "context" };
      right?: { line?: number; text: string; kind: "add" | "context" };
    };

function formatHunkLabel(line: string): string {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
  if (!match) return line;
  const newStart = Number(match[3]);
  const newCount = match[4] ? Number(match[4]) : 1;
  const heading = match[5]?.trim();
  const rangeText = newCount > 1 ? `Lines ${newStart}–${newStart + newCount - 1}` : `Line ${newStart}`;
  return heading ? `${rangeText} · ${heading}` : rangeText;
}

function parseUnifiedDiff(patch: string): ParsedDiffLine[] {
  if (!patch) return [];
  const rawLines = patch.split("\n");
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  const parsed: ParsedDiffLine[] = [];
  let inHunk = false;
  let oldNum = 0;
  let newNum = 0;

  for (const line of rawLines) {
    if (line.startsWith("@@")) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldNum = match ? Number(match[1]) : 0;
      newNum = match ? Number(match[2]) : 0;
      inHunk = true;
      parsed.push({ kind: "hunk", text: line, friendlyHunk: formatHunkLabel(line) });
      continue;
    }

    if (!inHunk || line.startsWith("diff --git ")) {
      if (line.startsWith("diff --git ")) inHunk = false;
      parsed.push({ kind: "meta", text: line });
      continue;
    }

    if (line.startsWith("\\ No newline at end of file")) {
      parsed.push({ kind: "meta", text: line });
      continue;
    }

    if (line.startsWith("+")) {
      parsed.push({ kind: "add", text: line, newLine: newNum });
      newNum += 1;
    } else if (line.startsWith("-")) {
      parsed.push({ kind: "del", text: line, oldLine: oldNum });
      oldNum += 1;
    } else {
      parsed.push({ kind: "context", text: line, oldLine: oldNum, newLine: newNum });
      oldNum += 1;
      newNum += 1;
    }
  }

  return parsed;
}

function buildSplitRows(lines: ParsedDiffLine[], showRawMeta: boolean): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.kind === "meta") {
      if (showRawMeta) rows.push({ kind: "meta", text: line.text });
      i += 1;
      continue;
    }
    if (line.kind === "hunk") {
      rows.push({ kind: "hunk", label: line.friendlyHunk ?? line.text, raw: line.text });
      i += 1;
      continue;
    }
    if (line.kind === "context") {
      const clean = line.text.startsWith(" ") ? line.text.slice(1) : line.text;
      rows.push({
        kind: "code",
        left: { line: line.oldLine, text: clean, kind: "context" },
        right: { line: line.newLine, text: clean, kind: "context" }
      });
      i += 1;
      continue;
    }

    // Group contiguous deletions followed by contiguous additions side-by-side.
    const dels: ParsedDiffLine[] = [];
    const adds: ParsedDiffLine[] = [];
    while (i < lines.length && lines[i].kind === "del") {
      dels.push(lines[i]);
      i += 1;
    }
    while (i < lines.length && lines[i].kind === "add") {
      adds.push(lines[i]);
      i += 1;
    }

    const pairCount = Math.max(dels.length, adds.length);
    for (let k = 0; k < pairCount; k += 1) {
      const d = dels[k];
      const a = adds[k];
      rows.push({
        kind: "code",
        left: d ? { line: d.oldLine, text: d.text.slice(1), kind: "del" } : undefined,
        right: a ? { line: a.newLine, text: a.text.slice(1), kind: "add" } : undefined
      });
    }
  }

  return rows;
}

const STATUS_DESCRIPTIONS: Record<GitChangeStatus, string> = {
  A: "Added",
  M: "Modified",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  T: "Type changed",
  U: "Unmerged",
  X: "Changed"
};

export function DiffViewer({ target, diff, loading, error, onClose }: DiffViewerProps) {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [showRawMeta, setShowRawMeta] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const lines = useMemo(() => (diff ? parseUnifiedDiff(diff.patch) : []), [diff]);
  const visibleUnifiedLines = useMemo(
    () => (showRawMeta ? lines : lines.filter((line) => line.kind !== "meta")),
    [lines, showRawMeta]
  );
  const splitRows = useMemo(() => buildSplitRows(lines, showRawMeta), [lines, showRawMeta]);

  async function handleCopyPath() {
    try {
      await navigator.clipboard.writeText(target.filePath);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable in some environments.
    }
  }

  return (
    <div
      className="diff-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div className="diff-modal" role="dialog" aria-modal="true" aria-label={`Diff for ${target.filePath}`}>
        <div className="diff-modal-header">
          <div className="diff-modal-title-group">
            <FileDiff size={16} className="diff-title-icon" />
            <div className="diff-title-texts">
              <div className="diff-file-title font-mono">
                {target.status && (
                  <span
                    className={`change-status-pill status-${target.status}`}
                    title={STATUS_DESCRIPTIONS[target.status]}
                  >
                    {target.status}
                  </span>
                )}
                {target.oldPath && target.oldPath !== target.filePath ? (
                  <span>
                    {target.oldPath} <span className="diff-arrow">→</span> {target.filePath}
                  </span>
                ) : (
                  <span>{target.filePath}</span>
                )}
              </div>
              <div className="diff-subtitle-row">
                <span>{target.subtitle}</span>
                {(target.additions !== undefined || target.deletions !== undefined) && (
                  <span className="diff-stat-summary font-mono">
                    {target.additions !== null && target.additions !== undefined && (
                      <span className="stat-add">+{target.additions} added</span>
                    )}
                    {target.deletions !== null && target.deletions !== undefined && (
                      <span className="stat-del">-{target.deletions} removed</span>
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="diff-modal-actions">
            <div className="density-toggle" role="group" aria-label="Diff view mode">
              <button
                type="button"
                className={`density-btn ${viewMode === "unified" ? "active" : ""}`}
                onClick={() => setViewMode("unified")}
                title="Show changes inline"
                aria-pressed={viewMode === "unified"}
              >
                <List size={12} />
                <span>Inline</span>
              </button>
              <button
                type="button"
                className={`density-btn ${viewMode === "split" ? "active" : ""}`}
                onClick={() => setViewMode("split")}
                title="Show before and after side by side"
                aria-pressed={viewMode === "split"}
              >
                <Columns2 size={12} />
                <span>Side-by-side</span>
              </button>
            </div>

            <button
              type="button"
              className={`diff-action-btn ${showRawMeta ? "active" : ""}`}
              onClick={() => setShowRawMeta((prev) => !prev)}
              aria-pressed={showRawMeta}
              title="Toggle raw git patch headers"
            >
              <span>Raw headers</span>
            </button>

            <button
              type="button"
              className="diff-action-btn"
              onClick={handleCopyPath}
              title="Copy file path"
              aria-label="Copy file path"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span>{copied ? "Copied" : "Copy path"}</span>
            </button>
            <button
              type="button"
              className="diff-close-btn"
              onClick={onClose}
              title="Close diff (Esc)"
              aria-label="Close diff"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="diff-legend-bar">
          <span className="diff-legend-item del">
            <span className="legend-swatch" />
            Removed (Before)
          </span>
          <span className="diff-legend-item add">
            <span className="legend-swatch" />
            Added (After)
          </span>
        </div>

        <div className="diff-modal-body">
          {loading ? (
            <div className="diff-state-box">
              <Loader2 size={20} className="spin-icon" />
              <span>Loading diff…</span>
            </div>
          ) : error ? (
            <div className="diff-state-box error">
              <span>{error}</span>
            </div>
          ) : lines.length === 0 ? (
            <div className="diff-state-box">
              <span>No textual changes in this diff (empty file or mode-only change).</span>
            </div>
          ) : (
            <>
              {diff?.truncated && (
                <div className="diff-truncated-banner">
                  Diff output was truncated at 200 KB for responsiveness.
                </div>
              )}
              {viewMode === "unified" ? (
                <div className="diff-code-table font-mono">
                  {visibleUnifiedLines.map((line, index) => (
                    <div key={index} className={`diff-line diff-line-${line.kind}`}>
                      <span className="diff-gutter-num">{line.oldLine ?? ""}</span>
                      <span className="diff-gutter-num">{line.newLine ?? ""}</span>
                      <span className="diff-line-text">
                        {line.kind === "hunk"
                          ? showRawMeta
                            ? line.text
                            : line.friendlyHunk ?? line.text
                          : line.text || " "}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="diff-split-table font-mono">
                  <div className="diff-split-head font-sans">
                    <span>Before</span>
                    <span>After</span>
                  </div>
                  {splitRows.map((row, index) => {
                    if (row.kind === "meta") {
                      return (
                        <div key={index} className="diff-split-meta">
                          {row.text}
                        </div>
                      );
                    }
                    if (row.kind === "hunk") {
                      return (
                        <div key={index} className="diff-split-hunk">
                          {showRawMeta ? row.raw : row.label}
                        </div>
                      );
                    }
                    return (
                      <div key={index} className="diff-split-row">
                        <div className={`diff-split-cell ${row.left ? `kind-${row.left.kind}` : "kind-empty"}`}>
                          <span className="diff-gutter-num">{row.left?.line ?? ""}</span>
                          <span className="diff-line-text">{row.left?.text ?? ""}</span>
                        </div>
                        <div className={`diff-split-cell ${row.right ? `kind-${row.right.kind}` : "kind-empty"}`}>
                          <span className="diff-gutter-num">{row.right?.line ?? ""}</span>
                          <span className="diff-line-text">{row.right?.text ?? ""}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
