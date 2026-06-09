import { layoutCommitDiagram, diagramNodeMetrics } from "../lib/diagramLayout";
import type { GitDiagramEdge, GitGraph } from "../lib/types";

type CommitGraphProps = {
  graph: GitGraph;
  selectedHash: string | null;
  onSelect: (hash: string) => void;
};

function edgePath(edge: GitDiagramEdge) {
  const midY = edge.fromY + Math.max(34, (edge.toY - edge.fromY) / 2);
  return `M ${edge.fromX} ${edge.fromY} C ${edge.fromX} ${midY}, ${edge.toX} ${midY}, ${edge.toX} ${edge.toY}`;
}

export function CommitGraph({ graph, selectedHash, onSelect }: CommitGraphProps) {
  const diagram = layoutCommitDiagram(graph.rows);
  const { width: nodeWidth, height: nodeHeight } = diagramNodeMetrics;

  return (
    <section className="graph-panel" aria-label="Commit node diagram">
      <div className="graph-header">
        <span>Node diagram</span>
        <span>{diagram.nodes.length} visible</span>
      </div>
      <div className="diagram-scroll">
        <div className="diagram-lane-header" style={{ width: diagram.width }}>
          {diagram.lanes.map((lane) => (
            <div key={lane.name} className="diagram-lane-title" style={{ left: lane.x, width: lane.width }}>
              {lane.name}
            </div>
          ))}
        </div>
        <svg className="diagram-svg" width={diagram.width} height={diagram.height} role="img" aria-label="Mermaid-style Git commit node diagram">
          <defs>
            <marker id="arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
              <path d="M 0 0 L 8 4 L 0 8 z" className="arrow-head" />
            </marker>
            <marker id="arrowMerge" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
              <path d="M 0 0 L 8 4 L 0 8 z" className="arrow-head merge" />
            </marker>
          </defs>
          {diagram.lanes.map((lane) => (
            <g key={lane.name} className="diagram-lane">
              <rect x={lane.x} y="10" width={lane.width} height={diagram.height - 20} rx="8" />
            </g>
          ))}
          {diagram.edges.map((edge) => (
            <path
              key={`${edge.from}-${edge.to}`}
              d={edgePath(edge)}
              className={edge.merge ? "diagram-edge merge" : "diagram-edge"}
              markerEnd={edge.merge ? "url(#arrowMerge)" : "url(#arrow)"}
            />
          ))}
          {diagram.nodes.map((node) => {
            const selected = node.hash === selectedHash;
            const isMerge = node.parents.length > 1;
            return (
              <g
                key={node.hash}
                className={`diagram-node ${selected ? "selected" : ""} ${isMerge ? "merge" : ""}`}
                transform={`translate(${node.x}, ${node.y})`}
              >
                <rect width={nodeWidth} height={nodeHeight} rx="8" />
                <foreignObject width={nodeWidth} height={nodeHeight}>
                  <button type="button" className="diagram-node-button" onClick={() => onSelect(node.hash)}>
                    <span className="diagram-node-title">{node.subject}</span>
                    <span className="diagram-node-meta">
                      {node.shortHash} · {node.authorName}
                    </span>
                    {node.refs.length ? (
                      <span className="diagram-node-refs">
                        {node.refs.slice(0, 2).map((ref) => (
                          <span key={ref}>{ref}</span>
                        ))}
                      </span>
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
