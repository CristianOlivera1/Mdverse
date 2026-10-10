import type { APIRoute } from 'astro';
import { TURNSTILE_SECRET_KEY } from 'astro:env/server';

import { keepAlive } from '@/lib/api/http';
import { authFeedbackUrl, loginFeedbackUrl, passwordProblemErrorCode } from '@/lib/auth/messages';
import { checkPassword } from '@/lib/auth/password';
import { isLikelyEmail, normalizeEmail } from '@/lib/auth/profile';
import {
  authAttemptFor,
  enforceAuthRateLimit,
  HONEYPOT_FIELD,
  isHoneypotFilled,
  logRateLimited,
  maybeVerifyTurnstile,
  rateLimitedRedirect,
  TURNSTILE_FIELD,
} from '@/lib/auth/rate-limit';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { DEFAULT_AUTHENTICATED_PATH } from '@/lib/auth/routes';
import { authCallbackUrl, getSiteUrl } from '@/lib/supabase/env';
import { isAlreadyRegistered, isAuthRateLimited } from '@/lib/supabase/errors';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

const SIGNUP_PATH = '/signup';

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const submitted = String(form.get('email') ?? '');
  const email = normalizeEmail(submitted);
  const next = safeRedirectPath(form.get('next'), DEFAULT_AUTHENTICATED_PATH);
  const fail = (error: Parameters<typeof authFeedbackUrl>[0]['error']) =>
    context.redirect(authFeedbackUrl({ to: SIGNUP_PATH, error, next, email }));
  const success = () => context.redirect(loginFeedbackUrl({ sent: 'confirm', next, email }));

  if (isHoneypotFilled(form.get(HONEYPOT_FIELD))) {
    console.warn('[auth] honeypot signup ignored');
    return success();
  }

  const turnstile = await maybeVerifyTurnstile(form.get(TURNSTILE_FIELD), TURNSTILE_SECRET_KEY);
  if (!turnstile.ok) {
    const attempt = authAttemptFor('signup', context.request, email || null);
    logRateLimited('signup', attempt.key, 0);
    return rateLimitedRedirect(
      authFeedbackUrl({ to: SIGNUP_PATH, error: 'rate_limited', next, email }),
      60,
    );
  }

  const attempt = authAttemptFor('signup', context.request, email || null);
  const verdict = enforceAuthRateLimit(attempt);
  if (!verdict.allowed) {
    logRateLimited('signup', attempt.key, verdict.retryAfterSeconds);
    return rateLimitedRedirect(
      authFeedbackUrl({ to: SIGNUP_PATH, error: 'rate_limited', next, email }),
      verdict.retryAfterSeconds,
    );
  }

  if (!isLikelyEmail(email)) return fail('invalid_email');

  const password = form.get('password');
  const check = checkPassword(password, form.get('confirm_password'));
  if (!check.ok && check.problem) return fail(passwordProblemErrorCode(check.problem));

  const admin = createAdminSupabaseClient();
  if (!admin) return context.redirect(loginFeedbackUrl({ error: 'not_configured' }));

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: linkData, error: linkError } = await (admin.auth.admin.generateLink as any)({
      type: 'magiclink',
      email,
      password: String(password),
      options: { redirectTo: authCallbackUrl(next) },
    });

    if (linkError) {
      if (isAlreadyRegistered(linkError)) return success();
      if (isAuthRateLimited(linkError)) {
        logRateLimited('signup', attempt.key, 60);
        return rateLimitedRedirect(
          authFeedbackUrl({ to: SIGNUP_PATH, error: 'rate_limited', next, email }),
          60,
        );
      }
      console.warn('[auth] sign-up failed:', linkError.message);
      return fail('signup_failed');
    } else {
      const confirmUrl = (linkData as { properties: { action_link: string } }).properties
        .action_link;
      keepAlive(
        context,
        import('@/lib/email/sender')
          .then((m) => m.sendConfirmEmail({ to: email, confirmUrl, siteUrl: getSiteUrl() }))
          .then((sent) => {
            if (!sent.ok) console.warn('[email] confirm email failed:', sent.error);
          })
          .catch((err) => console.warn('[email] confirm email could not be sent:', err)),
      );
    }
  } catch (err) {
    console.warn('[auth] generateLink (signup) threw:', err);
  }

  return success();
};
