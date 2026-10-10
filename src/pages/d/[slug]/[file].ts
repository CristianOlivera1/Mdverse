import type { APIRoute } from 'astro';

import { apiRateLimitedResponse, enforceApiRateLimit } from '@/lib/auth/rate-limit';
import { formatTimestamp } from '@/lib/documents/format';
import { isPublicSlug } from '@/lib/documents/ids';
import {
  buildStandaloneHtml,
  documentDescription,
  LINK_ONLY_CACHE_CONTROL,
  MISSING_CACHE_CONTROL,
  PUBLIC_CACHE_CONTROL,
  publicDocumentUrl,
} from '@/lib/documents/publicPage';
import { getPublicDocument } from '@/lib/documents/repository';
import { renderStaticMarkdown } from '@/lib/markdown/renderStatic';
import { getSiteUrl } from '@/lib/supabase/env';
import { createAnonymousSupabaseClient } from '@/lib/supabase/server';

export const prerender = false;

const KNOWN_FILES = new Set(['document.md', 'document.html']);

export const GET: APIRoute = async ({ params, url, request }) => {
  const limit = enforceApiRateLimit('public-export', request);
  if (!limit.allowed) {
    return apiRateLimitedResponse(limit, 'text/plain; charset=utf-8', 'Too many requests');
  }

  const slug = params.slug ?? '';
  const file = params.file ?? '';

  const db = createAnonymousSupabaseClient();
  const document =
    db && isPublicSlug(slug) && KNOWN_FILES.has(file) ? await getPublicDocument(db, slug) : null;

  if (!document) {
    return new Response('Not found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': MISSING_CACHE_CONTROL,
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  }

  const indexable = document.visibility === 'public';
  const cacheControl = indexable ? PUBLIC_CACHE_CONTROL : LINK_ONLY_CACHE_CONTROL;
  const robots: Record<string, string> = indexable ? {} : { 'X-Robots-Tag': 'noindex, nofollow' };

  const extension = file === 'document.md' ? 'md' : 'html';
  const filename = `${document.slug}.${extension}`;
  const disposition = (kind: 'attachment' | 'inline'): string =>
    `${kind}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

  if (file === 'document.md') {
    return new Response(document.content, {
      headers: {
        'Cache-Control': cacheControl,
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': disposition('attachment'),
        ...robots,
      },
    });
  }

  const pageUrl = publicDocumentUrl(getSiteUrl(), document.slug);
  const rendered = renderStaticMarkdown(document.content);
  const printable = url.searchParams.get('print') === '1';

  const html = buildStandaloneHtml(
    {
      title: document.title,
      url: pageUrl,
      markdownUrl: `${pageUrl}/document.md`,
      description:
        documentDescription(document.content) ||
        `${document.title} - a Markdown document published with Mdverse.`,
      updatedLabel: formatTimestamp(document.updatedAt) || document.updatedAt,
      revision: document.revision,
      bodyHtml: rendered.html,
      headings: rendered.headings,
    },
    { print: printable },
  );

  return new Response(html, {
    headers: {
      'Cache-Control': cacheControl,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': disposition(printable ? 'inline' : 'attachment'),
      ...robots,
    },
  });
};
