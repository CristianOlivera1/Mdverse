/**
 * What a published document can be taken away as:
 *
 *   /d/:slug/document.md             the Markdown exactly as the owner wrote it
 *   /d/:slug/document.html           one self-contained file, styles inlined
 *   /d/:slug/document.html?print=1   the same file, opening the print dialog
 *
 * Both are read as `anon` (`createAnonymousSupabaseClient`), so they follow the
 * same rule as the page they belong to: published, or 404 — never "you can see it
 * because of who you are", which is what makes them safe to cache and to link.
 */

import type { APIRoute } from 'astro';

import { formatTimestamp } from '@/lib/documents/format';
import { isPublicSlug } from '@/lib/documents/ids';
import {
  documentDescription,
  MISSING_CACHE_CONTROL,
  PUBLIC_CACHE_CONTROL,
  publicDocumentUrl,
} from '@/lib/documents/publicPage';
import { getPublicDocument } from '@/lib/documents/repository';
import { buildStandaloneHtml } from '@/lib/export';
import { renderStaticMarkdown } from '@/lib/markdown/renderStatic';
import { getSiteUrl } from '@/lib/supabase/env';
import { createAnonymousSupabaseClient } from '@/lib/supabase/server';

export const prerender = false;

const KNOWN_FILES = new Set(['document.md', 'document.html']);

export const GET: APIRoute = async ({ params, url }) => {
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

  const extension = file === 'document.md' ? 'md' : 'html';
  // `isPublicSlug` rejects quotes, slashes and spaces, so the name is safe in the
  // header as written; the `filename*` copy is what carries non-ASCII letters.
  const filename = `${document.slug}.${extension}`;
  const disposition = (kind: 'attachment' | 'inline'): string =>
    `${kind}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

  if (file === 'document.md') {
    return new Response(document.content, {
      headers: {
        'Cache-Control': PUBLIC_CACHE_CONTROL,
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': disposition('attachment'),
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
        `${document.title} — a Markdown document published with Mdverse.`,
      updatedLabel: formatTimestamp(document.updatedAt) || document.updatedAt,
      revision: document.revision,
      bodyHtml: rendered.html,
      headings: rendered.headings,
    },
    { print: printable },
  );

  return new Response(html, {
    headers: {
      'Cache-Control': PUBLIC_CACHE_CONTROL,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': disposition(printable ? 'inline' : 'attachment'),
    },
  });
};
