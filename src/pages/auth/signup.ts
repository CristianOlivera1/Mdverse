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
import { isAlreadyRegistered } from '@/lib/supabase/errors';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const SIGNUP_PATH = '/signup';

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const submitted = String(form.get('email') ?? '');
  const email = normalizeEmail(submitted);
  const next = safeRedirectPath(form.get('next'), DEFAULT_AUTHENTICATED_PATH);
  const fail = (error: Parameters<typeof authFeedbackUrl>[0]['error']) =>
    context.redirect(authFeedbackUrl({ to: SIGNUP_PATH, error, next, email }));
  const success = () => context.redirect(loginFeedbackUrl({ sent: 'confirm', next, email }));

  // Honeypot: answer with the exact success shape without creating anything.
  if (isHoneypotFilled(form.get(HONEYPOT_FIELD))) {
    console.warn('[auth] honeypot signup ignored');
    return success();
  }

  // Env-gated Turnstile: skipped until TURNSTILE_SECRET_KEY is provisioned.
  const turnstile = await maybeVerifyTurnstile(form.get(TURNSTILE_FIELD), TURNSTILE_SECRET_KEY);
  if (!turnstile.ok) {
    const attempt = authAttemptFor('signup', context.request, email || null);
    logRateLimited('signup', attempt.key, 0);
    return rateLimitedRedirect(authFeedbackUrl({ to: SIGNUP_PATH, error: 'rate_limited', next, email }), 60);
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

  const supabase = createServerSupabaseClient(context);
  if (!supabase) return context.redirect(loginFeedbackUrl({ error: 'not_configured' }));

  const { data, error } = await supabase.auth.signUp({
    email,
    password: String(password),
    options: { emailRedirectTo: authCallbackUrl(next) },
  });

  if (error) {
    if (isAlreadyRegistered(error)) {
      // Anti-enumeration: an address that already has an account gets the SAME
      // success redirect as a fresh sign-up, and no `email_taken` code is
      // emitted here anymore. No email is sent on this path either, so an
      // attacker cannot turn our Resend budget into an oracle or a spam
      // cannon against someone else's address. Legitimate users who forgot
      // they signed up still land on "check your inbox" and can recover
      // through sign-in or forgot-password.
      return success();
    }
    console.warn('[auth] sign-up failed:', error.message);
    return fail('signup_failed');
  }

  // Session present means email confirmation is disabled - user is already in.
  if (data.session) return context.redirect(next);

  // No session → email confirmation is required.
  // Use the admin client to generate the confirmation link and send it via Resend.
  const admin = createAdminSupabaseClient();
  if (admin) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: linkData, error: linkError } = await (admin.auth.admin.generateLink as any)({
        type: 'signup',
        email,
        options: { redirectTo: authCallbackUrl(next) },
      });

      if (linkError) {
        console.warn('[auth] generateLink (signup) failed:', linkError.message);
      } else {
        const confirmUrl = (linkData as { properties: { action_link: string } }).properties.action_link;
        // Lazy import: the React email chain must stay out of this route's
        // static import graph, or `astro dev` 500s the whole route at import
        // time when the SSR optimizer chokes on it (see the share invite
        // route). The trailing `.catch` covers the import itself failing.
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
  }

  return success();
};
