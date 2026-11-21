import { useState } from "react";
import { Loader2 } from "lucide-react";

type ConfirmActionProps = {
  title: string;
  /** What will happen, in plain words. */
  children: React.ReactNode;
  /** The command this is equivalent to, shown so people learn it. */
  command: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
};

/** Inline "here is exactly what will happen" step shown before any action that changes the repository. */
export function ConfirmAction({ title, children, command, confirmLabel, onConfirm, onCancel }: ConfirmActionProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Git could not do that.");
      setBusy(false);
    }
  }

  return (
    <div className="confirm" role="group" aria-label={title}>
      <p className="confirm-title">{title}</p>
      <div className="confirm-body">{children}</div>
      <p className="confirm-command">
        <span>Same as typing</span> <code>{command}</code>
      </p>
      {error && (
        <p className="confirm-error" role="alert">
          {error}
        </p>
      )}
      <div className="confirm-actions">
        <button type="button" className="btn primary" onClick={() => void handleConfirm()} disabled={busy}>
          {busy && <Loader2 size={14} className="spin" />}
          <span>{confirmLabel}</span>
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
