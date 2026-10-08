/**
 * `POST /auth/signin` - signs in with an email address and password.
 *
 * Only the *presence* of a password is checked here: the policy belongs to
 * sign-up, and applying it to sign-in would reject legacy or externally-set
 * passwords with a misleading message. Every failure that is not "unconfirmed
 * address" is reported as `invalid_credentials`, so the response never reveals
 * whether an address has an account.
 */

import type { APIRoute } from 'astro';

import { loginFeedbackUrl } from '@/lib/auth/messages';
import { isLikelyEmail, normalizeEmail } from '@/lib/auth/profile';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { DEFAULT_AUTHENTICATED_PATH } from '@/lib/auth/routes';
import { isEmailNotConfirmed } from '@/lib/supabase/errors';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const submitted = String(form.get('email') ?? '');
  const email = normalizeEmail(submitted);
  const next = safeRedirectPath(form.get('next'), DEFAULT_AUTHENTICATED_PATH);

  if (!isLikelyEmail(email)) {
    return context.redirect(loginFeedbackUrl({ error: 'invalid_email', next, email: submitted }));
  }

  const password = String(form.get('password') ?? '');
  if (password.length === 0) {
    return context.redirect(loginFeedbackUrl({ error: 'password_missing', next, email }));
  }

  const supabase = createServerSupabaseClient(context);
  if (!supabase) return context.redirect(loginFeedbackUrl({ error: 'not_configured' }));

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (isEmailNotConfirmed(error)) {
      return context.redirect(loginFeedbackUrl({ error: 'email_not_confirmed', next, email }));
    }

    console.warn('[auth] password sign-in failed:', error.message);
    return context.redirect(loginFeedbackUrl({ error: 'invalid_credentials', next, email }));
  }

  // Cookies for the new session were written through `context.cookies` by the
  // server client, so the redirect already carries them.
  return context.redirect(next);
};
