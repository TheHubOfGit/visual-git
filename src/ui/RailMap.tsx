import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Cloud, GitBranch, Loader2, LocateFixed, Tag, X } from "lucide-react";
import { compactMetrics, roomyMetrics } from "../lib/diagramLayout";
import { plural, relativeTime } from "../lib/glossary";
import { sortRefsForDisplay } from "../lib/refs";
import type { GitDiagram, GitDiagramEdge, GitDiagramNode, GitRef } from "../lib/types";
import type { Theme } from "./useTheme";

export type MapDensity = "roomy" | "compact";

export type CompareHighlight = {
  ahead: Set<string>;
  behind: Set<string>;
};

type RailMapProps = {
  theme: Theme;
  repoKey: string;
  diagram: GitDiagram;
  density: MapDensity;
  onDensityChange: (density: MapDensity) => void;
  selectedHash: string | null;
  onSelect: (hash: string) => void;
  headHash: string | null;
  matchedHashes: Set<string> | null;
  compareHighlight: CompareHighlight | null;
  compareMergeBase: string | null;
  tracedLane: string | null;
  onClearTrace: () => void;
  dirtyCount: number;
  onOpenChanges: () => void;
  truncated: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  liveConnected: boolean;
};

const VIRTUAL_BUFFER = 700;

type Shape = { x1: number; y1: number; x2: number; y2: number; bend: GitDiagramEdge["bend"] };

