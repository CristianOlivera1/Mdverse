/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import { renderMarkdown } from '../../src/lib/markdown/render';

const target = () => document.createElement('div');

describe('renderMarkdown', () => {
  it('renders Markdown and gives headings GitHub-friendly ids', async () => {
    const element = target();
    await renderMarkdown(element, '# Hello World\n\nBody text');
    expect(element.querySelector('h1')?.id).toBe('hello-world');
    expect(element.textContent).toContain('Body text');
  });

  it('de-duplicates repeated heading ids sequentially', async () => {
    const element = target();
    await renderMarkdown(element, '# Same\n\n# Same\n\n# Same');
    expect([...element.querySelectorAll('h1')].map((heading) => heading.id)).toEqual([
      'same',
      'same-1',
      'same-2',
    ]);
  });

  it('strips scripts injected through the Markdown source', async () => {
    const element = target();
    await renderMarkdown(element, 'Hello <script>window.__pwned = true</script>');
    expect(element.querySelector('script')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it('opens external links in a new tab but leaves anchors alone', async () => {
    const element = target();
    await renderMarkdown(element, '[ext](https://example.com) [in](#section)');
    const [external, internal] = [...element.querySelectorAll('a')];
    expect(external.getAttribute('target')).toBe('_blank');
    expect(external.getAttribute('rel')).toBe('noopener noreferrer');
    expect(internal.getAttribute('target')).toBeNull();
  });

  it('highlights fenced code blocks with a supported language', async () => {
    const element = target();
    await renderMarkdown(element, '```js\nconst a = 1;\n```');
    expect(element.querySelector('code.hljs')).not.toBeNull();
  });

  it('shows an empty state for blank input', async () => {
    const element = target();
    await renderMarkdown(element, '   ');
    expect(element.textContent).toContain('Nothing to preview yet');
  });

  it('keeps the raw HTML a README relies on: centering, picture and table widths', async () => {
    const element = target();
    await renderMarkdown(
      element,
      `<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://example.com/dark.svg" />
  <img width="50%" alt="logo" src="https://example.com/logo.svg" />
</picture>

## Centered heading
</div>

<table width="100%">
  <tr><td width="60%"><img src="https://example.com/a.png" width="100%" /></td></tr>
</table>`,
    );

    expect(element.querySelector('div[align="center"]')).not.toBeNull();
    expect(element.querySelector('picture > source')?.getAttribute('srcset')).toContain('dark.svg');
    expect(element.querySelector('picture > source')?.getAttribute('media')).toBe(
      '(prefers-color-scheme: dark)',
    );
    expect(element.querySelector('picture img')?.getAttribute('width')).toBe('50%');
    // Markdown inside the wrapper is still parsed, so the heading is a heading.
    expect(element.querySelector('div[align="center"] > h2')?.textContent).toBe('Centered heading');
    expect(element.querySelector('table')?.getAttribute('width')).toBe('100%');
    expect(element.querySelector('td')?.getAttribute('width')).toBe('60%');
    expect(element.querySelector('td img')?.getAttribute('width')).toBe('100%');
  });

  it('keeps a badge row in one paragraph, so the badges can flow in a single row', async () => {
    const element = target();
    await renderMarkdown(
      element,
      '[![Next.js](https://img.shields.io/badge/Next.js-000000)](https://nextjs.org)\n' +
        '[![FFmpeg](https://img.shields.io/badge/FFmpeg-007808)](https://ffmpeg.org)\n' +
        '[![Three.js](https://img.shields.io/badge/Three.js-000000)](https://threejs.org)',
    );

    const paragraph = element.querySelector('p');
    expect(paragraph?.querySelectorAll('img').length).toBe(3);
    // Each badge is its own link; the images are what share the line.
    expect(paragraph?.querySelectorAll('a').length).toBe(3);
  });

  it('drops event handlers and script URLs that arrive as raw HTML', async () => {
    const element = target();
    await renderMarkdown(
      element,
      '<img src="https://example.com/a.png" onerror="window.__pwned = true">' +
        '<a href="javascript:window.__pwned = true">click</a>',
    );

    expect(element.querySelector('img')?.getAttribute('onerror')).toBeNull();
    expect(element.querySelector('a')?.getAttribute('href') ?? '').not.toContain('javascript:');
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it('leaves a linked image to its link instead of the lightbox', async () => {
    const element = target();
    await renderMarkdown(
      element,
      '[![badge](https://img.shields.io/badge/x-y)](https://example.com)',
    );

    expect(element.querySelector('img')?.classList.contains('zoomable')).toBe(false);
  });
});
