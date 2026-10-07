import type { APIRoute } from 'astro';

import { PUBLIC_CACHE_CONTROL, publicDocumentUrl } from '@/lib/documents/publicPage';
import { listPublicDocuments } from '@/lib/documents/repository';
import { escapeHtml } from '@/lib/markdown/toc';
import { getSiteUrl } from '@/lib/supabase/env';
import { createAnonymousSupabaseClient } from '@/lib/supabase/server';

export const prerender = false;

export const GET: APIRoute = async () => {
  const siteUrl = getSiteUrl();
  const db = createAnonymousSupabaseClient();
  const documents = db ? await listPublicDocuments(db) : [];

  const entries = documents
    .map(
      (document) =>
        `<url><loc>${escapeHtml(publicDocumentUrl(siteUrl, document.slug))}</loc>` +
        `<lastmod>${escapeHtml(document.updatedAt)}</lastmod>` +
        '<changefreq>weekly</changefreq></url>',
    )
    .join('');

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    `<url><loc>${escapeHtml(siteUrl)}/</loc><changefreq>daily</changefreq></url>` +
    entries +
    '</urlset>';

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': PUBLIC_CACHE_CONTROL,
    },
  });
};
