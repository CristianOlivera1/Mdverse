/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';

import { markdownParser } from '../../src/lib/markdown/extensions';
import { renderMarkdown } from '../../src/lib/markdown/render';
import { taskToggleAt } from '../../src/lib/markdown/taskList';

const target = () => document.createElement('div');

/** The parser on its own, before KaTeX claims the placeholders. */
function parse(markdown: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = markdownParser(true).parse(markdown) as string;
  return host;
}

const diagram = async () =>
  '<svg viewBox="0 0 400 200" width="100%"><rect width="400" height="200" /></svg>';

describe('markdown dialect', () => {
  it('turns ==text== into a highlight, and leaves == alone in prose', async () => {
    const element = target();
    await renderMarkdown(element, 'Esto es ==importante== y esto no: a == b.\n\n1 == 2 == 3');
    const marks = [...element.querySelectorAll('mark')];
    expect(marks.map((mark) => mark.textContent)).toEqual(['importante']);
    expect(element.textContent).toContain('a == b');
  });

  it('keeps a formula as a placeholder carrying its source', () => {
    const node = parse('Energía: $E = mc^2$').querySelector<HTMLElement>('.kd-math');
    expect(node?.dataset.tex).toBe('E = mc^2');
    expect(node?.dataset.display).toBeUndefined();
  });

  it('marks a display formula, and never rewrites prices', () => {
    const element = parse('Cuesta $5 y $10, no es una fórmula.\n\n$$\na^2 + b^2\n$$');
    expect(element.textContent).toContain('Cuesta $5 y $10');

    const display = element.querySelector<HTMLElement>('.kd-math');
    expect(display?.dataset.display).toBe('true');
    expect(display?.dataset.tex).toBe('a^2 + b^2');
  });

  it('renders a formula with KaTeX when math is on', async () => {
    const element = target();
    await renderMarkdown(element, '$x^2$');
    expect(element.querySelector('.katex')).not.toBeNull();
  });

  it('renders GFM footnotes and keeps their own heading id', async () => {
    const element = target();
    await renderMarkdown(element, 'Texto[^a].\n\n[^a]: La nota.', { math: false });

    const reference = element.querySelector('[data-footnote-ref]');
    expect(reference?.getAttribute('href')).toBe('#footnote-a');

    const section = element.querySelector('section.footnotes');
    expect(section?.textContent).toContain('La nota.');

    // The section ships `id="footnote-label"` and every reference points at it, so
    // heading ids must not be regenerated over it.
    expect(element.querySelector('h2')?.id).toBe('footnote-label');
  });
});

