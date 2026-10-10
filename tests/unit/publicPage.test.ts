import { describe, expect, it } from 'vitest';

import {
  buildStandaloneHtml,
  documentDescription,
  documentJsonLd,
  readingMinutes,
  seoTags,
} from '../../src/lib/documents/publicPage';
import { isPublicSlug, MAX_SLUG_LENGTH } from '../../src/lib/documents/ids';
import { renderStaticMarkdown, safeHref } from '../../src/lib/markdown/renderStatic';

describe('safeHref', () => {
  it('keeps the schemes a document may link to', () => {
    expect(safeHref('https://example.com/a?b=1&c=2')).toBe('https://example.com/a?b=1&c=2');
    expect(safeHref('http://example.com')).toBe('http://example.com');
    expect(safeHref('mailto:hi@example.com')).toBe('mailto:hi@example.com');
  });

  it('keeps addresses that point inside the document or the site', () => {
    expect(safeHref('#a-heading')).toBe('#a-heading');
    expect(safeHref('/dashboard')).toBe('/dashboard');
    expect(safeHref('./notes/today.md')).toBe('./notes/today.md');
    expect(safeHref('notes/today.md')).toBe('notes/today.md');
  });

  it('defuses everything else, including schemes in mixed case', () => {
    expect(safeHref('javascript:alert(1)')).toBe('#');
    expect(safeHref('JaVaScRiPt:alert(1)')).toBe('#');
    expect(safeHref('vbscript:msgbox(1)')).toBe('#');
    expect(safeHref('data:text/html;base64,PHNjcmlwdD4=')).toBe('#');
    expect(safeHref('file:///etc/passwd')).toBe('#');
    expect(safeHref('')).toBe('');
  });

  it('drops control characters a browser would ignore anyway', () => {
    expect(safeHref('java\nscript:alert(1)')).toBe('#');
  });
});

describe('renderStaticMarkdown', () => {
  it('renders Markdown and collects the headings it assigned ids to', () => {
    const { html, headings } = renderStaticMarkdown('# Title\n\nText\n\n## Second\n');

    expect(html).toContain('<h1 id="title">');
    expect(html).toContain('<h2 id="second">');
    expect(headings).toEqual([
      { id: 'title', text: 'Title', level: 1 },
      { id: 'second', text: 'Second', level: 2 },
    ]);
  });

  it('de-duplicates repeated headings the way the editor does', () => {
    const { headings } = renderStaticMarkdown('# Same\n\n# Same\n\n# Same');
    expect(headings.map((heading) => heading.id)).toEqual(['same', 'same-1', 'same-2']);
  });

  it('drops raw HTML from the source instead of trusting it', () => {
    const { html } = renderStaticMarkdown(
      'Hello <script>window.__pwned = true</script>\n\n<img src=x onerror="alert(1)">\n',
    );

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).toContain('Hello');
  });

  it('neutralises a link whose scheme is not allowed', () => {
    const { html } = renderStaticMarkdown('[click me](javascript:alert(1))');
    expect(html).toContain('href="#"');
    expect(html).not.toContain('javascript:');
  });

  it('marks external links as such and leaves in-page ones alone', () => {
    const { html } = renderStaticMarkdown('[out](https://example.com) and [in](#title)');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('href="#title"');
  });

  it('highlights code it knows and keeps mermaid as a code block', () => {
    const { html } = renderStaticMarkdown(
      '```js\nconst a = 1;\n```\n\n```mermaid\ngraph TD;\n```\n',
    );
    // The alias the author wrote stays on the element, exactly like the preview
    // keeps it; only the `hljs` class is added on top of it.
    expect(html).toContain('class="hljs language-js"');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('class="language-mermaid"');
    expect(html).not.toContain('class="hljs language-mermaid"');
  });

  it('renders an empty document as a message, never as a bare shell', () => {
    expect(renderStaticMarkdown('   ').html).toContain('This document is empty');
  });
});

describe('documentDescription', () => {
  it('takes the first paragraph and strips the syntax off it', () => {
    expect(documentDescription('# Title\n\n**Notes** on [link](https://x) and `code`.')).toBe(
      'Notes on link and code.',
    );
  });

  it('skips headings, lists, quotes and fences before it finds prose', () => {
    expect(
      documentDescription('# Title\n\n- one\n\n> quote\n\n```js\ncode\n```\n\nReal text.'),
    ).toBe('Real text.');
  });

  it('truncates on a word boundary and marks the cut', () => {
    const description = documentDescription('word '.repeat(60), 40);
    expect(description.length).toBeLessThanOrEqual(41);
    expect(description.endsWith('…')).toBe(true);
    expect(description).not.toContain('  ');
  });

  it('answers with an empty string when there is nothing to say', () => {
    expect(documentDescription('')).toBe('');
    expect(documentDescription('# Only a heading')).toBe('');
  });
});

