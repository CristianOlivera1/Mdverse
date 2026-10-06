import { describe, expect, it } from 'vitest';

import { toAccountSummary } from '../../src/lib/auth/account';
import {
  authNotice,
  isAuthErrorCode,
  loginFeedbackUrl,
  profileFeedbackUrl,
  profileNotice,
} from '../../src/lib/auth/messages';
import {
  avatarToneIndex,
  displayNameFromEmail,
  formatMemberSince,
  initials,
  isLikelyEmail,
  isValidDisplayName,
  isValidUsername,
  usernameFromEmail,
} from '../../src/lib/auth/profile';
import { currentPathWithSearch, safeRedirectPath } from '../../src/lib/auth/redirect';
import { isAnonymousOnlyPath, isProtectedPath, loginPathFor } from '../../src/lib/auth/routes';
import { buildAuthCallbackUrl, normalizeSupabaseConfig } from '../../src/lib/supabase/config';
import { pickAuthCookieOptions } from '../../src/lib/supabase/cookies';

describe('safeRedirectPath', () => {
  it('keeps same-origin paths, including their query string', () => {
    expect(safeRedirectPath('/settings')).toBe('/settings');
    expect(safeRedirectPath('/dashboard?tab=shared')).toBe('/dashboard?tab=shared');
    expect(safeRedirectPath('  /documents/1  ')).toBe('/documents/1');
  });

  it('rejects anything that could leave the origin', () => {
    expect(safeRedirectPath('https://evil.example/phish')).toBe('/dashboard');
    expect(safeRedirectPath('//evil.example')).toBe('/dashboard');
    expect(safeRedirectPath('/\\evil.example')).toBe('/dashboard');
    expect(safeRedirectPath('/settings\\..\\evil')).toBe('/dashboard');
    expect(safeRedirectPath('javascript:alert(1)')).toBe('/dashboard');
    expect(safeRedirectPath('/dashboard\r\nSet-Cookie: a=b')).toBe('/dashboard');
    expect(safeRedirectPath(`/${'a'.repeat(600)}`)).toBe('/dashboard');
  });

  it('falls back for missing or non-string input and honours a custom fallback', () => {
    expect(safeRedirectPath(null)).toBe('/dashboard');
    expect(safeRedirectPath(undefined)).toBe('/dashboard');
    expect(safeRedirectPath('')).toBe('/dashboard');
    expect(safeRedirectPath(42 as unknown as string)).toBe('/dashboard');
    expect(safeRedirectPath('', '/login')).toBe('/login');
  });
});

describe('currentPathWithSearch', () => {
  it('rebuilds the destination with its query string', () => {
    expect(currentPathWithSearch({ pathname: '/settings' })).toBe('/settings');
    expect(currentPathWithSearch({ pathname: '/settings', search: '?tab=account' })).toBe(
      '/settings?tab=account',
    );
    expect(currentPathWithSearch({ pathname: '/settings', search: 'tab=account' })).toBe(
      '/settings?tab=account',
    );
  });
});

describe('initials', () => {
  it('uses the first letter of the first and last word', () => {
    expect(initials('Ana Pérez')).toBe('AP');
    expect(initials('ana perez gomez')).toBe('AG');
  });

  it('reads an email as a two-part name', () => {
    expect(initials('ana.perez@mail.com')).toBe('AP');
    expect(initials('ana@mail.com')).toBe('A');
  });

  it('keeps non-latin letters and drops emoji', () => {
    expect(initials('Ñuñoa Lima')).toBe('ÑL');
    expect(initials('🔥 Team')).toBe('T');
  });

  it('never renders empty', () => {
    expect(initials('  ')).toBe('?');
    expect(initials(null)).toBe('?');
    expect(initials(undefined)).toBe('?');
  });

  it('respects the max length', () => {
    expect(initials('Ana Pérez', 1)).toBe('A');
  });
});

describe('displayNameFromEmail', () => {
  it('title-cases the local part', () => {
    expect(displayNameFromEmail('ana.perez@mail.com')).toBe('Ana Perez');
    expect(displayNameFromEmail('ana_perez+notes@mail.com')).toBe('Ana Perez');
    expect(displayNameFromEmail('ANA@mail.com')).toBe('ANA');
  });

  it('falls back for unusable input', () => {
    expect(displayNameFromEmail('')).toBe('Anonymous');
    expect(displayNameFromEmail(null)).toBe('Anonymous');
    expect(displayNameFromEmail('...@mail.com')).toBe('Anonymous');
  });
});

