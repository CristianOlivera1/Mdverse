import { PUBLIC_SUPABASE_URL } from 'astro:env/client';
import { defineMiddleware } from 'astro:middleware';

import { safeRedirectPath } from '@/lib/auth/redirect';
import { isAnonymousOnlyPath, isProtectedPath, loginPathFor } from '@/lib/auth/routes';
import { loadSession } from '@/lib/auth/session';
import { appendDeploymentCsp, applySecurityHeaders } from '@/lib/security/headers';

const PRIVATE_CACHE_CONTROL = 'private, no-cache, no-store, must-revalidate, max-age=0';

const AUTH_AWARE_PATHS = new Set(['/']);

export const onRequest = defineMiddleware(async (context, next) => {
  const authHeaders: Record<string, string> = {};

  const session = await loadSession(context, (headers) => Object.assign(authHeaders, headers));
  context.locals.supabase = session.supabase;
  context.locals.user = session.user;
  context.locals.profile = session.profile;

  const { pathname, searchParams } = context.url;
  const sessionDependent =
    isProtectedPath(pathname) || isAnonymousOnlyPath(pathname) || AUTH_AWARE_PATHS.has(pathname);
  const finalize = (response: Response): Response => {
    for (const [name, value] of Object.entries(authHeaders)) response.headers.set(name, value);
    if (sessionDependent) response.headers.set('Cache-Control', PRIVATE_CACHE_CONTROL);
    applySecurityHeaders(response.headers);
    appendDeploymentCsp(response.headers, PUBLIC_SUPABASE_URL);
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
