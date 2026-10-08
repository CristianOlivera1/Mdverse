import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { marked } from 'marked';
import type { Tokens } from 'marked';

import { safeHref } from '../markdown/url';

export interface DocxMeta {
  readonly title: string;
  readonly creator?: string;
  readonly description?: string;
}

type Alignment = (typeof AlignmentType)[keyof typeof AlignmentType];

const MONO = 'Consolas';
const CODE_SHADING = { fill: 'F6F8FA', type: ShadingType.CLEAR, color: 'auto' } as const;
const CODE_SPAN_SHADING = { fill: 'F1F3F5', type: ShadingType.CLEAR, color: 'auto' } as const;
const HEADER_SHADING = { fill: 'F1F5F9', type: ShadingType.CLEAR, color: 'auto' } as const;

const HEADING_BY_DEPTH = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

interface Context {
  readonly list?: { ordered: boolean; level: number };
  readonly quoteDepth: number;
}

const BODY: Context = { quoteDepth: 0 };

function listProps(context: Context): Partial<{
  numbering: { reference: string; level: number };
  bullet: { level: number };
}> {
  if (!context.list) return {};
  if (context.list.ordered) {
    return { numbering: { reference: 'md-ordered', level: Math.min(context.list.level, 2) } };
  }
  return { bullet: { level: Math.min(context.list.level, 4) } };
}

function quoteProps(context: Context): Partial<{ indent: { left: number } }> {
  return context.quoteDepth > 0 ? { indent: { left: 460 * context.quoteDepth } } : {};
}

export interface DocxImage {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly type: 'png' | 'jpg' | 'gif';
}

export type DocxImageMap = Map<string, DocxImage>;

const DOCX_IMAGE_TIMEOUT_MS = 10_000;
const DOCX_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const DOCX_IMAGE_MAX_WIDTH = 600;
const DOCX_IMAGE_FALLBACK_SIZE = { width: 600, height: 400 } as const;

const WORD_SAFE_TYPES: Record<string, DocxImage['type']> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
};

function collectDocxImageUrls(markdown: string): string[] {
  let tokens: Tokens.Generic[];
  try {
    tokens = marked.lexer(markdown) as Tokens.Generic[];
  } catch {
    return [];
  }

  const urls: string[] = [];
  const seen = new Set<string>();

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (node.type === 'image' && typeof node.href === 'string') {
      const href = safeHref(node.href);
      if (/^https?:\/\//i.test(href) && !seen.has(href)) {
        seen.add(href);
        urls.push(href);
      }
    }
    if (Array.isArray(node.tokens)) visit(node.tokens);
    if (Array.isArray(node.items)) visit(node.items);
    if (Array.isArray(node.header)) visit(node.header);
    if (Array.isArray(node.rows)) visit(node.rows);
  };

  visit(tokens);
  return urls;
}

function sniffPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (
    bytes[0] !== 137 ||
    bytes[1] !== 80 ||
    bytes[2] !== 78 ||
    bytes[3] !== 71 ||
    bytes[4] !== 13 ||
    bytes[5] !== 10 ||
    bytes[6] !== 26 ||
    bytes[7] !== 10
  ) {
    return null;
  }
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  return width > 0 && height > 0 ? { width, height } : null;
}

function sniffGifSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 10) return null;
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  if (header !== 'GIF87a' && header !== 'GIF89a') return null;
  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  return width > 0 && height > 0 ? { width, height } : null;
}

function sniffJpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return null;
    if (SOF.has(marker)) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

function fitToMaxWidth(
  size: { width: number; height: number } | null,
): { width: number; height: number } {
  const source = size ?? DOCX_IMAGE_FALLBACK_SIZE;
  if (source.width <= DOCX_IMAGE_MAX_WIDTH) return { ...source };
  return {
    width: DOCX_IMAGE_MAX_WIDTH,
    height: Math.max(1, Math.round((source.height * DOCX_IMAGE_MAX_WIDTH) / source.width)),
  };
}

