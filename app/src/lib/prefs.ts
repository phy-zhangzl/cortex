/** Per-device UI preferences (theme, font size…). Data lives in SQLite; these are conveniences. */
export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`cortex:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref<T>(key: string, value: T) {
  try {
    localStorage.setItem(`cortex:${key}`, JSON.stringify(value));
  } catch {
    // ignore (private mode / storage disabled)
  }
}
