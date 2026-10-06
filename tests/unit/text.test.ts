import { describe, expect, it } from 'vitest';

import { escapeRegExp, lineEnd, lineRange, lineStart, wordAt } from '../../src/lib/editor/text';

describe('wordAt', () => {
  it('expands to the surrounding word', () => {
    expect(wordAt('hello world', 3)).toEqual([0, 5]);
    expect(wordAt('hello world', 8)).toEqual([6, 11]);
  });

  it('expands to the word before a caret sitting on whitespace', () => {
    // Faithful to the original viewer: a caret on the space still expands back
    // to the preceding word, which is what `wrapInline` relies on.
    expect(wordAt('hello world', 5)).toEqual([0, 5]);
  });

  it('returns null when there is no word to expand to', () => {
    expect(wordAt('   ', 1)).toBeNull();
    expect(wordAt('', 0)).toBeNull();
  });
});

describe('lineStart / lineEnd', () => {
  const value = 'one\ntwo\nthree';

  it('finds line boundaries', () => {
    expect(lineStart(value, 0)).toBe(0);
    expect(lineStart(value, 6)).toBe(4);
    expect(lineEnd(value, 0)).toBe(3);
    expect(lineEnd(value, 6)).toBe(7);
    expect(lineEnd(value, 100)).toBe(13);
  });
});

describe('lineRange', () => {
  it('covers the whole lines touched by the selection', () => {
    expect(lineRange({ value: 'a\nb\nc', start: 2, end: 3 })).toEqual([2, 3]);
  });

  it('ignores a trailing newline inside the selection', () => {
    expect(lineRange({ value: 'a\nb', start: 0, end: 2 })).toEqual([0, 1]);
  });
});

describe('escapeRegExp', () => {
  it('escapes regular-expression metacharacters', () => {
    expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c');
  });
});
