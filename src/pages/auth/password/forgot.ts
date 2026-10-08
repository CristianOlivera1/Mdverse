import type { APIRoute } from 'astro';

import { keepAlive } from '@/lib/api/http';
import { authFeedbackUrl } from '@/lib/auth/messages';
import { isLikelyEmail, normalizeEmail } from '@/lib/auth/profile';
import { authCallbackUrl, getSiteUrl } from '@/lib/supabase/env';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
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

  // Generate the recovery link via admin API so we can send it ourselves.
  const admin = createAdminSupabaseClient();
  if (!admin) {
    console.warn('[auth] admin client unavailable - SUPABASE_SECRET_KEY not set?');
    return fail('reset_failed');
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: authCallbackUrl(RESET_PATH) },
  });

  if (linkError) {
    // Log but don't leak whether the address exists.
    console.warn('[auth] generateLink (recovery) failed:', linkError.message);
    // Still redirect with success - never reveal whether an account exists.
    return context.redirect(authFeedbackUrl({ to: FORGOT_PATH, sent: 'reset', email }));
  }

  const resetUrl = linkData.properties.action_link;

  // Off the response path (never blocks the redirect) but still awaited by the
  // platform: `waitUntil` keeps it alive on Cloudflare, and the sender reports
  // instead of rejecting, so the `.catch()` only ever sees a lazy-import
  // failure (e.g. the SSR optimizer choking on the React email chain in dev).
  //
  // Lazy import: the React email chain must stay out of this route's static
  // import graph, or `astro dev` 500s the whole route at import time when the
  // SSR optimizer chokes on it (see the share invite route). The trailing
  // `.catch` covers the import itself failing.
  keepAlive(
    context,
    import('@/lib/email/sender')
      .then((m) => m.sendResetPasswordEmail({ to: email, resetUrl, siteUrl: getSiteUrl() }))
      .then((sent) => {
        if (!sent.ok) console.warn('[email] reset password send failed:', sent.error);
      })
      .catch((err) => console.warn('[email] reset password could not be sent:', err)),
  );

  return context.redirect(authFeedbackUrl({ to: FORGOT_PATH, sent: 'reset', email }));
};
