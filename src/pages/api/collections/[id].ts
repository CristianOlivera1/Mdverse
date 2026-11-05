import type { APIRoute } from 'astro';

import { apiSession, jsonError, jsonResponse, readJsonObject, readString } from '@/lib/api/http';
import { isUuid } from '@/lib/documents/ids';
import { deleteCollection, renameCollection } from '@/lib/documents/repository';

function failure(reason: string): Response {
  switch (reason) {
    case 'missing':
      return jsonError(404, 'not_found');
    case 'forbidden':
      return jsonError(403, 'forbidden');
    case 'invalid':
      return jsonError(400, 'invalid_name');
    case 'duplicate':
      return jsonError(409, 'duplicate_name');
    case 'default':
      return jsonError(409, 'default_collection');
    default:
      return jsonError(500, 'collection_failed');
  }
}

export const PATCH: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');

  const id = context.params.id ?? '';
  if (!isUuid(id)) return jsonError(400, 'invalid_id');

  const body = await readJsonObject(context.request);
  const name = readString(body?.name);
  if (name === null) return jsonError(400, 'invalid_body');

  try {
    const result = await renameCollection(session.supabase, id, name);
    return result.ok ? jsonResponse({ collection: result.value }) : failure(result.reason);
  } catch (error) {
    console.warn('[collections] rename failed:', error);
    return jsonError(500, 'rename_failed');
  }
};

export const DELETE: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');

  const id = context.params.id ?? '';
  if (!isUuid(id)) return jsonError(400, 'invalid_id');

  try {
    const result = await deleteCollection(session.supabase, session.userId, id);
    return result.ok ? jsonResponse({ ok: true }) : failure(result.reason);
  } catch (error) {
    console.warn('[collections] delete failed:', error);
    return jsonError(500, 'delete_failed');
  }
};
