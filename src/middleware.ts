/**
 * Auth middleware.
 *
 * Responsibilities, in order:
 *  1. Refresh the Supabase session (rotated cookies are written back to the response).
 *  2. Expose `locals.supabase` / `locals.user` / `locals.profile` to pages.
 *  3. Guard protected routes and keep signed-in users away from `/login`.
 *  4. Mark session-dependent responses as non-cacheable, so Cloudflare can never
 *     serve one user's HTML to another.
 */

import { defineMiddleware } from 'astro:middleware';

import { safeRedirectPath } from '@/lib/auth/redirect';
import { isAnonymousOnlyPath, isProtectedPath, loginPathFor } from '@/lib/auth/routes';
import { loadSession } from '@/lib/auth/session';

const PRIVATE_CACHE_CONTROL = 'private, no-cache, no-store, must-revalidate, max-age=0';

export const onRequest = defineMiddleware(async (context, next) => {
  // Cache headers the Supabase client asks for when it writes auth cookies.
  const authHeaders: Record<string, string> = {};

  const session = await loadSession(context, (headers) => Object.assign(authHeaders, headers));
  context.locals.supabase = session.supabase;
  context.locals.user = session.user;
  context.locals.profile = session.profile;

  const { pathname, searchParams } = context.url;
  const sessionDependent = isProtectedPath(pathname) || isAnonymousOnlyPath(pathname);
  const finalize = (response: Response): Response => {
    for (const [name, value] of Object.entries(authHeaders)) response.headers.set(name, value);
    if (sessionDependent) response.headers.set('Cache-Control', PRIVATE_CACHE_CONTROL);
    return response;
  };

  if (isProtectedPath(pathname) && !session.user) {
    return finalize(context.redirect(loginPathFor(pathname, context.url.search)));
  }

  if (isAnonymousOnlyPath(pathname) && session.user) {
    return finalize(context.redirect(safeRedirectPath(searchParams.get('next'))));
  }

  return finalize(await next());
});
