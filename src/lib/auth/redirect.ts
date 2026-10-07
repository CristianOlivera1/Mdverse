/** `next` is attacker-controlled: only same-origin paths allowed (open redirect / header splitting). */

const MAX_LENGTH = 512;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function safeRedirectPath(value: unknown, fallback = '/dashboard'): string {
  if (typeof value !== 'string') return fallback;

  const path = value.trim();
  if (path.length === 0 || path.length > MAX_LENGTH) return fallback;
  if (!path.startsWith('/')) return fallback;
  // `//evil.com` and `/\evil.com` are read as protocol-relative URLs by browsers.
  if (path.startsWith('//') || path.startsWith('/\\')) return fallback;
  if (path.includes('\\')) return fallback;
  if (CONTROL_CHARS.test(path)) return fallback;

  return path;
}

export function currentPathWithSearch(url: { pathname: string; search?: string }): string {
  const search = url.search ?? '';
  if (search.length === 0) return url.pathname;
  return `${url.pathname}${search.startsWith('?') ? search : `?${search}`}`;
}
