import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { TERM_ORDER, TERMS, type TermKey } from "../lib/glossary";

type GuidePanelProps = {
  focusTerm: TermKey | null;
  canAct: boolean;
  onClose: () => void;
};

/** Side panel explaining how to read the map, plus the glossary of plain words and their git terms. */
export function GuidePanel({ focusTerm, canAct, onClose }: GuidePanelProps) {
  const focusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    focusRef.current?.scrollIntoView?.({ block: "center" });
  }, [focusTerm]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="guide" aria-label="Guide">
      <header className="guide-head">
        <h2>Guide</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close guide">
          <X size={16} />
        </button>
      </header>

      <div className="guide-scroll">
        <section>
          <h3>How to read the map</h3>
          <ol className="guide-steps">
            <li>
              <strong>Each row is a save point.</strong> Someone saved the project at that moment and left a note.
              The oldest is at the top; the newest is at the bottom.
            </li>
            <li>
              <strong>Each coloured line is a line of work.</strong> When a line splits off, someone started
              working separately. When it runs back into another line, that work was joined in.
            </li>
            <li>
              <strong>&ldquo;You are here&rdquo; marks your files.</strong> The files in your folder match that save
              point, plus any unsaved edits shown on a dashed stub below it.
            </li>
            <li>
              <strong>Select any row</strong> to see who saved it, when, and exactly which files changed.
            </li>
          </ol>
        </section>

        <section>
          <h3>What you can do here</h3>
          {canAct ? (
            <p>
              Looking around never changes anything. The only things that change your project are the buttons for
              including files, saving a save point, switching lines, and starting a new line. Each one first tells
              you what will happen and which git command it stands for. Nothing here uploads, deletes, or rewrites
              history.
            </p>
          ) : (
            <p>Visual Git was started in read-only mode, so nothing on this screen can change your project.</p>
          )}
        </section>

        <section>
          <h3>Words you will see</h3>
          <dl className="glossary">
            {TERM_ORDER.map((key) => {
              const term = TERMS[key];
              const focused = key === focusTerm;
              return (
                <div key={key} ref={focused ? focusRef : undefined} className={`glossary-entry ${focused ? "focused" : ""}`}>
                  <dt>
                    {term.plain} <span className="glossary-git">{term.git}</span>
                  </dt>
                  <dd>{term.meaning}</dd>
                </div>
              );
            })}
          </dl>
        </section>

        <section>
          <h3>Keyboard</h3>
          <ul className="guide-keys">
            <li>
              <kbd>↓</kbd> <kbd>↑</kbd> or <kbd>j</kbd> <kbd>k</kbd> move between save points
            </li>
            <li>
              <kbd>p</kbd> jump to the save point this one was built on
            </li>
            <li>
              <kbd>/</kbd> search, <kbd>d</kbd> switch row spacing, <kbd>Esc</kbd> close
            </li>
          </ul>
        </section>
      </div>
    </aside>
  );
}
