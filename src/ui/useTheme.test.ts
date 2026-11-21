import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTheme } from "./useTheme";

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to the transit map and applies data-theme to <html>", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("transit");
    expect(document.documentElement.getAttribute("data-theme")).toBe("transit");
  });

  it("persists the chosen theme to localStorage", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme("logbook"));
    expect(localStorage.getItem("visual-git-theme")).toBe("logbook");
    expect(document.documentElement.getAttribute("data-theme")).toBe("logbook");
  });

  it("restores a stored theme on init", () => {
    localStorage.setItem("visual-git-theme", "blueprint");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("blueprint");
  });

  it("maps the old light and dark settings onto the new themes", () => {
    localStorage.setItem("visual-git-theme", "dark");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("blueprint");
  });
});
