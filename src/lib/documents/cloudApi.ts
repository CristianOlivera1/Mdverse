import { isCloudDocument, parseCloudDocuments } from './types';
import type { CloudDocument, SaveDocumentResult } from './types';

export interface CloudSession {
  /** Documents owned by, or shared with, the account, newest first. */
  readonly documents: CloudDocument[];
  create(title: string, content?: string): Promise<CloudDocument>;
  save(input: {
    id: string;
    content: string;
    revision: number;
    title?: string;
    /**
     * For `pagehide`/`visibilitychange`: lets the request outlive the page. The
     * browser caps keepalive bodies (~64 KB), so large documents fall back to a
     * normal request.
     */
    keepalive?: boolean;
  }): Promise<SaveDocumentResult>;
  fetch(id: string): Promise<CloudDocument | null>;
  remove(id: string): Promise<boolean>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' } as const;

function documentUrl(id: string): string {
  return `/api/documents/${encodeURIComponent(id)}`;
}

/**
 * Returns a cloud session, or `null` when this visitor is not signed in (or
 * Supabase is not configured, which also answers 401).
 */
export async function openCloudDocuments(): Promise<CloudSession | null> {
  let response: Response;
  try {
    response = await fetch('/api/documents', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
  } catch {
    return null;
  }

  if (response.status === 401) return null;
  if (!response.ok) return null;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  return cloudSession(parseCloudDocuments(payload));
}

export function cloudSession(documents: CloudDocument[]): CloudSession {
  return {
    documents,

    async create(title: string, content = ''): Promise<CloudDocument> {
      const response = await fetch('/api/documents', {
        method: 'POST',
        headers: JSON_HEADERS,
        credentials: 'same-origin',
        body: JSON.stringify({ title, content }),
      });
      if (!response.ok) throw new Error(`create failed (${response.status})`);

      const payload: unknown = await response.json();
      const created = (payload as { document?: unknown }).document;
      if (!isCloudDocument(created)) throw new Error('create returned an unexpected payload');
      return created;
    },

    async save(input): Promise<SaveDocumentResult> {
      let response: Response;
      try {
        response = await fetch(documentUrl(input.id), {
          method: 'PATCH',
          headers: JSON_HEADERS,
          credentials: 'same-origin',
          keepalive: Boolean(input.keepalive) && input.content.length < 60_000,
          body: JSON.stringify({
            content: input.content,
            revision: input.revision,
            ...(input.title === undefined ? {} : { title: input.title }),
          }),
        });
      } catch {
        return { ok: false, reason: 'error' };
      }

      if (response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          revision?: unknown;
          updatedAt?: unknown;
        } | null;
        return {
          ok: true,
          revision: typeof payload?.revision === 'number' ? payload.revision : input.revision + 1,
          // A 200 without a usable body still counts: the write reached the row.
          updatedAt:
            typeof payload?.updatedAt === 'string' ? payload.updatedAt : new Date().toISOString(),
        };
      }

      const payload = (await response.json().catch(() => null)) as {
        error?: unknown;
        revision?: unknown;
      } | null;

      if (response.status === 409 && typeof payload?.revision === 'number') {
        return { ok: false, reason: 'conflict', revision: payload.revision };
      }
      if (response.status === 403) return { ok: false, reason: 'forbidden' };
      if (response.status === 404) return { ok: false, reason: 'missing' };
      return { ok: false, reason: 'error' };
    },

    /** Fresh server copy, used to resolve a revision conflict. */
    async fetch(id: string): Promise<CloudDocument | null> {
      try {
        const response = await fetch(documentUrl(id), {
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
        });
        if (!response.ok) return null;

        const payload: unknown = await response.json();
        const found = (payload as { document?: unknown }).document;
        return isCloudDocument(found) ? found : null;
      } catch {
        return null;
      }
    },

    async remove(id: string): Promise<boolean> {
      try {
        const response = await fetch(documentUrl(id), {
          method: 'DELETE',
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
