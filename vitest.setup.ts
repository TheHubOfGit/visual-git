import "@testing-library/jest-dom/vitest";

// Node 25 ships an experimental global `localStorage` that lacks `.clear()`
// unless `--localstorage-file` is passed, overriding jsdom's Storage. Provide a
// standard in-memory Storage implementation when `.clear` is missing.
if (typeof globalThis.localStorage === "undefined" || typeof globalThis.localStorage.clear !== "function") {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(String(key)) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(String(key));
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    }
  };

  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage,
    configurable: true,
    writable: true
  });
}
