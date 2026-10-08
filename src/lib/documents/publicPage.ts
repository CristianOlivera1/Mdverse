import { escapeHtml } from '../markdown/toc';

export const PUBLIC_CACHE_CONTROL = 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400';

/** Nothing about a document that is not published may be cached or indexed. */
export const MISSING_CACHE_CONTROL = 'no-store';

export function publicDocumentUrl(siteUrl: string, slug: string): string {
  return `${siteUrl}/d/${encodeURIComponent(slug)}`;
}

/**
 * One line for `<meta name="description">` and Open Graph, from the Markdown
 * source - never from the rendered HTML, so no tag in the document can end up
 * inside the tag.
 */
export function documentDescription(markdown: string, max = 160): string {
  const blocks = markdown
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim());

  const paragraph =
    blocks.find((block) => block && !/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|\|)/.test(block)) ?? '';

  const plain = paragraph
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:#{1,6}\s*|[-*+]\s|\d+[.)]\s|>+\s*)/, '')
    .replace(/[`*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (plain.length <= max) return plain;

  const cut = plain.lastIndexOf(' ', max - 1);
  return `${plain.slice(0, cut > 0 ? cut : max - 1).trimEnd()}…`;
}

/** Read time for the page header: 200 words a minute, never zero. */
export function readingMinutes(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export interface PublicDocumentMeta {
  readonly title: string;
  readonly slug: string;
  readonly description: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly siteUrl: string;
}

export function jsonLdForDocument(meta: PublicDocumentMeta): string {
  const url = publicDocumentUrl(meta.siteUrl, meta.slug);
  const json = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: meta.title,
    description: meta.description,
    url,
    mainEntityOfPage: url,
    datePublished: meta.createdAt,
    dateModified: meta.updatedAt,
    inLanguage: 'en',
    isAccessibleForFree: true,
    publisher: { '@type': 'Organization', name: 'Mdverse', url: meta.siteUrl },
  });

  return json.replace(/[<>&]/g, (character) => {
    if (character === '<') return '\\u003c';
    if (character === '>') return '\\u003e';
    return '\\u0026';
  });
}

/** `<meta>` tags every public document page carries. */
export function seoTags(meta: PublicDocumentMeta): string {
  const url = publicDocumentUrl(meta.siteUrl, meta.slug);
  const tags = [
    `<meta name="description" content="${escapeHtml(meta.description)}">`,
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}">`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<meta property="og:site_name" content="Mdverse">`,
    `<meta property="article:modified_time" content="${escapeHtml(meta.updatedAt)}">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}">`,
  ];
  return tags.join('');
}
