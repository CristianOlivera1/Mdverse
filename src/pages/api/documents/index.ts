/**
 * Editor endpoint: runs as the signed-in user, filtered by RLS
 * (`supabase/migrations/20261006130000_documents.sql`).
 */

import type { APIRoute } from 'astro';

import { apiSession, jsonError, jsonResponse, readJsonObject, readString } from '@/lib/api/http';
import { displayNameFromEmail } from '@/lib/auth/profile';
import { isUuid } from '@/lib/documents/ids';
import { createDocument, listCollections, listDocuments } from '@/lib/documents/repository';

export const GET: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');

  const { supabase, userId } = session;

  try {
    // One round trip: the editor groups its tabs by these collections.
    const [documents, collections] = await Promise.all([
      listDocuments(supabase, userId),
      listCollections(supabase, userId),
    ]);
    // Display name only (never a credential) so the editor can join presence without a second round trip.
    const viewer = {
      id: userId,
      name:
        context.locals.profile?.display_name?.trim() ||
        displayNameFromEmail(context.locals.user?.email ?? null),
    };
    return jsonResponse({ documents, collections, viewer });
  } catch (error) {
    console.warn('[documents] list failed:', error);
    return jsonError(500, 'list_failed');
  }
};

export const POST: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');

  const { supabase, userId } = session;
  const body = await readJsonObject(context.request);
  const title = readString(body?.title) ?? undefined;
  const content = readString(body?.content) ?? undefined;
  const requestedCollection = readString(body?.collectionId);
  const collectionId =
    requestedCollection && isUuid(requestedCollection) ? requestedCollection : undefined;

  try {
    const document = await createDocument(supabase, userId, { title, content, collectionId });
    return jsonResponse({ document }, 201);
  } catch (error) {
    console.warn('[documents] create failed:', error);
    return jsonError(500, 'create_failed');
  }
};
