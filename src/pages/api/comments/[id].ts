import type { APIRoute } from 'astro';
import { apiSession, jsonError, jsonResponse, type ApiSession } from '@/lib/api/http';

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
