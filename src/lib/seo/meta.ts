import { escapeHtml } from '../markdown/toc';

export const SITE_NAME = 'Mdverse';

export const SITE_DESCRIPTION =
  'Mdverse is a Markdown editor with live preview, diagrams, code highlighting, comments and real-time collaboration, plus a read-only address for everything you publish.';

export const OG_IMAGE = {
  path: '/metadata/og-image.webp',
  width: 1200,
  height: 630,
  type: 'image/webp',
  alt: 'The Mdverse editor: Markdown on the left, a live preview on the right.',
} as const;

export const LOGO = {
  path: '/metadata/android-chrome-512x512.png',
  width: 512,
  height: 512,
} as const;

export const MANIFEST_PATH = '/manifest.webmanifest';

export const THEME_COLOR = '#000000';

export function absoluteUrl(siteUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = siteUrl.trim().replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export interface PageMeta {
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly imageUrl: string;
  readonly type?: 'website' | 'article';
  readonly locale?: string;
}

export function socialTags(meta: PageMeta): string {
  const tags = [
    `<meta property="og:type" content="${meta.type ?? 'website'}">`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">`,
    `<meta property="og:locale" content="${escapeHtml(meta.locale ?? 'en_US')}">`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}">`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}">`,
    `<meta property="og:url" content="${escapeHtml(meta.url)}">`,
    `<meta property="og:image" content="${escapeHtml(meta.imageUrl)}">`,
    `<meta property="og:image:type" content="${OG_IMAGE.type}">`,
    `<meta property="og:image:width" content="${OG_IMAGE.width}">`,
    `<meta property="og:image:height" content="${OG_IMAGE.height}">`,
    `<meta property="og:image:alt" content="${escapeHtml(OG_IMAGE.alt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(meta.imageUrl)}">`,
    `<meta name="twitter:image:alt" content="${escapeHtml(OG_IMAGE.alt)}">`,
  ];
  return tags.join('');
}

export function pageSeoTags(meta: PageMeta): string {
  return [
    `<meta name="description" content="${escapeHtml(meta.description)}">`,
    `<link rel="canonical" href="${escapeHtml(meta.url)}">`,
    socialTags(meta),
  ].join('');
}

const JSON_ESCAPES: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
};

export function jsonLdScript(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&]/g,
    (character) => JSON_ESCAPES[character] ?? character,
  );
}

export function jsonLdGraph(nodes: readonly unknown[]): string {
  return jsonLdScript({ '@context': 'https://schema.org', '@graph': nodes });
}

export function organizationId(siteUrl: string): string {
  return `${absoluteUrl(siteUrl, '/')}#organization`;
}

export function organizationNode(siteUrl: string) {
  return {
    '@type': 'Organization',
    '@id': organizationId(siteUrl),
    name: SITE_NAME,
    url: absoluteUrl(siteUrl, '/'),
    logo: {
      '@type': 'ImageObject',
      url: absoluteUrl(siteUrl, LOGO.path),
      width: LOGO.width,
      height: LOGO.height,
    },
  };
}

export function websiteNode(siteUrl: string) {
  return {
    '@type': 'WebSite',
    '@id': `${absoluteUrl(siteUrl, '/')}#website`,
    name: SITE_NAME,
    url: absoluteUrl(siteUrl, '/'),
    description: SITE_DESCRIPTION,
    inLanguage: 'en',
    publisher: { '@id': organizationId(siteUrl) },
  };
}

export function softwareApplicationNode(siteUrl: string) {
  return {
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    applicationCategory: 'WebApplication',
    operatingSystem: 'Any',
    url: absoluteUrl(siteUrl, '/'),
    description: SITE_DESCRIPTION,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    screenshot: absoluteUrl(siteUrl, OG_IMAGE.path),
  };
}

export interface Crumb {
  readonly name: string;
  readonly path: string;
}

export function breadcrumbNode(siteUrl: string, trail: readonly Crumb[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(siteUrl, crumb.path),
    })),
  };
}
