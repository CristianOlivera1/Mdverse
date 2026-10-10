export interface AuthErrorLike {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly status?: number | null;
}

const UNCONFIRMED_CODES = new Set(['email_not_confirmed', 'email_not_verified']);

const EXISTING_ACCOUNT_CODES = new Set(['user_already_exists', 'email_exists']);

const RATE_LIMITED_CODES = new Set(['over_request_rate_limit', 'request_rate_limit_exceeded']);

function matches(
  error: AuthErrorLike | null | undefined,
  codes: Set<string>,
  fragments: string[],
): boolean {
  // Code is primary; message fallback covers older Auth versions and message-only edge cases.
  if (!error) return false;
  if (error.code && codes.has(error.code)) return true;

  const message = error.message?.toLowerCase() ?? '';
  return fragments.some((fragment) => message.includes(fragment));
}

export function isEmailNotConfirmed(error: AuthErrorLike | null | undefined): boolean {
  return matches(error, UNCONFIRMED_CODES, ['email not confirmed', 'not confirmed']);
}

export function isAlreadyRegistered(error: AuthErrorLike | null | undefined): boolean {
  return matches(error, EXISTING_ACCOUNT_CODES, ['already registered', 'already exists']);
}

export function isAuthRateLimited(error: AuthErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.status === 429) return true;
  return matches(error, RATE_LIMITED_CODES, ['rate limit', 'too many requests']);
}
