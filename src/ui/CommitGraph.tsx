import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { compactDiagramMetrics, diagramNodeMetrics } from "../lib/diagramLayout";
import { refClass, refLabel, sortRefsForDisplay } from "../lib/refs";
import type { GitDiagram, GitDiagramEdge, GitStatusFile } from "../lib/types";
import {
  ArrowDown,
  ChevronDown,
  FileEdit,
  GitBranch,
  GitMerge,
  HelpCircle,
  LayoutGrid,
  List,
  Loader2,
  Map as MapIcon,
  Maximize2,
  Minus,
  Plus,
  X
} from "lucide-react";

export type GraphDensity = "cards" | "compact";

export type CompareHighlight = {
  ahead: Set<string>;
  behind: Set<string>;
};

type CommitGraphProps = {
  repoKey: string;
  diagram: GitDiagram;
  density: GraphDensity;
  onDensityChange: (density: GraphDensity) => void;
  selectedHash: string | null;
  onSelect: (hash: string) => void;
  matchedHashes: Set<string> | null;
  compareHighlight: CompareHighlight | null;
  compareMergeBase?: string | null;
  headHash?: string;
  workingStatus?: { clean: boolean; files: GitStatusFile[] };
  onOpenChanges?: () => void;
  truncated: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  liveConnected: boolean;
};

const MIN_SCALE = 0.1;
const MAX_SCALE = 2;
const ZOOM_STEP = 0.2;
const FIT_PADDING = 32;
const VIRTUAL_BUFFER = 450;

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function edgePath(edge: GitDiagramEdge) {
  const midY = edge.fromY + Math.max(24, (edge.toY - edge.fromY) / 2);
  return `M ${edge.fromX} ${edge.fromY} C ${edge.fromX} ${midY}, ${edge.toX} ${midY}, ${edge.toX} ${edge.toY}`;
}

