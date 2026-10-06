import { describe, expect, it } from 'vitest';

import { slugifyHeading } from '../../src/lib/markdown/slug';
import { buildTocHtml, escapeHtml } from '../../src/lib/markdown/toc';

describe('slugifyHeading', () => {
  it('lowercases, strips punctuation and joins words with dashes', () => {
    expect(slugifyHeading('Hello, World!')).toBe('hello-world');
  });

  it('keeps accents and non-latin letters (GitHub compatible)', () => {
    expect(slugifyHeading('Año 2026')).toBe('año-2026');
    // Removing `&` leaves two spaces, and GitHub (github-slugger) does not
    // collapse them, so the double dash is the expected, compatible output.
    expect(slugifyHeading('Café & Té')).toBe('café--té');
  });

  it('keeps underscores and dashes', () => {
    expect(slugifyHeading('my_section-1')).toBe('my_section-1');
  });
});

describe('escapeHtml', () => {
  it('escapes the four dangerous characters', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;'");
  });
});

describe('buildTocHtml', () => {
  it('indents entries by heading level', () => {
    const html = buildTocHtml([
      { id: 'a', text: 'A', level: 1 },
      { id: 'b', text: 'B', level: 2 },
    ]);
    expect(html).toContain('padding-left:12px');
    expect(html).toContain('padding-left:26px');
  });

  it('reports documents without headings', () => {
    expect(buildTocHtml([])).toContain('no headings');
  });
});
