const PREFIX = 'mdverse:';

export const PREF_KEYS = {
  zoom: `${PREFIX}zoom`,
  split: `${PREFIX}split`,
  sync: `${PREFIX}sync`,
  activeTab: `${PREFIX}active-tab`,
  openDocuments: `${PREFIX}open-documents`,
  toc: `${PREFIX}toc`,
  documentContent: (id: string) => `${PREFIX}doc:${id}:content`,
  documentTitle: (id: string) => `${PREFIX}doc:${id}:title`,
} as const;

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode / quota) — preferences are best-effort */
  }
}

export function readNumberPref(key: string, fallback: number): number {
  const parsed = Number.parseFloat(readPref(key) ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readJsonPref<T>(key: string, fallback: T): T {
  const raw = readPref(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
