import { useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { clearProjectIdentity, loadIdentity, saveIdentity } from "../api";
import type { CommitIdentity } from "../lib/types";
import { THEMES, type Theme } from "./useTheme";

type SettingsPanelProps = {
  repoPath: string | null;
  projectName: string | null;
  readOnly: boolean;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  /** Called after the name or email changes so the rest of the app can refresh. */
  onIdentityChange: (identity: CommitIdentity) => void;
  onClose: () => void;
};

type Scope = "global" | "project";

function quote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

/** Settings: the name and email put on save points, and the look of the app. */
export function SettingsPanel({ repoPath, projectName, readOnly, theme, onTheme, onIdentityChange, onClose }: SettingsPanelProps) {
  const [identity, setIdentity] = useState<CommitIdentity | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [scope, setScope] = useState<Scope>("global");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ summary: string; command: string } | null>(null);

  const projectOverride = Boolean(identity?.project && (identity.project.name || identity.project.email));

  function fill(next: CommitIdentity, nextScope: Scope) {
    const source = nextScope === "project" && next.project ? next.project : next.global;
    setName(source.name || next.effective.name);
    setEmail(source.email || next.effective.email);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadIdentity(repoPath)
      .then((data) => {
        if (cancelled) return;
        setIdentity(data);
        const override = Boolean(data.project && (data.project.name || data.project.email));
        const initialScope: Scope = override ? "project" : "global";
        setScope(initialScope);
        fill(data, initialScope);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Unable to read your name and email."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const emailLooksRight = /^[^\s@<>]+@[^\s@<>]+$/.test(trimmedEmail);
  const flag = scope === "global" ? "--global " : "";
  const command = `git config ${flag}user.name ${quote(trimmedName || "Your Name")} && git config ${flag}user.email ${quote(trimmedEmail || "you@example.com")}`;
  const current = scope === "project" && identity?.project ? identity.project : identity?.global;
  const unchanged = Boolean(current && current.name === trimmedName && current.email === trimmedEmail);

  async function submit() {
    setSaving(true);
    setError("");
    setDone(null);
    try {
      const result = await saveIdentity({
        name: trimmedName,
        email: trimmedEmail,
        scope,
        path: repoPath ?? undefined
      });
      setIdentity(result.identity);
      onIdentityChange(result.identity);
      setDone({ summary: result.summary, command: result.command });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Git could not save your name and email.");
    } finally {
      setSaving(false);
    }
  }

  async function useEverywhereName() {
    if (!repoPath) return;
    setSaving(true);
    setError("");
    setDone(null);
    try {
      const result = await clearProjectIdentity(repoPath);
      setIdentity(result.identity);
      onIdentityChange(result.identity);
      setScope("global");
      fill(result.identity, "global");
      setDone({ summary: result.summary, command: result.command });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Git could not change that setting.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="guide settings" aria-label="Settings">
      <header className="guide-head">
        <h2>Settings</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings">
          <X size={16} />
        </button>
      </header>

      <div className="guide-scroll">
        <section aria-labelledby="identity-heading">
          <h3 id="identity-heading">Your name on save points</h3>
          <p>
            Every save point records who made it. Git needs a name and an email for that. They stay on this computer
            until you share the project with someone.
          </p>

          {loading ? (
            <p className="settings-loading">
              <Loader2 size={14} className="spin" aria-hidden="true" /> Reading your current settings…
            </p>
          ) : (
            <form
              className="settings-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!readOnly && trimmedName && emailLooksRight && !unchanged) void submit();
              }}
            >
              {identity && !identity.effective.name && !identity.effective.email && (
                <p className="settings-callout">Not set yet. Add them here before your first save.</p>
              )}

              <div>
                <label htmlFor="identity-name" className="field-label">
                  Name
                </label>
                <input
                  id="identity-name"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setDone(null);
                  }}
                  placeholder="Ada Lovelace"
                  autoComplete="name"
                  disabled={readOnly}
                  maxLength={100}
                />
              </div>

              <div>
                <label htmlFor="identity-email" className="field-label">
                  Email
                </label>
                <input
                  id="identity-email"
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setDone(null);
                  }}
                  placeholder="you@example.com"
                  autoComplete="email"
                  disabled={readOnly}
                  aria-invalid={trimmedEmail !== "" && !emailLooksRight}
                  aria-describedby="identity-email-help"
                  maxLength={200}
                />
                <p id="identity-email-help" className="field-help">
                  {trimmedEmail !== "" && !emailLooksRight
                    ? "That does not look like an email address yet."
                    : "If you use GitHub, use the same email as your GitHub account so your saves link to you."}
                </p>
              </div>

              <fieldset className="settings-scope" disabled={readOnly}>
                <legend className="field-label">Use this for</legend>
                <label className="settings-radio">
                  <input
                    type="radio"
                    name="identity-scope"
                    checked={scope === "global"}
                    onChange={() => {
                      setScope("global");
                      if (identity) fill(identity, "global");
                      setDone(null);
                    }}
                  />
                  <span>
                    <strong>Every project on this computer</strong>
                    <span className="settings-radio-hint">Most people want this.</span>
                  </span>
                </label>
                <label className={`settings-radio ${repoPath ? "" : "is-disabled"}`}>
                  <input
                    type="radio"
                    name="identity-scope"
                    checked={scope === "project"}
                    disabled={!repoPath}
                    onChange={() => {
                      setScope("project");
                      if (identity) fill(identity, "project");
                      setDone(null);
                    }}
                  />
                  <span>
                    <strong>Only {projectName ? `“${projectName}”` : "this project"}</strong>
                    <span className="settings-radio-hint">
                      {repoPath ? "Handy for a work project that needs your work email." : "Open a project first."}
                    </span>
                  </span>
                </label>
              </fieldset>

              {projectOverride && identity?.project && (
                <div className="settings-override">
                  <p>
                    This project has its own name: <strong>{identity.project.name || "(none)"}</strong>{" "}
                    {identity.project.email && <span className="settings-mono">&lt;{identity.project.email}&gt;</span>}
                  </p>
                  {!readOnly && (
                    <button type="button" className="btn small" disabled={saving} onClick={() => void useEverywhereName()}>
                      Use my everywhere name instead
                    </button>
                  )}
                </div>
              )}

              {readOnly ? (
                <p className="panel-help">Read-only mode is on, so these cannot be changed here.</p>
              ) : (
                <div className="settings-actions">
                  <button type="submit" className="btn primary" disabled={saving || !trimmedName || !emailLooksRight || unchanged}>
                    {saving && <Loader2 size={14} className="spin" aria-hidden="true" />}
                    <span>{unchanged ? "Saved" : "Save name and email"}</span>
                  </button>
                  <p className="confirm-command">
                    Same as typing <code>{command}</code>
                  </p>
                </div>
              )}

              {error && (
                <p className="settings-error" role="alert">
                  {error}
                </p>
              )}
              {done && (
                <p className="settings-done" role="status">
                  <Check size={14} aria-hidden="true" /> {done.summary}
                </p>
              )}
            </form>
          )}
        </section>

        <section aria-labelledby="look-heading">
          <h3 id="look-heading">Look</h3>
          <p>Three ways to draw the same map. Pick whichever is easiest for you to read.</p>
          <div className="settings-themes" role="radiogroup" aria-label="Look">
            {THEMES.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={theme === option.id}
                className={`settings-theme ${theme === option.id ? "active" : ""}`}
                onClick={() => onTheme(option.id)}
              >
                <i className={`theme-swatch swatch-${option.id}`} aria-hidden="true" />
                <span>
                  <strong>{option.name}</strong>
                  <span className="settings-radio-hint">{option.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
