/**
 * `GET /api/documents/:id` — one document (RLS decides whether it is visible).
 * `PATCH /api/documents/:id` — autosave or rename, guarded by `revision`.
 * `DELETE /api/documents/:id` — owner only.
 *
 * A `PATCH` is the hot path: the editor sends `{content, revision}` every couple
 * of seconds while typing. The `revision` travels back and forth so a stale
 * writer gets `409 {error: "conflict", revision}` instead of overwriting text it
 * never saw.
 */

import type { APIRoute } from 'astro';

import {
  apiSession,
  jsonError,
  jsonResponse,
  readJsonObject,
  readRevision,
  readString,
} from '@/lib/api/http';
import { isDocumentId } from '@/lib/documents/ids';
import {
  deleteDocument,
  getDocument,
  renameDocument,
  saveDocument,
} from '@/lib/documents/repository';
import type { SaveDocumentResult } from '@/lib/documents/types';

function saveResponse(result: SaveDocumentResult): Response {
  if (result.ok) {
    return jsonResponse({ ok: true, revision: result.revision, updatedAt: result.updatedAt });
  }

  switch (result.reason) {
    case 'conflict':
      return jsonResponse({ error: 'conflict', revision: result.revision }, 409);
    case 'forbidden':
      return jsonError(403, 'forbidden');
    case 'missing':
      return jsonError(404, 'not_found');
    default:
      return jsonError(500, 'save_failed');
  }
}

export const GET: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');

  const id = context.params.id ?? '';
  if (!isDocumentId(id)) return jsonError(400, 'invalid_id');

  try {
    const document = await getDocument(session.supabase, session.userId, id);
    return document ? jsonResponse({ document }) : jsonError(404, 'not_found');
  } catch (error) {
    console.warn('[documents] read failed:', error);
    return jsonError(500, 'read_failed');
  }
};

export const PATCH: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');

  const id = context.params.id ?? '';
  if (!isDocumentId(id)) return jsonError(400, 'invalid_id');

  const body = await readJsonObject(context.request);
  if (!body) return jsonError(400, 'invalid_body');

  const revision = readRevision(body.revision);
  if (revision === null) return jsonError(400, 'invalid_revision');

  const content = readString(body.content);
  const title = readString(body.title);
  if (content === null && title === null) return jsonError(400, 'empty_patch');

  const { supabase, userId } = session;

  try {
    const result =
      content === null
        ? await renameDocument(supabase, userId, id, title ?? '', revision)
        : await saveDocument(supabase, userId, {
            id,
            content,
            revision,
            title: title ?? undefined,
          });
    return saveResponse(result);
  } catch (error) {
    console.warn('[documents] save failed:', error);
    return jsonError(500, 'save_failed');
  }
};

export const DELETE: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');

  const id = context.params.id ?? '';
  if (!isDocumentId(id)) return jsonError(400, 'invalid_id');

  try {
    const result = await deleteDocument(session.supabase, id);
    if (result === 'ok') return jsonResponse({ ok: true });
    return result === 'forbidden' ? jsonError(403, 'forbidden') : jsonError(500, 'delete_failed');
  } catch (error) {
    console.warn('[documents] delete failed:', error);
    return jsonError(500, 'delete_failed');
  }
};
