import { describe, expect, it } from 'vitest';

import {
  absoluteUrl,
  breadcrumbNode,
  jsonLdGraph,
  jsonLdScript,
  OG_IMAGE,
  organizationNode,
  pageSeoTags,
  socialTags,
  softwareApplicationNode,
  websiteNode,
} from '../../src/lib/seo/meta';

describe('absoluteUrl', () => {
  it('joins a site URL and a path without doubling the slash', () => {
    expect(absoluteUrl('https://mdverse.dev', '/d/notes')).toBe(
      'https://mdverse.dev/d/notes',
    );
    expect(absoluteUrl('https://mdverse.dev/', '/d/notes')).toBe(
      'https://mdverse.dev/d/notes',
    );
    expect(absoluteUrl('https://mdverse.dev///', 'd/notes')).toBe(
      'https://mdverse.dev/d/notes',
    );
  });

  it('leaves an already-absolute URL alone', () => {
    expect(absoluteUrl('https://mdverse.dev', 'https://other.example/x')).toBe(
      'https://other.example/x',
    );
  });
});

describe('socialTags', () => {
  const meta = {
    title: 'Año & <friends>',
    description: 'Notes "quoted" & <tagged>',
    url: 'https://mdverse.example/d/ano-friends',
    imageUrl: 'https://mdverse.example/metadata/og-image.webp',
    type: 'article' as const,
  };

  it('asks for a large card and states the image size', () => {
    const tags = socialTags(meta);
    expect(tags).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(tags).toContain(`content="${OG_IMAGE.width}"`);
    expect(tags).toContain(`content="${OG_IMAGE.height}"`);
    expect(tags).toContain('<meta property="og:type" content="article">');
    expect(tags).toContain('<meta property="og:site_name" content="Mdverse">');
  });

  it('escapes every value it puts in an attribute', () => {
    const tags = socialTags(meta);
    expect(tags).toContain('content="Notes &quot;quoted&quot; &amp; &lt;tagged&gt;"');
    expect(tags).not.toContain('<tagged>');
    expect(tags).toContain('content="Año &amp; &lt;friends&gt;"');
  });

  it('defaults the type to website and the locale to en_US', () => {
    const tags = socialTags({ ...meta, type: undefined });
    expect(tags).toContain('<meta property="og:type" content="website">');
    expect(tags).toContain('<meta property="og:locale" content="en_US">');
  });
});

describe('pageSeoTags', () => {
  const meta = {
    title: 'Mdverse',
    description: 'A Markdown editor.',
    url: 'https://mdverse.example/',
    imageUrl: 'https://mdverse.example/metadata/og-image.webp',
  };

  it('carries the description, a self-referencing canonical and the card block', () => {
    const tags = pageSeoTags(meta);
    expect(tags).toContain('<meta name="description" content="A Markdown editor.">');
    expect(tags).toContain('<link rel="canonical" href="https://mdverse.example/">');
    expect(tags).toContain('<meta property="og:image"');
  });
});

describe('jsonLdScript', () => {
  it('escapes every character that could close the script element', () => {
    const json = jsonLdScript({ name: 'a</script><script>alert(1)</script> & <b>' });
    expect(json).not.toContain('<');
    expect(json).not.toContain('>');
    expect(json).not.toContain('&');
    expect(JSON.parse(json)).toEqual({ name: 'a</script><script>alert(1)</script> & <b>' });
  });
});

describe('jsonLdGraph', () => {
  it('wraps the nodes in one schema.org graph', () => {
    const parsed = JSON.parse(jsonLdGraph([{ '@type': 'WebSite' }])) as Record<string, unknown>;
    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@graph']).toEqual([{ '@type': 'WebSite' }]);
  });
});

describe('site nodes', () => {
  const siteUrl = 'https://mdverse.example';

  it('gives the website and the organization absolute URLs', () => {
    expect(websiteNode(siteUrl)).toMatchObject({
      '@type': 'WebSite',
      url: 'https://mdverse.example/',
      publisher: { '@id': 'https://mdverse.example/#organization' },
    });
    expect(organizationNode(siteUrl)).toMatchObject({
      '@type': 'Organization',
      name: 'Mdverse',
      logo: { '@type': 'ImageObject', width: 512, height: 512 },
    });
  });

  it('describes the editor as a free web application', () => {
    expect(softwareApplicationNode(siteUrl)).toMatchObject({
      '@type': 'SoftwareApplication',
      applicationCategory: 'WebApplication',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    });
  });

  it('numbers the breadcrumb and points every step at an absolute URL', () => {
    const node = breadcrumbNode(siteUrl, [
      { name: 'Mdverse', path: '/' },
      { name: 'Notes', path: '/d/notes' },
    ]) as { itemListElement: Record<string, unknown>[] };

    expect(node.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Mdverse', item: 'https://mdverse.example/' },
      { '@type': 'ListItem', position: 2, name: 'Notes', item: 'https://mdverse.example/d/notes' },
    ]);
  });
});
