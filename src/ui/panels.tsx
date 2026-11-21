import { useEffect, useState } from "react";
import { ArrowLeftRight, Check, ChevronRight, Cloud, Copy, Loader2, Minus, Plus, Tag } from "lucide-react";
import { plural, relativeTime } from "../lib/glossary";
import { sortRefsForDisplay, tagKey, type ResolvedRefs } from "../lib/refs";
import type {
  GitActionResult,
  GitBranchComparison,
  GitChangedFile,
  GitChangeStatus,
  GitCommitDetails,
  GitDiagram,
  GitDiagramNode,
  GitRepositorySnapshot
} from "../lib/types";
import { ConfirmAction } from "./ConfirmAction";
import { Term } from "./Term";

/** Runs an action, then refreshes the project. Rejects with a plain-language message on failure. */
export type RunAction = (run: () => Promise<GitActionResult>) => Promise<void>;

export type ActionApi = {
  stage: (files: string[]) => Promise<GitActionResult>;
  unstage: (files: string[]) => Promise<GitActionResult>;
  commit: (message: string) => Promise<GitActionResult>;
  switchTo: (branch: string) => Promise<GitActionResult>;
  createBranch: (name: string, startPoint?: string) => Promise<GitActionResult>;
};

const CHANGE_WORD: Record<GitChangeStatus, string> = {
  A: "added",
  M: "edited",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type changed",
  U: "conflict",
  X: "changed"
};

function porcelainWord(code: string): string {
  switch (code) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "U":
      return "conflict";
    case "?":
      return "new";
    default:
      return "edited";
  }
}

