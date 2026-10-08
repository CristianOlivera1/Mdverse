import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildPdfDefinition, collectImageNodes } from '../../src/lib/export/pdfDefinition';
import { embedPdfImages } from '../../src/lib/export/pdf';

/** The subset of the pdfmake definition the exporter relies on. */
function contentText(nodes: unknown[]): string {
  return JSON.stringify(nodes);
}

describe('buildPdfDefinition', () => {
  const meta = { title: 'A document', brand: 'Mdverse' };

  it('produces a real A4 definition with a footer and page numbers', () => {
    const definition = buildPdfDefinition('# Hello\n\nBody.', meta);
    expect(definition.pageSize).toBe('A4');
    expect(definition.content.length).toBeGreaterThan(0);
    expect(definition.info.title).toBe('A document');

    const footer = definition.footer?.(1, 3) as { columns: { text: string }[] };
    expect(footer.columns[1].text).toBe('1 / 3');
  });

  it('maps headings, paragraphs, lists, quotes, code and tables to nodes', () => {
    const markdown = [
      '# Heading',
      '',
      'A **bold** paragraph with [a link](https://example.com) and `code`.',
      '',
      '- one',
      '- two',
      '',
      '1. first',
      '',
      '> a quote',
      '',
      '```js',
      'const a = 1;',
      '```',
      '',
      '| A | B |',
      '| --- | :--: |',
      '| 1 | 2 |',
    ].join('\n');

    const definition = buildPdfDefinition(markdown, meta);
    const serialized = contentText(definition.content);

    expect(serialized).toContain('"style":"h1"');
    expect(serialized).toContain('"ul"');
    expect(serialized).toContain('"ol"');
    expect(serialized).toContain('"blockquote"');
    expect(serialized).toContain('"table"');
    expect(serialized).toContain('"headerRows":1');
  });

  it('reuses the document title instead of repeating it when the source opens with an h1', () => {
    const definition = buildPdfDefinition('# Already titled', meta);
    const serialized = contentText(definition.content);
    expect(serialized.match(/"Already titled"/g)?.length).toBe(1);
  });

  it('adds the title as the first block when the source has no heading', () => {
    const definition = buildPdfDefinition('Just prose.', meta);
    expect(definition.content[0]).toMatchObject({ text: 'A document', style: 'h1' });
  });

  it('defuses a dangerous link scheme instead of forwarding it to the PDF', () => {
    const definition = buildPdfDefinition('[click](javascript:alert(1))', meta);
    expect(contentText(definition.content)).not.toContain('javascript:');
  });

  it('treats a lone image as a picture and keeps mixed images as alt text', () => {
    const lone = buildPdfDefinition('![alt](https://example.com/a.png)', meta);
    expect(contentText(lone.content)).toContain('"image":"https://example.com/a.png"');

    const mixed = buildPdfDefinition('before ![alt](https://example.com/a.png) after', meta);
    expect(contentText(mixed.content)).not.toContain('"image":"');
    expect(contentText(mixed.content)).toContain('alt');
  });

  it('renders an empty document as a valid definition, never a crash', () => {
    const definition = buildPdfDefinition('   ', meta);
    expect(Array.isArray(definition.content)).toBe(true);
    expect(definition.content.length).toBeGreaterThan(0);
  });
});

describe('collectImageNodes', () => {
  it('finds external images, however deeply nested, and skips inline data URLs', () => {
    const content = [
      { image: 'https://cdn.example.com/a.png' },
      { stack: [{ image: 'data:image/png;base64,AAAA' }, { image: '/api/images/b.png' }] },
      { table: { body: [[{ image: 'https://cdn.example.com/c.png' }]] } },
    ];

    const nodes = collectImageNodes(content);
    expect(nodes.map((node) => node.image)).toEqual([
      'https://cdn.example.com/a.png',
      '/api/images/b.png',
      'https://cdn.example.com/c.png',
    ]);
  });
});

describe('embedPdfImages', () => {
  const meta = { title: 'A document', brand: 'Mdverse' };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads each remote image into the virtual file system as a data URL', async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob([png], { type: 'image/png' }), { status: 200 })),
    );

    const definition = buildPdfDefinition('![alt](https://cdn.example.com/pic.png)', meta);
    await embedPdfImages(definition);

    // The node must reference a VFS key, never the raw URL.
    const serialized = JSON.stringify(definition.content);
    expect(serialized).toContain('"image":"image_0"');
    expect(serialized).not.toContain('cdn.example.com');
    expect(definition.images?.image_0).toMatch(/^data:image\/png;base64,/);
  });

  it('degrades an image that cannot be fetched instead of failing the export', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 404 })));

    const definition = buildPdfDefinition('![alt](https://cdn.example.com/pic.png)', meta);
    await embedPdfImages(definition);

    expect(definition.images).toBeUndefined();
    const serialized = JSON.stringify(definition.content);
    expect(serialized).not.toContain('"image"');
    expect(serialized).toContain('Image could not be embedded');
  });
});
