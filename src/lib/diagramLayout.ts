import type { GitCommit, GitDiagram, GitDiagramEdge, GitDiagramLane, GitDiagramNode } from "./types";

export type DiagramLayoutMetrics = {
  nodeWidth: number;
  nodeHeight: number;
  columnGap: number;
  rowGap: number;
  paddingX: number;
  paddingY: number;
  laneHeaderHeight: number;
};

export const diagramNodeMetrics: DiagramLayoutMetrics = {
  nodeWidth: 240,
  nodeHeight: 86,
  columnGap: 86,
  rowGap: 42,
  paddingX: 34,
  paddingY: 28,
  laneHeaderHeight: 44
};

export const compactDiagramMetrics: DiagramLayoutMetrics = {
  nodeWidth: 236,
  nodeHeight: 38,
  columnGap: 68,
  rowGap: 14,
  paddingX: 34,
  paddingY: 24,
  laneHeaderHeight: 44
};

export type LayoutDiagramOptions = {
  defaultBranch?: string;
  metrics?: Partial<DiagramLayoutMetrics>;
};

type LaneStats = {
  name: string;
  earliestTime: number;
};

function commitTime(commit: GitCommit): number {
  const raw = commit.committerDate || commit.date;
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return parsed;
  const fallback = Date.parse(commit.date);
  return Number.isFinite(fallback) ? fallback : Number.MAX_SAFE_INTEGER;
}

function directLaneName(commit: GitCommit, defaultBranch: string): string | undefined {
  const locals = commit.refs.filter((ref) => ref.kind === "local");
  if (locals.some((ref) => ref.name === defaultBranch)) return defaultBranch;
  if (locals.length > 0) return locals[0].name;

  const remotes = commit.refs.filter((ref) => ref.kind === "remote");
  if (remotes.some((ref) => ref.branch === defaultBranch)) return defaultBranch;
  if (remotes.length > 0) return remotes[0].name;

  return undefined;
}

function inferMergedBranchName(subject: string): string | undefined {
  const branchMatch = subject.match(/^Merge (?:remote-tracking )?branch '([^']+)'/);
  if (branchMatch?.[1]) return branchMatch[1];

  const prMatch = subject.match(/^Merge pull request #\d+ from (?:[^/\s]+\/)?([^\s]+)/);
  if (prMatch?.[1]) return prMatch[1];

  const tagMatch = subject.match(/^Merge tag '([^']+)'/);
  if (tagMatch?.[1]) return tagMatch[1];

  return undefined;
}

/**
 * Top-down topological ordering: every parent present in `commits` is
 * guaranteed to appear before all of its children, breaking ties among ready
 * commits by committer timestamp (oldest first), then original input order
 * descending (so earlier git-log rows come first).
 */
function orderCommitsTopDown(commits: GitCommit[]): GitCommit[] {
  if (commits.length <= 1) return commits.slice();

  const indexByHash = new Map<string, number>();
  const commitByHash = new Map<string, GitCommit>();
  const timeByHash = new Map<string, number>();

  commits.forEach((commit, index) => {
    indexByHash.set(commit.hash, index);
    commitByHash.set(commit.hash, commit);
    timeByHash.set(commit.hash, commitTime(commit));
  });

  const inDegree = new Map<string, number>();
  const childrenByHash = new Map<string, string[]>();

  for (const commit of commits) {
    const uniqueParents = new Set(commit.parents.filter((parent) => commitByHash.has(parent) && parent !== commit.hash));
    inDegree.set(commit.hash, uniqueParents.size);
    for (const parent of uniqueParents) {
      let children = childrenByHash.get(parent);
      if (!children) {
        children = [];
        childrenByHash.set(parent, children);
      }
      children.push(commit.hash);
    }
  }

  const compareReady = (leftHash: string, rightHash: string) => {
    const timeDiff = (timeByHash.get(leftHash) ?? 0) - (timeByHash.get(rightHash) ?? 0);
    if (timeDiff !== 0) return timeDiff;
    return (indexByHash.get(rightHash) ?? 0) - (indexByHash.get(leftHash) ?? 0);
  };

  const ready: string[] = [];
  for (const commit of commits) {
    if ((inDegree.get(commit.hash) ?? 0) === 0) {
      ready.push(commit.hash);
    }
  }
  ready.sort(compareReady);

  const ordered: GitCommit[] = [];
  const emitted = new Set<string>();

  while (ready.length > 0) {
    const currentHash = ready.shift()!;
    if (emitted.has(currentHash)) continue;
    emitted.add(currentHash);
    const commit = commitByHash.get(currentHash);
    if (commit) ordered.push(commit);

    const children = childrenByHash.get(currentHash);
    if (!children) continue;

    let inserted = false;
    for (const childHash of children) {
      const remaining = (inDegree.get(childHash) ?? 0) - 1;
      inDegree.set(childHash, remaining);
      if (remaining === 0 && !emitted.has(childHash)) {
        ready.push(childHash);
        inserted = true;
      }
    }
    if (inserted) {
      ready.sort(compareReady);
    }
  }

  // Fallback in case malformed history ever contains a cycle.
  if (ordered.length < commits.length) {
    const remaining = commits
      .filter((commit) => !emitted.has(commit.hash))
      .sort((left, right) => compareReady(left.hash, right.hash));
    ordered.push(...remaining);
  }

  return ordered;
}

