import { Marked } from 'marked';
import type { Renderer, RendererObject, Tokens } from 'marked';

import { highlightCode } from './highlight';
import { slugifyHeading } from './slug';
import { escapeHtml } from './toc';
import { safeHref } from './url';

export { safeHref };

export interface StaticHeading {
  readonly id: string;
  readonly text: string;
  readonly level: number;
}

export interface StaticHtml {
  readonly html: string;
  readonly headings: readonly StaticHeading[];
}

export interface StaticRenderOptions {
  readonly emptyMessage?: string;
}

export function renderStaticMarkdown(
  markdown: string,
  options: StaticRenderOptions = {},
): StaticHtml {
  const ids = new Map<string, number>();
  const headings: StaticHeading[] = [];

  const renderer: RendererObject = {
    html: () => '',

    heading(this: Renderer, { tokens, depth }: Tokens.Heading) {
      const inner = this.parser.parseInline(tokens);
      const text = inner.replace(/<[^>]*>/g, '').trim();
      const base = slugifyHeading(text) || 'section';
      const seen = ids.get(base) ?? 0;
      ids.set(base, seen + 1);
      const id = seen === 0 ? base : `${base}-${seen}`;
      headings.push({ id, text, level: depth });
      return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
    },

    code({ text, lang }: Tokens.Code) {
      const language = (lang ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
      const highlighted = language && language !== 'mermaid' ? highlightCode(text, language) : null;
      if (highlighted === null) return false;
      return `<pre><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre>\n`;
    },

    link(this: Renderer, token: Tokens.Link) {
      const href = safeHref(token.href);
      const inner = this.parser.parseInline(token.tokens);
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      const external = /^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${escapeHtml(href)}"${title}${external}>${inner}</a>`;
    },

    image(token: Tokens.Image) {
      const src = safeHref(token.href);
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(token.text)}"${title} />`;
    },
  };

  if (!markdown.trim()) {
    return {
      html:
        options.emptyMessage ?? '<p class="text-sm text-neutral-500">This document is empty.</p>',
      headings: [],
    };
  }

  const parser = new Marked({ renderer });
  // No async extensions are registered, so `parse` is synchronous; the union in
  // its type comes from the ones we do not use.
  const html = parser.parse(markdown) as string;
  return { html, headings };
}
