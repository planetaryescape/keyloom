// Per-browser conveniences (theme, the dismissed tip). Storage can be missing or throw (private
// windows, blocked site data), and nothing here may depend on it, so every access is guarded.
export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered; the page works the same without it.
  }
}
