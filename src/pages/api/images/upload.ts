import type { APIRoute } from 'astro';

import { apiSession, jsonError, jsonResponse, type ApiSession } from '@/lib/api/http';
import { isDocumentId } from '@/lib/documents/ids';

const MAX_BYTES = 5 * 1024 * 1024; 

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/avif',
]);

const BUCKET = 'doc-images';

export const POST: APIRoute = async (context) => {
  try {
    const session = apiSession(context);
    if (!session) return jsonError(401, 'unauthenticated');
    const { supabase, userId } = session;

    let form: FormData;
    try {
      form = await context.request.formData();
    } catch {
      return jsonError(400, 'invalid_form');
    }

    const file = form.get('file');
    const documentId = String(form.get('documentId') ?? '');

    if (!(file instanceof File)) return jsonError(400, 'file_missing');
    if (!isDocumentId(documentId)) return jsonError(400, 'invalid_document_id');

    if (!ALLOWED_MIME.has(file.type)) return jsonError(415, 'unsupported_format');
    if (file.size > MAX_BYTES) return jsonError(413, 'file_too_large');

    const hasAccess = await checkEditAccess(supabase, documentId, userId);
    if (!hasAccess) return jsonError(403, 'forbidden');

    const ext = file.type === 'image/svg+xml'
      ? 'svg'
      : (file.type.split('/')[1] ?? 'bin');
    const storagePath = `${userId}/${documentId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const buffer = await file.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type,
        cacheControl: '31536000',
        upsert: false,
      });

    if (uploadError) {
      console.warn('[images] user-client upload failed, trying admin:', uploadError.message);
      const adminClient = await getAdminClient();
      if (!adminClient) {
        console.error('[images] no admin client available');
        return jsonError(502, 'upload_failed');
      }

      const { error: adminErr } = await adminClient.storage
        .from(BUCKET)
        .upload(storagePath, buffer, {
          contentType: file.type,
          cacheControl: '31536000',
          upsert: false,
        });

      if (adminErr) {
        console.error('[images] admin upload also failed:', adminErr.message);
        return jsonError(502, 'upload_failed');
      }

      const { data: pub } = adminClient.storage.from(BUCKET).getPublicUrl(storagePath);
      return jsonResponse({ url: pub.publicUrl, path: storagePath });
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    return jsonResponse({ url: pub.publicUrl, path: storagePath });

  } catch (err) {
    console.error('[images] unexpected error:', err);
    return jsonError(500, 'internal_error');
  }
};

async function getAdminClient() {
  try {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin');
    return createAdminSupabaseClient();
  } catch {
    return null;
  }
}

async function checkEditAccess(
  supabase: ApiSession['supabase'],
  documentId: string,
  userId: string,
): Promise<boolean> {
  const { data: doc } = await supabase
    .from('documents')
    .select('owner_id')
    .eq('id', documentId)
    .maybeSingle();

  if (!doc) return false;
  if (doc.owner_id === userId) return true;

  const { data: collab } = await supabase
    .from('document_collaborators')
    .select('role')
    .eq('document_id', documentId)
    .eq('user_id', userId)
    .maybeSingle();

  return collab?.role === 'editor' || collab?.role === 'admin';
}
