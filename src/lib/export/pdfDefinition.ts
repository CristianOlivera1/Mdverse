import { marked } from 'marked';
import type { Tokens } from 'marked';

import { safeHref } from '../markdown/url';

export type PdfContent = Record<string, unknown>;

interface InlineStyle {
  bold?: boolean;
  italics?: boolean;
  decoration?: 'underline' | 'lineThrough';
  style?: string;
  link?: string;
  color?: string;
  background?: string;
}

export interface PdfMeta {
  readonly title: string;
  readonly brand?: string;
  readonly url?: string;
  readonly updatedLabel?: string;
}

export interface PdfDocumentDefinition {
  pageSize: string;
  pageMargins: [number, number, number, number];
  info: Record<string, string>;
  content: unknown[];
  images?: Record<string, string>;
  styles: Record<string, unknown>;
  defaultStyle: Record<string, unknown>;
  header?: (currentPage: number) => unknown;
  footer?: (currentPage: number, pageCount: number) => unknown;
}

const CONTENT_WIDTH = 595.28 - 46 * 2;

const HEADINGS: Record<number, string> = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
  6: 'h6',
};

function inline(tokens: readonly Tokens.Generic[] = []): unknown[] {
  const runs: unknown[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'escape': {
        runs.push({ text: token.text });
        break;
      }
      case 'br': {
        runs.push({ text: '\n' });
        break;
      }
      case 'strong': {
        runs.push({ text: inline(token.tokens), ...({ bold: true } as InlineStyle) });
        break;
      }
      case 'em': {
        runs.push({ text: inline(token.tokens), ...({ italics: true } as InlineStyle) });
        break;
      }
      case 'del': {
        runs.push({ text: inline(token.tokens), ...({ decoration: 'lineThrough' } as InlineStyle) });
        break;
      }
      case 'codespan': {
        runs.push({ text: token.text, style: 'codespan' });
        break;
      }
      case 'link': {
        const href = safeHref(token.href);
        runs.push({
          text: inline(token.tokens) as unknown,
          link: href === '#' ? undefined : href,
          color: href === '#' ? undefined : '#2563eb',
          decoration: href === '#' ? undefined : 'underline',
        });
        break;
      }
      case 'image': {
        runs.push({
          text: token.text || 'image',
          italics: true,
          color: '#6b7280',
        });
        break;
      }
      case 'html': {
        const text = stripTags(token.text);
        if (text) runs.push({ text });
        break;
      }
      default: {
        const text = (token as { text?: unknown }).text;
        if (typeof text === 'string' && text) runs.push({ text });
        break;
      }
    }
  }

  return runs.length > 0 ? runs : [{ text: '' }];
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


function listItem(item: Tokens.ListItem): unknown {
  const blocks = blocksOf(item.tokens);
  const nested = blocks.filter((node) => 'ul' in node || 'ol' in node);
  const leading = blocks.filter((node) => !('ul' in node || 'ol' in node));

  const head: PdfContent =
    leading.length === 1 && typeof leading[0].text !== 'undefined'
      ? { ...(leading[0] as PdfContent) }
      : { stack: leading.length > 0 ? leading : [{ text: '' }] };

  if (item.task) {
    const marker = { text: item.checked ? '☑  ' : '☐  ' };
    if (Array.isArray(head.text)) head.text = [marker, ...head.text];
    else head.text = [marker, ...(toRuns(head.text) as unknown[])];
  }

  for (const child of nested) {
    if ('ul' in child) head.ul = child.ul;
    if ('ol' in child) head.ol = child.ol;
  }

  return head;
}

function toRuns(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return [{ text: String(value ?? '') }];
}


function blocksOf(tokens: readonly Tokens.Generic[] = []): PdfContent[] {
  const result: PdfContent[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'space':
      case 'def':
      case 'html':
        break;

      case 'heading': {
        const depth = Math.min(Math.max(token.depth, 1), 6);
        result.push({ text: inline(token.tokens), style: HEADINGS[depth] });
        break;
      }

      case 'paragraph': {
        const only = token.tokens?.length === 1 ? token.tokens[0] : null;
        if (only?.type === 'image' && safeHref((only as Tokens.Image).href)) {
          result.push(imageBlock(only as Tokens.Image));
          break;
        }
        result.push({ text: inline(token.tokens), style: 'paragraph' });
        break;
      }

      case 'text': {
        result.push({ text: inline(token.tokens), style: 'paragraph' });
        break;
      }

      case 'code': {
        if (token.lang === 'mermaid') {
          result.push({ text: 'Mermaid diagram (source)', style: 'diagramLabel' });
          result.push({ text: token.text, style: 'code' });
          break;
        }
        result.push({ text: token.text, style: 'code' });
        break;
      }

      case 'blockquote': {
        result.push({ stack: blocksOf(token.tokens), style: 'blockquote' });
        break;
      }

      case 'list': {
        const items = token.items.map(listItem);
        const node: PdfContent = token.ordered ? { ol: items } : { ul: items };
        if (token.ordered && typeof token.start === 'number' && token.start !== 1) {
          node.start = token.start;
        }
        node.markerColor = '#6366f1';
        result.push({ ...node, margin: [0, 2, 0, 8] });
        break;
      }

      case 'table': {
        result.push(tableBlock(token as Tokens.Table));
        break;
      }

      case 'hr': {
        result.push({
          canvas: [
            { type: 'line', x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 1, lineColor: '#d1d5db' },
          ],
          margin: [0, 6, 0, 14],
        });
        break;
      }

      default: {
        const text = (token as { text?: unknown }).text;
        if (typeof text === 'string' && text.trim()) {
          result.push({ text, style: 'paragraph' });
        }
        break;
      }
    }
  }

  return result;
}