function inferLaneAssignments(orderedTopDown: GitCommit[], defaultBranch: string) {
  const commitByHash = new Map(orderedTopDown.map((commit) => [commit.hash, commit]));
  const activeLaneByHash = new Map<string, string>();
  const laneNameByHash = new Map<string, string>();
  const laneStats = new Map<string, LaneStats>();

  function recordLane(name: string, commit: GitCommit) {
    const earliestTime = commitTime(commit);
    const existing = laneStats.get(name);
    if (!existing) {
      laneStats.set(name, { name, earliestTime });
      return;
    }
    existing.earliestTime = Math.min(existing.earliestTime, earliestTime);
  }

  // Traverse newest-to-oldest (children before parents) so branch identity
  // flows from branch tips down through their first-parent history.
  for (let i = orderedTopDown.length - 1; i >= 0; i -= 1) {
    const commit = orderedTopDown[i];
    const laneName = directLaneName(commit, defaultBranch) ?? activeLaneByHash.get(commit.hash) ?? defaultBranch;
    laneNameByHash.set(commit.hash, laneName);
    recordLane(laneName, commit);
    activeLaneByHash.delete(commit.hash);

    commit.parents.forEach((parent, parentIndex) => {
      if (activeLaneByHash.has(parent)) return;
      const parentCommit = commitByHash.get(parent);
      const parentDirectLane = parentCommit ? directLaneName(parentCommit, defaultBranch) : undefined;
      if (parentDirectLane) {
        activeLaneByHash.set(parent, parentDirectLane);
        return;
      }
      if (parentIndex === 0) {
        activeLaneByHash.set(parent, laneName);
        return;
      }
      const inferred = parentIndex === 1 ? inferMergedBranchName(commit.subject) : undefined;
      const fallbackName = inferred && inferred !== laneName ? inferred : `parent ${parentIndex + 1}`;
      activeLaneByHash.set(parent, fallbackName);
    });
  }

  const laneNames = Array.from(laneStats.values())
    .sort((left, right) => {
      if (left.name === defaultBranch) return -1;
      if (right.name === defaultBranch) return 1;
      const timeDiff = left.earliestTime - right.earliestTime;
      if (timeDiff !== 0) return timeDiff;
      return left.name.localeCompare(right.name);
    })
    .map((lane) => lane.name);

  return { laneNameByHash, laneNames };
}

export function layoutCommitDiagram(commits: GitCommit[], options: LayoutDiagramOptions = {}): GitDiagram {
  const defaultBranch = options.defaultBranch?.trim() || "main";
  const metrics: DiagramLayoutMetrics = {
    ...diagramNodeMetrics,
    ...options.metrics
  };
  const { nodeWidth, nodeHeight, columnGap, rowGap, paddingX, paddingY, laneHeaderHeight } = metrics;

  if (commits.length === 0) {
    return {
      lanes: [],
      nodes: [],
      edges: [],
      width: paddingX * 2,
      height: paddingY * 2 + laneHeaderHeight
    };
  }

  const orderedTopDown = orderCommitsTopDown(commits);
  const { laneNameByHash, laneNames } = inferLaneAssignments(orderedTopDown, defaultBranch);
  const lanes: GitDiagramLane[] = [];
  const laneByName = new Map<string, GitDiagramLane>();
  const nodeByHash = new Map<string, GitDiagramNode>();

  function ensureLane(name: string): GitDiagramLane {
    const existing = laneByName.get(name);
    if (existing) return existing;
    const column = lanes.length;
    const nodeX = paddingX + column * (nodeWidth + columnGap);
    const lane: GitDiagramLane = {
      name,
      column,
      x: nodeX - (column === 0 ? 0 : columnGap / 2),
      width: nodeWidth + (column === 0 ? columnGap / 2 : columnGap),
      centerX: nodeX + nodeWidth / 2
    };
    lanes.push(lane);
    laneByName.set(name, lane);
    return lane;
  }

  laneNames.forEach(ensureLane);

  const nodes: GitDiagramNode[] = orderedTopDown.map((commit, row) => {
    const laneName = laneNameByHash.get(commit.hash) ?? defaultBranch;
    const lane = ensureLane(laneName);

    const node: GitDiagramNode = {
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
        from: parent.hash,
        to: node.hash,
        fromX: parent.x + nodeWidth / 2,
        fromY: parent.y + nodeHeight,
        toX: node.x + nodeWidth / 2,
        toY: node.y,
        merge: node.parents.length > 1,
        column: parent.column
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
