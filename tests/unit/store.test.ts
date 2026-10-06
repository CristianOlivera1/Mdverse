import { describe, expect, it } from 'vitest';

import { nextUntitledTitle, normalizeTitle } from '../../src/lib/documents/store';
import type { OpenDocument } from '../../src/lib/documents/types';

const doc = (title: string): OpenDocument => ({ id: title, title, content: '' });

describe('nextUntitledTitle', () => {
  it('starts with a plain Untitled', () => {
    expect(nextUntitledTitle([])).toBe('Untitled');
  });

  it('counts up when the default name is taken', () => {
    expect(nextUntitledTitle([doc('Untitled')])).toBe('Untitled 2');
    expect(nextUntitledTitle([doc('Untitled'), doc('Untitled 2')])).toBe('Untitled 3');
  });

  it('fills the first gap in the sequence', () => {
    expect(nextUntitledTitle([doc('Untitled'), doc('Untitled 3')])).toBe('Untitled 2');
  });

  it('ignores unrelated titles', () => {
    expect(nextUntitledTitle([doc('Notes'), doc('Roadmap')])).toBe('Untitled');
  });
});

describe('normalizeTitle', () => {
  it('falls back to Untitled for blank names', () => {
    expect(normalizeTitle('   ')).toBe('Untitled');
  });

  it('trims and caps the length', () => {
    expect(normalizeTitle('  Notes  ')).toBe('Notes');
    expect(normalizeTitle('x'.repeat(200))).toHaveLength(120);
  });
});
