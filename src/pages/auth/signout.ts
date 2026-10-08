import type { APIRoute } from 'astro';

import { safeRedirectPath } from '@/lib/auth/redirect';
import { signOutUser } from '@/lib/auth/session';

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData().catch(() => null);
  const next = safeRedirectPath(form?.get('next'), '/');

  await signOutUser(context);

  return context.redirect(next);
};