export function CommitGraph({
  repoKey,
  diagram,
  density,
  onDensityChange,
  selectedHash,
  onSelect,
  matchedHashes,
  compareHighlight,
  compareMergeBase,
  headHash,
  workingStatus,
  onOpenChanges,
  truncated,
  loadingMore,
  onLoadMore,
  liveConnected
}: CommitGraphProps) {
  const metrics = density === "compact" ? compactDiagramMetrics : diagramNodeMetrics;
  const { nodeWidth, nodeHeight, rowGap } = metrics;

  const [hoveredHash, setHoveredHash] = useState<string | null>(null);
  const [tracedLane, setTracedLane] = useState<string | null>(null);
  const [showMinimap, setShowMinimap] = useState(true);
  const [showGuide, setShowGuide] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scrollPos, setScrollPos] = useState({ top: 0, left: 0 });
  const [sizeMode, setSizeMode] = useState<"actual" | "fit" | "manual">("actual");
  const [manualScale, setManualScale] = useState(1);

  const nodeByHash = useMemo(() => new Map(diagram.nodes.map((node) => [node.hash, node])), [diagram.nodes]);

  const childrenByHash = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const node of diagram.nodes) {
      for (const parent of node.parents) {
        let list = map.get(parent);
        if (!list) {
          list = [];
          map.set(parent, list);
        }
        list.push(node.hash);
      }
    }
    return map;
  }, [diagram.nodes]);

  // Identify the checked-out HEAD node so we can mark "You are here" and attach uncommitted work.
  const headNode = useMemo(() => {
    const normalizedHead = headHash?.trim() ?? "";
    if (normalizedHead) {
      const exact = diagram.nodes.find(
        (node) =>
          node.hash === normalizedHead ||
          node.shortHash === normalizedHead ||
          node.hash.startsWith(normalizedHead)
      );
      if (exact) return exact;
    }
    return (
      diagram.nodes.find((node) =>
        node.refs.some((ref) => ref.kind === "head" || (ref.kind === "local" && ref.isCurrent))
      ) ?? null
    );
  }, [diagram.nodes, headHash]);

  // Tip (newest) node per lane — diagram.nodes is ordered oldest-to-newest, so the last node in a lane is its tip.
  const laneTipByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of diagram.nodes) {
      map.set(node.laneName, node.hash);
    }
    return map;
  }, [diagram.nodes]);

  // Full ancestor set when tracing a branch lane from its tip commit.
  const tracedHashes = useMemo(() => {
    if (!tracedLane) return null;
    const tipHash = laneTipByName.get(tracedLane);
    if (!tipHash) return null;
    const visited = new Set<string>();
    const stack = [tipHash];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const node = nodeByHash.get(current);
      if (!node) continue;
      for (const parent of node.parents) {
        if (nodeByHash.has(parent) && !visited.has(parent)) {
          stack.push(parent);
        }
      }
    }
    return visited;
  }, [tracedLane, laneTipByName, nodeByHash]);

  // Virtual "Uncommitted changes" card rendered below the graph when working tree is dirty.
  const dirtyFilesCount = workingStatus && !workingStatus.clean ? workingStatus.files.length : 0;
  const hasWorkingCard = dirtyFilesCount > 0 && headNode !== null;
  const workingCardExtraHeight = hasWorkingCard ? nodeHeight + rowGap : 0;
  const workingCard = useMemo(() => {
    if (!hasWorkingCard || !headNode) return null;
    const maxNodeBottom = diagram.nodes.reduce((max, n) => Math.max(max, n.y + nodeHeight), 0);
    const y = maxNodeBottom + rowGap;
    return {
      x: headNode.x,
      y,
      fromX: headNode.x + nodeWidth / 2,
      fromY: headNode.y + nodeHeight,
      toX: headNode.x + nodeWidth / 2,
      toY: y,
      column: headNode.column
    };
  }, [hasWorkingCard, headNode, diagram.nodes, nodeHeight, rowGap, nodeWidth]);

  const totalDiagramHeight = diagram.height + workingCardExtraHeight;

  // Track viewport size for fit mode, virtualization, and minimap.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setViewport({ width: element.clientWidth, height: element.clientHeight });
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fitScale = useMemo(() => {
    if (viewport.width === 0 || viewport.height === 0) return 1;
    const scaleX = (viewport.width - FIT_PADDING) / diagram.width;
    const scaleY = (viewport.height - FIT_PADDING) / totalDiagramHeight;
    return clampScale(Math.min(scaleX, scaleY));
  }, [viewport, diagram.width, totalDiagramHeight]);

  const scale = sizeMode === "fit" ? fitScale : sizeMode === "manual" ? manualScale : 1;

  function zoomBy(delta: number) {
    setManualScale(() => clampScale((sizeMode === "fit" ? fitScale : scale) + delta));
    setSizeMode("manual");
  }

  function resetActual() {
    setManualScale(1);
    setSizeMode("actual");
  }

  // Only reset zoom/scroll/trace when switching repositories, never on search or live refresh.
  useEffect(() => {
    setSizeMode("actual");
    setManualScale(1);
    setTracedLane(null);
    if (scrollRef.current && typeof scrollRef.current.scrollTo === "function") {
      scrollRef.current.scrollTo({ top: 0, left: 0 });
    }
  }, [repoKey]);

  // Smoothly bring the selected node into view if it's outside the visible area.
  useEffect(() => {
    if (!selectedHash) return;
    const element = scrollRef.current;
    if (!element || typeof element.scrollTo !== "function") return;
    if (viewport.width === 0 || viewport.height === 0) return;

    const node = nodeByHash.get(selectedHash);
    if (!node) return;

    const headerBuffer = Math.max(0, Math.ceil(44 - (metrics.paddingY + metrics.laneHeaderHeight) * scale));
    const nodeLeft = node.x * scale;
    const nodeRight = (node.x + nodeWidth) * scale;
    const nodeTop = node.y * scale + headerBuffer;
    const nodeBottom = (node.y + nodeHeight) * scale + headerBuffer;

    const viewLeft = element.scrollLeft;
    const viewRight = viewLeft + viewport.width;
    const viewTop = element.scrollTop;
    const viewBottom = viewTop + viewport.height;

    const marginX = 48;
    const marginY = 72;

    let nextLeft = viewLeft;
    let nextTop = viewTop;

    if (nodeLeft < viewLeft + marginX || nodeRight > viewRight - marginX) {
      nextLeft = Math.max(0, nodeLeft - viewport.width / 2 + (nodeWidth * scale) / 2);
    }
    if (nodeTop < viewTop + marginY || nodeBottom > viewBottom - marginY) {
      nextTop = Math.max(0, nodeTop - viewport.height / 2 + (nodeHeight * scale) / 2);
    }

    if (nextLeft !== viewLeft || nextTop !== viewTop) {
      element.scrollTo({ left: nextLeft, top: nextTop, behavior: "smooth" });
    }
  }, [
    selectedHash,
    nodeByHash,
    scale,
    nodeWidth,
    nodeHeight,
    metrics.paddingY,
    metrics.laneHeaderHeight,
    viewport.width,
    viewport.height
  ]);

  // Ctrl/Cmd + Wheel (and trackpad pinch) zoom anchored to cursor.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();

      const currentScale = sizeMode === "fit" ? fitScale : sizeMode === "manual" ? manualScale : 1;
      const factor = Math.exp(-event.deltaY * 0.004);
      const nextScale = clampScale(currentScale * factor);
      if (Math.abs(nextScale - currentScale) < 0.001) return;

      const rect = element.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const ratio = nextScale / currentScale;

      const nextLeft = Math.max(0, (element.scrollLeft + cursorX) * ratio - cursorX);
      const nextTop = Math.max(0, (element.scrollTop + cursorY) * ratio - cursorY);

      setManualScale(nextScale);
      setSizeMode("manual");
      requestAnimationFrame(() => {
        element.scrollLeft = nextLeft;
        element.scrollTop = nextTop;
      });
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [sizeMode, fitScale, manualScale]);

  // Connected nodes on hover (O(1) lookup via indexed maps).
  const connectedHashes = useMemo(() => {
    if (!hoveredHash) return null;
    const set = new Set<string>([hoveredHash]);
    const hoveredNode = nodeByHash.get(hoveredHash);
    if (hoveredNode) {
      hoveredNode.parents.forEach((p) => set.add(p));
    }
    const children = childrenByHash.get(hoveredHash);
    if (children) {
      children.forEach((c) => set.add(c));
    }
    return set;
  }, [hoveredHash, nodeByHash, childrenByHash]);

  // Virtualized slice: when viewport.height === 0 (e.g. jsdom), render everything.
  const { visibleNodes, visibleEdges } = useMemo(() => {
    if (viewport.height === 0) {
      return { visibleNodes: diagram.nodes, visibleEdges: diagram.edges };
    }
    const minY = scrollPos.top / scale - VIRTUAL_BUFFER;
    const maxY = (scrollPos.top + viewport.height) / scale + VIRTUAL_BUFFER;

    const vNodes = diagram.nodes.filter((node) => node.y + nodeHeight >= minY && node.y <= maxY);
    const vEdges = diagram.edges.filter(
      (edge) => Math.max(edge.fromY, edge.toY) >= minY && Math.min(edge.fromY, edge.toY) <= maxY
    );
    return { visibleNodes: vNodes, visibleEdges: vEdges };
  }, [diagram.nodes, diagram.edges, viewport.height, scrollPos.top, scale, nodeHeight]);

  const scaledWidth = diagram.width * scale;
  const scaledHeight = totalDiagramHeight * scale;
  const zoomPercent = Math.round(scale * 100);

  // Prevent sticky lane header (-36px overlap) from covering row 0 when zoomed out.
  const headerClearanceTop = Math.max(0, Math.ceil(44 - (metrics.paddingY + metrics.laneHeaderHeight) * scale));

  // Minimap geometry
  const minimapMaxW = 148;
  const minimapMaxH = 190;
  const minimapScale = useMemo(() => {
    if (diagram.width <= 0 || totalDiagramHeight <= 0) return 0.1;
    return Math.min(minimapMaxW / diagram.width, minimapMaxH / totalDiagramHeight);
  }, [diagram.width, totalDiagramHeight]);

  const minimapWidth = Math.max(60, diagram.width * minimapScale);
  const minimapHeight = Math.max(60, totalDiagramHeight * minimapScale);
  const showMinimapWidget =
    showMinimap &&
    viewport.height > 0 &&
    (scaledHeight > viewport.height + 40 || scaledWidth > viewport.width + 40);

  const scrollToMinimapPoint = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => {
      const element = scrollRef.current;
      if (!element || typeof element.scrollTo !== "function") return;
      const diagX = (clientX - rect.left) / minimapScale;
      const diagY = (clientY - rect.top) / minimapScale;
      element.scrollTo({
        left: Math.max(0, diagX * scale - viewport.width / 2),
        top: Math.max(0, diagY * scale - viewport.height / 2)
      });
    },
    [minimapScale, scale, viewport.width, viewport.height]
  );

  // Drag-to-pan on empty canvas background.
  const handleCanvasMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(".diagram-node, .diagram-working-node, button, a, input, select, .graph-minimap, .graph-guide-popover")) {
      return;
    }

    const element = scrollRef.current;
    if (!element) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const startScrollLeft = element.scrollLeft;
    const startScrollTop = element.scrollTop;
    let moved = false;

    const handleMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > 3) {
        moved = true;
        setIsPanning(true);
      }
      if (moved) {
        element.scrollLeft = startScrollLeft - dx;
        element.scrollTop = startScrollTop - dy;
      }
    };

    const handleUp = () => {
      setIsPanning(false);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  function handleLaneClick(laneName: string) {
    const nextLane = tracedLane === laneName ? null : laneName;
    setTracedLane(nextLane);
    if (nextLane) {
      const tipHash = laneTipByName.get(nextLane);
      if (tipHash) onSelect(tipHash);
    }
  }

  return (
    <section className="graph-panel" aria-label="Commit node diagram">
      <div className="graph-header">
        <div className="header-title-row">
          <span
            className={`dot-glowing ${liveConnected ? "live" : ""}`}
            title={liveConnected ? "Live watching .git for changes" : "Manual refresh"}
          />
          <span className="topology-title font-sans">Commit timeline</span>
          <span className="badge-meta font-mono">
            {diagram.nodes.length}
            {truncated ? "+" : ""} commits
          </span>
          <span className="timeline-direction-pill" title="Commits flow downward from older history at the top to newer work below">
            <ArrowDown size={11} />
            <span>Older → Newest</span>
          </span>
          {liveConnected && <span className="live-pill">Live</span>}
          {tracedLane && (
            <button
              type="button"
              className="trace-active-pill"
              onClick={() => setTracedLane(null)}
              title="Clear branch history highlight"
            >
              <span>Tracing: {tracedLane}</span>
              <X size={11} />
            </button>
          )}
        </div>

        <div className="graph-toolbar-right">
          <div className="density-toggle" role="group" aria-label="View density">
            <button
              type="button"
              className={`density-btn ${density === "cards" ? "active" : ""}`}
              onClick={() => onDensityChange("cards")}
              title="Card view (detailed)"
              aria-pressed={density === "cards"}
            >
              <LayoutGrid size={13} />
              <span>Cards</span>
            </button>
            <button
              type="button"
              className={`density-btn ${density === "compact" ? "active" : ""}`}
              onClick={() => onDensityChange("compact")}
              title="Compact view (dense, press d)"
              aria-pressed={density === "compact"}
            >
              <List size={13} />
              <span>Compact</span>
            </button>
          </div>

          <div className="graph-zoom-controls" role="group" aria-label="Graph zoom">
            <button
              type="button"
              className="zoom-btn"
              onClick={() => zoomBy(-ZOOM_STEP)}
              disabled={scale <= MIN_SCALE}
              title="Zoom out (Ctrl/Cmd + Wheel)"
              aria-label="Zoom out"
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              className="zoom-level"
              onClick={resetActual}
              title="Reset to 100%"
              aria-label="Reset zoom to 100%"
            >
              {zoomPercent}%
            </button>
            <button
              type="button"
              className="zoom-btn"
              onClick={() => zoomBy(ZOOM_STEP)}
              disabled={scale >= MAX_SCALE}
              title="Zoom in (Ctrl/Cmd + Wheel)"
              aria-label="Zoom in"
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              className={`zoom-btn fit-btn ${sizeMode === "fit" ? "active" : ""}`}
              onClick={() => setSizeMode((mode) => (mode === "fit" ? "actual" : "fit"))}
              aria-pressed={sizeMode === "fit"}
              title={sizeMode === "fit" ? "Exit fit to view" : "Fit to view"}
              aria-label={sizeMode === "fit" ? "Exit fit to view" : "Fit to view"}
            >
              <Maximize2 size={13} />
              <span>Fit</span>
            </button>
            <button
              type="button"
              className={`zoom-btn ${showMinimap ? "active" : ""}`}
              onClick={() => setShowMinimap((prev) => !prev)}
              aria-pressed={showMinimap}
              title={showMinimap ? "Hide minimap" : "Show minimap"}
              aria-label={showMinimap ? "Hide minimap" : "Show minimap"}
            >
              <MapIcon size={13} />
            </button>
            <button
              type="button"
              className={`zoom-btn fit-btn ${showGuide ? "active" : ""}`}
              onClick={() => setShowGuide((prev) => !prev)}
              aria-pressed={showGuide}
              title="How to read this graph"
              aria-label="How to read this graph"
            >
              <HelpCircle size={13} />
              <span>Guide</span>
            </button>
          </div>
        </div>
      </div>

      {showGuide && (
        <div className="graph-guide-popover" role="region" aria-label="How to read this Git timeline">
          <div className="guide-popover-header">
            <span className="guide-title">How to read this timeline</span>
            <button
              type="button"
              className="guide-close-btn"
              onClick={() => setShowGuide(false)}
              aria-label="Close guide"
            >
              <X size={13} />
            </button>
          </div>
          <div className="guide-grid">
            <div className="guide-item">
              <span className="guide-swatch arrow-swatch">↓</span>
              <div>
                <strong>Older at top, newer below</strong>
                <p>Arrows point forward in time to the next commit built on top of an earlier snapshot.</p>
              </div>
            </div>
            <div className="guide-item">
              <span className="guide-swatch solid-line" />
              <div>
                <strong>Solid vs. dashed lines</strong>
                <p>Solid lines follow normal commits; dashed lines show a merge combining two branches.</p>
              </div>
            </div>
            <div className="guide-item">
              <span className="guide-swatch you-swatch">HEAD</span>
              <div>
                <strong>You are here</strong>
                <p>Marks the commit currently checked out on your computer. Unsaved edits appear below it.</p>
              </div>
            </div>
            <div className="guide-item">
              <span className="guide-swatch branch-swatch">Tip</span>
              <div>
                <strong>Trace any branch</strong>
                <p>Click a branch name column at the top to highlight its full history. Hover lines for details.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        className={`diagram-scroll ${isPanning ? "panning" : ""}`}
        ref={scrollRef}
        onMouseDown={handleCanvasMouseDown}
        onScroll={(event) => {
          const el = event.currentTarget;
          setScrollPos({ top: el.scrollTop, left: el.scrollLeft });
        }}
      >
        {/* Sticky Clickable Lane Title Headers */}
        <div className="diagram-lane-header" style={{ width: scaledWidth }}>
          {diagram.lanes.map((lane) => {
            const isTraced = tracedLane === lane.name;
            return (
              <button
                key={lane.name}
                type="button"
                className={`diagram-lane-title lane-title-col-${lane.column % 6} ${isTraced ? "traced" : ""}`}
                style={{ left: lane.x * scale, width: lane.width * scale }}
                onClick={() => handleLaneClick(lane.name)}
                aria-label={`Trace branch ${lane.name}`}
                aria-pressed={isTraced}
                title={
                  isTraced
                    ? `Stop tracing ${lane.name} history`
                    : `Click to jump to ${lane.name} and trace its history`
                }
              >
                <GitBranch size={12} className="lane-icon-svg" />
                <span>{lane.name}</span>
              </button>
            );
          })}
        </div>

        {/* SVG Drawing Canvas */}
        <svg
          className={`diagram-svg density-${density}`}
          width={scaledWidth}
          height={scaledHeight}
          style={headerClearanceTop > 0 ? { marginTop: headerClearanceTop } : undefined}
          viewBox={`0 0 ${diagram.width} ${totalDiagramHeight}`}
          role="img"
          aria-label="Git commit node diagram"
        >
          <defs>
            <pattern id="dot-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.1" className="grid-dot" />
            </pattern>

            {[0, 1, 2, 3, 4, 5].map((col) => (
              <marker
                key={col}
                id={`arrow-${col}`}
                markerHeight="6"
                markerWidth="6"
                orient="auto"
                refX="7"
                refY="3"
              >
                <path d="M 0 0.5 L 6 3 L 0 5.5 z" className={`arrow-head col-${col}`} />
              </marker>
            ))}
          </defs>

          <rect width={diagram.width} height={totalDiagramHeight} fill="url(#dot-grid)" />

          {/* Background Lane Guides (Rails) */}
          {diagram.lanes.map((lane) => (
            <g key={`rail-group-${lane.name}`} className={`diagram-lane-rail lane-col-${lane.column % 6}`}>
              <line
                x1={lane.centerX}
                y1={20}
                x2={lane.centerX}
                y2={totalDiagramHeight - 20}
                strokeWidth="1.5"
                className="rail-line"
              />
            </g>
          ))}

          {/* Lane Column Hover Background Backdrops */}
          {diagram.lanes.map((lane) => (
            <g key={`backdrop-${lane.name}`} className={`diagram-lane-backdrop lane-col-${lane.column % 6}`}>
              <rect
                x={lane.x}
                y="10"
                width={lane.width}
                height={totalDiagramHeight - 20}
                rx="16"
                className="lane-hover-backdrop"
              />
            </g>
          ))}

          {/* Connection Edges */}
          {visibleEdges.map((edge) => {
            const fromNode = nodeByHash.get(edge.from);
            const toNode = nodeByHash.get(edge.to);
            const isSecondParentMerge = Boolean(edge.merge && toNode && toNode.parents[0] !== edge.from);

            const isEdgeHovered = hoveredHash && (edge.from === hoveredHash || edge.to === hoveredHash);
            const isEdgeMatched =
              matchedHashes !== null && (matchedHashes.has(edge.from) || matchedHashes.has(edge.to));
            const isEdgeCompared =
              compareHighlight !== null &&
              (compareHighlight.ahead.has(edge.to) ||
                compareHighlight.behind.has(edge.to) ||
                compareHighlight.ahead.has(edge.from) ||
                compareHighlight.behind.has(edge.from));
            const isEdgeTraced =
              tracedHashes !== null && tracedHashes.has(edge.from) && tracedHashes.has(edge.to);

            const isEdgeDimmed =
              (hoveredHash && !isEdgeHovered) ||
              (!hoveredHash && matchedHashes !== null && !isEdgeMatched) ||
              (!hoveredHash && matchedHashes === null && compareHighlight !== null && !isEdgeCompared) ||
              (!hoveredHash &&
                matchedHashes === null &&
                compareHighlight === null &&
                tracedHashes !== null &&
                !isEdgeTraced);

            const edgeClass = [
              "diagram-edge",
              `edge-col-${edge.column % 6}`,
              edge.merge ? "merge" : "",
              isEdgeHovered ? "hovered" : "",
              isEdgeCompared || isEdgeTraced ? "compared" : "",
              isEdgeDimmed ? "dimmed" : ""
            ]
              .filter(Boolean)
              .join(" ");

            const edgeTooltip =
              fromNode && toNode
                ? isSecondParentMerge
                  ? `Merged "${fromNode.laneName}" (${fromNode.shortHash}) into "${toNode.subject}" (${toNode.shortHash})`
                  : `Built "${toNode.subject}" (${toNode.shortHash}) on top of ${fromNode.shortHash}`
                : undefined;

            return (
              <path
                key={`${edge.from}-${edge.to}`}
                d={edgePath(edge)}
                className={edgeClass}
                markerEnd={`url(#arrow-${edge.column % 6})`}
              >
                {edgeTooltip && <title>{edgeTooltip}</title>}
              </path>
            );
          })}

          {/* Connector from HEAD to Uncommitted Working Changes */}
          {workingCard && (
            <path
              d={edgePath({
                from: headNode?.hash ?? "head",
                to: "working-tree",
                fromX: workingCard.fromX,
                fromY: workingCard.fromY,
                toX: workingCard.toX,
                toY: workingCard.toY,
                merge: false,
                column: workingCard.column
              })}
              className={`diagram-edge working-edge edge-col-${workingCard.column % 6}`}
              markerEnd={`url(#arrow-${workingCard.column % 6})`}
            >
              <title>Uncommitted edits on your computer based on the current commit</title>
            </path>
          )}

          {/* Commit Nodes */}
          {visibleNodes.map((node) => {
            const selected = node.hash === selectedHash;
            const isHeadNode = headNode?.hash === node.hash;
            const isMerge = node.parents.length > 1;
            const isNodeHovered = node.hash === hoveredHash;
            const isNodeConnected = connectedHashes?.has(node.hash) ?? false;
            const isSearchMatch = matchedHashes !== null && matchedHashes.has(node.hash);
            const isCompareAhead = compareHighlight?.ahead.has(node.hash) ?? false;
            const isCompareBehind = compareHighlight?.behind.has(node.hash) ?? false;
            const isCompareBase = compareHighlight !== null && compareMergeBase === node.hash;
            const isTraced = tracedHashes?.has(node.hash) ?? false;

            const dimmedByHover = hoveredHash !== null && !isNodeConnected;
            const dimmedBySearch = hoveredHash === null && matchedHashes !== null && !isSearchMatch && !selected;
            const dimmedByCompare =
              hoveredHash === null &&
              matchedHashes === null &&
              compareHighlight !== null &&
              !isCompareAhead &&
              !isCompareBehind &&
              !isCompareBase &&
              !selected;
            const dimmedByTrace =
              hoveredHash === null &&
              matchedHashes === null &&
              compareHighlight === null &&
              tracedHashes !== null &&
              !isTraced &&
              !selected;

            const isNodeDimmed = dimmedByHover || dimmedBySearch || dimmedByCompare || dimmedByTrace;

            const nodeClass = [
              "diagram-node",
              `node-col-${node.column % 6}`,
              selected ? "selected" : "",
              isHeadNode ? "is-head" : "",
              isNodeHovered ? "hovered" : "",
              isNodeConnected ? "connected" : "",
              isSearchMatch ? "search-match" : "",
              isCompareAhead ? "compare-ahead" : "",
              isCompareBehind ? "compare-behind" : "",
              isCompareBase ? "compare-base" : "",
              isNodeDimmed ? "dimmed" : "",
              isMerge ? "merge" : "regular"
            ]
              .filter(Boolean)
              .join(" ");

            const sortedRefs = sortRefsForDisplay(node.refs);

            return (
              <g
                key={node.hash}
                className={nodeClass}
                transform={`translate(${node.x}, ${node.y})`}
                onMouseEnter={() => setHoveredHash(node.hash)}
                onMouseLeave={() => setHoveredHash(null)}
              >
                <rect width={nodeWidth} height={nodeHeight} rx={density === "compact" ? 9 : 14} className="node-card-bg" />

                {density === "cards" ? (
                  <path
                    d={`M 0 14 C 0 6, 6 0, 14 0 L 14 ${nodeHeight} L 0 ${nodeHeight} Z`}
                    className="node-accent-strip"
                  />
                ) : (
                  <rect x="0" y="0" width="8" height={nodeHeight} rx="4" className="node-accent-strip" />
                )}

                <circle
                  cx={density === "compact" ? 5 : 7}
                  cy={nodeHeight / 2}
                  r={density === "compact" ? (isMerge ? 3 : 2.2) : isMerge ? 3.5 : 2.5}
                  className="node-junction-dot"
                />

                <foreignObject width={nodeWidth} height={nodeHeight}>
                  <button
                    type="button"
                    className={`diagram-node-button ${density === "compact" ? "compact" : ""}`}
                    onClick={() => onSelect(node.hash)}
                  >
                    {density === "compact" ? (
                      <div className="compact-node-row">
                        <span className="diagram-node-hash font-mono">{node.shortHash}</span>
                        {isMerge && (
                          <span className="compact-merge-icon" title="Merge commit (combines two branches)">
                            <GitMerge size={11} />
                          </span>
                        )}
                        <span className="diagram-node-title compact font-sans" title={node.subject}>
                          {node.subject}
                        </span>
                        {isHeadNode && (
                          <span className="node-you-badge compact" title="Currently checked out (HEAD)">
                            HEAD
                          </span>
                        )}
                        {!isHeadNode && sortedRefs[0] && (
                          <span className={`node-ref-badge compact ${refClass(sortedRefs[0])}`}>
                            {refLabel(sortedRefs[0])}
                          </span>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="diagram-node-title-row">
                          <span className="diagram-node-title font-sans" title={node.subject}>
                            {node.subject}
                          </span>
                          {isMerge && (
                            <span className="node-merge-pill" title="Merge commit: combined two branches">
                              <GitMerge size={10} />
                            </span>
                          )}
                        </div>

                        <div className="diagram-node-meta-row font-mono">
                          <span className="diagram-node-hash">{node.shortHash}</span>
                          <span className="diagram-node-divider">·</span>
                          <span className="diagram-node-author" title={`${node.authorName} <${node.authorEmail}>`}>
                            {node.authorName.split(" ")[0]}
                          </span>
                          {isHeadNode && (
                            <span className="node-you-badge font-sans" title="You are currently here (HEAD)">
                              You are here
                            </span>
                          )}
                        </div>

                        {sortedRefs.length > 0 ? (
                          <div className="diagram-node-refs">
                            {sortedRefs.slice(0, 2).map((ref, idx) => (
                              <span key={`${ref.kind}-${ref.name}-${idx}`} className={`node-ref-badge ${refClass(ref)}`}>
                                {refLabel(ref)}
                              </span>
                            ))}
                            {sortedRefs.length > 2 && (
                              <span className="node-ref-badge ref-more">+{sortedRefs.length - 2}</span>
                            )}
                          </div>
                        ) : null}
                      </>
                    )}
                  </button>
                </foreignObject>
              </g>
            );
          })}

          {/* Virtual Uncommitted Changes Card */}
          {workingCard && (
            <g
              className={`diagram-working-node node-col-${workingCard.column % 6}`}
              transform={`translate(${workingCard.x}, ${workingCard.y})`}
            >
              <rect
                width={nodeWidth}
                height={nodeHeight}
                rx={density === "compact" ? 9 : 14}
                className="working-card-bg"
              />
              <foreignObject width={nodeWidth} height={nodeHeight}>
                <button
                  type="button"
                  className={`diagram-working-button ${density === "compact" ? "compact" : ""}`}
                  onClick={() => onOpenChanges?.()}
                  title="Open Changes tab to inspect uncommitted edits"
                >
                  {density === "compact" ? (
                    <div className="compact-node-row">
                      <FileEdit size={12} className="working-icon" />
                      <span className="diagram-node-title compact font-sans">
                        Uncommitted ({dirtyFilesCount} {dirtyFilesCount === 1 ? "file" : "files"})
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="working-card-title-row">
                        <FileEdit size={13} className="working-icon" />
                        <span className="working-card-title font-sans">Uncommitted changes</span>
                      </div>
                      <span className="working-card-sub font-sans">
                        {dirtyFilesCount} {dirtyFilesCount === 1 ? "file edited" : "files edited"} on disk · Click to review
                      </span>
                    </>
                  )}
                </button>
              </foreignObject>
            </g>
          )}
        </svg>

        {truncated && (
          <div className="graph-load-more-bar">
            <button type="button" className="load-more-btn" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? <Loader2 size={14} className="spin-icon" /> : <ChevronDown size={14} />}
              <span>{loadingMore ? "Loading older commits…" : "Load more commits"}</span>
            </button>
          </div>
        )}
      </div>

      {/* Floating Minimap */}
      {showMinimapWidget && (
        <div
          className="graph-minimap"
          style={{ width: minimapWidth + 12, height: minimapHeight + 12 }}
          aria-label="Graph minimap"
        >
          <svg
            width={minimapWidth}
            height={minimapHeight}
            viewBox={`0 0 ${diagram.width} ${totalDiagramHeight}`}
            onMouseDown={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              scrollToMinimapPoint(event.clientX, event.clientY, rect);
              const handleMove = (moveEvent: MouseEvent) => {
                scrollToMinimapPoint(moveEvent.clientX, moveEvent.clientY, rect);
              };
              const handleUp = () => {
                window.removeEventListener("mousemove", handleMove);
                window.removeEventListener("mouseup", handleUp);
              };
              window.addEventListener("mousemove", handleMove);
              window.addEventListener("mouseup", handleUp);
            }}
          >
            {diagram.lanes.map((lane) => (
              <line
                key={lane.name}
                x1={lane.centerX}
                y1={0}
                x2={lane.centerX}
                y2={totalDiagramHeight}
                className={`minimap-rail lane-col-${lane.column % 6}`}
                strokeWidth={Math.max(6, 1.5 / minimapScale)}
              />
            ))}
            {diagram.nodes.map((node) => {
              const isSelected = node.hash === selectedHash;
              const isMatch = matchedHashes?.has(node.hash);
              return (
                <rect
                  key={node.hash}
                  x={node.x}
                  y={node.y}
                  width={nodeWidth}
                  height={nodeHeight}
                  rx={16}
                  className={[
                    "minimap-node",
                    `node-col-${node.column % 6}`,
                    isSelected ? "selected" : "",
                    isMatch ? "matched" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
              );
            })}
            {workingCard && (
              <rect
                x={workingCard.x}
                y={workingCard.y}
                width={nodeWidth}
                height={nodeHeight}
                rx={16}
                className="minimap-working-node"
              />
            )}
            <rect
              x={scrollPos.left / scale}
              y={scrollPos.top / scale}
              width={viewport.width / scale}
              height={viewport.height / scale}
              className="minimap-viewport"
              strokeWidth={Math.max(8, 1.5 / minimapScale)}
            />
          </svg>
        </div>
      )}
    </section>
  );
}
