import { marked } from 'marked';

import { highlightCode } from './highlight';
import { sanitizeHtml } from './sanitize';
import { slugifyHeading } from './slug';

export interface RenderOptions {
  renderDiagram?: (source: string) => Promise<string>;
  emptyMessage?: string;
}

type RenderTarget = HTMLElement & { renderToken?: number };

const DEFAULT_EMPTY = '<p class="text-neutral-600 text-sm not-prose">Nothing to preview yet.</p>';

function patch(target: Element, staged: Element): void {
  const current = [...target.childNodes];
  const next = [...staged.childNodes];
  const min = Math.min(current.length, next.length);

  let start = 0;
  let currentEnd = current.length;
  let nextEnd = next.length;

  while (start < min && current[start].isEqualNode(next[start])) start++;
  while (
    currentEnd > start &&
    nextEnd > start &&
    current[currentEnd - 1].isEqualNode(next[nextEnd - 1])
  ) {
    currentEnd--;
    nextEnd--;
  }

  const anchor = current[currentEnd] ?? null;
  for (let i = start; i < currentEnd; i++) current[i].remove();
  for (let i = start; i < nextEnd; i++) target.insertBefore(next[i], anchor);
}

function assignHeadingIds(root: Element): void {
  const used = new Map<string, number>();
  root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach((heading) => {
    const base = slugifyHeading(heading.textContent ?? '');
    const seen = used.get(base) ?? 0;
    heading.id = seen === 0 ? base : `${base}-${seen}`;
    used.set(base, seen + 1);
  });
}

function linkExternalAnchors(root: Element): void {
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    if (!(anchor.getAttribute('href') ?? '').startsWith('#')) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

function highlightCodeBlocks(root: Element): void {
  root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]').forEach((code) => {
    const language = code.className.match(/language-([\w+-]+)/)?.[1];
    if (!language || language === 'mermaid') return;
    const highlighted = highlightCode(code.textContent ?? '', language);
    if (highlighted === null) return;
    code.innerHTML = highlighted;
    code.classList.add('hljs');
  });
}

async function replaceMermaidBlocks(
  root: Element,
  renderDiagram: RenderOptions['renderDiagram'],
): Promise<void> {
  if (!renderDiagram) return;
  const blocks = [...root.querySelectorAll<HTMLElement>('pre > code.language-mermaid')];
  for (const code of blocks) {
    const box = document.createElement('div');
    box.className = 'mermaid-box not-prose';
    try {
      box.innerHTML = await renderDiagram(code.textContent ?? '');
    } catch (error) {
      box.classList.add('mermaid-err');
      box.innerHTML = '<strong>Mermaid diagram error</strong><pre></pre>';
      const pre = box.querySelector('pre');
      if (pre) pre.textContent = String((error as Error).message ?? error).slice(0, 400);
    }
    code.parentElement?.replaceWith(box);
  }
}

export async function renderMarkdown(
  target: RenderTarget,
  markdown: string,
  options: RenderOptions = {},
): Promise<boolean> {
  const { renderDiagram, emptyMessage = DEFAULT_EMPTY } = options;
  target.renderToken = (target.renderToken ?? 0) + 1;
  const token = target.renderToken;

  const staged = document.createElement('div');

  if (!markdown.trim()) {
    staged.innerHTML = emptyMessage;
  } else {
    const parsed = marked.parse(markdown);
    staged.innerHTML = sanitizeHtml(typeof parsed === 'string' ? parsed : await parsed);

    assignHeadingIds(staged);
    linkExternalAnchors(staged);
    highlightCodeBlocks(staged);
    await replaceMermaidBlocks(staged, renderDiagram);
  }

  if (token !== target.renderToken) return false;
  patch(target, staged);
  return true;
}
