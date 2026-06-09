import type { GitCommit, GitDiagram, GitDiagramEdge, GitDiagramNode } from "./types";

const nodeWidth = 240;
const nodeHeight = 86;
const columnGap = 86;
const rowGap = 42;
const paddingX = 34;
const paddingY = 28;

function firstAvailableColumn(occupied: Set<number>): number {
  let column = 0;
  while (occupied.has(column)) column += 1;
  return column;
}

export function layoutCommitDiagram(commits: GitCommit[]): GitDiagram {
  const activeColumns = new Map<string, number>();
  const usedColumnsByRow = new Map<number, Set<number>>();
  const nodeByHash = new Map<string, GitDiagramNode>();

  const nodes = commits.map((commit, row) => {
    const occupied = usedColumnsByRow.get(row) ?? new Set<number>();
    usedColumnsByRow.set(row, occupied);
    const column = activeColumns.get(commit.hash) ?? firstAvailableColumn(occupied);
    occupied.add(column);
    activeColumns.delete(commit.hash);

    commit.parents.forEach((parent, parentIndex) => {
      if (activeColumns.has(parent)) return;
      if (parentIndex === 0) {
        activeColumns.set(parent, column);
        return;
      }
      activeColumns.set(parent, firstAvailableColumn(new Set([...occupied, ...activeColumns.values()])));
    });

    const node = {
      ...commit,
      row,
      column,
      x: paddingX + column * (nodeWidth + columnGap),
      y: paddingY + row * (nodeHeight + rowGap)
    };
    nodeByHash.set(commit.hash, node);
    return node;
  });

  const edges: GitDiagramEdge[] = [];
  for (const node of nodes) {
    for (const parentHash of node.parents) {
      const parent = nodeByHash.get(parentHash);
      if (!parent) continue;
      edges.push({
        from: node.hash,
        to: parent.hash,
        fromX: node.x + nodeWidth / 2,
        fromY: node.y + nodeHeight,
        toX: parent.x + nodeWidth / 2,
        toY: parent.y,
        merge: node.parents.length > 1
      });
    }
  }

  const maxColumn = Math.max(0, ...nodes.map((node) => node.column));
  return {
    nodes,
    edges,
    width: paddingX * 2 + (maxColumn + 1) * nodeWidth + maxColumn * columnGap,
    height: paddingY * 2 + nodes.length * nodeHeight + Math.max(0, nodes.length - 1) * rowGap
  };
}

export const diagramNodeMetrics = {
  width: nodeWidth,
  height: nodeHeight
};
