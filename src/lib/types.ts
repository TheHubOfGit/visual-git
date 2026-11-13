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
  x: number;
  y: number;
};

export type GitDiagramLane = {
  name: string;
  column: number;
  x: number;
  width: number;
  /** Horizontal centre of the lane's rail, in diagram coordinates. */
  centerX: number;
};

export type GitDiagramEdge = {
  from: string;
  to: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  merge: boolean;
  column: number;
};

export type GitDiagram = {
  lanes: GitDiagramLane[];
  nodes: GitDiagramNode[];
  edges: GitDiagramEdge[];
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

export type AppConfig = {
  /** Repository the server was launched for (CLI argument or working directory), if it is a Git repo. */
  defaultRepoPath: string | null;
};
