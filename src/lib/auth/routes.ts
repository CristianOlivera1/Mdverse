/**
 * Route access rules, kept in one place so the middleware, pages and tests agree.
 *
 * Phase 2 protects the account area only. Phase 3 adds `/documents/*`; add the
 * prefix here and both the middleware and the links keep working.
 */

/** Paths that require an authenticated session. */
export const PROTECTED_PREFIXES = ['/dashboard', '/settings', '/documents'] as const;

/** Paths that only make sense for anonymous visitors. */
export const ANONYMOUS_ONLY_PATHS = ['/login'] as const;

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

export function isAnonymousOnlyPath(pathname: string): boolean {
  return ANONYMOUS_ONLY_PATHS.some((path) => matchesPrefix(pathname, path));
}

/** Login URL carrying the destination, so the user lands where they intended. */
export function loginPathFor(pathname: string, search = ''): string {
  const target = `${pathname}${search}`;
  if (target === '/' || target.length === 0) return '/login';
  return `/login?next=${encodeURIComponent(target)}`;
}

export const DEFAULT_AUTHENTICATED_PATH = '/dashboard';
