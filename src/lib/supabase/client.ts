/**
 * Browser Supabase client.
 *
 * `@supabase/ssr`'s `createBrowserClient` persists the session in cookies (the
 * same cookie the server client reads), which is what keeps a session alive
 * across reloads and gives phase 4 its Realtime token.
 *
 * Import this only from client-side code (`<script>` blocks in `.astro` files).
 */

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import { SUPABASE_SETUP_HINT } from './config';
import type { Database } from './database.types';
import { readSupabaseConfig } from './env';

let cached: SupabaseClient<Database> | null = null;

export function isBrowserSupabaseConfigured(): boolean {
  return readSupabaseConfig() !== null;
}

export function getBrowserSupabaseClient(): SupabaseClient<Database> {
  if (cached) return cached;

  const config = readSupabaseConfig();
  if (!config) throw new Error(SUPABASE_SETUP_HINT);

  cached = createBrowserClient<Database>(config.url, config.publishableKey);
  return cached;
}
