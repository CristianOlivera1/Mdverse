/**
 * `POST /auth/resend` — sends the confirmation email again.
 *
 * The answer is identical whatever happens (unknown address, already confirmed,
 * rate-limited), so the route cannot be used to discover which addresses have
 * accounts. Failures are logged, never shown.
 *
 * With Supabase's built-in email provider disabled we generate the link ourselves
 * via the admin API and send it through Resend.
 */

import type { APIRoute } from 'astro';

import { loginFeedbackUrl } from '@/lib/auth/messages';
import { isLikelyEmail, normalizeEmail } from '@/lib/auth/profile';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { DEFAULT_AUTHENTICATED_PATH } from '@/lib/auth/routes';
import { sendConfirmEmail } from '@/lib/email/sender';
import { authCallbackUrl } from '@/lib/supabase/env';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const submitted = String(form.get('email') ?? '');
  const email = normalizeEmail(submitted);
  const next = safeRedirectPath(form.get('next'), DEFAULT_AUTHENTICATED_PATH);

  if (!isLikelyEmail(email)) {
    return context.redirect(loginFeedbackUrl({ error: 'invalid_email', next, email: submitted }));
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
        sendConfirmEmail({ to: email, confirmUrl }).catch((err: unknown) => {
          console.warn('[email] resend confirm failed:', err);
        });
      }
    } catch (err) {
      console.warn('[auth] generateLink (resend) threw:', err);
    }
  }

  // Always respond with success — never reveal whether the address has an account.
  return context.redirect(loginFeedbackUrl({ sent: 'resent', next, email }));
};
