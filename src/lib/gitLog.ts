import type { GitCommit } from "./types";

const FIELD_SEPARATOR = "\u001f";
const RECORD_SEPARATOR = "\u001e";

export const gitLogFormat =
  `%H${FIELD_SEPARATOR}%P${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ae${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%D${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%b${RECORD_SEPARATOR}`;

export function parseGitLog(rawLog: string): GitCommit[] {
  return rawLog
    .split(RECORD_SEPARATOR)
    .map((record) => record.replace(/^\n+/, "").trimEnd())
    .filter(Boolean)
    .map((record) => {
      const [hash = "", parents = "", authorName = "", authorEmail = "", date = "", decoration = "", subject = "", ...bodyParts] =
        record.split(FIELD_SEPARATOR);
      const body = bodyParts.join(FIELD_SEPARATOR).trim();

      return {
        hash,
        shortHash: hash.slice(0, 7),
        parents: parents ? parents.split(" ").filter(Boolean) : [],
        authorName,
        authorEmail,
        date,
        refs: decoration
          ? decoration
              .split(",")
              .map((ref) => ref.trim())
              .filter(Boolean)
          : [],
        subject,
        body
      };
    });
}
