/**
 * `POST /auth/resend` — sends the confirmation email again.
 *
 * The answer is identical whatever happens (unknown address, already confirmed,
 * rate-limited), so the route cannot be used to discover which addresses have
 * accounts. Failures are logged, never shown.
 */

import type { APIRoute } from 'astro';

import { loginFeedbackUrl } from '@/lib/auth/messages';
import { isLikelyEmail, normalizeEmail } from '@/lib/auth/profile';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { DEFAULT_AUTHENTICATED_PATH } from '@/lib/auth/routes';
import { authCallbackUrl } from '@/lib/supabase/env';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const submitted = String(form.get('email') ?? '');
  const email = normalizeEmail(submitted);
  const next = safeRedirectPath(form.get('next'), DEFAULT_AUTHENTICATED_PATH);

  if (!isLikelyEmail(email)) {
    return context.redirect(loginFeedbackUrl({ error: 'invalid_email', next, email: submitted }));
  }

  const supabase = createServerSupabaseClient(context);
  if (!supabase) return context.redirect(loginFeedbackUrl({ error: 'not_configured' }));

  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: authCallbackUrl(next) },
  });

  if (error) console.warn('[auth] resend confirmation failed:', error.message);

  return context.redirect(loginFeedbackUrl({ sent: 'resent', next, email }));
};