async function fetchOneDocxImage(url: string): Promise<DocxImage | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(DOCX_IMAGE_TIMEOUT_MS) });
    if (!response.ok) return null;

    const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    const type = WORD_SAFE_TYPES[mime];
    if (!type) return null;

    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > DOCX_IMAGE_MAX_BYTES) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > DOCX_IMAGE_MAX_BYTES) return null;

    const sniffed =
      type === 'png' ? sniffPngSize(bytes) : type === 'gif' ? sniffGifSize(bytes) : sniffJpegSize(bytes);
    return { data: bytes, type, ...fitToMaxWidth(sniffed) };
  } catch {
    return null;
  }
}

export async function fetchDocxImages(markdown: string): Promise<DocxImageMap> {
  const images: DocxImageMap = new Map();
  try {
    const urls = collectDocxImageUrls(markdown);
    await Promise.all(
      urls.map(async (url) => {
        const image = await fetchOneDocxImage(url);
        if (image) images.set(url, image);
      }),
    );
  } catch {
    // Degrade to hyperlink fallbacks; the export itself must survive.
  }
  return images;
}

function runs(
  tokens: readonly Tokens.Generic[] = [],
  base: { bold?: boolean; italics?: boolean; strike?: boolean } = {},
  images?: DocxImageMap,
): (TextRun | ExternalHyperlink | ImageRun)[] {
  const result: (TextRun | ExternalHyperlink | ImageRun)[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'escape': {
        result.push(new TextRun({ text: token.text, ...base }));
        break;
      }
      case 'br': {
        result.push(new TextRun({ break: 1 }));
        break;
      }
      case 'strong': {
        result.push(...runs(token.tokens, { ...base, bold: true }, images));
        break;
      }
      case 'em': {
        result.push(...runs(token.tokens, { ...base, italics: true }, images));
        break;
      }
      case 'del': {
        result.push(...runs(token.tokens, { ...base, strike: true }, images));
        break;
      }
      case 'codespan': {
        result.push(
          new TextRun({ text: token.text, font: MONO, size: 19, shading: CODE_SPAN_SHADING, ...base }),
        );
        break;
      }
      case 'link': {
        const href = safeHref(token.href);
        const children = runs(token.tokens, base, images);
        const texts = children.length > 0 ? children : [new TextRun({ text: token.text || href, ...base })];
        if (href && href !== '#') result.push(new ExternalHyperlink({ link: href, children: texts }));
        else result.push(...texts);
        break;
      }
      case 'image': {
        const href = safeHref(token.href);
        const image = href ? images?.get(href) : undefined;
        if (image) {
          result.push(
            new ImageRun({
              data: image.data,
              type: image.type,
              transformation: { width: image.width, height: image.height },
              altText: { name: token.text || href, description: token.text || href },
            }),
          );
        } else if (href && href !== '#') {
          result.push(
            new ExternalHyperlink({
              link: href,
              children: [new TextRun({ text: token.text || href, italics: true, color: '2563EB' })],
            }),
          );
        } else {
          result.push(new TextRun({ text: token.text || 'image', italics: true }));
        }
        break;
      }
      default: {
        const text = (token as { text?: unknown }).text;
        if (typeof text === 'string' && text) result.push(new TextRun({ text, ...base }));
        break;
      }
    }
  }

  return result;
}


type SectionChild = Paragraph | Table;

