/**
 * A ref decorating a commit, classified from git's fully-qualified names
 * (`refs/heads/…`, `refs/remotes/…`, `refs/tags/…`), so the UI never has to
 * guess from string prefixes.
 */
export type GitRef =
  | { kind: "local"; name: string; isCurrent: boolean }
  | { kind: "remote"; name: string; remote: string; branch: string }
  | { kind: "tag"; name: string }
  | { kind: "head"; name: "HEAD" };

export type GitCommit = {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  /** Author date (ISO 8601). Shown to people. */
  date: string;
  /** Committer date (ISO 8601). Used for ordering, since rebases keep the author date. */
  committerDate: string;
  refs: GitRef[];
  subject: string;
  body: string;
};

export type GitDiagramNode = GitCommit & {
  row: number;
  column: number;
  laneName: string;
  /** Stable palette slot of the node's lane (0 is the default branch). */
  colorIndex: number;
  /** Centre of the commit's station, in diagram coordinates. */
  x: number;
  y: number;
};

export type GitDiagramLane = {
  name: string;
  /** Track the lane runs on. Tracks are reused once a lane has ended. */
  column: number;
  colorIndex: number;
  x: number;
  /** Newest commit on the lane. */
  tipHash: string;
};

export type GitDiagramEdge = {
  from: string;
  to: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** The child commit has more than one parent. */
  merge: boolean;
  /** This edge comes from a parent other than the first (the line being merged in). */
  secondary: boolean;
  /** Where the edge changes track: right after its parent, right before its child, or not at all. */
  bend: "start" | "end" | "none";
  laneName: string;
  colorIndex: number;
};

export type GitDiagramDayMarker = {
  key: string;
  label: string;
  y: number;
};

export type GitDiagramPending = {
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  colorIndex: number;
};

export type GitDiagram = {
  lanes: GitDiagramLane[];
  nodes: GitDiagramNode[];
  edges: GitDiagramEdge[];
  dayMarkers: GitDiagramDayMarker[];
  /** Station for uncommitted work, drawn right after the checked-out commit. */
  pending: GitDiagramPending | null;
  /** Width of the track area; commit labels start to its right. */
  railWidth: number;
  rowHeight: number;
  width: number;
  height: number;
};

export type GitStatusFile = {
  path: string;
  index: string;
  workingTree: string;
};

export type GitRepositorySnapshot = {
  path: string;
  name: string;
  currentBranch: string;
  /** The repository's trunk (origin/HEAD, else main/master/…, else the current branch). */
  defaultBranch: string;
  head: string;
  remotes: string[];
  status: {
    clean: boolean;
    files: GitStatusFile[];
  };
  commits: GitCommit[];
  /** True when more history exists beyond the loaded `commits`. */
  truncated: boolean;
};

export type GitChangeStatus = "A" | "M" | "D" | "R" | "C" | "T" | "U" | "X";

export type GitChangedFile = {
  path: string;
  /** Previous path for renames and copies. */
  oldPath?: string;
  status: GitChangeStatus;
  /** null for binary files. */
  additions: number | null;
  deletions: number | null;
};

export type GitCommitDetails = {
  hash: string;
  /** The commit the changes are compared against (first parent), or null for a root commit. */
  base: string | null;
  files: GitChangedFile[];
};

export type GitFileDiff = {
  patch: string;
  truncated: boolean;
};

export type GitBranchComparison = {
  base: string;
  head: string;
  mergeBase: string | null;
  aheadCount: number;
  behindCount: number;
  aheadCommits: string[];
  behindCommits: string[];
  files: GitChangedFile[];
};

export type DirectoryEntry = {
  name: string;
  path: string;
  isGitRepo: boolean;
};

export type FolderPlace = {
  label: string;
  path: string;
};

export type DirectoryListing = {
  /** Folder being shown; null means the Windows list of drives. */
  path: string | null;
  /** Folder one level up; "" means the Windows list of drives; null means there is nothing above. */
  parent: string | null;
  isGitRepo: boolean;
  entries: DirectoryEntry[];
  places: FolderPlace[];
  truncated: boolean;
};

export type IdentityValues = {
  name: string;
  email: string;
};

export type CommitIdentity = {
  global: IdentityValues;
  project: (IdentityValues & { path: string }) | null;
  effective: IdentityValues;
};

export type AppConfig = {
  /** Repository the server was launched for (CLI argument or working directory), if it is a Git repo. */
  defaultRepoPath: string | null;
  /** True when the server refuses every action that changes a repository. */
  readOnly: boolean;
};

export type GitActionResult = {
  ok: true;
  summary: string;
  command: string;
  hash?: string;
};
