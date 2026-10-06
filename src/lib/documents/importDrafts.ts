import { PREF_KEYS } from '../editor/prefs';
import { LEGACY_CONTENT_KEYS } from './migrate';
import { UNTITLED } from './store';
import type { OpenDocument } from './types';

/** The slice of `Storage` this module needs, so tests can pass a stub. */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocalDraft {
  readonly title: string;
  readonly content: string;
}

export interface ImportSummary {
  readonly created: number;
  readonly failed: number;
}

function readOpenDocuments(storage: DraftStorage): OpenDocument[] {
  const raw = storage.getItem(PREF_KEYS.openDocuments);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (doc): doc is OpenDocument =>
        typeof doc === 'object' &&
        doc !== null &&
        typeof (doc as OpenDocument).id === 'string' &&
        typeof (doc as OpenDocument).title === 'string' &&
        typeof (doc as OpenDocument).content === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * The panels the original static viewer left behind.
 *
 * Read straight from the keys instead of through `migrateLegacyDocuments`: that
 * helper marks them as consumed, and counting the drafts must not spend them.
 * The import itself removes them once it has succeeded.
 */
function legacyDrafts(storage: DraftStorage): LocalDraft[] {
  return LEGACY_CONTENT_KEYS.flatMap((key) => {
    const content = storage.getItem(key);
    return content && content.trim().length > 0 ? [{ title: UNTITLED, content }] : [];
  });
}

export function collectLocalDrafts(storage: DraftStorage): LocalDraft[] {
  const open = readOpenDocuments(storage)
    .filter((doc) => doc.content.trim().length > 0)
    .map((doc) => ({ title: doc.title, content: doc.content }));

  return [...open, ...legacyDrafts(storage)];
}

export function countLocalDrafts(storage: DraftStorage): number {
  return collectLocalDrafts(storage).length;
}

/** `null` means the request itself failed; the caller decides what to say. */
export async function importLocalDrafts(storage: DraftStorage): Promise<ImportSummary | null> {
  const drafts = collectLocalDrafts(storage);
  if (drafts.length === 0) return { created: 0, failed: 0 };

  let response: Response;
  try {
    response = await fetch('/api/documents/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ drafts }),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const payload = (await response.json().catch(() => null)) as {
    created?: unknown;
    failed?: unknown;
  } | null;
  if (typeof payload?.created !== 'number') return null;

  // Imported: drop the local copies so a second run cannot duplicate them.
  storage.removeItem(PREF_KEYS.openDocuments);
  for (const key of LEGACY_CONTENT_KEYS) storage.removeItem(key);

  return {
    created: payload.created,
    failed: typeof payload.failed === 'number' ? payload.failed : 0,
  };
}
