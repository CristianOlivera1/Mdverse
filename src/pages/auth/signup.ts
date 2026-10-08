import type { APIRoute } from 'astro';

import { keepAlive } from '@/lib/api/http';
import { authFeedbackUrl, loginFeedbackUrl, passwordProblemErrorCode } from '@/lib/auth/messages';
import { checkPassword } from '@/lib/auth/password';
import { isLikelyEmail, normalizeEmail } from '@/lib/auth/profile';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { DEFAULT_AUTHENTICATED_PATH } from '@/lib/auth/routes';
import { authCallbackUrl } from '@/lib/supabase/env';
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
            .then((m) => m.sendConfirmEmail({ to: email, confirmUrl }))
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

  return context.redirect(loginFeedbackUrl({ sent: 'confirm', next, email }));
};

