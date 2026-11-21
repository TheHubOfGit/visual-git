import type {
  GitCommit,
  GitDiagram,
  GitDiagramDayMarker,
  GitDiagramEdge,
  GitDiagramLane,
  GitDiagramNode,
  GitDiagramPending
} from "./types";

export type DiagramLayoutMetrics = {
  /** Height of one commit row. */
  rowHeight: number;
  /** Distance between neighbouring tracks. */
  trackGap: number;
  paddingX: number;
  paddingY: number;
  dayHeaderHeight: number;
  /** Space between the last track and the commit labels. */
  labelGap: number;
};

export const roomyMetrics: DiagramLayoutMetrics = {
  rowHeight: 52,
  trackGap: 26,
  paddingX: 28,
  paddingY: 14,
  dayHeaderHeight: 38,
  labelGap: 26
};

export const compactMetrics: DiagramLayoutMetrics = {
  rowHeight: 32,
  trackGap: 20,
  paddingX: 24,
  paddingY: 10,
  dayHeaderHeight: 30,
  labelGap: 22
};

export const LANE_COLOR_COUNT = 8;

export type LayoutDiagramOptions = {
  defaultBranch?: string;
  metrics?: Partial<DiagramLayoutMetrics>;
  /** Insert a dated heading whenever the calendar day changes. Default true. */
  groupByDay?: boolean;
  /** Reserve a row for uncommitted work right after this commit (full or short hash). */
  pendingAfter?: string | null;
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

function dayOf(commit: GitCommit): { key: string; label: string } {
  const date = new Date(commit.date || commit.committerDate);
  if (Number.isNaN(date.getTime())) return { key: "unknown", label: "Undated" };
  const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const label = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
  return { key, label };
}

/**
 * Rail-map layout: one commit per row (oldest at the top), one narrow track
 * per branch, labels in a single column to the right of the tracks.
 */
export function layoutCommitDiagram(commits: GitCommit[], options: LayoutDiagramOptions = {}): GitDiagram {
  const defaultBranch = options.defaultBranch?.trim() || "main";
  const metrics: DiagramLayoutMetrics = { ...roomyMetrics, ...options.metrics };
  const { rowHeight, trackGap, paddingX, paddingY, dayHeaderHeight, labelGap } = metrics;
  const groupByDay = options.groupByDay ?? true;

  if (commits.length === 0) {
    return {
      lanes: [],
      nodes: [],
      edges: [],
      dayMarkers: [],
      pending: null,
      railWidth: paddingX + labelGap,
      rowHeight,
      width: paddingX * 2 + labelGap,
      height: paddingY * 2
    };
  }

  const ordered = orderCommitsTopDown(commits);
  const { laneNameByHash, laneNames } = inferLaneAssignments(ordered, defaultBranch);
  const pendingKey = options.pendingAfter?.trim() || "";
  const pendingIndex = pendingKey
    ? ordered.findIndex((commit) => commit.hash === pendingKey || commit.hash.startsWith(pendingKey))
    : -1;

  // Vertical positions.
  const yByHash = new Map<string, number>();
  const dayMarkers: GitDiagramDayMarker[] = [];
  let cursor = paddingY;
  let previousDay = "";
  let pendingY: number | null = null;
  ordered.forEach((commit, index) => {
    if (groupByDay) {
      const day = dayOf(commit);
      if (day.key !== previousDay) {
        dayMarkers.push({ key: `${day.key}-${index}`, label: day.label, y: cursor });
        cursor += dayHeaderHeight;
        previousDay = day.key;
      }
    }
    yByHash.set(commit.hash, cursor + rowHeight / 2);
    cursor += rowHeight;
    if (index === pendingIndex) {
      pendingY = cursor + rowHeight / 2;
      cursor += rowHeight;
    }
  });
  const height = cursor + paddingY;

  // Which lane owns each connection, and how far each lane reaches.
  const childCount = new Map<string, number>();
  type Span = { start: number; end: number };
  const spanByLane = new Map<string, Span>();
  const tipByLane = new Map<string, string>();
  const reach = (lane: string, y: number) => {
    const span = spanByLane.get(lane);
    if (!span) spanByLane.set(lane, { start: y, end: y });
    else {
      span.start = Math.min(span.start, y);
      span.end = Math.max(span.end, y);
    }
  };

  type Link = { from: string; to: string; secondary: boolean; merge: boolean; owner: string };
  const links: Link[] = [];
  for (const commit of ordered) {
    const lane = laneNameByHash.get(commit.hash) ?? defaultBranch;
    reach(lane, yByHash.get(commit.hash)!);
    tipByLane.set(lane, commit.hash);
    commit.parents.forEach((parentHash, parentIndex) => {
      if (!yByHash.has(parentHash) || parentHash === commit.hash) return;
      childCount.set(parentHash, (childCount.get(parentHash) ?? 0) + 1);
      const parentLane = laneNameByHash.get(parentHash) ?? defaultBranch;
      const secondary = parentIndex > 0;
      const owner = secondary ? parentLane : lane;
      // The owning lane runs along its own track for the whole connection.
      reach(owner, yByHash.get(secondary ? commit.hash : parentHash)!);
      links.push({ from: parentHash, to: commit.hash, secondary, merge: commit.parents.length > 1, owner });
    });
  }

  const pendingCommit = pendingIndex >= 0 ? ordered[pendingIndex] : null;
  const pendingInline = pendingCommit !== null && (childCount.get(pendingCommit.hash) ?? 0) === 0;
  if (pendingCommit && pendingInline && pendingY !== null) {
    reach(laneNameByHash.get(pendingCommit.hash) ?? defaultBranch, pendingY);
  }

  // Assign tracks, reusing one as soon as the lane that used it has ended.
  const columnByLane = new Map<string, number>();
  const occupied: Span[][] = [[{ start: -Infinity, end: Infinity }]];
  for (const name of laneNames) {
    if (name === defaultBranch) {
      columnByLane.set(name, 0);
      continue;
    }
    const span = spanByLane.get(name)!;
    const { start, end } = span;
    let column = 1;
    while (occupied[column]?.some((taken) => start <= taken.end && end >= taken.start)) column += 1;
    (occupied[column] ??= []).push({ start, end });
    columnByLane.set(name, column);
  }
  if (!columnByLane.has(defaultBranch)) columnByLane.set(defaultBranch, 0);

  let maxColumn = Math.max(0, ...columnByLane.values());
  const trackX = (column: number) => paddingX + column * trackGap;
  const colorByLane = new Map<string, number>();
  laneNames.forEach((name, index) => colorByLane.set(name, index % LANE_COLOR_COUNT));
  if (!colorByLane.has(defaultBranch)) colorByLane.set(defaultBranch, 0);

  const lanes: GitDiagramLane[] = laneNames.map((name) => ({
    name,
    column: columnByLane.get(name)!,
    colorIndex: colorByLane.get(name)!,
    x: trackX(columnByLane.get(name)!),
    tipHash: tipByLane.get(name)!
  }));

  const nodeByHash = new Map<string, GitDiagramNode>();
  const nodes: GitDiagramNode[] = ordered.map((commit, row) => {
    const laneName = laneNameByHash.get(commit.hash) ?? defaultBranch;
    const column = columnByLane.get(laneName) ?? 0;
    const node: GitDiagramNode = {
      ...commit,
      row,
      column,
      laneName,
      colorIndex: colorByLane.get(laneName) ?? 0,
      x: trackX(column),
      y: yByHash.get(commit.hash)!
    };
    nodeByHash.set(commit.hash, node);
    return node;
  });

  const edges: GitDiagramEdge[] = links.map((link) => {
    const parent = nodeByHash.get(link.from)!;
    const child = nodeByHash.get(link.to)!;
    return {
      from: link.from,
      to: link.to,
      fromX: parent.x,
      fromY: parent.y,
      toX: child.x,
      toY: child.y,
      merge: link.merge,
      secondary: link.secondary,
      bend: parent.x === child.x ? "none" : link.secondary ? "end" : "start",
      laneName: link.owner,
      colorIndex: colorByLane.get(link.owner) ?? 0
    };
  });

  let pending: GitDiagramPending | null = null;
  if (pendingCommit && pendingY !== null) {
    const headNode = nodeByHash.get(pendingCommit.hash)!;
    if (!pendingInline) maxColumn += 1;
    pending = {
      x: pendingInline ? headNode.x : trackX(maxColumn),
      y: pendingY,
      fromX: headNode.x,
      fromY: headNode.y,
      colorIndex: headNode.colorIndex
    };
  }

  const railWidth = trackX(maxColumn) + labelGap;
  return {
    lanes,
    nodes,
    edges,
    dayMarkers,
    pending,
    railWidth,
    rowHeight,
    width: railWidth + 320,
    height
  };
}
