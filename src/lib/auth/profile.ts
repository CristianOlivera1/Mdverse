/**
 * Avatars are **initials only** — the product decision is to store no profile
 * pictures (see PLAN_VISOR_MARKDOWN_PRODUCCION.md, block 6.2). `avatarToneIndex`
 * derives a stable color slot from a seed so the same person always gets the same
 * badge without persisting anything.
 */

export const AVATAR_TONE_COUNT = 6;

/** Username bounds shared with the SQL trigger `private.handle_new_user`. */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
/** The trigger truncates the derived base before appending a numeric suffix. */
export const USERNAME_BASE_MAX_LENGTH = 24;
export const DISPLAY_NAME_MAX_LENGTH = 60;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isLikelyEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  return email.length >= 6 && email.length <= 254 && EMAIL_PATTERN.test(email);
}

/**
 * Canonical form of an address before it reaches Supabase: trimmed and
 * lowercased, so `Ana@Mail.com` and `ana@mail.com` are the same account (and the
 * same value comes back in the feedback URL).
 */
export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function initials(name: string | null | undefined, max = 2): string {
  const cleaned = (name ?? '')
    .trim()
    // Keep the local part of an email, so "ana.perez@x.com" reads as Ana Pérez.
    .replace(/@.*$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

  if (cleaned.length === 0) return '?';

  const words = cleaned.split(/\s+/);
  const first = Array.from(words[0])[0] ?? '';
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? '') : '';

  const letters = (first + last).slice(0, Math.max(1, max));
  return letters.toLocaleUpperCase() || '?';
}

export function displayNameFromEmail(email: string | null | undefined): string {
  const local = localPartOf(email);
  const words = local
    .split(/[._\-+]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter((word) => word.length > 0);

  if (words.length === 0) return 'Anonymous';

  return words
    .map((word) => {
      const chars = Array.from(word);
      return (chars[0] ?? '').toLocaleUpperCase() + chars.slice(1).join('');
    })
    .join(' ')
    .slice(0, DISPLAY_NAME_MAX_LENGTH);
}

/**
 * The local part of an address without its `+tag`, which is a routing label and
 * never part of someone's name (`ana+news@mail.com` → `ana`).
 */
function localPartOf(email: string | null | undefined): string {
  return ((email ?? '').split('@')[0] ?? '').split('+')[0] ?? '';
}

/**
 * Derives a username from an email, mirroring the SQL in
 * `supabase/migrations/*_profiles.sql`. Kept in sync so an account created
 * client-side and one created by the trigger look identical.
 */
export function usernameFromEmail(email: string | null | undefined): string {
  let candidate = localPartOf(email)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');

  if (candidate.length === 0) candidate = 'user';
  if (candidate.length < USERNAME_MIN_LENGTH) candidate = `${candidate}user`;

  return candidate.slice(0, USERNAME_BASE_MAX_LENGTH);
}

export function isValidUsername(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= USERNAME_MIN_LENGTH &&
    value.length <= USERNAME_MAX_LENGTH &&
    /^[a-z0-9_]+$/.test(value)
  );
}

export function isValidDisplayName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim().length <= DISPLAY_NAME_MAX_LENGTH
  );
}

export function avatarToneIndex(
  seed: string | null | undefined,
  tones = AVATAR_TONE_COUNT,
): number {
  const value = (seed ?? '').trim();
  if (value.length === 0 || tones <= 1) return 0;

  // djb2 — tiny, dependency-free and deterministic across runtimes.
  let hash = 5381;
  for (const char of value) {
    hash = (hash * 33) ^ (char.codePointAt(0) ?? 0);
  }

  return Math.abs(hash) % tones;
}

/** `2026-10-06T…` → `Oct 6, 2026` (UTC, so tests are timezone independent). */
export function formatMemberSince(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