describe('usernameFromEmail', () => {
  it('mirrors the SQL trigger derivation', () => {
    expect(usernameFromEmail('Ana.Perez+test@mail.com')).toBe('anaperez');
    expect(usernameFromEmail('ana_perez@mail.com')).toBe('ana_perez');
    expect(usernameFromEmail('')).toBe('user');
    expect(usernameFromEmail(null)).toBe('user');
  });

  it('pads very short handles and truncates long ones to 24 characters', () => {
    expect(usernameFromEmail('ab@mail.com')).toBe('abuser');
    expect(usernameFromEmail(`${'a'.repeat(40)}@mail.com`)).toHaveLength(24);
  });
});

describe('validators', () => {
  it('accepts plausible emails and rejects obvious junk', () => {
    expect(isLikelyEmail('ana@mail.com')).toBe(true);
    expect(isLikelyEmail('ana@mail')).toBe(false);
    expect(isLikelyEmail('ana mail.com')).toBe(false);
    expect(isLikelyEmail('')).toBe(false);
    expect(isLikelyEmail(null)).toBe(false);
  });

  it('validates usernames and display names', () => {
    expect(isValidUsername('ana_98')).toBe(true);
    expect(isValidUsername('ab')).toBe(false);
    expect(isValidUsername('Ana')).toBe(false);
    expect(isValidUsername('a'.repeat(31))).toBe(false);
    expect(isValidUsername('ana-98')).toBe(false);

    expect(isValidDisplayName('Ana Pérez')).toBe(true);
    expect(isValidDisplayName('   ')).toBe(false);
    expect(isValidDisplayName('a'.repeat(61))).toBe(false);
  });
});

describe('avatarToneIndex', () => {
  it('is deterministic and stays within the palette', () => {
    expect(avatarToneIndex('user-1')).toBe(avatarToneIndex('user-1'));
    for (const seed of ['a', 'b', 'user-1', '9f8c1e2a-0000-4000-8000-000000000000']) {
      const tone = avatarToneIndex(seed);
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(6);
    }
  });

  it('spreads a sample of ids across more than one tone', () => {
    const tones = new Set(Array.from({ length: 24 }, (_, index) => avatarToneIndex(`id-${index}`)));
    expect(tones.size).toBeGreaterThan(1);
  });

  it('falls back to the first tone without a seed', () => {
    expect(avatarToneIndex('')).toBe(0);
    expect(avatarToneIndex(null)).toBe(0);
    expect(avatarToneIndex('anything', 1)).toBe(0);
  });
});

describe('formatMemberSince', () => {
  it('formats in UTC so the output is timezone independent', () => {
    expect(formatMemberSince('2026-10-06T23:30:00Z')).toBe('Oct 6, 2026');
  });

  it('returns an empty string for missing or invalid dates', () => {
    expect(formatMemberSince(null)).toBe('');
    expect(formatMemberSince('not-a-date')).toBe('');
  });
});

describe('toAccountSummary', () => {
  const user = { id: 'user-1', email: 'ana.perez@mail.com', created_at: '2026-10-06T12:00:00Z' };

  it('prefers the stored profile', () => {
    const summary = toAccountSummary(user, {
      id: 'user-1',
      username: 'ana',
      display_name: 'Ana Pérez',
      created_at: '2026-10-07T12:00:00Z',
      updated_at: '2026-10-07T12:00:00Z',
    });

    expect(summary).toEqual({
      id: 'user-1',
      email: 'ana.perez@mail.com',
      displayName: 'Ana Pérez',
      username: 'ana',
      initials: 'AP',
      toneSeed: 'user-1',
      createdAt: '2026-10-07T12:00:00Z',
    });
  });

  it('degrades to email-derived values while the profile is missing', () => {
    const summary = toAccountSummary(user, null);
    expect(summary?.displayName).toBe('Ana Perez');
    expect(summary?.username).toBe('anaperez');
    expect(summary?.createdAt).toBe('2026-10-06T12:00:00Z');
  });

  it('returns null without a user', () => {
    expect(toAccountSummary(null, null)).toBeNull();
  });
});

