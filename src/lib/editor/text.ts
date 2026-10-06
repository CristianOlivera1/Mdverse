/** A text buffer plus the current selection offsets. */
export interface TextState {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

/** Characters considered part of a word when expanding a collapsed caret. */
const WORD = /[\p{L}\p{N}_]/u;

/** Expand a position to the word boundaries that contain it. */
export function wordAt(value: string, position: number): [number, number] | null {
  let start = position;
  let end = position;
  while (start > 0 && WORD.test(value[start - 1])) start--;
  while (end < value.length && WORD.test(value[end])) end++;
  return start < end ? [start, end] : null;
}

/** Index of the first character of the line containing `index`. */
export function lineStart(value: string, index: number): number {
  return index ? value.lastIndexOf('\n', index - 1) + 1 : 0;
}

/** Index of the first character after the line containing `index`. */
export function lineEnd(value: string, index: number): number {
  const next = value.indexOf('\n', index);
  return next < 0 ? value.length : next;
}

/** Escape a string so it can be embedded in a regular expression. */
export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The line range touched by the current selection.
 * A trailing newline is excluded, matching the original `rng()` helper.
 */
export function lineRange(state: TextState): [number, number] {
  const { value, start } = state;
  let end = state.end;
  if (end > start && value[end - 1] === '\n') end--;
  return [lineStart(value, start), lineEnd(value, end)];
}
