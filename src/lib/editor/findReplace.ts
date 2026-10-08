import { escapeRegExp } from './text';

export interface SearchOptions {
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly wholeWord?: boolean;
}

export function buildSearchRegex({ query, caseSensitive, wholeWord }: SearchOptions): RegExp | null {
  if (!query) return null;
  const pattern = (wholeWord ?? false)
    ? `\\b${escapeRegExp(query)}\\b`
    : escapeRegExp(query);
  return new RegExp(pattern, caseSensitive ? 'g' : 'gi');
}

export function countMatches(value: string, regex: RegExp | null): number {
  if (!regex) return 0;
  regex.lastIndex = 0;

  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    count += 1;
    if (match[0] === '') regex.lastIndex += 1;
  }
  return count;
}

export function replaceAllMatches(
  value: string,
  regex: RegExp | null,
  replacement: string,
): string {
  if (!regex) return value;
  regex.lastIndex = 0;
  return value.replace(regex, () => replacement);
}
