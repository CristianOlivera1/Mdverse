export const PROTECTED_PREFIXES = [
  '/dashboard',
  '/settings',
  '/documents',
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
