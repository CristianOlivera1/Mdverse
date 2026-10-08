import type { APIRoute } from 'astro';

import { authFeedbackUrl, passwordProblemErrorCode, profileFeedbackUrl } from '@/lib/auth/messages';
import { checkPassword } from '@/lib/auth/password';
import {
  authAttemptFor,
  enforceAuthRateLimit,
  HONEYPOT_FIELD,
  isHoneypotFilled,
  logRateLimited,
  rateLimitedRedirect,
} from '@/lib/auth/rate-limit';

const RESET_PATH = '/reset-password';

export const POST: APIRoute = async (context) => {
  const { user, supabase } = context.locals;
  if (!user || !supabase) {
    return context.redirect(`/login?next=${encodeURIComponent(RESET_PATH)}`);
  }

  const form = await context.request.formData();

  // Honeypot: the session holder is authenticated, but a bot driving a stolen
  // session gets the success shape without changing the password.
  if (isHoneypotFilled(form.get(HONEYPOT_FIELD))) {
    console.warn('[auth] honeypot update ignored');
    return context.redirect(profileFeedbackUrl({ passwordUpdated: true }));
  }

  // Authenticated route: keyed by user id so one account's retries never
  // affect another. No email is sent here, so no per-address cooldown applies.
  const attempt = authAttemptFor('update', context.request, user.id);
  const verdict = enforceAuthRateLimit(attempt);
  if (!verdict.allowed) {
    logRateLimited('update', attempt.key, verdict.retryAfterSeconds);
    return rateLimitedRedirect(
      authFeedbackUrl({ to: RESET_PATH, error: 'rate_limited' }),
      verdict.retryAfterSeconds,
    );
  }

  const password = form.get('password');
  const check = checkPassword(password, form.get('confirm_password'));

  if (!check.ok && check.problem) {
    return context.redirect(
      authFeedbackUrl({ to: RESET_PATH, error: passwordProblemErrorCode(check.problem) }),
    );
  }

  // A successful update rotates the session refresh token; the server client
  // writes the new cookies through `context.cookies`.
  const { error } = await supabase.auth.updateUser({ password: String(password) });

  if (error) {
    console.warn('[auth] password update failed:', error.message);
    return context.redirect(authFeedbackUrl({ to: RESET_PATH, error: 'update_failed' }));
  }

  return context.redirect(profileFeedbackUrl({ passwordUpdated: true }));
};
