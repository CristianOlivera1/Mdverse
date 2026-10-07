import type { SupabaseClient } from '@supabase/supabase-js';

import { slugifyHeading } from '../markdown/slug';
import type { Database } from '../supabase/database.types';
import type {
  CollaboratorRole,
  DocumentShareLink,
  DocumentUpdate,
  DocumentVisibility,
} from '../supabase/types';
import { documentAccess } from './access';
import { isInviteStatus, type InviteRole, type InviteStatus } from './sharing';
import { normalizeTitle } from './store';
import type { CloudDocument, DocumentAccess, SaveDocumentResult } from './types';

export type Db = SupabaseClient<Database>;

export const MAX_LISTED_DOCUMENTS = 200;

export const NEW_DOCUMENT_TITLE = 'Untitled';

const DOCUMENT_COLUMNS = 'id, owner_id, title, slug, content, revision, visibility, updated_at';

interface DocumentRow {
  id: string;
  owner_id: string;
  title: string;
  slug: string;
  content: string;
  revision: number;
  visibility: DocumentVisibility;
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
    visibility: row.visibility,
    updatedAt: row.updated_at,
  };
}

// 42501 means RLS denied the row, not a system error.
const INSUFFICIENT_PRIVILEGE = '42501';

function failure(error: { code?: string } | null): 'forbidden' | 'error' {
  return error?.code === INSUFFICIENT_PRIVILEGE ? 'forbidden' : 'error';
}

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

  // Zero rows means the revision moved on, not success.
  const latest = await currentRevision(db, id);
  return latest === null
    ? { ok: false, reason: 'missing' }
    : { ok: false, reason: 'conflict', revision: latest };
}

export function saveDocument(
  db: Db,
  userId: string,
  input: { id: string; content: string; revision: number; title?: string },
): Promise<SaveDocumentResult> {
  const patch: DocumentUpdate = { content: input.content, last_edited_by: userId };
  if (input.title !== undefined) patch.title = normalizeTitle(input.title);
  return lockedUpdate(db, input.id, input.revision, patch);
}

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

// select('id') separates deleted from RLS-filtered; plain delete reports false success.
export async function deleteDocument(
  db: Db,
  id: string,
): Promise<'ok' | 'forbidden' | 'missing' | 'error'> {
  const { data, error } = await db.from('documents').delete().eq('id', id).select('id');
  if (error) return failure(error);
  if (asRows<{ id: string }>(data).length > 0) return 'ok';

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

export interface CollaboratorEntry {
  readonly userId: string;
  readonly role: CollaboratorRole;
  readonly name: string;
  readonly username: string;
  readonly addedAt: string;
}

export interface InvitationEntry {
  readonly id: string;
  readonly email: string;
  readonly role: CollaboratorRole;
  readonly createdAt: string;
  readonly acceptedAt: string | null;
}

export type ShareLinkEntry = Pick<
  DocumentShareLink,
  'id' | 'token' | 'role' | 'expires_at' | 'created_at'
>;

export type ShareFailure = 'forbidden' | 'missing' | 'invalid_email' | 'error';

export type ShareResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: ShareFailure };

const INVALID_PARAMETER = '22023';
const NO_DATA_FOUND = 'P0002';

function shareFailure(error: { code?: string } | null): ShareFailure {
  if (!error) return 'error';
  if (error.code === INSUFFICIENT_PRIVILEGE) return 'forbidden';
  if (error.code === NO_DATA_FOUND) return 'missing';
  if (error.code === INVALID_PARAMETER) return 'invalid_email';
  return 'error';
}

// One function for both cases so inviters cannot probe which addresses have accounts.
export async function inviteCollaborator(
  db: Db,
  input: { documentId: string; email: string; role: InviteRole },
): Promise<ShareResult<InviteStatus>> {
  const { data, error } = await db.rpc('invite_collaborator', {
    p_document_id: input.documentId,
    p_email: input.email,
    p_role: input.role,
  });

  if (error) return { ok: false, reason: shareFailure(error) };
  return typeof data === 'string' && isInviteStatus(data)
    ? { ok: true, value: data }
    : { ok: false, reason: 'error' };
}

export async function listCollaborators(db: Db, documentId: string): Promise<CollaboratorEntry[]> {
  const { data, error } = await db
    .from('document_collaborators')
    .select('user_id, role, created_at')
    .eq('document_id', documentId);

  if (error) throw error;

  const rows = asRows<{
    user_id: string;
    role: CollaboratorRole;
    created_at: string;
  }>(data);

  if (rows.length === 0) return [];

  const { data: profileData, error: profileError } = await db
    .from('profiles')
    .select('id, display_name, username')
    .in(
      'id',
      rows.map((row) => row.user_id),
    );

  if (profileError) throw profileError;

  const profiles = new Map<string, { display_name: string; username: string }>();
  for (const profile of asRows<{ id: string; display_name: string; username: string }>(
    profileData,
  )) {
    profiles.set(profile.id, profile);
  }

  return rows.map((row) => ({
    userId: row.user_id,
    role: row.role,
    name: profiles.get(row.user_id)?.display_name ?? 'Unknown account',
    username: profiles.get(row.user_id)?.username ?? '',
    addedAt: row.created_at,
  }));
}

