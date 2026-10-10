import type { APIRoute } from 'astro';
import {
  apiSession,
  jsonError,
  jsonResponse,
  readJsonObject,
  type ApiSession,
} from '@/lib/api/http';
import { colorForAuthor, initialsFor } from '@/lib/comments/api';

export const PATCH: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');
  const { supabase, userId } = session;

  const id = context.params.id ?? '';
  if (!id) return jsonError(400, 'missing_id');

  const body = await readJsonObject(context.request);
  if (!body) return jsonError(400, 'invalid_json');

  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text || text.length > 4000) return jsonError(400, 'invalid_body');

  const { data: comment } = await supabase
    .from('comments')
    .select('document_id, author_id')
    .eq('id', id)
    .maybeSingle();

  if (!comment) return jsonError(404, 'not_found');
  if (comment.author_id !== userId) return jsonError(403, 'forbidden');

  const { data, error } = await supabase
    .from('comments')
    .update({ body: text })
    .eq('id', id)
    .select('id, document_id, author_id, parent_id, body, anchor, resolved, created_at, updated_at')
    .single();

  if (error) {
    console.warn('[comments] update error:', error.message);
    return jsonError(502, 'update_failed');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', data.author_id)
    .maybeSingle();

  const name = profile?.display_name ?? data.author_id.slice(0, 8);

  return jsonResponse({
    id: data.id,
    documentId: data.document_id,
    authorId: data.author_id,
    authorName: name,
    authorInitials: initialsFor(name),
    authorColor: colorForAuthor(data.author_id),
    parentId: data.parent_id ?? null,
    body: data.body,
    anchor: data.anchor ?? null,
    resolved: data.resolved,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    edited: true,
  });
};

export const DELETE: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');
  const { supabase, userId } = session;

  const id = context.params.id ?? '';
  if (!id) return jsonError(400, 'missing_id');

  const { data: comment } = await supabase
    .from('comments')
    .select('document_id, author_id')
    .eq('id', id)
    .maybeSingle();

  if (!comment) return jsonError(404, 'not_found');

  const isAuthor = comment.author_id === userId;
  if (!isAuthor) {
    const canManage = await checkEditorOrOwner(supabase, comment.document_id, userId);
    if (!canManage) return jsonError(403, 'forbidden');
  }

  const { error } = await supabase
    .from('comments')
    .delete()
    .eq('id', id);

  if (error) {
    console.warn('[comments] delete error:', error.message);
    return jsonError(502, 'delete_failed');
  }

  return jsonResponse({ ok: true });
};

async function checkEditorOrOwner(
  supabase: ApiSession['supabase'],
  documentId: string,
  userId: string,
): Promise<boolean> {
  const { data: doc } = await supabase
    .from('documents')
    .select('owner_id')
    .eq('id', documentId)
    .maybeSingle();

  if (doc?.owner_id === userId) return true;

  const { data: collab } = await supabase
    .from('document_collaborators')
    .select('role')
    .eq('document_id', documentId)
    .eq('user_id', userId)
    .maybeSingle();

  return collab?.role === 'editor' || collab?.role === 'admin';
}
