export type GitCommit = {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  date: string;
  refs: string[];
  subject: string;
  body: string;
};

export type GitGraphRow = GitCommit & {
  row: number;
  lane: number;
};

export type GitGraphEdge = {
  from: string;
  to: string;
  fromRow: number;
  toRow: number;
  fromLane: number;
  toLane: number;
};

export type GitGraph = {
  rows: GitGraphRow[];
  edges: GitGraphEdge[];
  lanes: number;
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
  head: string;
  remotes: string[];
  status: {
    clean: boolean;
    files: GitStatusFile[];
  };
  commits: GitCommit[];
};
