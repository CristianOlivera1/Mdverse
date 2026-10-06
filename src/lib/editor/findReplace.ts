import { escapeRegExp } from './text';

export interface SearchOptions {
  readonly query: string;
  readonly caseSensitive: boolean;
}

/** Build the global search expression, or `null` when there is no query. */
export function buildSearchRegex({ query, caseSensitive }: SearchOptions): RegExp | null {
  if (!query) return null;
  return new RegExp(escapeRegExp(query), caseSensitive ? 'g' : 'gi');
}

export function countMatches(value: string, regex: RegExp | null): number {
  if (!regex) return 0;
  regex.lastIndex = 0;
  return value.match(regex)?.length ?? 0;
}

/**
 * Replace every match.
 * A function replacement keeps `$&`-style sequences in the replacement literal.
 */
export function replaceAllMatches(
  value: string,
  regex: RegExp | null,
  replacement: string,
): string {
  if (!regex) return value;
  regex.lastIndex = 0;
  return value.replace(regex, () => replacement);
}
