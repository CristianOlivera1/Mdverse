import type { APIRoute } from 'astro';

import { apiSession, jsonError, jsonResponse, type ApiSession } from '@/lib/api/http';
import { apiRateLimitedResponse, enforceApiRateLimit } from '@/lib/auth/rate-limit';
import { isDocumentId } from '@/lib/documents/ids';
import { MAX_IMAGE_BYTES } from '@/lib/editor/imageUpload';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
]);

const BUCKET = 'doc-images';

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

function sniffImageMime(b: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 3) === 'GIF') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'image/avif';
  return null;
}

export const POST: APIRoute = async (context) => {
  try {
    const session = apiSession(context);
    if (!session) return jsonError(401, 'unauthenticated');
    const { supabase, userId } = session;

    const limit = enforceApiRateLimit('upload', context.request, userId);
    if (!limit.allowed) return apiRateLimitedResponse(limit);

    const declared = Number(context.request.headers.get('content-length') ?? '0');
    if (declared > MAX_IMAGE_BYTES + 64 * 1024) return jsonError(413, 'file_too_large');

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

    if (file.size > MAX_IMAGE_BYTES) return jsonError(413, 'file_too_large');

    const hasAccess = await checkEditAccess(supabase, documentId, userId);
    if (!hasAccess) return jsonError(403, 'forbidden');

    const buffer = await file.arrayBuffer();
    const mime = sniffImageMime(new Uint8Array(buffer));
    if (!mime || !ALLOWED_MIME.has(mime)) return jsonError(415, 'unsupported_format');

    const storagePath = `${userId}/${documentId}/${crypto.randomUUID()}.${EXT[mime]}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: mime,
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
          contentType: mime,
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
