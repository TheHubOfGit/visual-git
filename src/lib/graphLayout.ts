import type { GitCommit, GitGraph, GitGraphEdge, GitGraphRow } from "./types";

function firstFreeLane(active: string[]): number {
  const lane = active.findIndex((hash) => !hash);
  return lane === -1 ? active.length : lane;
}

export function layoutCommitGraph(commits: GitCommit[]): GitGraph {
  const active: string[] = [];
  const rowByHash = new Map<string, GitGraphRow>();
  const rows: GitGraphRow[] = commits.map((commit, row) => {
    let lane = active.findIndex((hash) => hash === commit.hash);
    if (lane === -1) {
      lane = firstFreeLane(active);
    }

    active[lane] = commit.parents[0] ?? "";
    for (const parent of commit.parents.slice(1)) {
      if (!active.includes(parent)) {
        active[firstFreeLane(active)] = parent;
      }
    }

    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index]) break;
      active.pop();
    }

    const graphRow = { ...commit, row, lane };
    rowByHash.set(commit.hash, graphRow);
    return graphRow;
  });

  const edges: GitGraphEdge[] = [];
  for (const row of rows) {
    for (const parentHash of row.parents) {
      const parent = rowByHash.get(parentHash);
      if (!parent) continue;
      edges.push({
        from: row.hash,
        to: parent.hash,
        fromRow: row.row,
        toRow: parent.row,
        fromLane: row.lane,
        toLane: parent.lane
      });
    }
  }

  const lanes = Math.max(1, ...rows.map((row) => row.lane + 1), ...edges.map((edge) => Math.max(edge.fromLane, edge.toLane) + 1));

  return { rows, edges, lanes };
}
