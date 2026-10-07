import type { APIRoute } from 'astro';

import { authFeedbackUrl, loginFeedbackUrl, passwordProblemErrorCode } from '@/lib/auth/messages';
import { checkPassword } from '@/lib/auth/password';
import { isLikelyEmail, normalizeEmail } from '@/lib/auth/profile';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { DEFAULT_AUTHENTICATED_PATH } from '@/lib/auth/routes';
import { authCallbackUrl } from '@/lib/supabase/env';
import { isAlreadyRegistered } from '@/lib/supabase/errors';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const SIGNUP_PATH = '/signup';

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const submitted = String(form.get('email') ?? '');
  const email = normalizeEmail(submitted);
  const next = safeRedirectPath(form.get('next'), DEFAULT_AUTHENTICATED_PATH);
  const fail = (error: Parameters<typeof authFeedbackUrl>[0]['error']) =>
    context.redirect(authFeedbackUrl({ to: SIGNUP_PATH, error, next, email }));

  if (!isLikelyEmail(email)) return fail('invalid_email');

  const password = form.get('password');
  const check = checkPassword(password, form.get('confirm_password'));
  if (!check.ok && check.problem) return fail(passwordProblemErrorCode(check.problem));

  const supabase = createServerSupabaseClient(context);
  if (!supabase) return context.redirect(loginFeedbackUrl({ error: 'not_configured' }));

  const { data, error } = await supabase.auth.signUp({
    email,
    password: String(password),
    options: { emailRedirectTo: authCallbackUrl(next) },
  });

  if (error) {
    if (isAlreadyRegistered(error)) {
      return context.redirect(loginFeedbackUrl({ error: 'email_taken', next, email }));
    }

    console.warn('[auth] sign-up failed:', error.message);
    return fail('signup_failed');
  }

  // Confirmations on: Supabase sends the address a link and returns no
  // session, so the user lands on the sign-in screen with a "check your
  // inbox" notice. Confirmations off: Supabase signed the user in already.
  if (data.session) return context.redirect(next);

  return context.redirect(loginFeedbackUrl({ sent: 'confirm', next, email }));
};
