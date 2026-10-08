import { readFileSync } from 'node:fs';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/lib/supabase/database.types';

export interface LiveEnv {
  readonly url: string;
  readonly anonKey: string;
  readonly secretKey: string;
}

export function readLiveEnv(): LiveEnv | null {
  let raw: string;
  try {
    raw = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
  } catch {
    return null;
  }

  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at < 0) continue;
    values[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }

  const url = values.PUBLIC_SUPABASE_URL ?? '';
  const anonKey = values.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
  const secretKey = values.SUPABASE_SECRET_KEY ?? '';
  const usable = [url, anonKey, secretKey].every(
    (value) => value.length > 0 && !/YOUR_|^x\.x\.x$/i.test(value),
  );

  return usable ? { url, anonKey, secretKey } : null;
}

/** Admin client: creates and deletes the throwaway accounts. */
export function createProjectAdmin(env: LiveEnv): SupabaseClient<Database> {
  return createClient<Database>(env.url, env.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createAnonymousClient(env: LiveEnv): SupabaseClient<Database> {
  return createClient<Database>(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface LiveAccount {
  readonly client: SupabaseClient<Database>;
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

export async function createAccount(
  env: LiveEnv,
  admin: SupabaseClient<Database>,
  input: { email: string; password: string },
): Promise<LiveAccount> {
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (error) throw error;

  const id = data.user?.id;
  if (!id) throw new Error('the admin API created no user');

  const client = createAnonymousClient(env);
  const { error: signInError } = await client.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });
  if (signInError) {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(id);
    if (cleanupError) {
      console.warn(`[integration] could not remove ${input.email} after a refused sign-in:`, cleanupError.message);
    }
    throw signInError;
  }

  return { client, id, email: input.email, password: input.password };
}

export async function deleteAccounts(
  admin: SupabaseClient<Database>,
  ids: readonly string[],
): Promise<void> {
  for (const id of ids) await admin.auth.admin.deleteUser(id);
}
