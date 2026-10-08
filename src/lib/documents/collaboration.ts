/**
 * What the editor's collaboration dialog talks to.
 *
 * The shape is deliberately camelCase and independent from the database rows: the
 * API endpoint does the mapping, so a column rename never reaches the browser and
 * this module stays free of `supabase-js`.
 */

import type { CollaboratorRole, DocumentVisibility } from '../supabase/types';
import type { DocumentAccess } from './types';

export interface CollaborationPerson {
  readonly userId: string;
  readonly name: string;
  readonly username: string;
  readonly role: CollaboratorRole;
  readonly addedAt: string;
}

export interface CollaborationInvitation {
  readonly id: string;
  readonly email: string;
  readonly role: CollaboratorRole;
  readonly createdAt: string;
}

export interface CollaborationLink {
  readonly id: string;
  readonly token: string;
  readonly role: CollaboratorRole;
  readonly expiresAt: string | null;
  readonly createdAt: string;
}

export interface CollaborationRequest {
  readonly id: string;
  readonly requesterId: string;
  readonly name: string;
  readonly username: string;
  /** The requester's note, when they left one. */
  readonly message: string | null;
  readonly createdAt: string;
}

export interface CollaborationState {
  readonly id: string;
  readonly title: string;
  readonly visibility: DocumentVisibility;
  readonly role: DocumentAccess;
  /** Only an owner may invite, remove people or publish; everyone else reads this panel. */
  readonly canManage: boolean;
  readonly people: readonly CollaborationPerson[];
  readonly invitations: readonly CollaborationInvitation[];
  readonly links: readonly CollaborationLink[];
  /** Pending “could I get in?” questions, oldest first. Empty for non-managers. */
  readonly requests: readonly CollaborationRequest[];
}

export interface CollaborationFeedback {
  readonly ok: boolean;
  readonly message: string;
  /** `info` marks the honest middle case: access granted, the email refused. */
  readonly tone?: 'success' | 'info';
}

/** The fields each action reads. Values are strings and numbers only: no nested JSON travels. */
export type ShareActionFields = Record<string, string | number>;

// One endpoint per name, under /documents/:id/share/*.
export type ManagedAction =
  | 'invite'
  | 'collaborator'
  | 'invitation'
  | 'link'
  | 'visibility'
  | 'request';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readPerson(value: unknown): CollaborationPerson | null {
  if (!isRecord(value)) return null;
  const userId = readString(value.userId);
  if (!userId) return null;

  return {
    userId,
    name: readString(value.name, 'Someone'),
    username: readString(value.username),
    role: readString(value.role, 'reader') as CollaboratorRole,
    addedAt: readString(value.addedAt),
  };
}

function readInvitation(value: unknown): CollaborationInvitation | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const email = readString(value.email);
  if (!id || !email) return null;

  return {
    id,
    email,
    role: readString(value.role, 'reader') as CollaboratorRole,
    createdAt: readString(value.createdAt),
  };
}

function readRequest(value: unknown): CollaborationRequest | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  if (!id) return null;

  return {
    id,
    requesterId: readString(value.requesterId),
    name: readString(value.name, 'Someone'),
    username: readString(value.username),
    message: typeof value.message === 'string' && value.message.length > 0 ? value.message : null,
    createdAt: readString(value.createdAt),
  };
}

function readLink(value: unknown): CollaborationLink | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const token = readString(value.token);
  if (!id || !token) return null;

  return {
    id,
    token,
    role: readString(value.role, 'reader') as CollaboratorRole,
    expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : null,
    createdAt: readString(value.createdAt),
  };
}

/** `null` when the payload is not a document we can show: the caller keeps its old state. */
export function parseCollaborationState(payload: unknown): CollaborationState | null {
  if (!isRecord(payload)) return null;

  const document = payload.document;
  if (!isRecord(document)) return null;

  const id = readString(document.id);
  if (!id) return null;

  return {
    id,
    title: readString(document.title, 'Untitled'),
    visibility: readString(document.visibility, 'private') as DocumentVisibility,
    role: readString(document.role, 'reader') as DocumentAccess,
    canManage: document.canManage === true,
    people: asArray(payload.people)
      .map(readPerson)
      .filter((entry): entry is CollaborationPerson => entry !== null),
    invitations: asArray(payload.invitations)
      .map(readInvitation)
      .filter((entry): entry is CollaborationInvitation => entry !== null),
    links: asArray(payload.links)
      .map(readLink)
      .filter((entry): entry is CollaborationLink => entry !== null),
    requests: asArray(payload.requests)
      .map(readRequest)
      .filter((entry): entry is CollaborationRequest => entry !== null),
  };
}

function collaborationUrl(documentId: string): string {
  return `/api/documents/${encodeURIComponent(documentId)}/collaboration`;
}

// Same endpoints the share page posts to; they answer JSON when the caller asks for it.
function shareActionUrl(documentId: string, action: ManagedAction): string {
  return `/documents/${encodeURIComponent(documentId)}/share/${action}`;
}

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' } as const;

export async function loadCollaboration(documentId: string): Promise<CollaborationState | null> {
  try {
    const response = await fetch(collaborationUrl(documentId), {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!response.ok) return null;

    return parseCollaborationState(await response.json());
  } catch {
    return null;
  }
}

export async function runShareAction(
  documentId: string,
  action: ManagedAction,
  fields: ShareActionFields,
): Promise<CollaborationFeedback> {
  let response: Response;
  try {
    response = await fetch(shareActionUrl(documentId, action), {
      method: 'POST',
      headers: JSON_HEADERS,
      credentials: 'same-origin',
      body: JSON.stringify(fields),
    });
  } catch {
    return { ok: false, message: 'We could not reach the server. Please try again.' };
  }

  const payload: unknown = await response.json().catch(() => null);
  const body = isRecord(payload) ? payload : {};
  const notice = isRecord(body.notice) ? body.notice : null;

  // 401/403 without a notice (signed out, or the session expired while editing).
  if (!notice) {
    return {
      ok: false,
      message:
        response.status === 401
          ? 'Your session expired. Reload the page and sign in again.'
          : 'We could not complete that. Please try again.',
    };
  }

  const tone = notice.tone === 'info' ? 'info' : 'success';
  return {
    ok: body.ok !== false && notice.tone !== 'error',
    message: readString(notice.message, 'Done.'),
    tone,
  };
}
