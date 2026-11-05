/**
 * Collections of the signed-in account. New documents are filed under the
 * default collection unless another one is named.
 */

import type { APIRoute } from 'astro';

import { apiSession, jsonError, jsonResponse, readJsonObject, readString } from '@/lib/api/http';
import { createCollection, listCollections } from '@/lib/documents/repository';

export const GET: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');

  try {
    const collections = await listCollections(session.supabase, session.userId);
    return jsonResponse({ collections });
  } catch (error) {
    console.warn('[collections] list failed:', error);
    return jsonError(500, 'list_failed');
  }
};

export const POST: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');

  const body = await readJsonObject(context.request);
  const name = readString(body?.name);
  if (name === null) return jsonError(400, 'invalid_body');

  try {
    const result = await createCollection(session.supabase, session.userId, name);
    if (result.ok) return jsonResponse({ collection: result.value }, 201);

    switch (result.reason) {
      case 'invalid':
        return jsonError(400, 'invalid_name');
      case 'duplicate':
        return jsonError(409, 'duplicate_name');
      default:
        return jsonError(500, 'create_failed');
    }
  } catch (error) {
    console.warn('[collections] create failed:', error);
    return jsonError(500, 'create_failed');
  }
};