describe('route access rules', () => {
  it('protects the account area', () => {
    expect(isProtectedPath('/dashboard')).toBe(true);
    expect(isProtectedPath('/settings/profile')).toBe(true);
    expect(isProtectedPath('/documents/42')).toBe(true);
    expect(isProtectedPath('/dashboards')).toBe(false);
    expect(isProtectedPath('/')).toBe(false);
    expect(isProtectedPath('/preview')).toBe(false);
  });

  it('marks /login as anonymous only', () => {
    expect(isAnonymousOnlyPath('/login')).toBe(true);
    expect(isAnonymousOnlyPath('/login/help')).toBe(true);
    expect(isAnonymousOnlyPath('/logout')).toBe(false);
  });

  it('carries the destination into the login URL', () => {
    expect(loginPathFor('/settings', '?tab=account')).toBe(
      '/login?next=%2Fsettings%3Ftab%3Daccount',
    );
    expect(loginPathFor('/dashboard')).toBe('/login?next=%2Fdashboard');
    expect(loginPathFor('/')).toBe('/login');
  });
});

describe('auth notices', () => {
  it('maps error codes to copy and keeps unknown codes quiet', () => {
    expect(authNotice({ error: 'callback_failed' })?.tone).toBe('error');
    expect(authNotice({ error: 'callback_failed' })?.message).toContain('expired');
    expect(authNotice({ error: '<script>' })).toBeNull();
    expect(authNotice({ sent: '1' })?.tone).toBe('success');
    expect(authNotice({})).toBeNull();
    expect(isAuthErrorCode('oauth')).toBe(true);
    expect(isAuthErrorCode('nope')).toBe(false);
  });

  it('builds feedback URLs without leaking the default destination', () => {
    expect(loginFeedbackUrl({ sent: true, next: '/dashboard', email: 'a@b.com' })).toBe(
      '/login?sent=1&email=a%40b.com',
    );
    expect(loginFeedbackUrl({ error: 'invalid_email', next: '/settings' })).toBe(
      '/login?error=invalid_email&next=%2Fsettings',
    );
    expect(loginFeedbackUrl({ error: 'oauth' })).toBe('/login?error=oauth');
  });

  it('reports profile save results', () => {
    expect(profileNotice({ saved: '1' })?.tone).toBe('success');
    expect(profileNotice({ error: 'username_taken' })?.message).toContain('already taken');
    expect(profileNotice({ error: 'other' })).toBeNull();
    expect(profileFeedbackUrl({ saved: true })).toBe('/settings?saved=1');
    expect(profileFeedbackUrl({ error: 'save_failed' })).toBe('/settings?error=save_failed');
  });
});

describe('normalizeSupabaseConfig', () => {
  it('accepts a real project URL and strips the trailing slash', () => {
    expect(
      normalizeSupabaseConfig({
        url: 'https://abcd1234.supabase.co/',
        publishableKey: 'sb_publishable_abc',
      }),
    ).toEqual({ url: 'https://abcd1234.supabase.co', publishableKey: 'sb_publishable_abc' });
  });

  it('rejects missing, placeholder or malformed values', () => {
    expect(normalizeSupabaseConfig({})).toBeNull();
    expect(
      normalizeSupabaseConfig({
        url: 'https://YOUR_PROJECT_REF.supabase.co',
        publishableKey: 'YOUR_PUBLISHABLE_KEY',
      }),
    ).toBeNull();
    expect(
      normalizeSupabaseConfig({ url: 'not-a-url', publishableKey: 'sb_publishable_abc' }),
    ).toBeNull();
    expect(
      normalizeSupabaseConfig({ url: 'https://abcd.supabase.co', publishableKey: '  ' }),
    ).toBeNull();
  });
});

describe('buildAuthCallbackUrl', () => {
  it('always points at /auth/callback and sanitizes the destination', () => {
    expect(buildAuthCallbackUrl('http://localhost:4321/', '/settings')).toBe(
      'http://localhost:4321/auth/callback?next=%2Fsettings',
    );
    expect(buildAuthCallbackUrl('https://openmarkdown.pages.dev')).toBe(
      'https://openmarkdown.pages.dev/auth/callback?next=%2Fdashboard',
    );
    expect(buildAuthCallbackUrl('https://openmarkdown.pages.dev', 'https://evil.example')).toBe(
      'https://openmarkdown.pages.dev/auth/callback?next=%2Fdashboard',
    );
  });
});

describe('pickAuthCookieOptions', () => {
  it('forces safe defaults', () => {
    expect(pickAuthCookieOptions()).toEqual({ path: '/', sameSite: 'lax' });
  });

  it('copies the options Supabase provides and drops the rest', () => {
    const picked = pickAuthCookieOptions({
      path: '/',
      maxAge: 3600,
      sameSite: 'strict',
      httpOnly: true,
      secure: true,
      priority: 'high',
    });

    expect(picked).toEqual({
      path: '/',
      maxAge: 3600,
      sameSite: 'strict',
      httpOnly: true,
      secure: true,
    });
    expect('priority' in picked).toBe(false);
  });
});
