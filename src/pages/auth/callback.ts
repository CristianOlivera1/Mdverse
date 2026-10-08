/**
 * `GET /auth/callback` - completes sign-in.
 *
 * Handles both shapes Supabase can send:
 *  - `?code=…` (PKCE, used by magic links and OAuth),
 *  - `?token_hash=…&type=…` (email confirmations, invites, recovery links).
 *
 * Any failure redirects back to `/login` with a code; the raw provider error is
 * logged server-side and never echoed to the browser.
 */

import type { APIRoute } from 'astro';
import type { EmailOtpType } from '@supabase/supabase-js';

import { loginFeedbackUrl } from '@/lib/auth/messages';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { DEFAULT_AUTHENTICATED_PATH } from '@/lib/auth/routes';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const OTP_TYPES: readonly EmailOtpType[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
];

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (OTP_TYPES as readonly string[]).includes(value);
}

export const GET: APIRoute = async (context) => {
  const { searchParams } = context.url;
  const next = safeRedirectPath(searchParams.get('next'), DEFAULT_AUTHENTICATED_PATH);
  const failure = (code: 'callback' | 'callback_failed') =>
    context.redirect(loginFeedbackUrl({ error: code, next }));

  const providerError = searchParams.get('error_code') ?? searchParams.get('error');
  if (providerError) {
    console.warn(
      '[auth] provider returned an error:',
      providerError,
      searchParams.get('error_description') ?? '',
    );
    return failure('callback_failed');
  }

  const supabase = createServerSupabaseClient(context);
  if (!supabase) return context.redirect(loginFeedbackUrl({ error: 'not_configured' }));

  const code = searchParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.warn('[auth] code exchange failed:', error.message);
      return failure('callback_failed');
    }
    return context.redirect(next);
  }

  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  if (tokenHash && isEmailOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      console.warn('[auth] OTP verification failed:', error.message);
      return failure('callback_failed');
    }
    return context.redirect(next);
  }

  return failure('callback');
};
