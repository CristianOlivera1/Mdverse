/**
 * `POST /auth/password/forgot` — emails a one-time password recovery link.
 *
 * The recovery link points at `/auth/callback?next=/reset-password`: the callback
 * exchanges the token for a session and only then hands the user to the form, so
 * the new password is always set by an authenticated request. Like `/auth/resend`
 * the reply never depends on whether the address exists.
 */

import type { APIRoute } from 'astro';

import { authFeedbackUrl } from '@/lib/auth/messages';
import { isLikelyEmail, normalizeEmail } from '@/lib/auth/profile';
import { authCallbackUrl } from '@/lib/supabase/env';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const FORGOT_PATH = '/forgot-password';
const RESET_PATH = '/reset-password';

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const submitted = String(form.get('email') ?? '');
  const email = normalizeEmail(submitted);
  const fail = (error: Parameters<typeof authFeedbackUrl>[0]['error']) =>
    context.redirect(authFeedbackUrl({ to: FORGOT_PATH, error, email }));

  if (!isLikelyEmail(email)) return fail('invalid_email');

  const supabase = createServerSupabaseClient(context);
  if (!supabase) return context.redirect(`/login?error=not_configured`);

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: authCallbackUrl(RESET_PATH),
  });

  if (error) {
    console.warn('[auth] reset request failed:', error.message);
    return fail('reset_failed');
  }

  return context.redirect(authFeedbackUrl({ to: FORGOT_PATH, sent: 'reset', email }));
};
