import type { APIRoute } from 'astro';

import { PUBLIC_CACHE_CONTROL, publicDocumentUrl } from '@/lib/documents/publicPage';
import { listPublicDocuments } from '@/lib/documents/repository';
import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/seo/meta';
import { getSiteUrl } from '@/lib/supabase/env';
import { createAnonymousSupabaseClient } from '@/lib/supabase/server';

export const prerender = false;

function linkText(value: string): string {
  return (
    value
      .replace(/[[\]()\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Untitled'
  );
}

export const GET: APIRoute = async () => {
  const siteUrl = getSiteUrl();
  const db = createAnonymousSupabaseClient();
  const documents = db ? await listPublicDocuments(db) : [];

  const lines = [
    `# ${SITE_NAME}`,
    '',
    `> ${SITE_DESCRIPTION}`,
    '',
    'Mdverse runs entirely in the browser and stores documents in Postgres. A document is private',
    'until its owner publishes it, at which point it gets a stable read-only address under /d/.',
    'The editor, the preview and every export work without an account.',
    '',
    '## Main pages',
    '',
    `- [Mdverse editor](${siteUrl}/): the Markdown editor and live preview.`,
    `- [Sitemap](${siteUrl}/sitemap.xml): every indexable URL.`,
    '',
  ];

  if (documents.length > 0) {
    lines.push('## Published documents', '');
    for (const document of documents) {
      const url = publicDocumentUrl(siteUrl, document.slug);
      lines.push(`- [${linkText(document.title)}](${url}): updated ${document.updatedAt}.`);
    }
    lines.push('');
  }

  return new Response(`${lines.join('\n')}\n`, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': PUBLIC_CACHE_CONTROL,
    },
  });
};
