import { describe, expect, it } from 'vitest';

import {
  buildSearchRegex,
  countMatches,
  replaceAllMatches,
} from '../../src/lib/editor/findReplace';

describe('buildSearchRegex', () => {
  it('returns null for an empty query', () => {
    expect(buildSearchRegex({ query: '', caseSensitive: false })).toBeNull();
  });

  it('treats the query literally', () => {
    const regex = buildSearchRegex({ query: 'a.b', caseSensitive: false })!;
    expect(countMatches('a.b axb', regex)).toBe(1);
  });

  it('honours case sensitivity', () => {
    const insensitive = buildSearchRegex({ query: 'abc', caseSensitive: false })!;
    const sensitive = buildSearchRegex({ query: 'abc', caseSensitive: true })!;
    expect(countMatches('ABC abc', insensitive)).toBe(2);
    expect(countMatches('ABC abc', sensitive)).toBe(1);
  });
});

describe('replaceAllMatches', () => {
  it('replaces every occurrence, keeping `$` sequences literal', () => {
    const regex = buildSearchRegex({ query: 'x', caseSensitive: false })!;
    expect(replaceAllMatches('x y x', regex, '$1')).toBe('$1 y $1');
  });

  it('returns the input untouched without a regex', () => {
    expect(replaceAllMatches('abc', null, 'z')).toBe('abc');
  });
});
