import type { APIRoute } from 'astro';
import type { EmailOtpType } from '@supabase/supabase-js';

import { loginFeedbackUrl } from '@/lib/auth/messages';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { DEFAULT_AUTHENTICATED_PATH } from '@/lib/auth/routes';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const OTP_TYPES = new Set(['signup', 'magiclink', 'recovery', 'email', 'invite', 'email_change']);

export const GET: APIRoute = async (context) => {
  const params = context.url.searchParams;
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  const next = safeRedirectPath(params.get('next'), DEFAULT_AUTHENTICATED_PATH);

  if (!tokenHash || !type || !OTP_TYPES.has(type)) {
    return context.redirect(loginFeedbackUrl({ error: 'callback', next }));
  }

  const supabase = createServerSupabaseClient(context);
  if (!supabase) return context.redirect(loginFeedbackUrl({ error: 'not_configured' }));

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as EmailOtpType,
  });
  if (error) {
    console.warn('[auth] confirm failed:', error.message);
    return context.redirect(loginFeedbackUrl({ error: 'callback', next }));
  }

  return context.redirect(next);
};