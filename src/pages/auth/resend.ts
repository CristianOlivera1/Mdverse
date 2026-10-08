
import type { APIRoute } from 'astro';
import { TURNSTILE_SECRET_KEY } from 'astro:env/server';

import { keepAlive } from '@/lib/api/http';
import { loginFeedbackUrl } from '@/lib/auth/messages';
import { isLikelyEmail, normalizeEmail } from '@/lib/auth/profile';
import {
  authAttemptFor,
  enforceAuthRateLimit,
  enforceEmailCooldown,
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
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const submitted = String(form.get('email') ?? '');
  const email = normalizeEmail(submitted);
  const next = safeRedirectPath(form.get('next'), DEFAULT_AUTHENTICATED_PATH);
  // Always-redirects success: never reveal whether the address exists.
  const success = () => context.redirect(loginFeedbackUrl({ sent: 'resent', next, email }));

  // Honeypot: same success shape, no email sent.
  if (isHoneypotFilled(form.get(HONEYPOT_FIELD))) {
    console.warn('[auth] honeypot resend ignored');
    return success();
  }

  // Env-gated Turnstile: skipped until TURNSTILE_SECRET_KEY is provisioned.
  const turnstile = await maybeVerifyTurnstile(form.get(TURNSTILE_FIELD), TURNSTILE_SECRET_KEY);
  if (!turnstile.ok) {
    const attempt = authAttemptFor('resend', context.request, email || null);
    logRateLimited('resend', attempt.key, 0);
    return rateLimitedRedirect(loginFeedbackUrl({ error: 'rate_limited', next, email }), 60);
  }

  const attempt = authAttemptFor('resend', context.request, email || null);
  const verdict = enforceAuthRateLimit(attempt);
  if (!verdict.allowed) {
    logRateLimited('resend', attempt.key, verdict.retryAfterSeconds);
    return rateLimitedRedirect(
      loginFeedbackUrl({ error: 'rate_limited', next, email }),
      verdict.retryAfterSeconds,
    );
  }

  if (!isLikelyEmail(email)) {
    return context.redirect(loginFeedbackUrl({ error: 'invalid_email', next, email: submitted }));
  }

  // Per-address cooldown: looping this endpoint must not turn our Resend
  // budget into an email cannon against one address. Same success redirect
  // either way, so the cooldown itself is not an oracle.
  const cooldown = enforceEmailCooldown(email);
  if (!cooldown.allowed) {
    logRateLimited('resend', attempt.key, cooldown.retryAfterSeconds);
    return rateLimitedRedirect(
      loginFeedbackUrl({ error: 'rate_limited', next, email }),
      cooldown.retryAfterSeconds,
    );
  }

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
        console.warn('[auth] generateLink (resend) failed:', linkError.message);
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
              if (!sent.ok) console.warn('[email] resend confirm failed:', sent.error);
            })
            .catch((err) => console.warn('[email] resend confirm could not be sent:', err)),
        );
      }
    } catch (err) {
      console.warn('[auth] generateLink (resend) threw:', err);
    }
  }

  return success();
};
