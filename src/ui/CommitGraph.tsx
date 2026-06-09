import type { GitGraph } from "../lib/types";

type CommitGraphProps = {
  graph: GitGraph;
  selectedHash: string | null;
  onSelect: (hash: string) => void;
};

const laneWidth = 34;
const rowHeight = 54;
const topPadding = 28;
const leftPadding = 30;

function edgePath(edge: GitGraph["edges"][number]) {
  const x1 = leftPadding + edge.fromLane * laneWidth;
  const x2 = leftPadding + edge.toLane * laneWidth;
  const y1 = topPadding + edge.fromRow * rowHeight;
  const y2 = topPadding + edge.toRow * rowHeight;
  const midY = y1 + Math.max(18, (y2 - y1) / 2);
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

export function CommitGraph({ graph, selectedHash, onSelect }: CommitGraphProps) {
  const graphWidth = Math.max(96, leftPadding * 2 + graph.lanes * laneWidth);
  const graphHeight = Math.max(160, topPadding * 2 + graph.rows.length * rowHeight);
  const visibleHashes = new Set(graph.rows.map((row) => row.hash));
  const visibleEdges = graph.edges.filter((edge) => visibleHashes.has(edge.from) && visibleHashes.has(edge.to));

  return (
    <section className="graph-panel" aria-label="Commit graph">
      <div className="graph-header">
        <span>Graph</span>
        <span>{graph.rows.length} visible</span>
      </div>
      <div className="graph-scroll">
        <svg className="graph-svg" width={graphWidth} height={graphHeight} role="img" aria-label="Git commit graph">
          {visibleEdges.map((edge) => (
            <path key={`${edge.from}-${edge.to}`} d={edgePath(edge)} className={edge.fromLane === edge.toLane ? "edge" : "edge edge-merge"} />
          ))}
          {graph.rows.map((row) => {
            const selected = row.hash === selectedHash;
            const cx = leftPadding + row.lane * laneWidth;
            const cy = topPadding + row.row * rowHeight;
            return (
              <g key={row.hash}>
                <circle className={`node ${selected ? "selected" : ""}`} cx={cx} cy={cy} r={selected ? 7 : 5.5} />
              </g>
            );
          })}
        </svg>
        <div className="row-overlay" style={{ marginLeft: graphWidth + 18, width: `calc(100% - ${graphWidth + 24}px)`, height: graphHeight }}>
          {graph.rows.map((row) => (
            <button
              key={row.hash}
              type="button"
              className={`commit-row ${row.hash === selectedHash ? "selected" : ""}`}
              style={{ top: topPadding + row.row * rowHeight - 22 }}
              onClick={() => onSelect(row.hash)}
            >
              <span className="commit-subject">{row.subject}</span>
              <span className="commit-meta">
                {row.shortHash} · {row.authorName}
              </span>
              {row.refs.length ? (
                <span className="commit-refs">
                  {row.refs.slice(0, 3).map((ref) => (
                    <span key={ref}>{ref}</span>
                  ))}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
