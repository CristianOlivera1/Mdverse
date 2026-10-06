import type { CollaboratorRole } from '../supabase/types';

/** A locally open document (one editor tab). */
export interface OpenDocument {
  readonly id: string;
  title: string;
  content: string;
}

/**
 * Who the signed-in account is on a document.
 *
 * The owner is implicit (`documents.owner_id`) and never appears in
 * `document_collaborators`, so the union is built by hand.
 */
export type DocumentAccess = 'owner' | CollaboratorRole;

/** A document as it travels between the browser and the JSON API. */
export interface CloudDocument extends OpenDocument {
  /** Optimistic concurrency token: send back what you read. */
  revision: number;
  role: DocumentAccess;
  slug: string;
  updatedAt: string;
}

/** A snapshot of an earlier revision, as listed by the history page. */
export interface DocumentVersionSummary {
  readonly id: number;
  readonly revision: number;
  readonly title: string;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

export type SaveDocumentResult =
  | { readonly ok: true; readonly revision: number; readonly updatedAt: string }
  | { readonly ok: false; readonly reason: 'conflict'; readonly revision: number }
  | { readonly ok: false; readonly reason: 'forbidden' | 'missing' | 'error' };

export function isCloudDocument(value: unknown): value is CloudDocument {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.content === 'string' &&
    typeof candidate.revision === 'number' &&
    typeof candidate.updatedAt === 'string' &&
    (candidate.role === 'owner' ||
      candidate.role === 'reader' ||
      candidate.role === 'editor' ||
      candidate.role === 'admin')
  );
}

/**
 * Defensive parse of `GET /api/documents`: a malformed entry is dropped instead
 * of poisoning the editor with `undefined` content.
 */
export function parseCloudDocuments(payload: unknown): CloudDocument[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const list = (payload as { documents?: unknown }).documents;
  if (!Array.isArray(list)) return [];
  return list.filter(isCloudDocument);
}
