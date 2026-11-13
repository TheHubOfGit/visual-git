import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { layoutCommitDiagram, diagramNodeMetrics } from "../lib/diagramLayout";
import type { GitDiagramEdge, GitGraph } from "../lib/types";
import { GitBranch, Maximize2, Minus, Plus } from "lucide-react";

type CommitGraphProps = {
  graph: GitGraph;
  selectedHash: string | null;
  onSelect: (hash: string) => void;
};

const MIN_SCALE = 0.1;
const MAX_SCALE = 2;
const ZOOM_STEP = 0.2;
const FIT_PADDING = 32;

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function edgePath(edge: GitDiagramEdge) {
  const midY = edge.fromY + Math.max(34, (edge.toY - edge.fromY) / 2);
  return `M ${edge.fromX} ${edge.fromY} C ${edge.fromX} ${midY}, ${edge.toX} ${midY}, ${edge.toX} ${edge.toY}`;
}

export function CommitGraph({ graph, selectedHash, onSelect }: CommitGraphProps) {
  const diagram = layoutCommitDiagram(graph.rows);
  const { width: nodeWidth, height: nodeHeight } = diagramNodeMetrics;

  const [hoveredHash, setHoveredHash] = useState<string | null>(null);

  // Sizing: "actual" renders at 1:1 (scrollable, default); "fit" scales the
  // whole diagram to fit the viewport; "manual" is an explicit zoom level.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [sizeMode, setSizeMode] = useState<"actual" | "fit" | "manual">("actual");
  const [manualScale, setManualScale] = useState(1);

  // Track the viewport size so fit mode can recompute.
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
    const scaleY = (viewport.height - FIT_PADDING) / diagram.height;
    return clampScale(Math.min(scaleX, scaleY));
  }, [viewport, diagram.width, diagram.height]);

  const scale = sizeMode === "fit" ? fitScale : sizeMode === "manual" ? manualScale : 1;

  // Leaving fit mode (via zoom buttons) keeps the current visual size.
  function zoomBy(delta: number) {
    setManualScale(() => clampScale((sizeMode === "fit" ? fitScale : scale) + delta));
    setSizeMode("manual");
  }

  function resetActual() {
    setManualScale(1);
    setSizeMode("actual");
  }

  // Reset to 1:1 when the underlying graph changes (e.g. new repo / filter).
  useEffect(() => {
    setSizeMode("actual");
    setManualScale(1);
  }, [graph]);

  // Compute connected nodes for visual highlighting
  const connectedHashes = useMemo(() => {
    if (!hoveredHash) return null;
    const set = new Set<string>([hoveredHash]);
    const hoveredNode = diagram.nodes.find((n) => n.hash === hoveredHash);
    if (hoveredNode) {
      hoveredNode.parents.forEach((p) => set.add(p));
    }
    diagram.nodes.forEach((n) => {
      if (n.parents.includes(hoveredHash)) {
        set.add(n.hash);
      }
    });
    return set;
  }, [hoveredHash, diagram.nodes]);

  const paddingX = 34;
  const columnGap = 86;

  const scaledWidth = diagram.width * scale;
  const scaledHeight = diagram.height * scale;
  const zoomPercent = Math.round(scale * 100);

  return (
    <section className="graph-panel" aria-label="Commit node diagram">
      <div className="graph-header">
        <div className="header-title-row">
          <span className="dot-glowing" />
          <span className="topology-title font-sans">Commit graph</span>
          <span className="badge-meta font-mono">{diagram.nodes.length} commits</span>
        </div>

        <div className="graph-zoom-controls" role="group" aria-label="Graph zoom">
          <button
            type="button"
            className="zoom-btn"
            onClick={() => zoomBy(-ZOOM_STEP)}
            disabled={scale <= MIN_SCALE}
            title="Zoom out"
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
            title="Zoom in"
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
        </div>
      </div>

      <div className="diagram-scroll" ref={scrollRef}>
        {/* Sticky Lane Title Headers */}
        <div className="diagram-lane-header" style={{ width: scaledWidth }}>
          {diagram.lanes.map((lane) => (
            <div
              key={lane.name}
              className={`diagram-lane-title lane-title-col-${lane.column % 6}`}
              style={{ left: lane.x * scale, width: lane.width * scale }}
            >
              <GitBranch size={12} className="lane-icon-svg" />
              <span>{lane.name}</span>
            </div>
          ))}
        </div>

        {/* SVG Drawing Canvas */}
        <svg
          className="diagram-svg"
          width={scaledWidth}
          height={scaledHeight}
          viewBox={`0 0 ${diagram.width} ${diagram.height}`}
          role="img"
          aria-label="Git commit node diagram"
        >
          <defs>
            {/* Background dot grid */}
            <pattern id="dot-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.1" className="grid-dot" />
            </pattern>
            
            {/* Custom arrow markers for connections */}
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

          {/* Background Grid */}
          <rect width={diagram.width} height={diagram.height} fill="url(#dot-grid)" />

          {/* Background Lane Guides (Rails) */}
          {diagram.lanes.map((lane) => {
            const railX = paddingX + lane.column * (nodeWidth + columnGap) + nodeWidth / 2;
            return (
              <g key={`rail-group-${lane.name}`} className={`diagram-lane-rail lane-col-${lane.column % 6}`}>
                <line
                  x1={railX}
                  y1={20}
                  x2={railX}
                  y2={diagram.height - 20}
                  strokeWidth="1.5"
                  className="rail-line"
                />
              </g>
            );
          })}

          {/* Lane Column Hover Background Backdrops */}
          {diagram.lanes.map((lane) => (
            <g key={`backdrop-${lane.name}`} className={`diagram-lane-backdrop lane-col-${lane.column % 6}`}>
              <rect
                x={lane.x}
                y="10"
                width={lane.width}
                height={diagram.height - 20}
                rx="16"
                className="lane-hover-backdrop"
              />
            </g>
          ))}

          {/* Connection Edges */}
          {diagram.edges.map((edge) => {
            const isEdgeHovered = hoveredHash && (edge.from === hoveredHash || edge.to === hoveredHash);
            const isEdgeDimmed = hoveredHash && !isEdgeHovered;
            const edgeClass = [
              "diagram-edge",
              `edge-col-${edge.column % 6}`,
              edge.merge ? "merge" : "",
              isEdgeHovered ? "hovered" : "",
              isEdgeDimmed ? "dimmed" : ""
            ].filter(Boolean).join(" ");

            return (
              <path
                key={`${edge.from}-${edge.to}`}
                d={edgePath(edge)}
                className={edgeClass}
                markerEnd={`url(#arrow-${edge.column % 6})`}
              />
            );
          })}

          {/* Commit Nodes */}
          {diagram.nodes.map((node) => {
            const selected = node.hash === selectedHash;
            const isMerge = node.parents.length > 1;
            const isNodeHovered = node.hash === hoveredHash;
            const isNodeConnected = connectedHashes?.has(node.hash);
            const isNodeDimmed = hoveredHash && !isNodeConnected;

            const nodeClass = [
              "diagram-node",
              `node-col-${node.column % 6}`,
              selected ? "selected" : "",
              isNodeHovered ? "hovered" : "",
              isNodeConnected ? "connected" : "",
              isNodeDimmed ? "dimmed" : "",
              isMerge ? "merge" : "regular"
            ].filter(Boolean).join(" ");

            return (
              <g
                key={node.hash}
                className={nodeClass}
                transform={`translate(${node.x}, ${node.y})`}
                onMouseEnter={() => setHoveredHash(node.hash)}
                onMouseLeave={() => setHoveredHash(null)}
              >
                {/* Node Card Shape */}
                <rect width={nodeWidth} height={nodeHeight} rx="14" className="node-card-bg" />
                
                {/* Color Accent Bar on the Left Edge */}
                <path
                  d={`M 0 14 C 0 6, 6 0, 14 0 L 14 ${nodeHeight} L 0 ${nodeHeight} Z`}
                  className="node-accent-strip"
                />

                {/* Micro Junction Dot on the Accent Strip */}
                <circle
                  cx="7"
                  cy={nodeHeight / 2}
                  r={isMerge ? 3.5 : 2.5}
                  className="node-junction-dot"
                />

                {/* HTML content inside SVG */}
                <foreignObject width={nodeWidth} height={nodeHeight}>
                  <button
                    type="button"
                    className="diagram-node-button"
                    onClick={() => onSelect(node.hash)}
                  >
                    <span className="diagram-node-title font-sans" title={node.subject}>
                      {node.subject}
                    </span>
                    
                    <div className="diagram-node-meta-row font-mono">
                      <span className="diagram-node-hash">{node.shortHash}</span>
                      <span className="diagram-node-divider">·</span>
                      <span className="diagram-node-author" title={`${node.authorName} <${node.authorEmail}>`}>
                        {node.authorName.split(" ")[0]}
                      </span>
                    </div>

                    {node.refs.length ? (
                      <div className="diagram-node-refs">
                        {node.refs.slice(0, 2).map((ref) => {
                          const isHead = ref.includes("HEAD");
                          const isTag = ref.startsWith("tag: ");
                          const cleanRef = isTag ? ref.slice(5) : ref.replace("HEAD -> ", "");
                          const refTypeClass = isHead
                            ? "ref-head"
                            : isTag
                            ? "ref-tag"
                            : ref.startsWith("origin/")
                            ? "ref-remote"
                            : "ref-local";

                          return (
                            <span key={ref} className={`node-ref-badge ${refTypeClass}`}>
                              {cleanRef}
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                  </button>
                </foreignObject>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
