import { lineEnd, lineRange, lineStart, wordAt, type TextState } from './text';

/**
 * A single, reversible edit computed from a {@link TextState}.
 * Commands are pure: they never touch the DOM, which keeps them unit-testable.
 * The DOM adapter applies the result through `document.execCommand` so the
 * browser's native undo/redo stack keeps working.
 */
export interface EditOp {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  readonly selStart: number;
  readonly selEnd: number;
}

function op(
  from: number,
  to: number,
  insert: string,
  selStart: number,
  selEnd: number = selStart,
): EditOp {
  return { from, to, insert, selStart, selEnd };
}

function onLines(state: TextState, fn: (lines: string[]) => string[]): EditOp {
  const [from, to] = lineRange(state);
  const out = fn(state.value.slice(from, to).split('\n')).join('\n');
  return op(from, to, out, from, from + out.length);
}

function toggleLinePrefix(
  state: TextState,
  test: RegExp,
  add: (line: string, index: number) => string,
  strip: RegExp,
): EditOp {
  return onLines(state, (lines) =>
    lines.every((line) => test.test(line))
      ? lines.map((line) => line.replace(strip, '$1'))
      : lines.map(add),
  );
}

export function insertBlock(
  state: TextState,
  text: string,
  selStartOffset = 0,
  selEndOffset = 0,
): EditOp {
  const { value } = state;
  const at = lineEnd(value, state.end);
  const from = lineStart(value, at);
  const empty = !value.slice(from, at).trim();
  const insertAt = empty ? from : at;
  const base = insertAt + (empty ? 0 : 2);
  return op(
    insertAt,
    at,
    `${empty ? '' : '\n\n'}${text}\n`,
    base + selStartOffset,
    base + selEndOffset,
  );
}

export function insertTable(state: TextState): EditOp {
  return insertBlock(state, '| Column 1 | Column 2 | Column 3 |\n|---|---|---|\n|  |  |  |', 2, 11);
}

export function insertHorizontalRule(state: TextState): EditOp {
  return insertBlock(state, '---');
}

export function insertMermaidDiagram(state: TextState): EditOp {
  return insertBlock(state, '```mermaid\nflowchart TD\n    A["Start"] --> B["End"]\n```', 11, 23);
}

export function insertCodeFence(state: TextState): EditOp {
  const { value, start, end } = state;
  if (start === end) return insertBlock(state, '```\n\n```', 4, 4);
  const selected = value.slice(start, end);
  return op(start, end, `\`\`\`\n${selected}\n\`\`\``, start + 4, start + 4 + selected.length);
}

/**
 * Wrap the selection (or the word under the caret) with a marker.
 * Calling it again with the same marker removes the surrounding markers.
 */
export function wrapInline(state: TextState, marker: string, placeholder = 'text'): EditOp {
  const { value } = state;
  let start = state.start;
  let end = state.end;

  if (start === end) {
    const word = wordAt(value, start);
    if (word) [start, end] = word;
  }

  const selected = value.slice(start, end);
  const length = marker.length;

  if (value.slice(start - length, start) === marker && value.slice(end, end + length) === marker) {
    return op(start - length, end + length, selected, start - length, end - length);
  }

  if (selected.length >= 2 * length && selected.startsWith(marker) && selected.endsWith(marker)) {
    return op(start, end, selected.slice(length, -length), start, end - 2 * length);
  }

  const text = selected || placeholder;
  return op(start, end, marker + text + marker, start + length, start + length + text.length);
}

export function insertLink(state: TextState): EditOp {
  const { value, start, end } = state;
  const text = value.slice(start, end) || 'text';
  return op(start, end, `[${text}](url)`, start + text.length + 3, start + text.length + 6);
}

