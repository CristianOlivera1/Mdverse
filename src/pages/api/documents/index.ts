/**
 * `GET /api/documents` — the account's documents (owned + shared with it).
 * `POST /api/documents` — creates an empty document.
 *
 * This is the editor's endpoint: it runs as the signed-in user, so every read and
 * write is filtered by the RLS policies in
 * `supabase/migrations/20261006130000_documents.sql`.
 */

import type { APIRoute } from 'astro';

import { apiSession, jsonError, jsonResponse, readJsonObject, readString } from '@/lib/api/http';
import { createDocument, listDocuments } from '@/lib/documents/repository';

export const GET: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');

  const { supabase, userId } = session;

  try {
    const documents = await listDocuments(supabase, userId);
    return jsonResponse({ documents });
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

  try {
    const document = await createDocument(supabase, userId, { title, content });
    return jsonResponse({ document }, 201);
  } catch (error) {
    console.warn('[documents] create failed:', error);
    return jsonError(500, 'create_failed');
  }
};
