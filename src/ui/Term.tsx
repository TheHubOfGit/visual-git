import { createContext, useContext } from "react";
import { TERMS, type TermKey } from "../lib/glossary";

/** Opens the guide, optionally scrolled to one glossary entry. */
export const GuideContext = createContext<(key?: TermKey) => void>(() => {});

type TermProps = {
  k: TermKey;
  /** Override the plain wording (for plurals or mid-sentence use). */
  children?: React.ReactNode;
};

/**
 * Plain wording first, git's own term beside it. The git term is a button
 * that opens its glossary entry. Never place a Term inside another button.
 */
export function Term({ k, children }: TermProps) {
  const openGuide = useContext(GuideContext);
  const term = TERMS[k];
  return (
    <span className="term">
      {children ?? term.plain}{" "}
      <button
        type="button"
        className="term-git"
        title={term.meaning}
        aria-label={`What does ${term.git} mean?`}
        onClick={(event) => {
          event.stopPropagation();
          openGuide(k);
        }}
      >
        ({term.git})
      </button>
    </span>
  );
}
