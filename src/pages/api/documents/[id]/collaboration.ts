/**
 * `GET /api/documents/:id/collaboration` - everything the editor's collaboration
 * dialog shows, in one round trip.
 *
 * Reads only. Every change still goes through the form endpoints under
 * `/documents/:id/share/*`, which answer JSON to this dialog and redirect to the
 * share page for a plain form post. The mapping from rows to camelCase lives here
 * so the browser never sees a column name.
 */

import type { APIRoute } from 'astro';

import { apiSession, jsonError, jsonResponse } from '@/lib/api/http';
import { canManageDocument } from '@/lib/documents/access';
import { isDocumentId } from '@/lib/documents/ids';
import {
  getDocument,
  listCollaborators,
  listInvitations,
  listShareLinks,
} from '@/lib/documents/repository';
import { sortCollaborators } from '@/lib/documents/sharing';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');

  const id = context.params.id ?? '';
  if (!isDocumentId(id)) return jsonError(400, 'invalid_id');

  const { supabase, userId } = session;

  try {
    const document = await getDocument(supabase, userId, id);
    if (!document) return jsonError(404, 'not_found');

    const canManage = canManageDocument(document.role);

    // A non-manager skips these queries entirely: RLS would return nothing anyway.
    const [collaborators, invitations, links] = canManage
      ? await Promise.all([
          listCollaborators(supabase, id),
          listInvitations(supabase, id),
          listShareLinks(supabase, id),
        ])
      : [[], [], []];

    return jsonResponse({
      document: {
        id: document.id,
        title: document.title,
        visibility: document.visibility,
        role: document.role,
        canManage,
      },
      people: sortCollaborators(collaborators).map((person) => ({
        userId: person.userId,
        name: person.name,
        username: person.username,
        role: person.role,
        addedAt: person.addedAt,
      })),
      invitations: invitations
        .filter((entry) => entry.acceptedAt === null)
        .map((entry) => ({
          id: entry.id,
          email: entry.email,
          role: entry.role,
          createdAt: entry.createdAt,
        })),
      links: links.map((link) => ({
        id: link.id,
        token: link.token,
        role: link.role,
        expiresAt: link.expires_at,
        createdAt: link.created_at,
      })),
    });
  } catch (error) {
    console.warn('[documents] collaboration read failed:', error);
    return jsonError(500, 'read_failed');
  }
};