describe('public page metadata', () => {
  const meta = {
    title: 'Año & <friends>',
    slug: 'ano-friends',
    description: 'Notes "quoted" & <tagged>',
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-06T12:00:00Z',
    siteUrl: 'https://mdverse.example',
  };

  it('builds a canonical URL from the site and the slug', () => {
    expect(seoTags(meta)).toContain('https://mdverse.example/d/ano-friends');
  });

  it('escapes the values it puts in attributes', () => {
    const tags = seoTags(meta);
    expect(tags).toContain('content="Notes &quot;quoted&quot; &amp; &lt;tagged&gt;"');
    expect(tags).not.toContain('<tagged>');
  });

  it('keeps the JSON-LD parseable and free of a literal `</script>`', () => {
    const json = documentJsonLd({
      ...meta,
      title: 'Closing </script><script>alert(1)</script>',
    });

    expect(json).not.toContain('<');
    expect(json).not.toContain('>');

    const graph = (JSON.parse(json) as { '@graph': { '@type': string; headline?: string }[] })[
      '@graph'
    ];
    expect(graph.some((node) => node['@type'] === 'Article' && node.headline)).toBe(true);
    expect(graph.some((node) => node['@type'] === 'BreadcrumbList')).toBe(true);
    expect(graph.some((node) => node['@type'] === 'Organization')).toBe(true);
  });

  it('ships the social card, its dimensions and the publisher logo', () => {
    const tags = seoTags(meta);
    expect(tags).toContain('content="https://mdverse.example/metadata/og-image.webp"');
    expect(tags).toContain('<meta property="og:image:width" content="1200">');
    expect(tags).toContain('<meta property="og:image:height" content="630">');
    expect(tags).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(tags).toContain('<meta property="og:type" content="article">');

    const json = documentJsonLd(meta);
    expect(json).toContain('/metadata/android-chrome-512x512.png');
  });

  it('counts reading time by the minute, never zero', () => {
    expect(readingMinutes('one two three')).toBe(1);
    expect(readingMinutes('word '.repeat(450))).toBe(2);
  });
});

describe('isPublicSlug', () => {
  it('accepts what the database generates', () => {
    expect(isPublicSlug('rls-check')).toBe(true);
    expect(isPublicSlug('año-2026')).toBe(true);
    expect(isPublicSlug('rls-check-2')).toBe(true);
  });

  it('rejects anything a slug never contains', () => {
    expect(isPublicSlug('')).toBe(false);
    expect(isPublicSlug('with space')).toBe(false);
    expect(isPublicSlug('with/slash')).toBe(false);
    expect(isPublicSlug('100%')).toBe(false);
    expect(isPublicSlug('a?b')).toBe(false);
    expect(isPublicSlug('a#b')).toBe(false);
    expect(isPublicSlug('quo"te')).toBe(false);
    expect(isPublicSlug('a'.repeat(MAX_SLUG_LENGTH + 1))).toBe(false);
  });
});

describe('buildStandaloneHtml', () => {
  const document = {
    title: 'Export </title><script>alert(1)</script>',
    url: 'https://mdverse.example/d/export',
    markdownUrl: 'https://mdverse.example/d/export/document.md',
    description: 'A document & its description',
    updatedLabel: '6 Oct 2026, 15:22 UTC',
    revision: 3,
    bodyHtml: '<h1 id="h">Hi</h1>',
    headings: [{ id: 'h', text: 'Hi', level: 1 }],
  };

  it('is one file: styles inside, no external requests', () => {
    const html = buildStandaloneHtml(document);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<style>');
    expect(html).not.toContain('src="http');
  });

  it('escapes a title that tries to close its own tag', () => {
    const html = buildStandaloneHtml(document);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('only asks the browser to print when it was told to', () => {
    expect(buildStandaloneHtml(document)).not.toContain('print()');
    expect(buildStandaloneHtml(document, { print: true })).toContain('print()');
  });

  it('links the Markdown source so the file can be traced back', () => {
    expect(buildStandaloneHtml(document)).toContain(
      'href="https://mdverse.example/d/export/document.md"',
    );
  });
});