/** Each theme draws a change of track its own way: 45° like a metro map, a pen curve, or a drafted right angle. */
function trackPath(theme: Theme, { x1, y1, x2, y2, bend }: Shape, rowHeight: number): string {
  if (bend === "none" || x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const rise = Math.min(Math.abs(x2 - x1), y2 - y1, rowHeight);

  if (theme === "blueprint") {
    const turnY = bend === "start" ? y1 + rowHeight / 2 : y2 - rowHeight / 2;
    return `M ${x1} ${y1} L ${x1} ${turnY} L ${x2} ${turnY} L ${x2} ${y2}`;
  }
  if (theme === "logbook") {
    return bend === "start"
      ? `M ${x1} ${y1} C ${x1} ${y1 + rise * 0.7}, ${x2} ${y1 + rise * 0.3}, ${x2} ${y1 + rise} L ${x2} ${y2}`
      : `M ${x1} ${y1} L ${x1} ${y2 - rise} C ${x1} ${y2 - rise * 0.3}, ${x2} ${y2 - rise * 0.7}, ${x2} ${y2}`;
  }
  return bend === "start"
    ? `M ${x1} ${y1} L ${x2} ${y1 + rise} L ${x2} ${y2}`
    : `M ${x1} ${y1} L ${x1} ${y2 - rise} L ${x2} ${y2}`;
}

function Station({ theme, node, merge, compact }: { theme: Theme; node: { x: number; y: number }; merge: boolean; compact: boolean }) {
  const { x, y } = node;
  if (theme === "blueprint") {
    const r = compact ? 4 : 5;
    return (
      <>
        <path d={`M ${x - r - 4} ${y} H ${x + r + 4} M ${x} ${y - r - 4} V ${y + r + 4}`} className="station-cross" />
        <circle cx={x} cy={y} r={r} className="station-core" />
        {merge && <circle cx={x} cy={y} r={r + 3.5} className="station-outer" />}
      </>
    );
  }
  if (theme === "logbook") {
    const r = compact ? 3.5 : 4.25;
    return merge ? (
      <circle cx={x} cy={y} r={r + 1.5} className="station-core open" />
    ) : (
      <circle cx={x} cy={y} r={r} className="station-core" />
    );
  }
  const r = compact ? 5 : 6.5;
  return merge ? (
    <circle cx={x} cy={y} r={r + 2} className="station-core interchange" />
  ) : (
    <circle cx={x} cy={y} r={r} className="station-core" />
  );
}

function RefBadge({ gitRef }: { gitRef: GitRef }) {
  if (gitRef.kind === "head") return null;
  const Icon = gitRef.kind === "tag" ? Tag : gitRef.kind === "remote" ? Cloud : GitBranch;
  const kindLabel = gitRef.kind === "tag" ? "Milestone (tag)" : gitRef.kind === "remote" ? "Online copy (remote branch)" : "Line of work (branch)";
  return (
    <span className={`ref-badge ref-${gitRef.kind}`} title={`${kindLabel}: ${gitRef.name}`}>
      <Icon size={11} aria-hidden="true" />
      {gitRef.name}
    </span>
  );
}

export function RailMap({
  theme,
  repoKey,
  diagram,
  density,
  onDensityChange,
  selectedHash,
  onSelect,
  headHash,
  matchedHashes,
  compareHighlight,
  compareMergeBase,
  tracedLane,
  onClearTrace,
  dirtyCount,
  onOpenChanges,
  truncated,
  loadingMore,
  onLoadMore,
  liveConnected
}: RailMapProps) {
  const compact = density === "compact";
  const metrics = compact ? compactMetrics : roomyMetrics;
  const { rowHeight } = diagram;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const nodeByHash = useMemo(() => new Map(diagram.nodes.map((node) => [node.hash, node])), [diagram.nodes]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setViewportHeight(element.clientHeight);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Every save point reachable from the tip of the line being followed.
  const tracedHashes = useMemo(() => {
    if (!tracedLane) return null;
    const tip = diagram.lanes.find((lane) => lane.name === tracedLane)?.tipHash;
    if (!tip) return null;
    const visited = new Set<string>();
    const stack = [tip];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const parent of nodeByHash.get(current)?.parents ?? []) {
        if (nodeByHash.has(parent)) stack.push(parent);
      }
    }
    return visited;
  }, [tracedLane, diagram.lanes, nodeByHash]);

  function scrollToNode(node: GitDiagramNode | undefined, force = false) {
    const element = scrollRef.current;
    if (!element || !node || typeof element.scrollTo !== "function" || element.clientHeight === 0) return;
    const top = element.scrollTop;
    const bottom = top + element.clientHeight;
    const margin = rowHeight * 1.5;
    if (force || node.y - margin < top || node.y + margin > bottom) {
      const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      element.scrollTo({ top: Math.max(0, node.y - element.clientHeight / 2), behavior: reduce ? "auto" : "smooth" });
    }
  }

  // Keep the selected save point in view. A freshly opened project jumps straight there.
  const shownRepoRef = useRef<string | null>(null);
  useEffect(() => {
    const node = selectedHash ? nodeByHash.get(selectedHash) : undefined;
    const element = scrollRef.current;
    if (!node || !element || viewportHeight === 0) return;
    if (shownRepoRef.current !== repoKey) {
      shownRepoRef.current = repoKey;
      element.scrollTop = Math.max(0, node.y - element.clientHeight / 2);
      return;
    }
    scrollToNode(node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHash, nodeByHash, viewportHeight, repoKey]);

  const { visibleNodes, visibleEdges } = useMemo(() => {
    if (viewportHeight === 0) return { visibleNodes: diagram.nodes, visibleEdges: diagram.edges };
    const minY = scrollTop - VIRTUAL_BUFFER;
    const maxY = scrollTop + viewportHeight + VIRTUAL_BUFFER;
    return {
      visibleNodes: diagram.nodes.filter((node) => node.y >= minY && node.y <= maxY),
      visibleEdges: diagram.edges.filter((edge) => edge.toY >= minY && edge.fromY <= maxY)
    };
  }, [diagram.nodes, diagram.edges, viewportHeight, scrollTop]);

  const focusActive = matchedHashes !== null || compareHighlight !== null || tracedHashes !== null;
  const inFocus = (hash: string): boolean => {
    if (matchedHashes !== null) return matchedHashes.has(hash);
    if (compareHighlight !== null) {
      return compareHighlight.ahead.has(hash) || compareHighlight.behind.has(hash) || compareMergeBase === hash;
    }
    if (tracedHashes !== null) return tracedHashes.has(hash);
    return true;
  };

  const headNode = headHash ? nodeByHash.get(headHash) : undefined;
  const count = diagram.nodes.length;

  return (
    <section className={`map-panel density-${density}`} aria-label="History map">
      <header className="map-toolbar">
        <div className="map-toolbar-lead">
          <h2 className="map-title">History map</h2>
          <span className="map-count">
            {plural(count, "save point")}
            {truncated ? " shown, more below" : ""}
          </span>
          <span className="map-direction">Oldest at the top, newest at the bottom</span>
          {tracedLane && (
            <button type="button" className="chip-btn" onClick={onClearTrace} title="Stop following this line">
              <span>Following: {tracedLane}</span>
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="map-toolbar-tools">
          <span className={`live-state ${liveConnected ? "on" : ""}`} title={liveConnected ? "The map redraws by itself when the project changes" : "Not watching for changes"}>
            <i aria-hidden="true" />
            {liveConnected ? "Updates live" : "Not live"}
          </span>
          {headNode && (
            <button
              type="button"
              className="btn small"
              onClick={() => {
                onSelect(headNode.hash);
                scrollToNode(headNode, true);
              }}
              title="Scroll to the save point your files currently match (HEAD)"
            >
              <LocateFixed size={13} aria-hidden="true" />
              <span>Find me</span>
            </button>
          )}
          <div className="segmented" role="group" aria-label="Row spacing">
            <button type="button" className={density === "roomy" ? "active" : ""} aria-pressed={density === "roomy"} onClick={() => onDensityChange("roomy")}>
              Roomy
            </button>
            <button type="button" className={compact ? "active" : ""} aria-pressed={compact} onClick={() => onDensityChange("compact")} title="Compact rows (press d)">
              Compact
            </button>
          </div>
        </div>
      </header>

      <div className="map-scroll" ref={scrollRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <div className="map-canvas" style={{ height: diagram.height, minWidth: diagram.width, "--rail": `${diagram.railWidth}px` } as React.CSSProperties}>
          {diagram.dayMarkers.map((marker) => (
            <div
              key={marker.key}
              className="map-day"
              style={{ top: marker.y, height: metrics.dayHeaderHeight, paddingLeft: diagram.railWidth }}
            >
              <span>{marker.label}</span>
            </div>
          ))}

          {visibleNodes.map((node) => {
            const selected = node.hash === selectedHash;
            const isHead = node.hash === headHash;
            const isMerge = node.parents.length > 1;
            const isMatch = matchedHashes?.has(node.hash) ?? false;
            const ahead = compareHighlight?.ahead.has(node.hash) ?? false;
            const behind = compareHighlight?.behind.has(node.hash) ?? false;
            const isSplit = compareHighlight !== null && compareMergeBase === node.hash;
            const dim = focusActive && !inFocus(node.hash) && !selected;
            const refs = sortRefsForDisplay(node.refs).filter((ref) => ref.kind !== "head");
            const shownRefs = refs.slice(0, compact ? 2 : 3);

            const className = [
              "map-row",
              selected ? "is-selected" : "",
              isHead ? "is-head" : "",
              isMatch ? "is-match" : "",
              ahead ? "is-ahead" : "",
              behind ? "is-behind" : "",
              isSplit ? "is-split" : "",
              dim ? "is-dim" : ""
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button
                key={node.hash}
                type="button"
                className={className}
                data-hash={node.hash}
                aria-current={selected ? "true" : undefined}
                style={{ top: node.y - rowHeight / 2, height: rowHeight, paddingLeft: diagram.railWidth }}
                onClick={() => onSelect(node.hash)}
              >
                <span className="row-main">
                  <span className="row-subject">{node.subject || "(no description)"}</span>
                  {isHead && <span className="here-flag">You are here</span>}
                  {isMerge && <span className="row-tag">joins two lines</span>}
                  {ahead && <span className="row-tag ahead">new</span>}
                  {behind && <span className="row-tag behind">missing</span>}
                  {isSplit && <span className="row-tag split">where they split</span>}
                  {shownRefs.map((ref) => (
                    <RefBadge key={`${ref.kind}-${ref.name}`} gitRef={ref} />
                  ))}
                  {refs.length > shownRefs.length && <span className="ref-badge">+{refs.length - shownRefs.length}</span>}
                  {compact && <span className="row-hash">{node.shortHash}</span>}
                </span>
                {!compact && (
                  <span className="row-meta">
                    <i className={`lane-dot lane-c${node.colorIndex}`} aria-hidden="true" />
                    <span className="row-lane">{node.laneName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{node.authorName.split(" ")[0] || "Unknown"}</span>
                    <span aria-hidden="true">·</span>
                    <span>{relativeTime(node.date)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="row-hash">{node.shortHash}</span>
                  </span>
                )}
              </button>
            );
          })}

          {diagram.pending && (
            <button
              type="button"
              className="map-row is-pending"
              style={{ top: diagram.pending.y - rowHeight / 2, height: rowHeight, paddingLeft: diagram.railWidth }}
              onClick={onOpenChanges}
              aria-label={`Unsaved edits: ${plural(dirtyCount, "file")} changed. Review them`}
            >
              <span className="row-main">
                <span className="row-subject">Unsaved edits</span>
                <span className="row-tag pending">not a save point yet</span>
              </span>
              {!compact && (
                <span className="row-meta">
                  {plural(dirtyCount, "file")} changed since the save point above. Select to review.
                </span>
              )}
            </button>
          )}

          <svg className="map-svg" width="100%" height={diagram.height} aria-hidden="true">
            {visibleEdges.map((edge) => {
              const dim = focusActive && !(inFocus(edge.from) && inFocus(edge.to));
              return (
                <path
                  key={`${edge.from}-${edge.to}`}
                  d={trackPath(theme, { x1: edge.fromX, y1: edge.fromY, x2: edge.toX, y2: edge.toY, bend: edge.bend }, rowHeight)}
                  className={`track lane-s${edge.colorIndex} ${edge.secondary ? "joining" : ""} ${dim ? "is-dim" : ""}`}
                />
              );
            })}

            {diagram.pending && (
              <path
                d={trackPath(
                  theme,
                  {
                    x1: diagram.pending.fromX,
                    y1: diagram.pending.fromY,
                    x2: diagram.pending.x,
                    y2: diagram.pending.y,
                    bend: diagram.pending.x === diagram.pending.fromX ? "none" : "start"
                  },
                  rowHeight
                )}
                className={`track pending lane-s${diagram.pending.colorIndex}`}
              />
            )}

            {visibleNodes.map((node) => {
              const selected = node.hash === selectedHash;
              const dim = focusActive && !inFocus(node.hash) && !selected;
              return (
                <g
                  key={node.hash}
                  className={`station lane-s${node.colorIndex} ${selected ? "is-selected" : ""} ${node.hash === headHash ? "is-head" : ""} ${dim ? "is-dim" : ""}`}
                >
                  <line x1={node.x + 12} y1={node.y} x2={diagram.railWidth - 8} y2={node.y} className="leader" />
                  {node.hash === headHash && <circle cx={node.x} cy={node.y} r={compact ? 10 : 13} className="here-ring" />}
                  {selected && <circle cx={node.x} cy={node.y} r={compact ? 9 : 11.5} className="select-ring" />}
                  <Station theme={theme} node={node} merge={node.parents.length > 1} compact={compact} />
                </g>
              );
            })}

            {diagram.pending && (
              <g className={`station is-pending lane-s${diagram.pending.colorIndex}`}>
                <line x1={diagram.pending.x + 12} y1={diagram.pending.y} x2={diagram.railWidth - 8} y2={diagram.pending.y} className="leader" />
                <circle cx={diagram.pending.x} cy={diagram.pending.y} r={compact ? 5 : 6.5} className="station-core" />
              </g>
            )}
          </svg>
        </div>

        {truncated && (
          <div className="map-more">
            <button type="button" className="btn" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? <Loader2 size={14} className="spin" /> : <ChevronDown size={14} />}
              <span>{loadingMore ? "Loading older save points…" : "Load older save points"}</span>
            </button>
          </div>
        )}
      </div>

      <footer className="map-legend" role="region" aria-label="Map legend">
        <span className="legend-item">
          <svg width="30" height="14" aria-hidden="true">
            <line x1="0" y1="7" x2="30" y2="7" className="track lane-s0" />
            <circle cx="15" cy="7" r="4.5" className="legend-station lane-s0" />
          </svg>
          Save point on a line
        </span>
        <span className="legend-item">
          <svg width="30" height="14" aria-hidden="true">
            <path d="M 0 3 L 12 3 L 20 11 L 30 11" className="track lane-s2" />
          </svg>
          A line splitting off or joining
        </span>
        <span className="legend-item">
          <svg width="30" height="14" aria-hidden="true">
            <line x1="0" y1="7" x2="30" y2="7" className="track pending lane-s0" />
          </svg>
          Unsaved edits
        </span>
        <span className="legend-item">
          <span className="here-flag">You are here</span>
          Your files match this save point
        </span>
      </footer>
    </section>
  );
}
