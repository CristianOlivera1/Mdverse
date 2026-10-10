import type { User } from '@supabase/supabase-js';

import type { Profile } from '../supabase/types';
import { displayNameFromEmail, initials, usernameFromEmail } from './profile';

export interface AccountSummary {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly username: string;
  readonly initials: string;
  readonly toneSeed: string;
  readonly createdAt: string | null;
  readonly emailVerified: boolean;
  readonly providers: readonly string[];

  readonly hasPassword: boolean;
}

type AccountUser = Pick<User, 'id' | 'email' | 'created_at'> & {
  email_confirmed_at?: string | null;
  identities?: readonly { provider?: string | null }[] | null;
  app_metadata?: { provider?: string | null; providers?: readonly string[] | null } | null;
};

const PROVIDER_LABELS: Record<string, string> = {
  email: 'Email and password',
  github: 'GitHub',
  google: 'Google',
};

export function describeProvider(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

export function providersOf(user: AccountUser): readonly string[] {
  const fromIdentities = (user.identities ?? [])
    .map((identity) => identity.provider)
    .filter((provider): provider is string => typeof provider === 'string' && provider.length > 0);

  const meta = user.app_metadata?.providers;
  const fromMeta = Array.isArray(meta)
    ? meta.filter((provider): provider is string => typeof provider === 'string')
    : [];

  const single = user.app_metadata?.provider;
  const all = [...new Set([...fromIdentities, ...fromMeta, ...(single ? [single] : [])])];

  return all.sort((a, b) => a.localeCompare(b));
}

export function hasPasswordIdentity(user: AccountUser | null | undefined): boolean {
  if (!user) return false;
  const providers = providersOf(user);
  return providers.length === 0 || providers.includes('email');
}

export function toAccountSummary(
  user: AccountUser | null | undefined,
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
    emailVerified: Boolean(user.email_confirmed_at),
    providers: providersOf(user),
    hasPassword: hasPasswordIdentity(user),
  };
}
