import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "visual-git-theme";

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

function systemPreference(): Theme {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

/** Light-first initial theme: stored choice wins, otherwise system, otherwise light. */
function initialTheme(): Theme {
  return readStoredTheme() ?? systemPreference();
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/**
 * Theme state persisted to localStorage and reflected on <html data-theme>.
 * Initialized synchronously to avoid a flash of the wrong theme.
 */
export function useTheme(): { theme: Theme; toggleTheme: () => void; setTheme: (theme: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(() => {
    const initial = initialTheme();
    // Apply during first render so the very first paint is correct.
    if (typeof document !== "undefined") {
      applyTheme(initial);
    }
    return initial;
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore storage failures (e.g. privacy mode); the in-memory state still works.
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggleTheme = useCallback(() => setThemeState((prev) => (prev === "light" ? "dark" : "light")), []);

  return { theme, toggleTheme, setTheme };
}
