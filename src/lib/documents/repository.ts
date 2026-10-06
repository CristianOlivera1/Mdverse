import type { SupabaseClient } from '@supabase/supabase-js';

import { slugifyHeading } from '../markdown/slug';
import type { Database } from '../supabase/database.types';
import type { CollaboratorRole, DocumentUpdate } from '../supabase/types';
import { documentAccess } from './access';
import { normalizeTitle } from './store';
import type { CloudDocument, DocumentAccess, SaveDocumentResult } from './types';

export type Db = SupabaseClient<Database>;

/** Guardrail on the dashboard query, not a product limit. */
export const MAX_LISTED_DOCUMENTS = 200;

export const NEW_DOCUMENT_TITLE = 'Untitled';

const DOCUMENT_COLUMNS = 'id, owner_id, title, slug, content, revision, updated_at';

interface DocumentRow {
  id: string;
  owner_id: string;
  title: string;
  slug: string;
  content: string;
  revision: number;
  updated_at: string;
}

interface VersionRow {
  id: number;
  revision: number;
  title: string;
  content: string;
  created_by: string | null;
  created_at: string;
}

/**
 * PostgREST row shapes cannot be validated at compile time (the generated types
 * are hand-written until `pnpm db:types` runs), so rows cross this boundary as
 * `unknown` and are read through narrow interfaces declared right here.
 */
function asRows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function asRow<T>(data: unknown): T | null {
  return typeof data === 'object' && data !== null ? (data as T) : null;
}

export function toCloudDocument(row: DocumentRow, access: DocumentAccess): CloudDocument {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    content: row.content,
    revision: row.revision,
    role: access,
    updatedAt: row.updated_at,
  };
}

/** Postgres `insufficient_privilege`: RLS said no. */
const INSUFFICIENT_PRIVILEGE = '42501';

function failure(error: { code?: string } | null): 'forbidden' | 'error' {
  return error?.code === INSUFFICIENT_PRIVILEGE ? 'forbidden' : 'error';
}

/**
 * Documents the account owns plus the ones shared with it, newest first.
 *
 * The query itself is broader — RLS also lets an authenticated user read any
 * `public` document — so the list is narrowed to owner/collaborator here: a
 * public document reaches the editor through its public route (phase 5), not by
 * appearing uninvited in someone's tabs.
 */
export async function listDocuments(db: Db, userId: string): Promise<CloudDocument[]> {
  const [documentsResult, rolesResult] = await Promise.all([
    db
      .from('documents')
      .select(DOCUMENT_COLUMNS)
      .order('updated_at', { ascending: false })
      .limit(MAX_LISTED_DOCUMENTS),
    db.from('document_collaborators').select('document_id, role').eq('user_id', userId),
  ]);

  if (documentsResult.error) throw documentsResult.error;
  if (rolesResult.error) throw rolesResult.error;

  const roles = new Map<string, CollaboratorRole>();
  for (const entry of asRows<{ document_id: string; role: CollaboratorRole }>(rolesResult.data)) {
    roles.set(entry.document_id, entry.role);
  }

  return asRows<DocumentRow>(documentsResult.data)
    .filter((row) => row.owner_id === userId || roles.has(row.id))
    .map((row) =>
      toCloudDocument(
        row,
        documentAccess({
          ownerId: row.owner_id,
          viewerId: userId,
          collaboratorRole: roles.get(row.id),
        }),
      ),
    );
}

