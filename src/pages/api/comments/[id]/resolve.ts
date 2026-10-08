import type { APIRoute } from 'astro';
import { apiSession, jsonError, jsonResponse, type ApiSession } from '@/lib/api/http';

export const POST: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');
  const { supabase, userId } = session;

  const id = context.params.id ?? '';
  if (!id) return jsonError(400, 'missing_id');

  const { data: comment } = await supabase
    .from('comments')
    .select('document_id, author_id, resolved')
    .eq('id', id)
    .maybeSingle();

  if (!comment) return jsonError(404, 'not_found');
  if (comment.resolved) return jsonResponse({ ok: true });

  const canResolve = await checkEditorOrOwner(supabase, comment.document_id, userId);
  if (!canResolve) return jsonError(403, 'forbidden');

  const { error } = await supabase
    .from('comments')
    .update({ resolved: true })
    .eq('id', id);

  if (error) {
    console.warn('[comments] resolve error:', error.message);
    return jsonError(502, 'resolve_failed');
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
