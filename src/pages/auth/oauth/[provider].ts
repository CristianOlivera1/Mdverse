/**
 * `GET /auth/oauth/:provider` - starts an OAuth round-trip.
 *
 * The provider comes from the URL, so it is checked against an allowlist before
 * being handed to Supabase (no open-ended pass-through of user input).
 */

import type { APIRoute } from 'astro';
import type { Provider } from '@supabase/supabase-js';

import { loginFeedbackUrl } from '@/lib/auth/messages';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { DEFAULT_AUTHENTICATED_PATH } from '@/lib/auth/routes';
import { authCallbackUrl } from '@/lib/supabase/env';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const OAUTH_PROVIDERS = ['github', 'google'] as const satisfies readonly Provider[];

type SupportedProvider = (typeof OAUTH_PROVIDERS)[number];

function isSupportedProvider(value: string | undefined): value is SupportedProvider {
  return value !== undefined && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

export const GET: APIRoute = async (context) => {
  const next = safeRedirectPath(context.url.searchParams.get('next'), DEFAULT_AUTHENTICATED_PATH);
  const provider = context.params.provider;

  if (!isSupportedProvider(provider)) {
    return context.redirect(loginFeedbackUrl({ error: 'provider', next }));
  }

  const supabase = createServerSupabaseClient(context);
  if (!supabase) return context.redirect(loginFeedbackUrl({ error: 'not_configured' }));

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: authCallbackUrl(next),
      // Only Google understands `prompt`; GitHub ignores unknown parameters but
      // there is no reason to send it one. Accounts are never merged by email.
      ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}),
    },
  });

  if (error || !data.url) {
    console.warn('[auth] OAuth start failed:', error?.message ?? 'missing redirect URL');
    return context.redirect(loginFeedbackUrl({ error: 'oauth', next }));
  }

  return context.redirect(data.url);
};
