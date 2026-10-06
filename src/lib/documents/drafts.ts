import { normalizeTitle } from './store';

/** Same ceiling as the editor's own tab list (see `src/lib/documents/store.ts`). */
export const MAX_IMPORTED_DRAFTS = 20;

/** `octet_length(content) <= 1048576` in the migration. */
export const MAX_DRAFT_BYTES = 1024 * 1024;

export interface ImportedDraft {
  readonly title: string;
  readonly content: string;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function parseDraftList(value: unknown): ImportedDraft[] {
  if (!Array.isArray(value)) return [];

  const drafts: ImportedDraft[] = [];
  for (const entry of value) {
    if (drafts.length >= MAX_IMPORTED_DRAFTS) break;
    if (typeof entry !== 'object' || entry === null) continue;

    const candidate = entry as { title?: unknown; content?: unknown };
    if (typeof candidate.content !== 'string') continue;

    const content = candidate.content;
    // An empty draft carries nothing the database needs to keep.
    if (content.trim().length === 0 || byteLength(content) > MAX_DRAFT_BYTES) continue;

    drafts.push({
      title: normalizeTitle(typeof candidate.title === 'string' ? candidate.title : ''),
      content,
    });
  }

  return drafts;
}
