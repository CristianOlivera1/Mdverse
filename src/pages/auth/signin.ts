/** `POST /auth/signin` — sends a magic sign-in link by email. */

import type { APIRoute } from 'astro';

import { isLikelyEmail } from '@/lib/auth/profile';
import { loginFeedbackUrl } from '@/lib/auth/messages';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { DEFAULT_AUTHENTICATED_PATH } from '@/lib/auth/routes';
import { authCallbackUrl } from '@/lib/supabase/env';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const next = safeRedirectPath(form.get('next'), DEFAULT_AUTHENTICATED_PATH);

  if (!isLikelyEmail(email)) {
    return context.redirect(loginFeedbackUrl({ error: 'invalid_email', next, email }));
  }

  const supabase = createServerSupabaseClient(context);
  if (!supabase) return context.redirect(loginFeedbackUrl({ error: 'not_configured' }));

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: authCallbackUrl(next),
      // Anyone can create an account by signing in; phase 4 adds invitations.
      shouldCreateUser: true,
    },
  });

  if (error) {
    console.warn('[auth] magic link failed:', error.message);
    return context.redirect(loginFeedbackUrl({ error: 'signin_failed', next, email }));
  }

  return context.redirect(loginFeedbackUrl({ sent: true, next, email }));
};
