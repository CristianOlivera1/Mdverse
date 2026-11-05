import type { APIRoute } from 'astro';

import { apiSession, jsonError, jsonResponse, readJsonObject, readString } from '@/lib/api/http';
import { isDocumentId, isUuid } from '@/lib/documents/ids';
import { moveDocument } from '@/lib/documents/repository';

/** Files a document under a collection. Only its owner may do this. */
export const PUT: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');

  const id = context.params.id ?? '';
  if (!isDocumentId(id)) return jsonError(400, 'invalid_id');

  const body = await readJsonObject(context.request);
  const collectionId = readString(body?.collectionId);
  if (!collectionId || !isUuid(collectionId)) return jsonError(400, 'invalid_collection');

  try {
    const result = await moveDocument(session.supabase, session.userId, id, collectionId);
    if (result.ok) {
      return jsonResponse({
        ok: true,
        revision: result.revision,
        updatedAt: result.updatedAt,
      });
    }

    switch (result.reason) {
      case 'forbidden':
        return jsonError(403, 'forbidden');
      case 'missing':
        return jsonError(404, 'not_found');
      default:
        return jsonError(500, 'move_failed');
    }
  } catch (error) {
    console.warn('[documents] move failed:', error);
    return jsonError(500, 'move_failed');
  }
};
