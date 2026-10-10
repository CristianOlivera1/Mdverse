import type { APIRoute } from 'astro';

import { apiSession, jsonError, readJsonObject } from '@/lib/api/http';
import { apiRateLimitedResponse, enforceApiRateLimit } from '@/lib/auth/rate-limit';
import { buildDocxBlob, fetchDocxImages } from '@/lib/export/docxDocument';

const CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

export const POST: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');

  const limit = enforceApiRateLimit('docx', context.request, session.userId);
  if (!limit.allowed) return apiRateLimitedResponse(limit);

  const body = await readJsonObject(context.request);
  if (!body) return jsonError(400, 'invalid_json');

  const markdown = typeof body.markdown === 'string' ? body.markdown : '';
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Document';

  if (!markdown.trim()) return jsonError(400, 'empty');
  if (markdown.length > MAX_MARKDOWN_BYTES) return jsonError(413, 'too_large');

  try {
    // Image fetch failures degrade to hyperlink fallbacks; they must never 502 the export.
    let images;
    try {
      images = await fetchDocxImages(markdown);
    } catch {
      images = undefined;
    }
    const blob = await buildDocxBlob(markdown, { title }, images);
    const filename = `${safeFilename(title)}.docx`;

    return new Response(blob, {
      status: 200,
      headers: {
        'content-type': CONTENT_TYPE,
        'content-disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    console.warn('[export/docx] conversion failed:', error);
    return jsonError(502, 'conversion_failed');
  }
};

function safeFilename(title: string): string {
  const cleaned = title
    .replace(/["\\/\r\n\t]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || 'document';
}
