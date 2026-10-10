import {
  absoluteUrl,
  breadcrumbNode,
  jsonLdGraph,
  LOGO,
  OG_IMAGE,
  organizationNode,
  pageSeoTags,
  SITE_NAME,
  type PageMeta,
} from '../seo/meta';
import { EXPORT_CSS } from '../markdown/exportTheme';
import { HIGHLIGHT_THEME_CSS } from '../markdown/highlightTheme';
import type { StaticHeading } from '../markdown/renderStatic';
import { escapeHtml } from '../markdown/toc';

export const PUBLIC_CACHE_CONTROL = 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400';

export const LINK_ONLY_CACHE_CONTROL = 'no-store';

export const MISSING_CACHE_CONTROL = 'no-store';

export function publicDocumentUrl(siteUrl: string, slug: string): string {
  return absoluteUrl(siteUrl, `/d/${encodeURIComponent(slug)}`);
}

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

/** The page-level metadata (canonical URL, card image, type) for a published document. */
export function documentPageMeta(meta: PublicDocumentMeta): PageMeta {
  return {
    title: meta.title,
    description: meta.description,
    url: publicDocumentUrl(meta.siteUrl, meta.slug),
    imageUrl: absoluteUrl(meta.siteUrl, OG_IMAGE.path),
    type: 'article',
    locale: 'en_US',
  };
}

export function seoTags(meta: PublicDocumentMeta): string {
  return pageSeoTags(documentPageMeta(meta));
}

export function articleNode(meta: PublicDocumentMeta) {
  const url = publicDocumentUrl(meta.siteUrl, meta.slug);
  return {
    '@type': 'Article',
    headline: meta.title,
    description: meta.description,
    url,
    mainEntityOfPage: url,
    datePublished: meta.createdAt,
    dateModified: meta.updatedAt,
    inLanguage: 'en',
    isAccessibleForFree: true,
    image: [absoluteUrl(meta.siteUrl, OG_IMAGE.path)],
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: absoluteUrl(meta.siteUrl, '/'),
      logo: {
        '@type': 'ImageObject',
        url: absoluteUrl(meta.siteUrl, LOGO.path),
        width: LOGO.width,
        height: LOGO.height,
      },
    },
  };
}

export function documentJsonLd(meta: PublicDocumentMeta): string {
  return jsonLdGraph([
    organizationNode(meta.siteUrl),
    breadcrumbNode(meta.siteUrl, [
      { name: SITE_NAME, path: '/' },
      { name: meta.title, path: `/d/${encodeURIComponent(meta.slug)}` },
    ]),
    articleNode(meta),
  ]);
}

export interface StandaloneDocument {
  readonly title: string;
  readonly url: string;
  readonly markdownUrl: string;
  readonly description: string;
  readonly updatedLabel: string;
  readonly revision: number;
  readonly bodyHtml: string;
  readonly headings: readonly StaticHeading[];
}

function standaloneTableOfContents(headings: readonly StaticHeading[]): string {
  const visible = headings.filter((heading) => heading.level <= 3);
  if (visible.length < 2) return '';

  const min = Math.min(...visible.map((heading) => heading.level));
  const items = visible
    .map(
      (heading) =>
        `<li style="margin-left:${(heading.level - min) * 14}px">` +
        `<a href="#${heading.id}">${escapeHtml(heading.text)}</a></li>`,
    )
    .join('');

  return (
    `<nav aria-label="Contents" style="max-width:820px;margin:24px auto 0;padding:0 24px">` +
    `<p style="margin:0;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#59636e">Contents</p>` +
    `<ul style="margin:8px 0 0;padding-left:18px;font-size:13px;line-height:1.7">${items}</ul></nav>`
  );
}

export function buildStandaloneHtml(
  document: StandaloneDocument,
  options: { print?: boolean } = {},
): string {
  const printable = options.print === true;
  const printer = printable
    ? '<script>addEventListener("load",()=>setTimeout(()=>print(),400))</script>'
    : '';

  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${escapeHtml(document.title)}</title>` +
    `<meta name="description" content="${escapeHtml(document.description)}">` +
    `<link rel="canonical" href="${escapeHtml(document.url)}">` +
    `<link rel="alternate" type="text/markdown" href="${escapeHtml(document.markdownUrl)}">` +
    '<meta name="generator" content="Mdverse">' +
    `<style>${EXPORT_CSS}${HIGHLIGHT_THEME_CSS}` +
    'header{max-width:820px;margin:0 auto;padding:32px 24px 0}' +
    'header h1{margin:0;border:0;font-size:1.9em}' +
    'header p{margin:.4em 0 0;font-size:12px;color:#59636e}' +
    'footer{max-width:820px;margin:0 auto;padding:8px 24px 40px;font-size:12px;color:#59636e}' +
    '</style></head><body>' +
    `<header><h1>${escapeHtml(document.title)}</h1>` +
    `<p>Updated ${escapeHtml(document.updatedLabel)} · revision ${document.revision} · ` +
    `<a href="${escapeHtml(document.url)}">published page</a> · ` +
    `<a href="${escapeHtml(document.markdownUrl)}">Markdown source</a></p></header>` +
    standaloneTableOfContents(document.headings) +
    `<article>${document.bodyHtml}</article>` +
    `<footer>Exported from <a href="${escapeHtml(document.url)}">${escapeHtml(document.url)}</a> with ` +
    `Mdverse. The Markdown is the source of truth; this file is a rendering of it.</footer>` +
    printer +
    '</body></html>'
  );
}
