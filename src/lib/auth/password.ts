/**
 * The numbers mirror the Supabase Auth settings in the setup checklist
 * (PLAN_VISOR_MARKDOWN_PRODUCCION.md, block 10: *Authentication → Sign In /
 * Providers → Email*): minimum length 8 with "Confirm email" enabled. Supabase
 * enforces its own policy server-side; these checks exist so the form can show a
 * clear message before a round-trip, and so a weak password never reaches the API.
 *
 * Pure module on purpose: it is imported by the browser forms, the route handlers
 * and the unit tests, with no Astro or Supabase dependency.
 */

/** Mirrors *Authentication → Settings → Minimum password length*. */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * bcrypt — Supabase's hash — only reads the first 72 bytes, so anything longer
 * would be silently truncated. Rejecting it is honest: the user's password must
 * behave exactly as typed.
 */
export const PASSWORD_MAX_LENGTH = 72;

export const PASSWORD_HINT = `At least ${PASSWORD_MIN_LENGTH} characters, including a letter and a number.`;

/**
 * `pattern` for the `<input>` element: same rule as `checkPassword`, expressed as
 * a browser-native check (lookaheads are supported by every current engine).
 */
export const PASSWORD_PATTERN = `(?=.*[A-Za-z])(?=.*[0-9]).{${PASSWORD_MIN_LENGTH},${PASSWORD_MAX_LENGTH}}`;

export const PASSWORD_PROBLEMS = [
  'missing',
  'too_short',
  'too_long',
  'too_weak',
  'mismatch',
] as const;

export type PasswordProblem = (typeof PASSWORD_PROBLEMS)[number];

export interface PasswordCheck {
  readonly ok: boolean;
  /** `null` when `ok` is true. */
  readonly problem: PasswordProblem | null;
}

export function checkPassword(password: unknown, confirmation?: unknown): PasswordCheck {
  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, problem: 'missing' };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, problem: 'too_short' };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, problem: 'too_long' };
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return { ok: false, problem: 'too_weak' };
  }
  if (confirmation !== undefined && confirmation !== password) {
    return { ok: false, problem: 'mismatch' };
  }

  return { ok: true, problem: null };
}
