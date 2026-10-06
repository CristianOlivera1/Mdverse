/**
 * View-model for the signed-in account.
 *
 * The UI never reads `user`/`profile` directly: it consumes this summary, so a
 * missing profile row (trigger not run yet, RLS hiccup, offline) degrades to the
 * email-derived values instead of rendering an empty header.
 */

import type { User } from '@supabase/supabase-js';

import type { Profile } from '../supabase/types';
import { displayNameFromEmail, initials, usernameFromEmail } from './profile';

export interface AccountSummary {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly username: string;
  /** Ready-to-render avatar text (no profile pictures in this product). */
  readonly initials: string;
  /** Stable seed for the avatar color; the user id, never the display name. */
  readonly toneSeed: string;
  readonly createdAt: string | null;
}

export function toAccountSummary(
  user: Pick<User, 'id' | 'email' | 'created_at'> | null | undefined,
  profile: Profile | null | undefined,
): AccountSummary | null {
  if (!user) return null;

  const email = user.email ?? '';
  const displayName = profile?.display_name?.trim() || displayNameFromEmail(email);
  const username = profile?.username?.trim() || usernameFromEmail(email);

  return {
    id: user.id,
    email,
    displayName,
    username,
    initials: initials(displayName || email),
    toneSeed: user.id || email,
    createdAt: profile?.created_at ?? user.created_at ?? null,
  };
}
