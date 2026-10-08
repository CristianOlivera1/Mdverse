import type { APIRoute } from 'astro';

import { authFeedbackUrl, passwordProblemErrorCode, profileFeedbackUrl } from '@/lib/auth/messages';
import { checkPassword } from '@/lib/auth/password';

const RESET_PATH = '/reset-password';

export const POST: APIRoute = async (context) => {
  const { user, supabase } = context.locals;
  if (!user || !supabase) {
    return context.redirect(`/login?next=${encodeURIComponent(RESET_PATH)}`);
  }

  const form = await context.request.formData();
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
