/** Route access rules, shared by middleware, pages and tests. */

export const PROTECTED_PREFIXES = [
  '/dashboard',
  '/settings',
  '/documents',
  // Reached from the password-reset email: the link signs the user in first, so
  // an anonymous visitor here is redirected to /login to start over.
  '/reset-password',
] as const;

export const ANONYMOUS_ONLY_PATHS = ['/login', '/signup', '/forgot-password'] as const;

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

export function isAnonymousOnlyPath(pathname: string): boolean {
  return ANONYMOUS_ONLY_PATHS.some((path) => matchesPrefix(pathname, path));
}

export function loginPathFor(pathname: string, search = ''): string {
  const target = `${pathname}${search}`;
  if (target === '/' || target.length === 0) return '/login';
  return `/login?next=${encodeURIComponent(target)}`;
}

export const DEFAULT_AUTHENTICATED_PATH = '/dashboard';
