import type { CollaboratorRole, DocumentVisibility } from '../supabase/types';

export interface OpenDocument {
  readonly id: string;
  title: string;
  content: string;
  readonly role?: DocumentAccess;
}

export type DocumentAccess = 'owner' | CollaboratorRole;

export interface CloudDocument extends OpenDocument {
  revision: number;
  role: DocumentAccess;
  slug: string;
  visibility: DocumentVisibility;
  linkRole: LinkRole;
  updatedAt: string;
}

export type LinkRole = 'reader' | 'editor';

export function isLinkRole(value: unknown): value is LinkRole {
  return value === 'reader' || value === 'editor';
}

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
    (candidate.visibility === 'private' ||
      candidate.visibility === 'unlisted' ||
      candidate.visibility === 'public') &&
    isLinkRole(candidate.linkRole) &&
    (candidate.role === 'owner' ||
      candidate.role === 'reader' ||
      candidate.role === 'editor' ||
      candidate.role === 'admin')
  );
}

export function parseCloudDocuments(payload: unknown): CloudDocument[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const list = (payload as { documents?: unknown }).documents;
  if (!Array.isArray(list)) return [];
  return list.filter(isCloudDocument);
}
