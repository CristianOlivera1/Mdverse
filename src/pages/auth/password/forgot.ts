import type { APIRoute } from 'astro';

import { authFeedbackUrl } from '@/lib/auth/messages';
import { isLikelyEmail, normalizeEmail } from '@/lib/auth/profile';
import { sendResetPasswordEmail } from '@/lib/email/sender';
import { authCallbackUrl } from '@/lib/supabase/env';
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
    console.warn('[auth] admin client unavailable — SUPABASE_SECRET_KEY not set?');
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
    // Still redirect with success — never reveal whether an account exists.
    return context.redirect(authFeedbackUrl({ to: FORGOT_PATH, sent: 'reset', email }));
  }

  const resetUrl = linkData.properties.action_link;

  // Fire-and-forget: email failure never blocks the redirect.
  sendResetPasswordEmail({ to: email, resetUrl }).catch((err: unknown) => {
    console.warn('[email] reset password send failed:', err);
  });

  return context.redirect(authFeedbackUrl({ to: FORGOT_PATH, sent: 'reset', email }));
};
