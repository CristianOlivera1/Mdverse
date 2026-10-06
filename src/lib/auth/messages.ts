/**
 * One place for every auth notice the user can see.
 *
 * Route handlers redirect with a short code (`/login?error=callback_failed`) and
 * the login page renders the matching copy, so wording stays consistent and no
 * error text ever travels through the URL.
 */

export const AUTH_ERROR_CODES = [
  'not_configured',
  'invalid_email',
  'signin_failed',
  'oauth',
  'provider',
  'callback',
  'callback_failed',
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export interface AuthNotice {
  readonly tone: 'error' | 'success' | 'info';
  readonly message: string;
}

const ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  not_configured:
    'Supabase is not configured yet. Add PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env, then restart the dev server.',
  invalid_email: 'That does not look like a valid email address.',
  signin_failed: 'We could not send the sign-in link. Please try again in a moment.',
  oauth: 'The provider rejected the sign-in. Please try again.',
  provider: 'That sign-in provider is not supported.',
  callback: 'This sign-in link is incomplete. Please request a new one.',
  callback_failed: 'This sign-in link is invalid or has expired. Please request a new one.',
};

const SENT_MESSAGE = 'Check your inbox — we sent you a sign-in link.';

export const PROFILE_ERROR_CODES = [
  'invalid_display_name',
  'invalid_username',
  'username_taken',
  'save_failed',
] as const;

export type ProfileErrorCode = (typeof PROFILE_ERROR_CODES)[number];

const PROFILE_ERROR_MESSAGES: Record<ProfileErrorCode, string> = {
  invalid_display_name: 'Display name must be between 1 and 60 characters.',
  invalid_username:
    'Username must be 3–30 characters and use only lowercase letters, numbers and underscores.',
  username_taken: 'That username is already taken. Try another one.',
  save_failed: 'We could not save your profile. Please try again.',
};

function isProfileErrorCode(value: unknown): value is ProfileErrorCode {
  return typeof value === 'string' && (PROFILE_ERROR_CODES as readonly string[]).includes(value);
}

/** Resolves the notice to show on the profile page from its query parameters. */
export function profileNotice(params: {
  saved?: string | null;
  error?: string | null;
}): AuthNotice | null {
  if (isProfileErrorCode(params.error)) {
    return { tone: 'error', message: PROFILE_ERROR_MESSAGES[params.error] };
  }

  if (params.saved === '1') return { tone: 'success', message: 'Profile saved.' };

  return null;
}

/** Builds the `/settings` URL the profile route redirects back to. */
export function profileFeedbackUrl(options: { saved?: boolean; error?: ProfileErrorCode }): string {
  if (options.error) return `/settings?error=${options.error}`;
  return options.saved ? '/settings?saved=1' : '/settings';
}

export function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return typeof value === 'string' && (AUTH_ERROR_CODES as readonly string[]).includes(value);
}

/** Resolves the notice to show on the login page from its query parameters. */
export function authNotice(params: {
  error?: string | null;
  sent?: string | null;
}): AuthNotice | null {
  if (isAuthErrorCode(params.error)) {
    return { tone: 'error', message: ERROR_MESSAGES[params.error] };
  }

  if (params.sent === '1') return { tone: 'success', message: SENT_MESSAGE };

  return null;
}

/** Builds the `/login` URL a route handler redirects back to. */
export function loginFeedbackUrl(options: {
  error?: AuthErrorCode;
  sent?: boolean;
  next?: string | null;
  email?: string | null;
}): string {
  const params = new URLSearchParams();

  if (options.error) params.set('error', options.error);
  if (options.sent) params.set('sent', '1');
  if (options.next && options.next !== '/dashboard') params.set('next', options.next);
  if (options.email) params.set('email', options.email);

  const query = params.toString();
  return query.length > 0 ? `/login?${query}` : '/login';
}
