import type { GitChangedFile, GitChangeStatus, GitCommit, GitRef } from "./types";

const FIELD_SEPARATOR = "\u001f";
const RECORD_SEPARATOR = "\u001e";

/**
 * `git log --pretty=format:` string. Must be paired with `--decorate=full` so
 * `%D` yields fully-qualified ref names that can be classified exactly.
 */
export const gitLogFormat = [
  "%H",
  "%P",
  "%an",
  "%ae",
  "%aI",
  "%cI",
  "%D",
  "%s",
  `%b${RECORD_SEPARATOR}`
].join(FIELD_SEPARATOR);

const HEAD_ARROW = "HEAD -> ";

/** Parse one `%D` entry (with `--decorate=full`) into a structured ref. */
export function parseDecoration(entry: string): GitRef | null {
  let raw = entry.trim();
  if (!raw) return null;
  if (raw === "HEAD") return { kind: "head", name: "HEAD" };

  let isCurrent = false;
  if (raw.startsWith(HEAD_ARROW)) {
    isCurrent = true;
    raw = raw.slice(HEAD_ARROW.length).trim();
  }

  if (raw.startsWith("tag: ")) raw = raw.slice("tag: ".length).trim();

  if (raw.startsWith("refs/heads/")) {
    return { kind: "local", name: raw.slice("refs/heads/".length), isCurrent };
  }
  if (raw.startsWith("refs/tags/")) {
    return { kind: "tag", name: raw.slice("refs/tags/".length) };
  }
  if (raw.startsWith("refs/remotes/")) {
    const name = raw.slice("refs/remotes/".length);
    const slash = name.indexOf("/");
    if (slash <= 0) return null;
    const remote = name.slice(0, slash);
    const branch = name.slice(slash + 1);
    // `origin/HEAD` is a symbolic pointer, not a branch of its own.
    if (branch === "HEAD") return null;
    return { kind: "remote", name, remote, branch };
  }
  // refs/stash, refs/notes, tool-private refs, …: not part of the branch picture.
  return null;
}

export function parseGitLog(rawLog: string): GitCommit[] {
  return rawLog
    .split(RECORD_SEPARATOR)
    .map((record) => record.replace(/^\n+/, "").trimEnd())
    .filter(Boolean)
    .map((record) => {
      const [
        hash = "",
        parents = "",
        authorName = "",
        authorEmail = "",
        date = "",
        committerDate = "",
        decoration = "",
        subject = "",
        ...bodyParts
      ] = record.split(FIELD_SEPARATOR);

      return {
        hash,
        shortHash: hash.slice(0, 7),
        parents: parents ? parents.split(" ").filter(Boolean) : [],
        authorName,
        authorEmail,
        date,
        committerDate: committerDate || date,
        refs: decoration
          ? decoration
              .split(",")
              .map(parseDecoration)
              .filter((ref): ref is GitRef => ref !== null)
          : [],
        subject,
        body: bodyParts.join(FIELD_SEPARATOR).trim()
      };
    });
}

const KNOWN_STATUSES = new Set<GitChangeStatus>(["A", "M", "D", "R", "C", "T", "U", "X"]);

/**
 * Combine `git diff-tree -r -M -z --name-status` and `--numstat` output for the
 * same diff into one list of changed files.
 */
export function parseChangedFiles(nameStatusRaw: string, numstatRaw: string): GitChangedFile[] {
  const files: GitChangedFile[] = [];
  const statusTokens = nameStatusRaw.split("\0").filter((token) => token !== "");
  for (let i = 0; i < statusTokens.length; ) {
    const code = statusTokens[i++];
    const letter = (code[0] ?? "M") as GitChangeStatus;
    const status = KNOWN_STATUSES.has(letter) ? letter : "M";
    if (status === "R" || status === "C") {
      const oldPath = statusTokens[i++] ?? "";
      const path = statusTokens[i++] ?? "";
      files.push({ path, oldPath, status, additions: null, deletions: null });
    } else {
      files.push({ path: statusTokens[i++] ?? "", status, additions: null, deletions: null });
    }
  }

  // numstat -z: "add\tdel\tpath\0" or, for renames, "add\tdel\t\0old\0new\0".
  const counts = new Map<string, { additions: number | null; deletions: number | null }>();
  const numTokens = numstatRaw.split("\0");
  for (let i = 0; i < numTokens.length; i++) {
    const token = numTokens[i];
    if (!token) continue;
    const [add, del, inlinePath] = token.split("\t");
    if (del === undefined) continue;
    let path = inlinePath;
    if (!path) {
      i += 1; // old path
      path = numTokens[++i];
    }
    if (!path) continue;
    counts.set(path, {
      additions: add === "-" ? null : Number(add),
      deletions: del === "-" ? null : Number(del)
    });
  }

  return files.map((file) => ({ ...file, ...(counts.get(file.path) ?? {}) }));
}
