/**
 * Supabase connection settings.
 *
 * Kept free of `astro:env` imports on purpose: this module is pure so it can be
 * unit-tested outside the Astro runtime. `src/lib/supabase/env.ts` is the thin
 * layer that wires it to the real environment variables.
 */

import { safeRedirectPath } from '../auth/redirect';

export interface SupabaseConfig {
  /** Project URL, without a trailing slash. */
  readonly url: string;
  /** Publishable (a.k.a. legacy anon) key. Safe to ship to the browser. */
  readonly publishableKey: string;
}

/** Values copied from `.env.example` that must never be treated as configured. */
const PLACEHOLDERS = [
  'YOUR_PROJECT_REF',
  'YOUR_PUBLISHABLE_KEY',
  'YOUR_SECRET_KEY',
  'TU_CLAVE',
  'TU_PROJECT_REF',
  'xxx',
];

function isUsableValue(value: string): boolean {
  if (value.length === 0) return false;
  const upper = value.toUpperCase();
  return !PLACEHOLDERS.some((placeholder) => upper.includes(placeholder.toUpperCase()));
}

function isUsableUrl(value: string): boolean {
  if (!/^https?:\/\/[^\s/]+/i.test(value)) return false;
  return isUsableValue(value);
}

/**
 * Normalizes the raw environment values into a usable config, or `null` when the
 * project is not configured yet (missing or still holding `.env.example` values).
 */
export function normalizeSupabaseConfig(input: {
  url?: string | null;
  publishableKey?: string | null;
}): SupabaseConfig | null {
  const url = (input.url ?? '').trim().replace(/\/+$/, '');
  const publishableKey = (input.publishableKey ?? '').trim();

  if (!isUsableUrl(url) || !isUsableValue(publishableKey)) return null;

  return { url, publishableKey };
}

/** Absolute URL Supabase redirects back to after an email link or OAuth round-trip. */
export function buildAuthCallbackUrl(siteUrl: string, next?: string | null): string {
  const base = siteUrl.trim().replace(/\/+$/, '');
  const target = safeRedirectPath(next, '/dashboard');
  return `${base}/auth/callback?next=${encodeURIComponent(target)}`;
}

/** Shown in the UI (and in thrown errors) when the Supabase project is missing. */
export const SUPABASE_SETUP_HINT = [
  'Supabase is not configured yet.',
  'Copy .env.example to .env and fill in PUBLIC_SUPABASE_URL and',
  'PUBLIC_SUPABASE_PUBLISHABLE_KEY from your project (Settings → API).',
  'See PLAN_VISOR_MARKDOWN_PRODUCCION.md (blocks 9 and 10).',
].join(' ');