function imageBlock(token: Tokens.Image): PdfContent {
  return {
    image: safeHref(token.href),
    fit: [CONTENT_WIDTH, 380],
    alignment: 'center',
    margin: [0, 6, 0, 12],
  };
}

/**
 * Recursively collects every node in a built definition that points at an
 * external image (anything that is not already an inline `data:` URL). pdfmake
 * can only draw images that exist in its virtual file system, so the browser
 * shell uses this list to inline them before rendering.
 */
export function collectImageNodes(content: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;

    const node = value as Record<string, unknown>;
    if (typeof node.image === 'string' && !/^data:/i.test(node.image)) found.push(node);
    for (const key of Object.keys(node)) {
      if (key === 'image') continue;
      visit(node[key]);
    }
  };

  visit(content);
  return found;
}

function tableBlock(token: Tokens.Table): PdfContent {
  const columns = token.header.length;
  const body: unknown[][] = [];

  body.push(
    token.header.map((cell, index) => ({
      text: inline(cell.tokens),
      style: 'tableHeader',
      alignment: alignmentFor(token.align?.[index] ?? cell.align),
    })),
  );

  for (const row of token.rows) {
    body.push(
      row.map((cell, index) => ({
        text: inline(cell.tokens),
        alignment: alignmentFor(token.align?.[index] ?? cell.align),
      })),
    );
  }

  return {
    table: {
      headerRows: 1,
      widths: Array.from({ length: columns }, () => '*'),
      body,
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#e2e8f0',
      vLineColor: () => '#e2e8f0',
      paddingLeft: () => 8,
      paddingRight: () => 8,
      paddingTop: () => 5,
      paddingBottom: () => 5,
    },
    margin: [0, 4, 0, 12],
  };
}

function alignmentFor(align: string | null | undefined): string | undefined {
  if (align === 'center') return 'center';
  if (align === 'right') return 'right';
  return 'left';
}


const STYLES: Record<string, unknown> = {
  h1: { fontSize: 24, bold: true, color: '#111827', margin: [0, 18, 0, 8] },
  h2: { fontSize: 18, bold: true, color: '#111827', margin: [0, 16, 0, 6] },
  h3: { fontSize: 15, bold: true, color: '#111827', margin: [0, 14, 0, 5] },
  h4: { fontSize: 13, bold: true, color: '#1f2937', margin: [0, 12, 0, 4] },
  h5: { fontSize: 12, bold: true, color: '#1f2937', margin: [0, 10, 0, 4] },
  h6: { fontSize: 11, bold: true, color: '#374151', margin: [0, 10, 0, 4] },
  paragraph: { margin: [0, 0, 0, 8] },
  code: {
    fontSize: 8.5,
    background: '#f6f8fa',
    color: '#24292f',
    preserveLeadingSpaces: true,
    margin: [0, 4, 0, 10],
  },
  codespan: { fontSize: 9.5, background: '#f1f3f5', color: '#24292f' },
  blockquote: { color: '#4b5563', margin: [14, 2, 0, 8], lineHeight: 1.4 },
  diagramLabel: { fontSize: 9, italics: true, color: '#6b7280', margin: [0, 6, 0, 2] },
  tableHeader: { bold: true, color: '#111827', fillColor: '#f1f5f9' },
};

/**
 * Builds the pdfmake definition for a document. `getDocDefinition` is
 * deterministic for a given Markdown string, which is what makes the export
 * reproducible.
 */
export function buildPdfDefinition(markdown: string, meta: PdfMeta): PdfDocumentDefinition {
  const tokens = marked.lexer(markdown);
  const content = blocksOf(tokens);

  const opensWithHeading = content[0]?.style === 'h1';
  const body = opensWithHeading
    ? content
    : [{ text: meta.title, style: 'h1' }, ...content];

  const header = (currentPage: number): unknown =>
    currentPage === 1
      ? { text: '', margin: [46, 24, 46, 0] }
      : {
          columns: [
            { text: meta.brand ?? '', color: '#9ca3af', fontSize: 8 },
            { text: meta.title, alignment: 'right', color: '#9ca3af', fontSize: 8 },
          ],
          margin: [46, 24, 46, 0],
        };

  const footer = (currentPage: number, pageCount: number): unknown => ({
    columns: [
      { text: meta.url ?? meta.updatedLabel ?? '', color: '#9ca3af', fontSize: 8 },
      {
        text: `${currentPage} / ${pageCount}`,
        alignment: 'right',
        color: '#9ca3af',
        fontSize: 8,
      },
    ],
    margin: [46, 8, 46, 0],
  });

  return {
    pageSize: 'A4',
    pageMargins: [46, 52, 46, 46],
    info: {
      title: meta.title,
      creator: meta.brand ?? 'Mdverse',
      producer: 'Mdverse',
    },
    content: body,
    styles: STYLES,
    defaultStyle: { fontSize: 10.5, lineHeight: 1.4, color: '#1a1a1a' },
    header,
    footer,
  };
}
