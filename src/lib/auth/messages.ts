import type { PasswordProblem } from './password';

export const AUTH_ERROR_CODES = [
  'not_configured',
  'invalid_email',
  'password_missing',
  'password_short',
  'password_long',
  'password_mismatch',
  'invalid_credentials',
  'email_not_confirmed',
  'email_taken',
  'signin_failed',
  'signup_failed',
  'reset_failed',
  'update_failed',
  'oauth',
  'provider',
  'callback',
  'callback_failed',
  'rate_limited',
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

/** Success notices, keyed by the `sent` query parameter. */
export const AUTH_SENT_CODES = ['confirm', 'resent', 'reset'] as const;

export type AuthSentCode = (typeof AUTH_SENT_CODES)[number];

export interface AuthNotice {
  readonly tone: 'error' | 'success' | 'info';
  readonly message: string;
}

const ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  not_configured:
    'Supabase is not configured yet. Add PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env, then restart the dev server.',
  invalid_email: 'That does not look like a valid email address.',
  password_missing: 'Enter your password.',
  password_short: 'That password is too short: use at least 8 characters.',
  password_long: 'That password is too long: keep it under 72 characters.',
  password_mismatch: 'The two passwords do not match.',
  invalid_credentials: 'Wrong email or password. Please try again.',
  email_not_confirmed:
    'Your email address is not confirmed yet. Open the link we emailed you, or send yourself a new one below.',
  email_taken: 'An account already exists for that address. Sign in instead.',
  signin_failed: 'We could not sign you in right now. Please try again in a moment.',
  signup_failed: 'We could not create your account. Please try again in a moment.',
  reset_failed: 'We could not complete that request. Please try again in a moment.',
  update_failed: 'We could not update your password. Please try again in a moment.',
  oauth: 'The provider rejected the sign-in. Please try again.',
  provider: 'That sign-in provider is not supported.',
  callback: 'This sign-in link is incomplete. Please request a new one.',
  callback_failed: 'This sign-in link is invalid or has expired. Please request a new one.',
  rate_limited:
    'Too many attempts. Please wait a minute before trying again.',
};

const SENT_MESSAGES: Record<AuthSentCode, string> = {
  confirm:
    'Account created. We sent you an email - open it to confirm your address and finish signing in.',
  resent: 'If that address still needs confirming, a new link is on its way.',
  reset: 'If an account exists for that address, we sent a password reset link.',
};

const PASSWORD_ERROR_CODES = {
  missing: 'password_missing',
  too_short: 'password_short',
  too_long: 'password_long',
  mismatch: 'password_mismatch',
} as const satisfies Record<PasswordProblem, AuthErrorCode>;

export function passwordProblemErrorCode(problem: PasswordProblem): AuthErrorCode {
  return PASSWORD_ERROR_CODES[problem];
}

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
  updated?: string | null;
  error?: string | null;
}): AuthNotice | null {
  if (isProfileErrorCode(params.error)) {
    return { tone: 'error', message: PROFILE_ERROR_MESSAGES[params.error] };
  }

  if (params.saved === '1') return { tone: 'success', message: 'Profile saved.' };
  if (params.updated === 'password') {
    return { tone: 'success', message: 'Password updated. Use it the next time you sign in.' };
  }

  return null;
}

/** Builds the `/settings` URL the profile route redirects back to. */
export function profileFeedbackUrl(options: {
  saved?: boolean;
  passwordUpdated?: boolean;
  error?: ProfileErrorCode;
}): string {
  if (options.error) return `/settings?error=${options.error}`;
  if (options.passwordUpdated) return '/settings?updated=password';
  return options.saved ? '/settings?saved=1' : '/settings';
}

export function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return typeof value === 'string' && (AUTH_ERROR_CODES as readonly string[]).includes(value);
}

export function isAuthSentCode(value: unknown): value is AuthSentCode {
  return typeof value === 'string' && (AUTH_SENT_CODES as readonly string[]).includes(value);
}

/** Resolves the notice to show on the login page from its query parameters. */
export function authNotice(params: {
  error?: string | null;
  sent?: string | null;
}): AuthNotice | null {
  if (isAuthErrorCode(params.error)) {
    return { tone: 'error', message: ERROR_MESSAGES[params.error] };
  }

  if (isAuthSentCode(params.sent)) {
    return { tone: 'success', message: SENT_MESSAGES[params.sent] };
  }

  return null;
}

/**
 * Builds the URL an auth route redirects back to.
 *
 * `target` is the screen that shows the notice - `/login` for sign-in, sign-up
 * and password recovery (where the sign-in form already lives), or `/signup` /
 * `/reset-password` when the notice belongs to that form.
 */
export function authFeedbackUrl(options: {
  to?: string;
  error?: AuthErrorCode;
  sent?: AuthSentCode;
  next?: string | null;
  email?: string | null;
}): string {
  const params = new URLSearchParams();

  if (options.error) params.set('error', options.error);
  if (options.sent) params.set('sent', options.sent);
  if (options.next && options.next !== '/dashboard') params.set('next', options.next);
  if (options.email) params.set('email', options.email);

  const path = options.to ?? '/login';
  const query = params.toString();
  return query.length > 0 ? `${path}?${query}` : path;
}

/** Sign-in / sign-up screen feedback (the default `authFeedbackUrl` target). */
export function loginFeedbackUrl(options: {
  error?: AuthErrorCode;
  sent?: AuthSentCode;
  next?: string | null;
  email?: string | null;
}): string {
  return authFeedbackUrl(options);
}
