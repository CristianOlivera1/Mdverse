// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { extractMentionUsernames, renderCommentBody } from '../../src/lib/comments/mentions';

describe('extractMentionUsernames', () => {
  it('finds handles at the start and after whitespace or an opening paren', () => {
    expect(extractMentionUsernames('@ana can you look? cc @bob_1')).toEqual(['ana', 'bob_1']);
    expect(extractMentionUsernames('ping (@carol)')).toEqual(['carol']);
  });

  it('lowercases and de-duplicates', () => {
    expect(extractMentionUsernames('@Ana and @ana again')).toEqual(['ana']);
  });

  it('ignores things that are not a mention', () => {
    expect(extractMentionUsernames('email me at hi@example.com')).toEqual([]);
    expect(extractMentionUsernames('@a')).toEqual([]); // too short
    expect(extractMentionUsernames('a@b')).toEqual([]); // needs whitespace/paren before
  });
});

describe('renderCommentBody', () => {
  it('keeps plain text as text, never as markup', () => {
    const fragment = renderCommentBody('<script>alert(1)</script>', new Set());
    const host = document.createElement('div');
    host.append(fragment);
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('<script>');
  });

  it('styles only handles that resolve to a known member', () => {
    const known = new Set(['ana']);
    const fragment = renderCommentBody('hi @ana and @ghost', known);
    const host = document.createElement('div');
    host.append(fragment);

    const chips = [...host.querySelectorAll('span')].map((node) => node.textContent);
    expect(chips).toContain('@ana');
    expect(chips).not.toContain('@ghost');
    expect(host.textContent).toContain('@ghost');
  });

  it('preserves the surrounding text exactly', () => {
    const fragment = renderCommentBody('before @ana after', new Set(['ana']));
    const host = document.createElement('div');
    host.append(fragment);
    expect(host.textContent).toBe('before @ana after');
  });
});
