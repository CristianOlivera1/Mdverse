/**
 * Environment wiring for Supabase.
 *
 * Only `PUBLIC_` variables are readable in the browser; the secret key is never
 * exposed through this module. Everything here goes through the pure helpers in
 * `./config` so the decision logic stays testable.
 */

import {
  PUBLIC_SITE_URL,
  PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  PUBLIC_SUPABASE_URL,
} from 'astro:env/client';

import { buildAuthCallbackUrl, normalizeSupabaseConfig, SUPABASE_SETUP_HINT } from './config';
import type { SupabaseConfig } from './config';

export { SUPABASE_SETUP_HINT };
export type { SupabaseConfig };

/** `null` until the project URL and publishable key are real values. */
export function readSupabaseConfig(): SupabaseConfig | null {
  return normalizeSupabaseConfig({
    url: PUBLIC_SUPABASE_URL,
    publishableKey: PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

export function isSupabaseConfigured(): boolean {
  return readSupabaseConfig() !== null;
}

/** Same as `readSupabaseConfig`, but fails loudly for code paths that need it. */
export function requireSupabaseConfig(): SupabaseConfig {
  const config = readSupabaseConfig();
  if (!config) throw new Error(SUPABASE_SETUP_HINT);
  return config;
}

/** Public site URL without a trailing slash, used to build absolute redirects. */
export function getSiteUrl(): string {
  return (PUBLIC_SITE_URL ?? 'http://localhost:4321').trim().replace(/\/+$/, '');
}

/** Redirect target handed to Supabase for magic links and OAuth. */
export function authCallbackUrl(next?: string | null): string {
  return buildAuthCallbackUrl(getSiteUrl(), next);
}
