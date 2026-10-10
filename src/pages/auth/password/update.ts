import type { APIRoute } from 'astro';

import type { AuthErrorCode } from '@/lib/auth/messages';
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

const GO_TRUE_ERROR_CODES: Record<string, AuthErrorCode> = {
  same_password: 'same_password',
  reauthentication_needed: 'reauthentication_needed',
};

export const POST: APIRoute = async (context) => {
  const { user, supabase } = context.locals;
  if (!user || !supabase) {
    return context.redirect(`/login?next=${encodeURIComponent(RESET_PATH)}`);
  }

  const form = await context.request.formData();

  if (isHoneypotFilled(form.get(HONEYPOT_FIELD))) {
    console.warn('[auth] honeypot update ignored');
    return context.redirect(profileFeedbackUrl({ passwordUpdated: true }));
  }

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

  const { error } = await supabase.auth.updateUser({ password: String(password) });

  if (error) {

    console.warn('[auth] password update failed:', error.code ?? 'unknown', '-', error.message);
    const mapped = error.code ? GO_TRUE_ERROR_CODES[error.code] : undefined;
    return context.redirect(
      authFeedbackUrl({ to: RESET_PATH, error: mapped ?? 'update_failed' }),
    );
  }

  return context.redirect(profileFeedbackUrl({ passwordUpdated: true }));
};