export async function getDocument(
  db: Db,
  userId: string,
  id: string,
): Promise<CloudDocument | null> {
  const [documentResult, roleResult] = await Promise.all([
    db.from('documents').select(DOCUMENT_COLUMNS).eq('id', id).maybeSingle(),
    db
      .from('document_collaborators')
      .select('role')
      .eq('document_id', id)
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  if (documentResult.error) throw documentResult.error;

  const row = asRow<DocumentRow>(documentResult.data);
  if (!row) return null;

  const role = asRow<{ role: CollaboratorRole }>(roleResult.data)?.role ?? null;
  return toCloudDocument(
    row,
    documentAccess({ ownerId: row.owner_id, viewerId: userId, collaboratorRole: role }),
  );
}

export async function listVersions(db: Db, documentId: string, limit = 50): Promise<VersionRow[]> {
  const { data, error } = await db
    .from('document_versions')
    .select('id, revision, title, content, created_by, created_at')
    .eq('document_id', documentId)
    .order('revision', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return asRows<VersionRow>(data);
}

export async function getVersion(
  db: Db,
  documentId: string,
  versionId: number,
): Promise<VersionRow | null> {
  const { data, error } = await db
    .from('document_versions')
    .select('id, revision, title, content, created_by, created_at')
    .eq('document_id', documentId)
    .eq('id', versionId)
    .maybeSingle();

  if (error) throw error;
  return asRow<VersionRow>(data);
}

/**
 * A slug is supplied instead of letting the trigger derive one, so that public
 * links follow the tested `slugifyHeading` rule. The trigger still deduplicates
 * (`-1`, `-2`, …) and the fallback covers titles made only of symbols.
 */
export function slugForTitle(title: string): string {
  return slugifyHeading(title).slice(0, 64) || 'untitled';
}

export async function createDocument(
  db: Db,
  userId: string,
  input: { title?: string; content?: string } = {},
): Promise<CloudDocument> {
  const title = normalizeTitle(input.title ?? NEW_DOCUMENT_TITLE);
  const { data, error } = await db
    .from('documents')
    .insert({
      owner_id: userId,
      title,
      slug: slugForTitle(title),
      content: input.content ?? '',
    })
    .select(DOCUMENT_COLUMNS)
    .single();

  if (error) throw error;
  const row = asRow<DocumentRow>(data);
  if (!row) throw new Error('The document was created but the API returned no row.');

  return toCloudDocument(row, 'owner');
}

async function currentRevision(db: Db, id: string): Promise<number | null> {
  const { data } = await db.from('documents').select('revision').eq('id', id).maybeSingle();
  return asRow<{ revision: number }>(data)?.revision ?? null;
}

async function lockedUpdate(
  db: Db,
  id: string,
  revision: number,
  patch: DocumentUpdate,
): Promise<SaveDocumentResult> {
  const { data, error } = await db
    .from('documents')
    .update(patch)
    .eq('id', id)
    .eq('revision', revision)
    .select('revision, updated_at')
    .maybeSingle();

  if (error) return { ok: false, reason: failure(error) };

  const row = asRow<{ revision: number; updated_at: string }>(data);
  if (row) return { ok: true, revision: row.revision, updatedAt: row.updated_at };

  // Zero rows: the revision moved on (or the document disappeared).
  const latest = await currentRevision(db, id);
  return latest === null
    ? { ok: false, reason: 'missing' }
    : { ok: false, reason: 'conflict', revision: latest };
}

/** Autosave. `title` is optional so a content-only save costs one round trip. */
export function saveDocument(
  db: Db,
  userId: string,
  input: { id: string; content: string; revision: number; title?: string },
): Promise<SaveDocumentResult> {
  const patch: DocumentUpdate = { content: input.content, last_edited_by: userId };
  if (input.title !== undefined) patch.title = normalizeTitle(input.title);
  return lockedUpdate(db, input.id, input.revision, patch);
}

/** Rename without touching the slug: public links must keep resolving. */
export function renameDocument(
  db: Db,
  userId: string,
  id: string,
  title: string,
  revision: number,
): Promise<SaveDocumentResult> {
  return lockedUpdate(db, id, revision, {
    title: normalizeTitle(title),
    last_edited_by: userId,
  });
}

/**
 * Deletes a document, and reports what actually happened.
 *
 * The delete policy is owner-only, and a policy that filters the row out is not an
 * error — the statement simply touches nothing. Asking for the deleted ids back is
 * what separates "deleted" from "not allowed"; a plain `.delete()` would report
 * success while the row was still there.
 */
export async function deleteDocument(
  db: Db,
  id: string,
): Promise<'ok' | 'forbidden' | 'missing' | 'error'> {
  const { data, error } = await db.from('documents').delete().eq('id', id).select('id');
  if (error) return failure(error);
  if (asRows<{ id: string }>(data).length > 0) return 'ok';

  // Nothing was deleted: either the caller may not (they can still read it) or
  // the row is gone. RLS already decided what this caller can see, so answering
  // from that same view leaks nothing new.
  const { data: visible } = await db.from('documents').select('id').eq('id', id).maybeSingle();
  return asRow<{ id: string }>(visible) ? 'forbidden' : 'missing';
}

export async function restoreVersion(
  db: Db,
  userId: string,
  input: { documentId: string; versionId: number; revision: number },
): Promise<SaveDocumentResult> {
  const version = await getVersion(db, input.documentId, input.versionId);
  if (!version) return { ok: false, reason: 'missing' };

  return lockedUpdate(db, input.documentId, input.revision, {
    content: version.content,
    title: version.title,
    last_edited_by: userId,
  });
}

export interface DraftImportResult {
  readonly created: CloudDocument[];
  readonly failed: number;
}

/**
 * Creates one document per local draft. Failures are counted, not thrown: an
 * import of ten drafts should keep the nine that worked.
 */
export async function importDrafts(
  db: Db,
  userId: string,
  drafts: readonly { title?: string; content: string }[],
): Promise<DraftImportResult> {
  const created: CloudDocument[] = [];
  let failed = 0;

  for (const draft of drafts) {
    try {
      created.push(
        await createDocument(db, userId, { title: draft.title, content: draft.content }),
      );
    } catch {
      failed += 1;
    }
  }

  return { created, failed };
}
