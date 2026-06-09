import type { GitCommit, GitDiagram, GitDiagramEdge, GitDiagramLane, GitDiagramNode } from "./types";

const nodeWidth = 240;
const nodeHeight = 86;
const columnGap = 86;
const rowGap = 42;
const paddingX = 34;
const paddingY = 28;
const laneHeaderHeight = 44;

function branchRefs(commit: GitCommit): string[] {
  return commit.refs
    .map((ref) => {
      if (ref.startsWith("tag:")) return "";
      if (ref.startsWith("HEAD -> ")) return ref.slice("HEAD -> ".length);
      return ref;
    })
    .map((ref) => ref.trim())
    .filter(Boolean);
}

function directLaneName(commit: GitCommit): string | undefined {
  const branches = branchRefs(commit);
  if (branches.includes("main")) return "main";
  const namedBranch = branches.find((branch) => branch !== "main");
  if (namedBranch) return namedBranch;
  if (commit.parents.length > 1 || commit.subject.startsWith("Merge ")) return "main";
  return undefined;
}

export function layoutCommitDiagram(commits: GitCommit[]): GitDiagram {
  const commitByHash = new Map(commits.map((commit) => [commit.hash, commit]));
  const activeLaneByHash = new Map<string, string>();
  const lanes: GitDiagramLane[] = [];
  const laneByName = new Map<string, GitDiagramLane>();
  const nodeByHash = new Map<string, GitDiagramNode>();

  function ensureLane(name: string): GitDiagramLane {
    const existing = laneByName.get(name);
    if (existing) return existing;
    const column = lanes.length;
    const lane = {
      name,
      column,
      x: paddingX + column * (nodeWidth + columnGap) - (column === 0 ? 0 : columnGap / 2),
      width: nodeWidth + (column === 0 ? columnGap / 2 : columnGap)
    };
    lanes.push(lane);
    laneByName.set(name, lane);
    return lane;
  }

  ensureLane("main");

  const nodes = commits.map((commit, row) => {
    const laneName = directLaneName(commit) ?? activeLaneByHash.get(commit.hash) ?? "main";
    const lane = ensureLane(laneName);
    activeLaneByHash.delete(commit.hash);

    commit.parents.forEach((parent, parentIndex) => {
      if (activeLaneByHash.has(parent)) return;
      const parentCommit = commitByHash.get(parent);
      const parentDirectLane = parentCommit ? directLaneName(parentCommit) : undefined;
      if (parentDirectLane) {
        activeLaneByHash.set(parent, parentDirectLane);
        return;
      }
      activeLaneByHash.set(parent, parentIndex === 0 ? laneName : `parent ${parentIndex + 1}`);
    });

    const node = {
      ...commit,
      row,
      column: lane.column,
      laneName,
      x: paddingX + lane.column * (nodeWidth + columnGap),
      y: paddingY + laneHeaderHeight + row * (nodeHeight + rowGap)
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
    lanes,
    nodes,
    edges,
    width: paddingX * 2 + (maxColumn + 1) * nodeWidth + maxColumn * columnGap,
    height: paddingY * 2 + laneHeaderHeight + nodes.length * nodeHeight + Math.max(0, nodes.length - 1) * rowGap
  };
}

export const diagramNodeMetrics = {
  width: nodeWidth,
  height: nodeHeight
};
