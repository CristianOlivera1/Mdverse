/**
 * `POST /auth/signout` - ends the session and clears the auth cookies.
 *
 * POST only: a link prefetch or a stray GET must never be able to log someone out.
 */

import type { APIRoute } from 'astro';

import { safeRedirectPath } from '@/lib/auth/redirect';
import { signOutUser } from '@/lib/auth/session';

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData().catch(() => null);
  const next = safeRedirectPath(form?.get('next'), '/');

  await signOutUser(context);

  return context.redirect(next);
};