describe('interactive preview', () => {
  it('adds a language label and a copy button to a fenced block', async () => {
    const element = target();
    await renderMarkdown(element, '```js\nconst a = 1;\n```', { math: false });

    const wrapper = element.querySelector('.code-block');
    expect(wrapper?.querySelector('.code-lang')?.textContent).toBe('js');
    expect(wrapper?.querySelector('.code-copy')?.textContent).toBe('Copy');
    // The bar is a sibling: a `div` inside `pre` is invalid HTML.
    expect(element.querySelector('pre > .code-bar')).toBeNull();
  });

  it('scrolls a wide table inside its own frame', async () => {
    const element = target();
    await renderMarkdown(element, '| a | b |\n| - | - |\n| 1 | 2 |', { math: false });
    expect(element.querySelector('.table-scroll > table')).not.toBeNull();
  });

  it('adds a heading anchor without touching the heading text', async () => {
    const element = target();
    await renderMarkdown(element, '## Sección', { math: false });

    const heading = element.querySelector('h2');
    expect(heading?.textContent).toBe('Sección');
    const anchor = heading?.querySelector<HTMLAnchorElement>('a.heading-anchor');
    // The slug keeps accented letters, exactly like the database's slugify.
    expect(anchor?.getAttribute('href')).toBe('#sección');
    expect(anchor?.textContent).toBe('');
  });

  it('makes task checkboxes editable and reports the index', async () => {
    const element = target();
    const seen: number[] = [];
    await renderMarkdown(element, '- [ ] uno\n- [x] dos', {
      math: false,
      onToggleTask: (index) => seen.push(index),
    });

    const boxes = [...element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes).toHaveLength(2);
    expect(boxes.every((box) => !box.disabled)).toBe(true);

    boxes[1].click();
    expect(seen).toEqual([1]);
    // The click is not applied locally: the source edit drives the next render.
    expect(boxes[1].checked).toBe(true);
  });

  it('leaves the checkboxes alone when nobody can edit the source', async () => {
    const element = target();
    await renderMarkdown(element, '- [ ] uno', { math: false });
    expect(element.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
  });

  it('omits every affordance when rendering for an export', async () => {
    const element = target();
    await renderMarkdown(element, '# T\n\n```js\nconst a = 1;\n```\n\n$E = mc^2$', {
      interactive: false,
      math: false,
    });

    expect(element.querySelector('.code-copy')).toBeNull();
    expect(element.querySelector('.heading-anchor')).toBeNull();
    expect(element.querySelector('.katex')).toBeNull();
    expect(element.textContent).toContain('$E = mc^2$');
  });
});

describe('diagram controls', () => {
  it('wraps the drawing in a viewport with a toolbar', async () => {
    const element = target();
    await renderMarkdown(element, '```mermaid\ngraph TD;A-->B\n```', { renderDiagram: diagram });

    const box = element.querySelector('.mermaid-box');
    expect(box?.querySelector('.diagram-viewport svg')).not.toBeNull();
    expect(box?.querySelectorAll('.diagram-bar button')).toHaveLength(4);
  });

  it('keeps the same node across renders so an adjusted view survives', async () => {
    const element = target();
    const markdown = '```mermaid\ngraph TD;A-->B\n```';

    await renderMarkdown(element, markdown, { renderDiagram: diagram });
    const first = element.querySelector<HTMLElement>('.mermaid-box');
    const stage = first?.querySelector<HTMLElement>('.diagram-stage');
    if (stage) stage.style.transform = 'scale(2)';

    await renderMarkdown(element, markdown, { renderDiagram: diagram });
    const second = element.querySelector<HTMLElement>('.mermaid-box');

    expect(second).toBe(first);
    expect(second?.querySelector<HTMLElement>('.diagram-stage')?.style.transform).toBe('scale(2)');
  });

  it('replaces the node when the diagram source changes', async () => {
    const element = target();
    await renderMarkdown(element, '```mermaid\ngraph TD;A-->B\n```', { renderDiagram: diagram });
    const first = element.querySelector('.mermaid-box');

    await renderMarkdown(element, '```mermaid\ngraph TD;A-->C\n```', { renderDiagram: diagram });
    expect(element.querySelector('.mermaid-box')).not.toBe(first);
  });
});

describe('taskToggleAt', () => {
  it('toggles the requested item between pending and done', () => {
    const markdown = '- [ ] uno\n- [x] dos\n';
    expect(taskToggleAt(markdown, 0)?.insert).toBe('x');
    expect(taskToggleAt(markdown, 1)?.insert).toBe(' ');
    expect(taskToggleAt(markdown, 2)).toBeNull();
  });

  it('writes only the marker character', () => {
    const markdown = '- [ ] uno';
    const toggle = taskToggleAt(markdown, 0);
    expect(toggle).not.toBeNull();
    if (!toggle) return;
    expect(markdown.slice(toggle.from, toggle.to)).toBe(' ');
    expect(markdown.slice(0, toggle.from) + toggle.insert + markdown.slice(toggle.to)).toBe(
      '- [x] uno',
    );
  });

  it('counts nested items in document order', () => {
    const markdown = '- [ ] padre\n  - [ ] hijo\n- [x] hermano\n';
    expect(taskToggleAt(markdown, 1)?.insert).toBe('x');
    const nested = taskToggleAt(markdown, 1);
    if (!nested) return;
    expect(markdown.slice(0, nested.from).split('\n').length).toBe(2);
  });

  it('ignores a checkbox that only looks like a task inside a code block', () => {
    const markdown = '```\n- [ ] no es tarea\n```\n\n- [ ] sí lo es\n';
    const toggle = taskToggleAt(markdown, 0);
    expect(toggle).not.toBeNull();
    if (!toggle) return;
    expect(markdown.slice(toggle.from, toggle.to)).toBe(' ');
    // The marker that was found is the one after the closing fence.
    expect(toggle.from).toBe(markdown.lastIndexOf('- [ ]') + 3);
  });
});

describe('diagram controls, wheel and buttons', () => {
  it('zooms with the buttons and reports the level', async () => {
    const element = target();
    document.body.append(element);
    await renderMarkdown(element, '```mermaid\ngraph TD;A-->B\n```', { renderDiagram: diagram });

    const box = element.querySelector<HTMLElement>('.mermaid-box');
    const level = box?.querySelector<HTMLElement>('[data-diagram="level"]');
    const before = level?.textContent;

    box?.querySelector<HTMLElement>('[data-diagram="in"]')?.click();
    expect(level?.textContent).not.toBe(before);
    expect(level?.textContent).toBe('125%');

    box?.querySelector<HTMLElement>('[data-diagram="fit"]')?.click();
    element.remove();
  });

  it('does not hijack a plain wheel over the drawing', async () => {
    const element = target();
    await renderMarkdown(element, '```mermaid\ngraph TD;A-->B\n```', { renderDiagram: diagram });
    const viewport = element.querySelector<HTMLElement>('.diagram-viewport');
    if (!viewport) return;

    const plain = new WheelEvent('wheel', { deltaY: -100, cancelable: true, bubbles: true });
    viewport.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);

    const pinch = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    });
    viewport.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(true);
  });
});

describe('copy button', () => {
  it('writes the block text to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const element = target();
    await renderMarkdown(element, '```js\nconst a = 1;\n```', { math: false });
    element.querySelector<HTMLButtonElement>('.code-copy')?.click();

    expect(writeText).toHaveBeenCalledWith('const a = 1;\n');
  });
});
