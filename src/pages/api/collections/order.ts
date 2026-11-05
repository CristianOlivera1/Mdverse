import type { APIRoute } from 'astro';

import { apiSession, jsonError, jsonResponse, readJsonObject } from '@/lib/api/http';
import { isUuid } from '@/lib/documents/ids';
import { reorderCollections } from '@/lib/documents/repository';

export const PUT: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');

  const body = await readJsonObject(context.request);
  const ids = body?.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > 100 ||
    !ids.every((id): id is string => typeof id === 'string' && isUuid(id)) ||
    new Set(ids).size !== ids.length
  ) {
    return jsonError(400, 'invalid_ids');
  }

  try {
    const result = await reorderCollections(session.supabase, ids);
    if (result.ok) return jsonResponse({ ok: true });
    return result.reason === 'forbidden'
      ? jsonError(403, 'forbidden')
      : jsonError(500, 'reorder_failed');
  } catch (error) {
    console.warn('[collections] reorder failed:', error);
    return jsonError(500, 'reorder_failed');
  }
};