function paragraphsOf(
  tokens: readonly Tokens.Generic[] = [],
  context: Context = BODY,
  images?: DocxImageMap,
): SectionChild[] {
  const result: SectionChild[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'space':
      case 'def':
      case 'html':
        break;

      case 'heading': {
        const depth = Math.min(Math.max(token.depth, 1), 6);
        result.push(
          new Paragraph({
            heading: HEADING_BY_DEPTH[depth],
            children: runs(token.tokens, {}, images),
            ...quoteProps(context),
          }),
        );
        break;
      }

      case 'paragraph': {
        const only = token.tokens?.length === 1 ? token.tokens[0] : null;
        if (only?.type === 'image') {
          const href = safeHref((only as Tokens.Image).href);
          const image = href ? images?.get(href) : undefined;
          if (image) {
            result.push(
              new Paragraph({
                children: [
                  new ImageRun({
                    data: image.data,
                    type: image.type,
                    transformation: { width: image.width, height: image.height },
                    altText: { name: (only as Tokens.Image).text || href, description: (only as Tokens.Image).text || href },
                  }),
                ],
                alignment: AlignmentType.CENTER,
                spacing: { after: 160 },
                ...quoteProps(context),
              }),
            );
            break;
          }
        }
        result.push(
          new Paragraph({
            children: runs(token.tokens, {}, images),
            spacing: { after: 160 },
            ...listProps(context),
            ...quoteProps(context),
          }),
        );
        break;
      }

      case 'code': {
        if (token.lang === 'mermaid') {
          result.push(
            new Paragraph({
              children: [
                new TextRun({ text: 'Mermaid diagram (source)', italics: true, color: '6B7280', size: 18 }),
              ],
              spacing: { before: 160 },
            }),
          );
        }
        for (const line of token.text.split('\n')) {
          result.push(
            new Paragraph({
              children: [new TextRun({ text: line || ' ', font: MONO, size: 18 })],
              shading: CODE_SHADING,
              spacing: { before: 0, after: 0 },
            }),
          );
        }
        break;
      }

      case 'blockquote': {
        result.push(...paragraphsOf(token.tokens, { ...context, quoteDepth: context.quoteDepth + 1 }, images));
        break;
      }

      case 'list': {
        const level = (context.list?.level ?? -1) + 1;
        const listContext: Context = { ...context, list: { ordered: token.ordered, level } };

        for (const item of token.items) {
          const nested = item.tokens.filter(
            (child: Tokens.Generic) => child.type === 'list' || child.type === 'blockquote',
          );
          const inline = item.tokens.filter(
            (child: Tokens.Generic) => child.type !== 'list' && child.type !== 'blockquote',
          );

          result.push(
            new Paragraph({
              children: [
                ...(item.task ? [new TextRun({ text: item.checked ? '☑  ' : '☐  ' })] : []),
                ...runs(inline as Tokens.Generic[], {}, images),
              ],
              spacing: { after: 80 },
              ...listProps(listContext),
              ...quoteProps(context),
            }),
          );

          if (nested.length > 0) {
            result.push(...paragraphsOf(nested as Tokens.Generic[], listContext, images));
          }
        }
        break;
      }

      case 'table': {
        result.push(tableChild(token as Tokens.Table, images));
        break;
      }

      case 'hr': {
        result.push(
          new Paragraph({
            text: '',
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB' } },
            spacing: { before: 120, after: 200 },
          }),
        );
        break;
      }

      default: {
        const text = (token as { text?: unknown }).text;
        if (typeof text === 'string' && text.trim()) {
          result.push(new Paragraph({ children: runs([token as Tokens.Generic], {}, images), ...quoteProps(context) }));
        }
        break;
      }
    }
  }

  return result;
}

function tableChild(token: Tokens.Table, images?: DocxImageMap): Table {
  const rows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: token.header.map(
        (cell, index) =>
          new TableCell({
            shading: HEADER_SHADING,
            children: [
              new Paragraph({
                children: runs(cell.tokens, { bold: true }, images),
                alignment: alignFor(token.align?.[index] ?? cell.align),
              }),
            ],
          }),
      ),
    }),
  ];

  for (const row of token.rows) {
    rows.push(
      new TableRow({
        children: row.map(
          (cell, index) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: runs(cell.tokens, {}, images),
                  alignment: alignFor(token.align?.[index] ?? cell.align),
                }),
              ],
            }),
        ),
      }),
    );
  }

  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

function alignFor(align: string | null | undefined): Alignment {
  if (align === 'center') return AlignmentType.CENTER;
  if (align === 'right') return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

export function buildDocxDocument(markdown: string, meta: DocxMeta, images?: DocxImageMap): Document {
  const children = paragraphsOf(marked.lexer(markdown) as Tokens.Generic[], BODY, images);

  if (children.length === 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: meta.title, bold: true })] }));
  }

  return new Document({
    creator: meta.creator ?? 'Mdverse',
    title: meta.title,
    description: meta.description ?? '',
    numbering: {
      config: [
        {
          reference: 'md-ordered',
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START },
            { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2.', alignment: AlignmentType.START },
            { level: 2, format: LevelFormat.LOWER_ROMAN, text: '%3.', alignment: AlignmentType.START },
          ],
        },
      ],
    },
    sections: [{ children }],
  });
}

export async function buildDocxBlob(
  markdown: string,
  meta: DocxMeta,
  images?: DocxImageMap,
): Promise<Blob> {
  return Packer.toBlob(buildDocxDocument(markdown, meta, images));
}
