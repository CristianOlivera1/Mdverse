import { marked } from 'marked';
import type { Token, Tokens } from 'marked';

const TASK_MARKER = /\[[ xX]\]/;

export interface TaskToggle {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export function taskToggleAt(markdown: string, index: number): TaskToggle | null {
  const found: TaskToggle[] = [];
  let cursor = 0;

  const walk = (tokens: readonly Token[]): void => {
    for (const token of tokens) {
      if (token.type === 'list') {
        for (const item of (token as Tokens.List).items) {
          const raw = typeof item.raw === 'string' ? item.raw : '';
          const at = raw ? markdown.indexOf(raw, cursor) : -1;
          if (at >= 0) cursor = at;

          if (item.task && at >= 0) {
            const marker = TASK_MARKER.exec(raw);
            if (marker) {
              found.push({
                from: at + marker.index + 1,
                to: at + marker.index + 2,
                insert: marker[0][1] === ' ' ? 'x' : ' ',
              });
            }
          }

          if (item.tokens) walk(item.tokens);
          if (at >= 0) cursor = Math.max(cursor, at + raw.length);
        }
        continue;
      }

      const children = (token as { tokens?: Token[] }).tokens;
      if (Array.isArray(children)) walk(children);
    }
  };

  walk(marked.lexer(markdown));
  return found[index] ?? null;
}
