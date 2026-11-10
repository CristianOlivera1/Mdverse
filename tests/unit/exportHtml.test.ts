// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { buildExportHtml } from '../../src/lib/editor/exportDocument';

describe('buildExportHtml', () => {
  it('exports readable Markdown with a dark background and light text', async () => {
    const html = await buildExportHtml('# Night notes\n\nLight text.', 'Notes');

    expect(html).toContain('body{min-height:100vh;background:#000;color:#e5e5e5}');
    expect(html).toContain(':root{color-scheme:dark}');
    expect(html).toContain('<h1 id="night-notes">Night notes</h1>');
    expect(html).toContain('<p>Light text.</p>');
  });
});
