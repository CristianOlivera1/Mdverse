import { describe, expect, it } from 'vitest';

import { buildDocxBlob } from '../../src/lib/export/docxDocument';
import { POST } from '../../src/pages/api/export/docx';

async function unzipText(blob: Blob, entry: string): Promise<string | null> {
  const buffer = Buffer.from(await blob.arrayBuffer());
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file(entry);
  return file ? file.async('string') : null;
}

describe('buildDocxBlob', () => {
  const markdown = [
    '# Heading',
    '',
    'A **bold** paragraph with a [link](https://example.com).',
    '',
    '- bullet one',
    '- bullet two',
    '',
    '1. first',
    '2. second',
    '',
    '| Left | Right |',
    '| --- | ---: |',
    '| a | b |',
    '',
    '```js',
    'const a = 1;',
    '```',
  ].join('\n');

  it('is a real OOXML package, not HTML in a .docx jacket', async () => {
    const blob = await buildDocxBlob(markdown, { title: 'Heading' });
    const buffer = Buffer.from(await blob.arrayBuffer());

    // Every OOXML file is a ZIP: it must start with the local-file signature.
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');

    const contentTypes = await unzipText(blob, '[Content_Types].xml');
    expect(contentTypes).toContain('wordprocessingml.document.main+xml');

    const documentXml = await unzipText(blob, 'word/document.xml');
    expect(documentXml).toBeTruthy();
  });

  it('emits real Word structure: headings, numbering, tables and hyperlinks', async () => {
    const blob = await buildDocxBlob(markdown, { title: 'Heading' });
    const documentXml = (await unzipText(blob, 'word/document.xml')) ?? '';

    expect(documentXml).toContain('w:pStyle');
    expect(documentXml).toContain('Heading1');
    expect(documentXml).toContain('<w:tbl>');
    expect(documentXml).toContain('w:numPr');
    expect(documentXml).toContain('w:hyperlink');

    // The old exporter emitted raw HTML tags inside the document; it must not.
    expect(documentXml).not.toContain('&lt;h1&gt;');
  });

  it('carries the document metadata through', async () => {
    const blob = await buildDocxBlob(markdown, { title: 'My Report', creator: 'Mdverse' });
    const core = (await unzipText(blob, 'docProps/core.xml')) ?? '';
    expect(core).toContain('My Report');
  });
});

/** Minimal API context: the route only needs `locals` and `request`. */
function context(body: unknown, authenticated: boolean) {
  return {
    request: new Request('http://localhost/api/export/docx', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    locals: authenticated ? { supabase: {}, user: { id: 'user-1' } } : { supabase: null, user: null },
  } as never;
}

describe('POST /api/export/docx', () => {
  it('answers with the document bytes and a download header', async () => {
    const response = await POST(
      context({ markdown: '# Title\n\nBody.', title: 'Report "/evil"' }, true),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    // The file name lands in a header, so quotes and slashes must be gone.
    expect(response.headers.get('content-disposition')).not.toContain('/evil');

    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('refuses an anonymous caller and empty input', async () => {
    expect((await POST(context({ markdown: 'x', title: 't' }, false))).status).toBe(401);
    expect((await POST(context({ markdown: '   ', title: 't' }, true))).status).toBe(400);
  });
});
