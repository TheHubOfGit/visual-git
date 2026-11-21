/**
 * Plain-language vocabulary. The interface leads with the everyday word and
 * shows git's own term beside it, so people pick up the real vocabulary.
 */
export type TermKey =
  | "repository"
  | "commit"
  | "branch"
  | "head"
  | "merge"
  | "staged"
  | "unstaged"
  | "untracked"
  | "workingTree"
  | "remote"
  | "tag"
  | "hash"
  | "parent"
  | "mergeBase"
  | "diff"
  | "detached";

export type Term = { plain: string; git: string; meaning: string };

export const TERMS: Record<TermKey, Term> = {
  repository: {
    plain: "Project",
    git: "repository",
    meaning: "A folder whose history git is keeping. Everything on this screen comes from one repository."
  },
  commit: {
    plain: "Save point",
    git: "commit",
    meaning:
      "A snapshot of the whole project at one moment, with a note saying what changed. You can always go back to one."
  },
  branch: {
    plain: "Line of work",
    git: "branch",
    meaning:
      "A named series of save points. Branches let you try something on the side without disturbing the main line."
  },
  head: {
    plain: "You are here",
    git: "HEAD",
    meaning: "The save point your files on disk currently match. New save points get added right after it."
  },
  merge: {
    plain: "Joined lines",
    git: "merge",
    meaning: "A save point that brings the work from two lines together into one."
  },
  staged: {
    plain: "Ready to save",
    git: "staged",
    meaning: "Changes you have picked to go into the next save point. Nothing is saved until you commit."
  },
  unstaged: {
    plain: "Not included yet",
    git: "unstaged",
    meaning: "Files you edited that will be left out of the next save point unless you include them."
  },
  untracked: {
    plain: "New file",
    git: "untracked",
    meaning: "A file git has never saved before. Include it once and git will follow it from then on."
  },
  workingTree: {
    plain: "Your files right now",
    git: "working tree",
    meaning: "The files as they sit on your disk, including edits you have not saved into history yet."
  },
  remote: {
    plain: "Online copy",
    git: "remote",
    meaning: "Another copy of this project, usually on a service like GitHub, that you send work to and get work from."
  },
  tag: {
    plain: "Milestone",
    git: "tag",
    meaning: "A permanent name pinned to one save point, often used for releases such as v1.0."
  },
  hash: {
    plain: "ID",
    git: "hash",
    meaning: "The unique code git gives every save point. The first seven characters are usually enough to name it."
  },
  parent: {
    plain: "Built on",
    git: "parent",
    meaning: "The save point that came directly before this one."
  },
  mergeBase: {
    plain: "Where they split",
    git: "merge base",
    meaning: "The last save point two lines of work have in common, before they went separate ways."
  },
  diff: {
    plain: "What changed",
    git: "diff",
    meaning: "A line-by-line comparison: removed lines on one side, added lines on the other."
  },
  detached: {
    plain: "Visiting an old save point",
    git: "detached HEAD",
    meaning:
      "Your files match a past save point instead of the end of a line. Looking around is safe; switch to a branch before saving new work."
  }
};

export const TERM_ORDER: TermKey[] = [
  "repository",
  "commit",
  "branch",
  "head",
  "workingTree",
  "staged",
  "unstaged",
  "untracked",
  "merge",
  "parent",
  "mergeBase",
  "diff",
  "hash",
  "tag",
  "remote",
  "detached"
];

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60]
];

/** "3 days ago" style wording for a commit date. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const seconds = Math.round((then - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
