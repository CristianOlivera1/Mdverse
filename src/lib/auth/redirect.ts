/**
 * Post-login redirect sanitizing.
 *
 * `?next=` values travel through query strings, hidden form fields and email
 * links, so they are attacker-controlled input. Only same-origin *paths* are
 * allowed: anything that could leave the origin (absolute URLs, protocol-relative
 * `//host`, backslash tricks, control characters used for header splitting) falls
 * back to a safe default.
 */

/** Longest accepted `next` value; longer ones are treated as hostile/broken. */
const MAX_LENGTH = 512;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Returns a safe, same-origin path to redirect to after authentication. */
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

/** Keeps the destination's query string when building a login redirect. */
export function currentPathWithSearch(url: { pathname: string; search?: string }): string {
  const search = url.search ?? '';
  if (search.length === 0) return url.pathname;
  return `${url.pathname}${search.startsWith('?') ? search : `?${search}`}`;
}
