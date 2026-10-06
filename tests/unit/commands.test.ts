import { describe, expect, it } from 'vitest';

import * as commands from '../../src/lib/editor/commands';
import type { EditOp } from '../../src/lib/editor/commands';
import type { TextState } from '../../src/lib/editor/text';

const state = (value: string, start: number, end = start): TextState => ({ value, start, end });

/** Apply an EditOp the same way the DOM adapter does, for assertions. */
const apply = (value: string, edit: EditOp): string =>
  value.slice(0, edit.from) + edit.insert + value.slice(edit.to);

describe('wrapInline', () => {
  it('wraps the current selection', () => {
    expect(apply('hello world', commands.wrapInline(state('hello world', 0, 5), '**'))).toBe(
      '**hello** world',
    );
  });

  it('wraps the word under a collapsed caret', () => {
    expect(apply('hello', commands.wrapInline(state('hello', 0, 0), '*'))).toBe('*hello*');
  });

  it('removes markers that already surround the target', () => {
    expect(apply('**hello**', commands.wrapInline(state('**hello**', 2, 7), '**'))).toBe('hello');
  });

  it('removes markers that are part of the selection', () => {
    expect(apply('**hello**', commands.wrapInline(state('**hello**', 0, 9), '**'))).toBe('hello');
  });

  it('falls back to a placeholder when there is nothing selected', () => {
    expect(apply('', commands.wrapInline(state('', 0, 0), '`'))).toBe('`text`');
  });
});

describe('insertLink', () => {
  it('uses the selection as the link label', () => {
    expect(apply('docs', commands.insertLink(state('docs', 0, 4)))).toBe('[docs](url)');
  });

  it('falls back to a placeholder label', () => {
    expect(apply('', commands.insertLink(state('', 0, 0)))).toBe('[text](url)');
  });
});

describe('list toggles', () => {
  it('adds and removes bullet markers', () => {
    expect(apply('a\nb', commands.toggleBulletList(state('a\nb', 0, 3)))).toBe('- a\n- b');
    expect(apply('- a\n- b', commands.toggleBulletList(state('- a\n- b', 0, 7)))).toBe('a\nb');
  });

  it('numbers ordered lists', () => {
    expect(apply('x\ny', commands.toggleOrderedList(state('x\ny', 0, 3)))).toBe('1. x\n2. y');
  });

  it('adds and removes task markers', () => {
    expect(apply('todo', commands.toggleTaskList(state('todo', 0, 4)))).toBe('- [ ] todo');
    expect(apply('- [ ] todo', commands.toggleTaskList(state('- [ ] todo', 0, 10)))).toBe('todo');
  });

  it('adds and removes blockquote markers', () => {
    expect(apply('q', commands.toggleBlockquote(state('q', 0, 1)))).toBe('> q');
    expect(apply('> q', commands.toggleBlockquote(state('> q', 0, 3)))).toBe('q');
  });
});

describe('cycleHeading', () => {
  it('cycles H1 → H2 → H3 → none', () => {
    expect(apply('# Title', commands.cycleHeading(state('# Title', 0, 7)))).toBe('## Title');
    expect(apply('## Title', commands.cycleHeading(state('## Title', 0, 8)))).toBe('### Title');
    expect(apply('### Title', commands.cycleHeading(state('### Title', 0, 9)))).toBe('Title');
  });
});

describe('toggleComment', () => {
  it('comments and uncomments lines', () => {
    expect(apply('a', commands.toggleComment(state('a', 0, 1)))).toBe('<!-- a -->');
    expect(apply('<!-- a -->', commands.toggleComment(state('<!-- a -->', 0, 10)))).toBe('a');
  });
});

describe('indentLines', () => {
  it('indents and outdents', () => {
    expect(apply('a\nb', commands.indentLines(state('a\nb', 0, 3)))).toBe('  a\n  b');
    expect(apply('  a', commands.indentLines(state('  a', 0, 3), true))).toBe('a');
  });
});

describe('line operations', () => {
  it('deletes the current line', () => {
    expect(apply('a\nb', commands.deleteLine(state('a\nb', 0, 1)))).toBe('b');
    expect(apply('a\nb', commands.deleteLine(state('a\nb', 2, 3)))).toBe('a');
  });

  it('selects the whole line including the newline', () => {
    expect(commands.selectLineRange(state('a\nb', 0, 0))).toEqual({ start: 0, end: 2 });
  });

  it('inserts a line above or below', () => {
    expect(apply('a', commands.insertLine(state('a', 0, 1), true))).toBe('a\n');
    expect(apply('a', commands.insertLine(state('a', 0, 1), false))).toBe('\na');
  });

  it('duplicates lines', () => {
    expect(apply('one\ntwo', commands.duplicateLines(state('one\ntwo', 0, 3), 1))).toBe(
      'one\none\ntwo',
    );
  });

  it('moves lines up and down', () => {
    expect(apply('a\nb', commands.moveLines(state('a\nb', 0, 1), 1)!)).toBe('b\na');
    expect(apply('a\nb', commands.moveLines(state('a\nb', 2, 3), -1)!)).toBe('b\na');
    expect(commands.moveLines(state('a', 0, 1), -1)).toBeNull();
  });
});

describe('insertBlock', () => {
  it('replaces an empty line', () => {
    expect(apply('', commands.insertHorizontalRule(state('', 0, 0)))).toBe('---\n');
  });

  it('appends after the current line, separated by a blank line', () => {
    expect(apply('hello', commands.insertHorizontalRule(state('hello', 5, 5)))).toBe(
      'hello\n\n---\n',
    );
  });

  it('inserts a table skeleton', () => {
    expect(apply('', commands.insertTable(state('', 0, 0)))).toBe(
      '| Column 1 | Column 2 | Column 3 |\n|---|---|---|\n|  |  |  |\n',
    );
  });
});

describe('insertCodeFence', () => {
  it('wraps the selection in a fence', () => {
    expect(apply('code', commands.insertCodeFence(state('code', 0, 4)))).toBe('```\ncode\n```');
  });

  it('inserts an empty fence without a selection', () => {
    expect(apply('', commands.insertCodeFence(state('', 0, 0)))).toBe('```\n\n```\n');
  });
});

describe('continueList', () => {
  it('continues bullet lists', () => {
    expect(apply('- item', commands.continueList(state('- item', 6))!)).toBe('- item\n- ');
  });

  it('increments ordered lists', () => {
    expect(apply('1. one', commands.continueList(state('1. one', 6))!)).toBe('1. one\n2. ');
  });

  it('continues task lists', () => {
    expect(apply('- [ ] todo', commands.continueList(state('- [ ] todo', 10))!)).toBe(
      '- [ ] todo\n- [ ] ',
    );
  });

  it('ends the list when the current item is empty', () => {
    expect(apply('- ', commands.continueList(state('- ', 2))!)).toBe('');
  });

  it('ignores plain text', () => {
    expect(commands.continueList(state('plain', 5))).toBeNull();
  });
});
