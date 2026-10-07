/**
 * Supabase Admin client — service-role key, server-only.
 *
 * Bypasses RLS. Use only for operations that require it:
 *   - auth.admin.generateLink()  (get auth magic links to send ourselves)
 *
 * Never expose this client or its key to the browser.
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

import { SUPABASE_SECRET_KEY } from 'astro:env/server';

import type { Database } from './database.types';
import { readSupabaseConfig } from './env';

let _admin: SupabaseClient<Database> | null = null;

/**
 * Returns the admin client, or `null` if SUPABASE_SECRET_KEY or the project
 * URL are not configured. Callers must handle the `null` case gracefully.
 */
export function createAdminSupabaseClient(): SupabaseClient<Database> | null {
  if (_admin) return _admin;

  const config = readSupabaseConfig();
  if (!config) return null;

  const secretKey = SUPABASE_SECRET_KEY;
  if (!secretKey) return null;

  _admin = createClient<Database>(config.url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return _admin;
}
