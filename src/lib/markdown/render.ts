import { markdownParser } from './extensions';
import {
  addHeadingAnchors,
  attachImageLightbox,
  attachTaskToggles,
  enhanceCodeBlocks,
  renderMath,
  wrapTables,
} from './enhance';
import { attachDiagramControls } from './diagramControls';
import { highlightCode } from './highlight';
import { sanitizeHtml } from './sanitize';
import { slugifyHeading } from './slug';

export interface RenderOptions {
  renderDiagram?: (source: string) => Promise<string>;
  emptyMessage?: string;
  interactive?: boolean;
  math?: boolean;
  onToggleTask?: (index: number) => void;
}

type RenderTarget = HTMLElement & { renderToken?: number };

const DEFAULT_EMPTY = '<p class="text-neutral-600 text-sm not-prose">Nothing to preview yet.</p>';

function renderKey(node: Node): string | null {
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const key = (node as HTMLElement).dataset?.renderKey;
  return key ? `${(node as HTMLElement).tagName}:${key}` : null;
}

function equivalent(a: Node, b: Node): boolean {
  const key = renderKey(a);
  return key !== null && key === renderKey(b);
}

function patch(target: Element, staged: Element): void {
  const current = [...target.childNodes];
  const next = [...staged.childNodes];
  const min = Math.min(current.length, next.length);

  let start = 0;
  let currentEnd = current.length;
  let nextEnd = next.length;

  const same = (a: Node | undefined, b: Node | undefined): boolean =>
    a !== undefined && b !== undefined && (equivalent(a, b) || a.isEqualNode(b));

  while (start < min && same(current[start], next[start])) start++;
  while (currentEnd > start && nextEnd > start && same(current[currentEnd - 1], next[nextEnd - 1])) {
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
    if (!heading.id) heading.id = seen === 0 ? base : `${base}-${seen}`;
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

function sourceKey(source: string): string {
  let hash = 5381;
  for (let i = 0; i < source.length; i++) hash = ((hash << 5) + hash + source.charCodeAt(i)) | 0;
  return `${source.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

async function replaceMermaidBlocks(
  root: Element,
  renderDiagram: RenderOptions['renderDiagram'],
  interactive: boolean,
): Promise<void> {
  if (!renderDiagram) return;
  const blocks = [...root.querySelectorAll<HTMLElement>('pre > code.language-mermaid')];
  for (const code of blocks) {
    const source = code.textContent ?? '';
    const box = document.createElement('div');
    box.className = 'mermaid-box not-prose';
    box.dataset.renderKey = `mermaid:${sourceKey(source)}`;
    try {
      box.innerHTML = await renderDiagram(source);
      if (interactive) attachDiagramControls(box);
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
  const {
    renderDiagram,
    emptyMessage = DEFAULT_EMPTY,
    interactive = true,
    math = true,
    onToggleTask,
  } = options;
  target.renderToken = (target.renderToken ?? 0) + 1;
  const token = target.renderToken;

  const staged = document.createElement('div');

  if (!markdown.trim()) {
    staged.innerHTML = emptyMessage;
  } else {
    const parser = markdownParser(math);
    staged.innerHTML = sanitizeHtml(parser.parse(markdown) as string);

    assignHeadingIds(staged);
    linkExternalAnchors(staged);
    highlightCodeBlocks(staged);
    wrapTables(staged);
    await replaceMermaidBlocks(staged, renderDiagram, interactive);
    if (math) await renderMath(staged);
    if (interactive) {
      enhanceCodeBlocks(staged);
      addHeadingAnchors(staged);
      attachImageLightbox(staged);
      if (onToggleTask) attachTaskToggles(staged, onToggleTask);
    }
  }

  if (token !== target.renderToken) return false;
  patch(target, staged);
  return true;
}