function fileName(path: string): { dir: string; name: string } {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const slash = trimmed.lastIndexOf("/");
  return slash < 0 ? { dir: "", name: path } : { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}

function FilePath({ path }: { path: string }) {
  const { dir, name } = fileName(path);
  return (
    <span className="file-path" title={path}>
      {dir && <span className="file-dir">{dir}</span>}
      <span className="file-name">{name}</span>
    </span>
  );
}

/** Files changed by a commit or between two branches. Selecting one opens its diff. */
export function ChangedFileList({ files, onOpen }: { files: GitChangedFile[]; onOpen: (file: GitChangedFile) => void }) {
  return (
    <ul className="file-list">
      {files.map((file) => (
        <li key={`${file.status}-${file.path}`}>
          <button
            type="button"
            className="file-row"
            onClick={() => onOpen(file)}
            title={file.oldPath ? `${file.oldPath} → ${file.path}` : `See what changed in ${file.path}`}
          >
            <span className={`change-word status-${file.status}`}>{CHANGE_WORD[file.status]}</span>
            <FilePath path={file.path} />
            <span className="file-stats">
              {file.additions !== null && <span className="stat-add">+{file.additions}</span>}
              {file.deletions !== null && <span className="stat-del">−{file.deletions}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ Branches */

type BranchesPanelProps = {
  refs: ResolvedRefs;
  diagram: GitDiagram;
  snapshot: GitRepositorySnapshot;
  tracedLane: string | null;
  onTrace: (lane: string | null) => void;
  onJump: (hash: string) => void;
  canAct: boolean;
  runAction: RunAction;
  api: ActionApi;
};

export function BranchesPanel({ refs, diagram, snapshot, tracedLane, onTrace, onJump, canAct, runAction, api }: BranchesPanelProps) {
  const [confirmSwitch, setConfirmSwitch] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [confirmCreate, setConfirmCreate] = useState(false);

  const laneByName = new Map(diagram.lanes.map((lane) => [lane.name, lane]));
  const nodeByHash = new Map(diagram.nodes.map((node) => [node.hash, node]));
  const colorOf = (name: string, hash: string | undefined) =>
    laneByName.get(name)?.colorIndex ?? (hash ? nodeByHash.get(hash)?.colorIndex : undefined) ?? 0;
  const dirty = !snapshot.status.clean;
  const cleanName = newName.trim();

  if (refs.local.length === 0 && refs.remote.length === 0 && refs.tags.length === 0) {
    return <p className="empty-note">This project has no named lines of work yet. They appear here after the first save point.</p>;
  }

  return (
    <div className="panel">
      <section className="panel-section">
        <h3 className="panel-heading">
          <Term k="branch">Lines of work</Term>
        </h3>
        <p className="panel-help">Select a line to jump to its newest save point and follow it on the map.</p>
        <ul className="line-list">
          {refs.local.map((branch) => {
            const hash = refs.refToHash.get(branch);
            const isCurrent = branch === refs.currentBranch;
            const isTraced = tracedLane === branch;
            const hasLane = laneByName.has(branch);
            return (
              <li key={branch} className={isCurrent ? "is-current" : ""}>
                <div className="line-row">
                  <button
                    type="button"
                    className={`line-btn ${isTraced ? "is-traced" : ""}`}
                    aria-label={branch}
                    aria-pressed={hasLane ? isTraced : undefined}
                    disabled={!hash}
                    title={isTraced ? `Stop following ${branch}` : `Jump to ${branch}`}
                    onClick={() => {
                      if (hash) onJump(hash);
                      if (hasLane) onTrace(isTraced ? null : branch);
                    }}
                  >
                    <i className={`line-bullet lane-c${colorOf(branch, hash)}`} aria-hidden="true" />
                    <span className="line-name">{branch}</span>
                    {isCurrent && <span className="here-flag">You are here</span>}
                  </button>
                  {canAct && !isCurrent && (
                    <button
                      type="button"
                      className="btn small"
                      aria-label={`Switch to ${branch}`}
                      onClick={() => setConfirmSwitch(confirmSwitch === branch ? null : branch)}
                    >
                      Switch
                    </button>
                  )}
                </div>
                {confirmSwitch === branch && (
                  <ConfirmAction
                    title={`Switch to ${branch}?`}
                    command={`git switch ${branch}`}
                    confirmLabel={`Switch to ${branch}`}
                    onCancel={() => setConfirmSwitch(null)}
                    onConfirm={async () => {
                      await runAction(() => api.switchTo(branch));
                      setConfirmSwitch(null);
                    }}
                  >
                    <p>The files in your folder will change to match the newest save point on {branch}.</p>
                    <p>
                      {dirty
                        ? `Your ${plural(snapshot.status.files.length, "unsaved file")} will come along. If they would be overwritten, git refuses and nothing changes.`
                        : "You have no unsaved edits, so nothing can be lost. You can switch back any time."}
                    </p>
                  </ConfirmAction>
                )}
              </li>
            );
          })}
        </ul>

        {canAct && (
          <form
            className="new-line"
            onSubmit={(event) => {
              event.preventDefault();
              if (cleanName) setConfirmCreate(true);
            }}
          >
            <label htmlFor="new-line-name" className="field-label">
              Start a new line of work
            </label>
            <div className="inline-field">
              <input
                id="new-line-name"
                value={newName}
                onChange={(event) => {
                  setNewName(event.target.value.replace(/\s+/g, "-"));
                  setConfirmCreate(false);
                }}
                placeholder="try-new-idea"
                spellCheck={false}
                autoComplete="off"
              />
              <button type="submit" className="btn" disabled={!cleanName}>
                <Plus size={13} aria-hidden="true" />
                <span>Create</span>
              </button>
            </div>
            {confirmCreate && cleanName && (
              <ConfirmAction
                title={`Create ${cleanName}?`}
                command={`git switch -c ${cleanName}`}
                confirmLabel="Create and switch"
                onCancel={() => setConfirmCreate(false)}
                onConfirm={async () => {
                  await runAction(() => api.createBranch(cleanName));
                  setConfirmCreate(false);
                  setNewName("");
                }}
              >
                <p>
                  A new line named {cleanName} starts from where you are now, and you move onto it. Existing lines
                  and your files stay exactly as they are.
                </p>
              </ConfirmAction>
            )}
          </form>
        )}
      </section>

      {refs.remote.length > 0 && (
        <section className="panel-section">
          <h3 className="panel-heading">
            <Term k="remote">Online copies</Term>
          </h3>
          <p className="panel-help">Where each line stood the last time this computer synced.</p>
          <ul className="line-list">
            {refs.remote.map((branch) => {
              const hash = refs.refToHash.get(branch);
              return (
                <li key={branch}>
                  <button type="button" className="line-btn" aria-label={branch} disabled={!hash} onClick={() => hash && onJump(hash)}>
                    <Cloud size={13} aria-hidden="true" />
                    <span className="line-name">{branch}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {refs.tags.length > 0 && (
        <section className="panel-section">
          <h3 className="panel-heading">
            <Term k="tag">Milestones</Term>
          </h3>
          <ul className="line-list">
            {refs.tags.map((tag) => {
              const hash = refs.refToHash.get(tagKey(tag));
              return (
                <li key={tag}>
                  <button type="button" className="line-btn" aria-label={tag} disabled={!hash} onClick={() => hash && onJump(hash)}>
                    <Tag size={13} aria-hidden="true" />
                    <span className="line-name">{tag}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- Changes */

type ChangesPanelProps = {
  snapshot: GitRepositorySnapshot;
  onOpenFile: (path: string) => void;
  canAct: boolean;
  runAction: RunAction;
  api: ActionApi;
  /** Name and email git will put on the save; null while unknown. */
  signedAs?: { name: string; email: string } | null;
  onOpenSettings?: () => void;
};

export function ChangesPanel({ snapshot, onOpenFile, canAct, runAction, api, signedAs = null, onOpenSettings }: ChangesPanelProps) {
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [error, setError] = useState("");

  const files = snapshot.status.files;
  const staged = files.filter((file) => file.index !== " " && file.index !== "?");
  const unstaged = files.filter((file) => file.workingTree !== " " && file.workingTree !== "?");
  const untracked = files.filter((file) => file.index === "?" && file.workingTree === "?");
  const detached = snapshot.currentBranch === "(detached)";
  const where = detached ? "this old save point" : snapshot.currentBranch;
  const missingIdentity = signedAs !== null && (!signedAs.name || !signedAs.email);

  useEffect(() => {
    if (staged.length === 0) setConfirming(false);
  }, [staged.length]);

  async function quick(key: string, run: () => Promise<GitActionResult>) {
    setBusyFile(key);
    setError("");
    try {
      await runAction(run);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Git could not do that.");
    } finally {
      setBusyFile(null);
    }
  }

  if (snapshot.status.clean) {
    return (
      <div className="panel">
        <div className="all-saved">
          <Check size={20} aria-hidden="true" />
          <p className="all-saved-title">Everything is saved</p>
          <p>Your files match the newest save point on {where}. Edit a file and it will show up here.</p>
        </div>
      </div>
    );
  }

  const group = (
    key: "staged" | "unstaged" | "untracked",
    heading: React.ReactNode,
    help: string,
    list: typeof files,
    word: (file: (typeof files)[number]) => string,
    include: boolean
  ) =>
    list.length > 0 && (
      <section className={`panel-section change-group group-${key}`}>
        <div className="panel-heading-row">
          <h3 className="panel-heading">
            {heading} <span className="count">{list.length}</span>
          </h3>
          {canAct && list.length > 1 && (
            <button
              type="button"
              className="btn small"
              disabled={busyFile !== null}
              onClick={() =>
                void quick(`all-${key}`, () => (include ? api.stage(list.map((f) => f.path)) : api.unstage(list.map((f) => f.path))))
              }
            >
              {include ? "Include all" : "Leave all out"}
            </button>
          )}
        </div>
        <p className="panel-help">{help}</p>
        <ul className="file-list">
          {list.map((file) => (
            <li key={`${key}-${file.path}`} className="file-row-wrap">
              <button type="button" className="file-row" onClick={() => onOpenFile(file.path)} title={`See what changed in ${file.path}`}>
                <span className={`change-word word-${word(file).replace(" ", "-")}`}>{word(file)}</span>
                <FilePath path={file.path} />
              </button>
              {canAct && (
                <button
                  type="button"
                  className="icon-btn bordered"
                  disabled={busyFile !== null}
                  aria-label={include ? `Include ${file.path} in the next save point` : `Leave ${file.path} out of the next save point`}
                  title={include ? "Include in the next save point (git add)" : "Leave out of the next save point (git restore --staged)"}
                  onClick={() => void quick(file.path, () => (include ? api.stage([file.path]) : api.unstage([file.path])))}
                >
                  {busyFile === file.path ? <Loader2 size={13} className="spin" /> : include ? <Plus size={13} /> : <Minus size={13} />}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div className="panel">
      <p className="panel-lede">
        <Term k="workingTree">Your files right now</Term> differ from the last save point in {plural(files.length, "file")}.
        {canAct ? " Pick what to include, then save." : ""}
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}

      {group(
        "staged",
        <Term k="staged">Ready to save</Term>,
        "These go into your next save point.",
        staged,
        (file) => porcelainWord(file.index),
        false
      )}
      {group(
        "unstaged",
        <Term k="unstaged">Not included yet</Term>,
        "Edited on disk, but left out of the next save point for now.",
        unstaged,
        (file) => porcelainWord(file.workingTree),
        true
      )}
      {group(
        "untracked",
        <Term k="untracked">New files</Term>,
        "Git has never saved these. Include them to start keeping their history.",
        untracked,
        () => "new",
        true
      )}

      {canAct && (
        <section className="panel-section save-box">
          <h3 className="panel-heading">
            <Term k="commit">Make a save point</Term>
          </h3>
          <label htmlFor="commit-message" className="field-label">
            What did you change?
          </label>
          <textarea
            id="commit-message"
            rows={3}
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              setConfirming(false);
            }}
            placeholder="Fix the typo on the pricing page"
          />
          {missingIdentity ? (
            <div className="signed-as missing" role="note">
              <p>Git needs your name and email before it can save.</p>
              {onOpenSettings && (
                <button type="button" className="btn small" onClick={onOpenSettings}>
                  Add my name
                </button>
              )}
            </div>
          ) : signedAs ? (
            <p className="signed-as">
              <span>
                Signed as <strong>{signedAs.name}</strong>
              </span>
              {onOpenSettings && (
                <button type="button" className="link-btn" onClick={onOpenSettings}>
                  Change
                </button>
              )}
            </p>
          ) : null}
          {staged.length === 0 ? (
            <p className="panel-help">Include at least one file above before saving.</p>
          ) : !message.trim() ? (
            <p className="panel-help">A short note helps you find this save point later.</p>
          ) : null}
          {!confirming && (
            <button
              type="button"
              className="btn primary"
              disabled={staged.length === 0 || !message.trim() || missingIdentity}
              onClick={() => setConfirming(true)}
            >
              {staged.length > 0 ? `Save ${plural(staged.length, "file")}…` : "Save…"}
            </button>
          )}
          {confirming && (
            <ConfirmAction
              title={`Save ${plural(staged.length, "file")} to ${where}?`}
              command={`git commit -m "${message.trim().split("\n")[0]}"`}
              confirmLabel="Save now"
              onCancel={() => setConfirming(false)}
              onConfirm={async () => {
                await runAction(() => api.commit(message));
                setConfirming(false);
                setMessage("");
              }}
            >
              <p>
                A new save point is added after &ldquo;You are here&rdquo; containing only the files under Ready to
                save. Files left out keep their edits and stay in this list.
              </p>
              <p>
                It is stored on this computer only. Nothing is uploaded.
                {detached ? " You are visiting an old save point, so switch to a line of work first or this save will be hard to find." : ""}
              </p>
            </ConfirmAction>
          )}
        </section>
      )}
    </div>
  );
}

/** The longer part of a save point's note: plain text, folded when long instead of a tiny scroll box. */
function CommitNote({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = body.split("\n").length > 6 || body.length > 420;
  return (
    <div className="inspector-message">
      <p id="inspector-note-text" className={`inspector-body ${long && !expanded ? "folded" : ""}`}>
        {body}
      </p>
      {long && (
        <button type="button" className="link-btn" aria-expanded={expanded} aria-controls="inspector-note-text" onClick={() => setExpanded((prev) => !prev)}>
          {expanded ? "Show less" : "Show the whole note"}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- Compare */

type ComparePanelProps = {
  branches: string[];
  base: string;
  head: string;
  onBase: (value: string) => void;
  onHead: (value: string) => void;
  loading: boolean;
  error: string;
  comparison: GitBranchComparison | null;
  highlight: boolean;
  onHighlight: (value: boolean) => void;
  onJump: (hash: string) => void;
  onOpenFile: (file: GitChangedFile) => void;
};

function compareSentence(c: GitBranchComparison): string {
  if (c.aheadCount === 0 && c.behindCount === 0) return `${c.head} and ${c.base} are identical.`;
  if (c.behindCount === 0) return `${c.head} has ${plural(c.aheadCount, "save point")} that ${c.base} does not have yet.`;
  if (c.aheadCount === 0) return `${c.head} is missing ${plural(c.behindCount, "save point")} that ${c.base} has.`;
  return `They went separate ways: ${c.head} has ${c.aheadCount} of its own, and ${c.base} has ${c.behindCount} that ${c.head} is missing.`;
}

export function ComparePanel(props: ComparePanelProps) {
  const { branches, base, head, comparison } = props;
  if (branches.length < 2) {
    return <p className="empty-note">Comparing needs at least two lines of work. This project has one.</p>;
  }
  return (
    <div className="panel">
      <p className="panel-lede">See what one line of work has that another does not.</p>
      <div className="compare-pick">
        <label>
          <span className="field-label">Start from</span>
          <select value={base} onChange={(event) => props.onBase(event.target.value)}>
            {branches.map((branch) => (
              <option key={branch}>{branch}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="icon-btn bordered"
          aria-label="Swap the two lines"
          title="Swap the two lines"
          onClick={() => {
            props.onBase(head);
            props.onHead(base);
          }}
        >
          <ArrowLeftRight size={14} />
        </button>
        <label>
          <span className="field-label">Compare with</span>
          <select value={head} onChange={(event) => props.onHead(event.target.value)}>
            {branches.map((branch) => (
              <option key={branch}>{branch}</option>
            ))}
          </select>
        </label>
      </div>

      {props.loading ? (
        <p className="loading-note">
          <Loader2 size={14} className="spin" /> Comparing…
        </p>
      ) : props.error ? (
        <p className="inline-error" role="alert">
          {props.error}
        </p>
      ) : comparison ? (
        <>
          <p className="compare-sentence">{compareSentence(comparison)}</p>
          <dl className="compare-counts">
            <div className="ahead">
              <dt>Only on {comparison.head}</dt>
              <dd>{comparison.aheadCount}</dd>
            </div>
            <div className="behind">
              <dt>Only on {comparison.base}</dt>
              <dd>{comparison.behindCount}</dd>
            </div>
          </dl>
          <label className="check-row">
            <input type="checkbox" checked={props.highlight} onChange={(event) => props.onHighlight(event.target.checked)} />
            <span>Highlight these save points on the map</span>
          </label>
          {comparison.mergeBase && (
            <p className="split-point">
              <Term k="mergeBase" />{" "}
              <button type="button" className="link-btn mono" onClick={() => props.onJump(comparison.mergeBase!)}>
                {comparison.mergeBase.slice(0, 7)}
                <ChevronRight size={12} aria-hidden="true" />
              </button>
            </p>
          )}
          <section className="panel-section">
            <h3 className="panel-heading">
              <Term k="diff">Files that differ</Term> <span className="count">{comparison.files.length}</span>
            </h3>
            {comparison.files.length === 0 ? (
              <p className="panel-help">No files differ between these two lines.</p>
            ) : (
              <ChangedFileList files={comparison.files} onOpen={props.onOpenFile} />
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------- Project */

export function ProjectPanel({ snapshot, laneCount, canAct }: { snapshot: GitRepositorySnapshot; laneCount: number; canAct: boolean }) {
  return (
    <div className="panel">
      <dl className="facts">
        <div>
          <dt>
            <Term k="repository" />
          </dt>
          <dd>{snapshot.name}</dd>
        </div>
        <div>
          <dt>Folder</dt>
          <dd className="mono wrap">{snapshot.path}</dd>
        </div>
        <div>
          <dt>Main line</dt>
          <dd className="mono">{snapshot.defaultBranch}</dd>
        </div>
        <div>
          <dt>History shown</dt>
          <dd>
            {plural(snapshot.commits.length, "save point")}
            {snapshot.truncated ? " (older ones not loaded yet)" : ""} across {plural(laneCount, "line")}
          </dd>
        </div>
        <div>
          <dt>
            <Term k="remote">Online copies</Term>
          </dt>
          <dd>{snapshot.remotes.length > 0 ? snapshot.remotes.join(", ") : "None. This project lives only on this computer."}</dd>
        </div>
        <div>
          <dt>Changing things</dt>
          <dd>
            {canAct
              ? "Only when you confirm an action: including files, saving, switching or creating a line."
              : "Off. Visual Git was started in read-only mode."}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/* ----------------------------------------------------------------- Inspector */

type InspectorProps = {
  commit: GitDiagramNode | null;
  isHead: boolean;
  details: GitCommitDetails | null;
  detailsLoading: boolean;
  detailsError: string;
  onJump: (hash: string) => void;
  onOpenFile: (file: GitChangedFile) => void;
  canAct: boolean;
  runAction: RunAction;
  api: ActionApi;
};

function fullDate(value: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function Inspector({ commit, isHead, details, detailsLoading, detailsError, onJump, onOpenFile, canAct, runAction, api }: InspectorProps) {
  const [copied, setCopied] = useState(false);
  const [branching, setBranching] = useState(false);
  const [branchName, setBranchName] = useState("");

  useEffect(() => {
    setBranching(false);
    setBranchName("");
    setCopied(false);
  }, [commit?.hash]);

  if (!commit) {
    return (
      <aside className="inspector" aria-label="Selected save point">
        <p className="empty-note">Select a row on the map to see who saved it, when, and what changed.</p>
      </aside>
    );
  }

  const isMerge = commit.parents.length > 1;
  const refs = sortRefsForDisplay(commit.refs).filter((ref) => ref.kind !== "head");
  const cleanName = branchName.trim();

  return (
    <aside className="inspector" aria-label="Selected save point">
      <p className="inspector-kicker">
        <Term k={isMerge ? "merge" : "commit"} />
        {isHead && <span className="here-flag">You are here</span>}
      </p>
      <h2 className="inspector-subject">{commit.subject || "(no description)"}</h2>
      {commit.body && <CommitNote key={commit.hash} body={commit.body} />}

      <p className="inspector-who">
        <strong>{commit.authorName}</strong> saved this {relativeTime(commit.date)}
        <span className="inspector-date">{fullDate(commit.date)}</span>
      </p>

      {isMerge && <p className="inspector-note">This save point joins two lines of work into one.</p>}

      <dl className="facts">
        <div>
          <dt>
            <Term k="hash" />
          </dt>
          <dd className="hash-row">
            <span className="mono">{commit.shortHash}</span>
            <button
              type="button"
              className="link-btn"
              title={commit.hash}
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(commit.hash)
                  .then(() => setCopied(true))
                  .catch(() => undefined);
              }}
            >
              {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
              {copied ? "Copied" : "Copy full ID"}
            </button>
          </dd>
        </div>
        <div>
          <dt>
            <Term k="parent" />
          </dt>
          <dd>
            {commit.parents.length === 0 ? (
              "Nothing. This is the very first save point."
            ) : (
              <span className="parent-links">
                {commit.parents.map((parent, index) => (
                  <button key={parent} type="button" className="link-btn mono" onClick={() => onJump(parent)} title="Jump to this earlier save point">
                    {isMerge && <span className="parent-role">{index === 0 ? "this line" : "joined in"}</span>}
                    {parent.slice(0, 7)}
                    <ChevronRight size={12} aria-hidden="true" />
                  </button>
                ))}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>On line</dt>
          <dd>
            <i className={`lane-dot lane-c${commit.colorIndex}`} aria-hidden="true" /> {commit.laneName}
          </dd>
        </div>
        {refs.length > 0 && (
          <div>
            <dt>Names pointing here</dt>
            <dd className="name-list">
              {refs.map((ref) => (
                <span key={`${ref.kind}-${ref.name}`} className={`ref-badge ref-${ref.kind}`}>
                  {ref.name}
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>

      {canAct && (
        <div className="inspector-action">
          {!branching ? (
            <button type="button" className="btn" onClick={() => setBranching(true)}>
              <Plus size={13} aria-hidden="true" />
              <span>Start a new line of work here</span>
            </button>
          ) : (
            <>
              <label htmlFor="branch-here-name" className="field-label">
                Name for the new line
              </label>
              <input
                id="branch-here-name"
                value={branchName}
                onChange={(event) => setBranchName(event.target.value.replace(/\s+/g, "-"))}
                placeholder="try-new-idea"
                spellCheck={false}
                autoComplete="off"
                autoFocus
              />
              <ConfirmAction
                title={cleanName ? `Start ${cleanName} from this save point?` : "Start a new line from this save point?"}
                command={`git switch -c ${cleanName || "<name>"} ${commit.shortHash}`}
                confirmLabel="Create and switch"
                onCancel={() => setBranching(false)}
                onConfirm={async () => {
                  if (!cleanName) throw new Error("Give the new line a name first.");
                  await runAction(() => api.createBranch(cleanName, commit.hash));
                  setBranching(false);
                }}
              >
                <p>
                  Your files change to match this save point and you continue from here on a new line. No existing
                  line is altered. If you have unsaved edits that would be overwritten, git refuses and nothing changes.
                </p>
              </ConfirmAction>
            </>
          )}
        </div>
      )}

      <section className="inspector-files">
        <h3 className="panel-heading">
          <Term k="diff">What changed</Term> {details && <span className="count">{details.files.length}</span>}
        </h3>
        {detailsLoading ? (
          <p className="loading-note">
            <Loader2 size={14} className="spin" /> Loading files…
          </p>
        ) : detailsError ? (
          <p className="inline-error" role="alert">
            {detailsError}
          </p>
        ) : details && details.files.length === 0 ? (
          <p className="panel-help">No files changed in this save point.</p>
        ) : details ? (
          <>
            <p className="panel-help">Select a file to see the exact lines.</p>
            <ChangedFileList files={details.files} onOpen={onOpenFile} />
          </>
        ) : null}
      </section>
    </aside>
  );
}
