import { useCallback, useEffect, useState } from "react";

export type Theme = "transit" | "logbook" | "blueprint";

export const THEMES: Array<{ id: Theme; name: string; hint: string }> = [
  { id: "transit", name: "Transit map", hint: "Bold coloured lines, like a subway map" },
  { id: "logbook", name: "Logbook", hint: "A ruled ledger with dated entries" },
  { id: "blueprint", name: "Blueprint", hint: "A technical drawing on blue" }
];

const STORAGE_KEY = "visual-git-theme";
const LEGACY: Record<string, Theme> = { light: "transit", dark: "blueprint" };

function isTheme(value: string | null): value is Theme {
  return value === "transit" || value === "logbook" || value === "blueprint";
}

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isTheme(stored)) return stored;
    return stored ? LEGACY[stored] ?? null : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/**
 * Theme state persisted to localStorage and reflected on <html data-theme>.
 * Transit map is the default. Initialized synchronously to avoid a flash.
 */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(() => {
    const initial = readStoredTheme() ?? "transit";
    if (typeof document !== "undefined") applyTheme(initial);
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
  return { theme, setTheme };
}
