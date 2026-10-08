import type { APIRoute } from 'astro';
import { TURNSTILE_SECRET_KEY } from 'astro:env/server';

import { loginFeedbackUrl } from '@/lib/auth/messages';
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
import { isEmailNotConfirmed } from '@/lib/supabase/errors';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const submitted = String(form.get('email') ?? '');
  const email = normalizeEmail(submitted);
  const next = safeRedirectPath(form.get('next'), DEFAULT_AUTHENTICATED_PATH);

  if (isHoneypotFilled(form.get(HONEYPOT_FIELD))) {
    console.warn('[auth] honeypot signin ignored');
    return context.redirect(next);
  }

  const turnstile = await maybeVerifyTurnstile(form.get(TURNSTILE_FIELD), TURNSTILE_SECRET_KEY);
  if (!turnstile.ok) {
    const attempt = authAttemptFor('signin', context.request, email || null);
    logRateLimited('signin', attempt.key, 0);
    return rateLimitedRedirect(loginFeedbackUrl({ error: 'rate_limited', next, email }), 60);
  }

  const attempt = authAttemptFor('signin', context.request, email || null);
  const verdict = enforceAuthRateLimit(attempt);
  if (!verdict.allowed) {
    logRateLimited('signin', attempt.key, verdict.retryAfterSeconds);
    return rateLimitedRedirect(
      loginFeedbackUrl({ error: 'rate_limited', next, email }),
      verdict.retryAfterSeconds,
    );
  }

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

  return context.redirect(next);
};
