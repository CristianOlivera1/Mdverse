import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
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

function runs(
  tokens: readonly Tokens.Generic[] = [],
  base: { bold?: boolean; italics?: boolean; strike?: boolean } = {},
): (TextRun | ExternalHyperlink)[] {
  const result: (TextRun | ExternalHyperlink)[] = [];

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
        result.push(...runs(token.tokens, { ...base, bold: true }));
        break;
      }
      case 'em': {
        result.push(...runs(token.tokens, { ...base, italics: true }));
        break;
      }
      case 'del': {
        result.push(...runs(token.tokens, { ...base, strike: true }));
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
        const children = runs(token.tokens, base);
        const texts = children.length > 0 ? children : [new TextRun({ text: token.text || href, ...base })];
        if (href && href !== '#') result.push(new ExternalHyperlink({ link: href, children: texts }));
        else result.push(...texts);
        break;
      }
      case 'image': {
        const href = safeHref(token.href);
        if (href && href !== '#') {
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

function paragraphsOf(tokens: readonly Tokens.Generic[] = [], context: Context = BODY): SectionChild[] {
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
            children: runs(token.tokens),
            ...quoteProps(context),
          }),
        );
        break;
      }

      case 'paragraph': {
        result.push(
          new Paragraph({
            children: runs(token.tokens),
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
        result.push(...paragraphsOf(token.tokens, { ...context, quoteDepth: context.quoteDepth + 1 }));
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
                ...runs(inline as Tokens.Generic[]),
              ],
              spacing: { after: 80 },
              ...listProps(listContext),
              ...quoteProps(context),
            }),
          );

          if (nested.length > 0) {
            result.push(...paragraphsOf(nested as Tokens.Generic[], listContext));
          }
        }
        break;
      }

      case 'table': {
        result.push(tableChild(token as Tokens.Table));
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
          result.push(new Paragraph({ children: runs([token as Tokens.Generic]), ...quoteProps(context) }));
        }
        break;
      }
    }
  }

  return result;
}

function tableChild(token: Tokens.Table): Table {
  const rows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: token.header.map(
        (cell, index) =>
          new TableCell({
            shading: HEADER_SHADING,
            children: [
              new Paragraph({
                children: runs(cell.tokens, { bold: true }),
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
                  children: runs(cell.tokens),
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

export function buildDocxDocument(markdown: string, meta: DocxMeta): Document {
  const children = paragraphsOf(marked.lexer(markdown) as Tokens.Generic[]);

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

export async function buildDocxBlob(markdown: string, meta: DocxMeta): Promise<Blob> {
  return Packer.toBlob(buildDocxDocument(markdown, meta));
}
