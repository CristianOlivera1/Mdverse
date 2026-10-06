import type { SupabaseClient, User } from '@supabase/supabase-js';

import type { Database } from '../supabase/database.types';
import { createServerSupabaseClient } from '../supabase/server';
import type { SupabaseServerContext } from '../supabase/server';
import type { Profile, ProfileInsert } from '../supabase/types';
import { displayNameFromEmail, usernameFromEmail } from './profile';

export interface SessionState {
  /** `null` when Supabase is not configured yet. */
  readonly supabase: SupabaseClient<Database> | null;
  readonly user: User | null;
  readonly profile: Profile | null;
}

const PROFILE_COLUMNS = 'id, username, display_name, created_at, updated_at';

export const ANONYMOUS_SESSION: SessionState = { supabase: null, user: null, profile: null };

export async function loadSession(
  context: SupabaseServerContext,
  onResponseHeaders?: (headers: Record<string, string>) => void,
): Promise<SessionState> {
  const supabase = createServerSupabaseClient(context, onResponseHeaders);
  if (!supabase) return ANONYMOUS_SESSION;

  const user = await readUser(supabase);
  if (!user) return { supabase, user: null, profile: null };

  return { supabase, user, profile: await readProfile(supabase, user) };
}

/**
 * Returns the verified user, or `null` for anonymous visitors or on any failure —
 * an unreachable auth server must not turn every page into a 500.
 *
 * `getSession()` only reads (and, when expired, refreshes) the cookies, so an
 * anonymous request costs no network round-trip. The identity is then confirmed
 * with `getUser()`, which validates the token against the auth server — the user
 * object from `getSession()` alone is never trusted on the server.
 */
async function readUser(supabase: SupabaseClient<Database>): Promise<User | null> {
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      console.warn('[auth] could not read the session:', sessionError.message);
      return null;
    }
    if (!sessionData.session) return null;

    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.warn('[auth] could not verify the session:', error.message);
      return null;
    }

    return data.user ?? null;
  } catch (error) {
    console.warn('[auth] could not reach the auth server:', error);
    return null;
  }
}

/** Reads the profile row, creating it on the fly if the signup trigger missed. */
async function readProfile(
  supabase: SupabaseClient<Database>,
  user: User,
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', user.id)
    .maybeSingle();

  if (data) return data;
  if (error) console.warn('[auth] could not read the profile:', error.message);

  const seed: ProfileInsert = {
    id: user.id,
    username: usernameFromEmail(user.email),
    display_name: displayNameFromEmail(user.email),
  };

  const { data: created, error: createError } = await supabase
    .from('profiles')
    .upsert(seed, { onConflict: 'id' })
    .select(PROFILE_COLUMNS)
    .maybeSingle();

  if (createError) {
    console.warn('[auth] could not create the profile:', createError.message);
    return null;
  }

  return created;
}

/** Signs out locally and clears the auth cookies. */
export async function signOutUser(context: SupabaseServerContext): Promise<boolean> {
  const supabase = createServerSupabaseClient(context);
  if (!supabase) return false;

  const { error } = await supabase.auth.signOut();
  if (error) {
    console.warn('[auth] sign out failed:', error.message);
    return false;
  }

  return true;
}
