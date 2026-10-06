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
});