export function cycleHeading(state: TextState): EditOp {
  return onLines(state, (lines) =>
    lines.map((line) => {
      const current = (line.match(/^(#{1,6}) /) || [''])[0].length - 1;
      const prefix = current >= 3 ? '' : `${'#'.repeat(current + 1)} `;
      return prefix + line.replace(/^#{1,6} /, '');
    }),
  );
}

export function toggleBlockquote(state: TextState): EditOp {
  // The original viewer captured the `>` in the strip group, so un-quoting left a
  // stray marker (`>q`). This port removes the prefix completely, keeping any
  // leading indentation only.
  return toggleLinePrefix(state, /^\s*>/, (line) => `> ${line}`, /^(\s*)> ?/);
}

export function toggleBulletList(state: TextState): EditOp {
  return toggleLinePrefix(state, /^\s*[-*+] (?!\[)/, (line) => `- ${line}`, /^(\s*)[-*+] /);
}

export function toggleOrderedList(state: TextState): EditOp {
  return toggleLinePrefix(
    state,
    /^\s*\d+\. /,
    (line, index) => `${index + 1}. ${line}`,
    /^(\s*)\d+\. /,
  );
}

export function toggleTaskList(state: TextState): EditOp {
  return toggleLinePrefix(
    state,
    /^\s*- \[[ xX]\] /,
    (line) => `- [ ] ${line}`,
    /^(\s*)- \[[ xX]\] /,
  );
}

export function toggleComment(state: TextState): EditOp {
  return onLines(state, (lines) => {
    const commented = lines.every((line) => !line.trim() || /^\s*<!-- .* -->\s*$/.test(line));
    return lines.map((line) => {
      if (!line.trim()) return line;
      if (commented) return line.replace(/<!-- ?/, '').replace(/ ?-->/, '');
      return line.replace(/^(\s*)(.*)$/, '$1<!-- $2 -->');
    });
  });
}

export function indentLines(state: TextState, outdent = false): EditOp {
  return onLines(state, (lines) =>
    lines.map((line) => (outdent ? line.replace(/^( {1,2}|\t)/, '') : `  ${line}`)),
  );
}

export function deleteLine(state: TextState): EditOp {
  const { value } = state;
  const [from, to] = lineRange(state);
  if (to < value.length) return op(from, to + 1, '', from);
  if (from > 0) return op(from - 1, to, '', from - 1);
  return op(from, to, '', from);
}

export function selectLineRange(state: TextState): { start: number; end: number } {
  const { value, start } = state;
  return {
    start: lineStart(value, start),
    end: Math.min(value.length, lineEnd(value, state.end) + 1),
  };
}

export function insertLine(state: TextState, below: boolean): EditOp {
  const [from, to] = lineRange(state);
  return below ? op(to, to, '\n', to + 1) : op(from, from, '\n', from);
}

export function moveLines(state: TextState, direction: -1 | 1): EditOp | null {
  const { value, start, end } = state;
  const [from, to] = lineRange(state);
  const block = value.slice(from, to);

  if (direction < 0) {
    if (!from) return null;
    const previousStart = lineStart(value, from - 1);
    const previous = value.slice(previousStart, from - 1);
    const shift = from - previousStart;
    return op(previousStart, to, `${block}\n${previous}`, start - shift, end - shift);
  }

  if (to >= value.length) return null;
  const nextEnd = lineEnd(value, to + 1);
  const next = value.slice(to + 1, nextEnd);
  const shift = next.length + 1;
  return op(from, nextEnd, `${next}\n${block}`, start + shift, end + shift);
}

export function duplicateLines(state: TextState, direction: -1 | 1): EditOp {
  const { start, end } = state;
  const [from, to] = lineRange(state);
  const block = state.value.slice(from, to);
  const shift = block.length + 1;
  return op(
    to,
    to,
    `\n${block}`,
    direction > 0 ? start + shift : start,
    direction > 0 ? end + shift : end,
  );
}

/**
 * Continue a list, task list or blockquote when Enter is pressed.
 * Returns `null` when the caret is not inside a list, so Enter keeps its default behaviour.
 */
export function continueList(state: TextState): EditOp | null {
  const { value, start, end } = state;
  if (start !== end) return null;

  const from = lineStart(value, start);
  const match = value.slice(from, start).match(/^(\s*)([-*+]|\d+\.|>)( \[[ xX]\])? (.*)$/);
  if (!match) return null;

  // Enter on an empty list item ends the list.
  if (!match[4] && lineEnd(value, start) === start) return op(from, start, '', from);

  const marker = /\d/.test(match[2]) ? `${parseInt(match[2], 10) + 1}.` : match[2];
  const insert = `\n${match[1]}${marker}${match[3] ? ' [ ]' : ''} `;
  return op(start, start, insert, start + insert.length);
}