// Zero rows means RLS filtered the write: answer forbidden, never whether the row exists.
export async function setCollaboratorRole(
  db: Db,
  input: { documentId: string; userId: string; role: InviteRole },
): Promise<ShareResult<true>> {
  const { data, error } = await db
    .from('document_collaborators')
    .update({ role: input.role, updated_at: new Date().toISOString() })
    .eq('document_id', input.documentId)
    .eq('user_id', input.userId)
    .select('user_id');

  if (error) return { ok: false, reason: shareFailure(error) };
  return asRows<{ user_id: string }>(data).length > 0
    ? { ok: true, value: true }
    : { ok: false, reason: 'forbidden' };
}

export async function removeCollaborator(
  db: Db,
  input: { documentId: string; userId: string },
): Promise<ShareResult<true>> {
  const { data, error } = await db
    .from('document_collaborators')
    .delete()
    .eq('document_id', input.documentId)
    .eq('user_id', input.userId)
    .select('user_id');

  if (error) return { ok: false, reason: shareFailure(error) };
  return asRows<{ user_id: string }>(data).length > 0
    ? { ok: true, value: true }
    : { ok: false, reason: 'forbidden' };
}

export async function listInvitations(db: Db, documentId: string): Promise<InvitationEntry[]> {
  const { data, error } = await db
    .from('document_invitations')
    .select('id, email, role, created_at, accepted_at')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return asRows<{
    id: string;
    email: string;
    role: CollaboratorRole;
    created_at: string;
    accepted_at: string | null;
  }>(data).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
  }));
}

export async function revokeInvitation(db: Db, id: string): Promise<ShareResult<true>> {
  const { data, error } = await db.from('document_invitations').delete().eq('id', id).select('id');

  if (error) return { ok: false, reason: shareFailure(error) };
  return asRows<{ id: string }>(data).length > 0
    ? { ok: true, value: true }
    : { ok: false, reason: 'forbidden' };
}

export async function listShareLinks(db: Db, documentId: string): Promise<ShareLinkEntry[]> {
  const { data, error } = await db
    .from('share_links')
    .select('id, token, role, expires_at, created_at')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return asRows<ShareLinkEntry>(data);
}

export async function createShareLink(
  db: Db,
  userId: string,
  input: { documentId: string; role: InviteRole; expiresAt: string | null },
): Promise<ShareResult<ShareLinkEntry>> {
  const { data, error } = await db
    .from('share_links')
    .insert({
      document_id: input.documentId,
      role: input.role,
      expires_at: input.expiresAt,
      created_by: userId,
    })
    .select('id, token, role, expires_at, created_at')
    .single();

  if (error) return { ok: false, reason: shareFailure(error) };
  const row = asRow<ShareLinkEntry>(data);
  return row ? { ok: true, value: row } : { ok: false, reason: 'error' };
}

export async function revokeShareLink(db: Db, id: string): Promise<ShareResult<true>> {
  const { data, error } = await db.from('share_links').delete().eq('id', id).select('id');
  if (error) return { ok: false, reason: shareFailure(error) };
  return asRows<{ id: string }>(data).length > 0
    ? { ok: true, value: true }
    : { ok: false, reason: 'forbidden' };
}

export async function setVisibility(
  db: Db,
  input: { documentId: string; visibility: DocumentVisibility },
): Promise<ShareResult<true>> {
  const { data, error } = await db
    .from('documents')
    .update({ visibility: input.visibility })
    .eq('id', input.documentId)
    .select('id');

  if (error) return { ok: false, reason: shareFailure(error) };
  return asRows<{ id: string }>(data).length > 0
    ? { ok: true, value: true }
    : { ok: false, reason: 'forbidden' };
}

export async function resolveShareToken(
  db: Db,
  token: string,
): Promise<{
  slug: string;
  title: string;
  content: string;
  revision: number;
  role: CollaboratorRole;
} | null> {
  const { data, error } = await db.rpc('resolve_share_token', { p_token: token });
  if (error) {
    console.warn('[sharing] resolving a link token failed:', error.message);
    return null;
  }

  const row = asRow<{
    slug: string;
    title: string;
    content: string;
    revision: number;
    link_role: CollaboratorRole;
  }>(asRows(data)[0]);

  if (!row) return null;
  return {
    slug: row.slug,
    title: row.title,
    content: row.content,
    revision: row.revision,
    role: row.link_role,
  };
}

export async function claimShareLink(
  db: Db,
  token: string,
): Promise<{ documentId: string; slug: string; role: CollaboratorRole; isOwner: boolean } | null> {
  const { data, error } = await db.rpc('claim_share_link', { p_token: token });
  if (error) return null;

  const row = asRow<{
    document_id: string;
    slug: string;
    granted_role: CollaboratorRole;
    is_owner: boolean;
  }>(asRows(data)[0]);

  if (!row) return null;
  return {
    documentId: row.document_id,
    slug: row.slug,
    role: row.granted_role,
    isOwner: row.is_owner,
  };
}

export interface DraftImportResult {
  readonly created: CloudDocument[];
  readonly failed: number;
}

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
