/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';

/**
 * KaTeX is a dynamic import, so it can fail on its own - a stale chunk, an
 * offline reload - while the rest of the document is perfectly fine. That failure
 * must not reject the whole render, because the caller has nothing to show when it
 * does: the pane would silently keep whatever it had. The formula falls back to
 * the source the author typed, which is how the export path renders it too.
 */
vi.mock('katex', () => {
  throw new Error('katex unavailable');
});

describe('math when KaTeX cannot load', () => {
  it('resolves, keeps the document, and shows each formula as its source', async () => {
    const { renderMarkdown } = await import('../../src/lib/markdown/render');
    const element = document.createElement('div');

    await expect(
      renderMarkdown(element, '# T\n\nInline $E = mc^2$ y\n\n$$\na^2\n$$', { math: true }),
    ).resolves.toBe(true);

    // The heading and the prose survive the missing chunk.
    expect(element.querySelector('h1')?.textContent).toBe('T');
    expect(element.textContent).toContain('Inline');

    const formulas = [...element.querySelectorAll<HTMLElement>('.kd-math')];
    expect(formulas.map((node) => node.textContent)).toEqual(['$E = mc^2$', '$$a^2$$']);
    expect(formulas.map((node) => node.dataset.display)).toEqual([undefined, 'true']);
    expect(formulas.every((node) => node.classList.contains('kd-math-error'))).toBe(true);
    expect(element.querySelector('.katex')).toBeNull();
  });
});
