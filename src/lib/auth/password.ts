export const PASSWORD_MIN_LENGTH = 8;

// bcrypt silently truncates beyond 72 bytes, so longer input must be rejected.
export const PASSWORD_MAX_LENGTH = 72;

export const PASSWORD_HINT = `At least ${PASSWORD_MIN_LENGTH} characters, including a letter and a number.`;

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
