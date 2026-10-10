import { describe, expect, it } from 'vitest';

import {
  describeProvider,
  hasPasswordIdentity,
  providersOf,
  toAccountSummary,
} from '../../src/lib/auth/account';
import {
  authFeedbackUrl,
  authNotice,
  isAuthErrorCode,
  isAuthSentCode,
  loginFeedbackUrl,
  passwordProblemErrorCode,
  profileFeedbackUrl,
  profileNotice,
} from '../../src/lib/auth/messages';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PROBLEMS,
  checkPassword,
} from '../../src/lib/auth/password';
import {
  avatarToneIndex,
  displayNameFromEmail,
  formatMemberSince,
  initials,
  isLikelyEmail,
  isValidDisplayName,
  isValidUsername,
  normalizeEmail,
  usernameFromEmail,
} from '../../src/lib/auth/profile';
import { currentPathWithSearch, safeRedirectPath } from '../../src/lib/auth/redirect';
import { isAnonymousOnlyPath, isProtectedPath, loginPathFor } from '../../src/lib/auth/routes';
import { buildAuthCallbackUrl, normalizeSupabaseConfig } from '../../src/lib/supabase/config';
import { pickAuthCookieOptions } from '../../src/lib/supabase/cookies';
import {
  authAttemptFor,
  AUTH_RATE_LIMITS,
  bucketKey,
  checkEmailCooldown,
  checkRateLimit,
  clientIpFromHeaders,
  EMAIL_RESEND_COOLDOWN_SECONDS,
  hashForLog,
  HONEYPOT_FIELD,
  isHoneypotFilled,
  maybeVerifyTurnstile,
  rateLimitedRedirect,
  shouldEnforceTurnstile,
  TURNSTILE_FIELD,
} from '../../src/lib/auth/rate-limit';
import {
  isAlreadyRegistered,
  isAuthRateLimited,
  isEmailNotConfirmed,
} from '../../src/lib/supabase/errors';

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

  it('splits dots, underscores, dashes and plus-tags into words', () => {
    expect(displayNameFromEmail('cristian.olivera@mail.com')).toBe('Cristian Olivera');
    expect(displayNameFromEmail('cristian_olivera@mail.com')).toBe('Cristian Olivera');
    expect(displayNameFromEmail('cristian-olivera@mail.com')).toBe('Cristian Olivera');
    expect(displayNameFromEmail('cristian.olivera+tag@mail.com')).toBe('Cristian Olivera');
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

  it('normalizes an address before it reaches Supabase', () => {
    expect(normalizeEmail('  Ana.Perez@Mail.com ')).toBe('ana.perez@mail.com');
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(42)).toBe('');
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
      emailVerified: false,
      providers: [],
      // No provider information at all: read as an email account, so the profile
      // keeps offering the recovery link instead of claiming there is no password.
      hasPassword: true,
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

  it('reads the confirmation state and the linked providers', () => {
    const summary = toAccountSummary(
      {
        ...user,
        email_confirmed_at: '2026-10-06T12:05:00Z',
        identities: [{ provider: 'github' }, { provider: 'email' }],
        app_metadata: { provider: 'email', providers: ['email', 'github'] },
      },
      null,
    );

    expect(summary?.emailVerified).toBe(true);
    expect(summary?.providers).toEqual(['email', 'github']);
  });

  it('falls back to app_metadata when identities are not loaded', () => {
    const summary = toAccountSummary(
      { ...user, app_metadata: { provider: 'google', providers: ['google'] } },
      null,
    );

    expect(summary?.emailVerified).toBe(false);
    expect(summary?.providers).toEqual(['google']);
  });

  it('labels known providers and passes unknown ones through', () => {
    expect(describeProvider('email')).toBe('Email and password');
    expect(describeProvider('github')).toBe('GitHub');
    expect(describeProvider('google')).toBe('Google');
    expect(describeProvider('saml')).toBe('saml');
  });

  it('knows an OAuth-only account has no password to change', () => {
    // The exact bug: a Google-only account was offered "Change password".
    const googleOnly = toAccountSummary(
      { ...user, identities: [{ provider: 'google' }], app_metadata: { providers: ['google'] } },
      null,
    );
    expect(googleOnly?.providers).toEqual(['google']);
    expect(googleOnly?.hasPassword).toBe(false);

    const githubOnly = toAccountSummary(
      { ...user, app_metadata: { provider: 'github', providers: ['github'] } },
      null,
    );
    expect(githubOnly?.hasPassword).toBe(false);

    // Linking a password to an OAuth account flips it back.
    const both = toAccountSummary(
      {
        ...user,
        identities: [{ provider: 'github' }, { provider: 'email' }],
        app_metadata: { providers: ['email', 'github'] },
      },
      null,
    );
    expect(both?.hasPassword).toBe(true);
  });

  it('treats the email provider as the password one, and defaults to it', () => {
    const base = { id: 'u', created_at: '2026-10-06T12:00:00Z' };

    expect(hasPasswordIdentity(null)).toBe(false);
    // Nothing loaded: assume the email case rather than asserting there is no password.
    expect(hasPasswordIdentity({ ...base, email: 'a@b.com' })).toBe(true);
    expect(hasPasswordIdentity({ ...base, identities: [{ provider: 'google' }] })).toBe(false);
    expect(hasPasswordIdentity({ ...base, identities: [{ provider: 'email' }] })).toBe(true);
  });

  it('reports linked providers without duplicates', () => {
    const base = { id: 'u', created_at: '2026-10-06T12:00:00Z' };

    expect(
      providersOf({ ...base, identities: [{ provider: 'github' }, { provider: 'github' }] }),
    ).toEqual(['github']);
    expect(providersOf(base)).toEqual([]);
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

  it('protects the password screen reached from a recovery email', () => {
    expect(isProtectedPath('/reset-password')).toBe(true);
  });

  it('marks the anonymous-only screens', () => {
    expect(isAnonymousOnlyPath('/login')).toBe(true);
    expect(isAnonymousOnlyPath('/login/help')).toBe(true);
    expect(isAnonymousOnlyPath('/signup')).toBe(true);
    expect(isAnonymousOnlyPath('/forgot-password')).toBe(true);
    expect(isAnonymousOnlyPath('/logout')).toBe(false);
    expect(isAnonymousOnlyPath('/reset-password')).toBe(false);
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
    expect(authNotice({ error: 'invalid_credentials' })?.message).toContain('Wrong email');
    expect(authNotice({ error: 'email_not_confirmed' })?.message).toContain('not confirmed');
    expect(authNotice({ sent: 'confirm' })?.tone).toBe('success');
    expect(authNotice({ sent: '1' })).toBeNull();
    expect(authNotice({})).toBeNull();
    expect(isAuthErrorCode('oauth')).toBe(true);
    expect(isAuthErrorCode('nope')).toBe(false);
    expect(isAuthSentCode('reset')).toBe(true);
    expect(isAuthSentCode('1')).toBe(false);
  });

  it('explains the password-update refusals instead of only offering a retry', () => {
    // Both codes are actionable: neither gets better by trying again, which is
    // what the generic `update_failed` copy told the user to do.
    const same = authNotice({ error: 'same_password' });
    expect(same?.tone).toBe('error');
    expect(same?.message).toContain('already your password');

    const reauth = authNotice({ error: 'reauthentication_needed' });
    expect(reauth?.tone).toBe('error');
    expect(reauth?.message).toContain('sign in again');
    // And the generic one still reads as a retry.
    expect(authNotice({ error: 'update_failed' })?.message).toContain('try again');
  });

  it('gives every password problem its own message', () => {
    // Derived from the source list (not hardcoded) so adding or removing a
    // `PasswordProblem` without updating the mapping fails loudly here and at
    // compile time (`satisfies Record<PasswordProblem, AuthErrorCode>`).
    expect(PASSWORD_PROBLEMS).toHaveLength(4);
    const codes = PASSWORD_PROBLEMS.map(passwordProblemErrorCode);

    expect(new Set(codes).size).toBe(PASSWORD_PROBLEMS.length);
    for (const code of codes) expect(authNotice({ error: code })?.tone).toBe('error');
  });

  it('builds feedback URLs without leaking the default destination', () => {
    expect(loginFeedbackUrl({ sent: 'confirm', next: '/dashboard', email: 'a@b.com' })).toBe(
      '/login?sent=confirm&email=a%40b.com',
    );
    expect(loginFeedbackUrl({ error: 'invalid_email', next: '/settings' })).toBe(
      '/login?error=invalid_email&next=%2Fsettings',
    );
    expect(loginFeedbackUrl({ error: 'oauth' })).toBe('/login?error=oauth');
    expect(authFeedbackUrl({ to: '/signup', error: 'signup_failed', next: '/dashboard' })).toBe(
      '/signup?error=signup_failed',
    );
    expect(authFeedbackUrl({ to: '/forgot-password', sent: 'reset', email: 'a@b.com' })).toBe(
      '/forgot-password?sent=reset&email=a%40b.com',
    );
    expect(authFeedbackUrl({ to: '/reset-password', error: 'update_failed' })).toBe(
      '/reset-password?error=update_failed',
    );
  });

  it('reports profile save results, including a changed password', () => {
    expect(profileNotice({ saved: '1' })?.tone).toBe('success');
    expect(profileNotice({ updated: 'password' })?.message).toContain('Password updated');
    expect(profileNotice({ updated: 'nope' })).toBeNull();
    expect(profileNotice({ error: 'username_taken' })?.message).toContain('already taken');
    expect(profileNotice({ error: 'other' })).toBeNull();
    expect(profileFeedbackUrl({ saved: true })).toBe('/settings?saved=1');
    expect(profileFeedbackUrl({ passwordUpdated: true })).toBe('/settings?updated=password');
    expect(profileFeedbackUrl({ error: 'save_failed' })).toBe('/settings?error=save_failed');
  });
});

describe('checkPassword', () => {
  it('accepts a password that meets the policy', () => {
    expect(checkPassword('markdown1')).toEqual({ ok: true, problem: null });
    expect(checkPassword('markdown1', 'markdown1')).toEqual({ ok: true, problem: null });
  });

  it('reports the first problem, in the order the form is filled in', () => {
    expect(checkPassword('')).toEqual({ ok: false, problem: 'missing' });
    expect(checkPassword(null)).toEqual({ ok: false, problem: 'missing' });
    expect(checkPassword('short1')).toEqual({ ok: false, problem: 'too_short' });
    expect(checkPassword('a'.repeat(PASSWORD_MAX_LENGTH + 1))).toEqual({
      ok: false,
      problem: 'too_long',
    });
    expect(checkPassword('abcdefgh')).toEqual({ ok: true, problem: null });
    expect(checkPassword('123456789')).toEqual({ ok: true, problem: null });
  });

  it('checks the confirmation only when one is provided', () => {
    expect(checkPassword('markdown1', 'markdown2')).toEqual({ ok: false, problem: 'mismatch' });
    expect(checkPassword('markdown1', undefined).ok).toBe(true);
    expect(checkPassword('markdown1').ok).toBe(true);
  });

  it('rejects a missing confirmation from the form (form.get returns null, never undefined)', () => {
    // Regression: the signup route reads `form.get('confirm_password')`, which
    // is `null` - not `undefined` - when the field is absent from the POST
    // body. That must reject as a mismatch, never slip through as valid.
    expect(checkPassword('markdown1', 'markdown1')).toEqual({ ok: true, problem: null });
    expect(checkPassword('markdown1', null)).toEqual({ ok: false, problem: 'mismatch' });
    expect(checkPassword('markdown1', '')).toEqual({ ok: false, problem: 'mismatch' });
  });

  it('keeps the bounds and the pattern in sync with the form attributes', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(72);
    expect(checkPassword(`a1${'b'.repeat(PASSWORD_MIN_LENGTH - 2)}`).ok).toBe(true);
    expect(checkPassword(`a1${'b'.repeat(PASSWORD_MIN_LENGTH - 3)}`).ok).toBe(false);
  });
});

describe('supabase auth error classification', () => {
  const error = (code: string, message: string) => ({ code, message });

  it('recognizes an unconfirmed address by code or by message', () => {
    expect(isEmailNotConfirmed(error('email_not_confirmed', 'Email not confirmed'))).toBe(true);
    expect(isEmailNotConfirmed(error('other', 'Email not confirmed'))).toBe(true);
    expect(isEmailNotConfirmed(error('invalid_credentials', 'Invalid login credentials'))).toBe(
      false,
    );
    expect(isEmailNotConfirmed(null)).toBe(false);
  });

  it('recognizes an address that already has an account', () => {
    expect(isAlreadyRegistered(error('user_already_exists', 'User already registered'))).toBe(true);
    expect(isAlreadyRegistered(error('other', 'User already registered'))).toBe(true);
    expect(isAlreadyRegistered(error('weak_password', 'Password is too weak'))).toBe(false);
    expect(isAlreadyRegistered(undefined)).toBe(false);
  });

  it('recognizes a rate-limited auth response by status, code, or message', () => {
    expect(isAuthRateLimited({ ...error('other', 'Sneaky'), status: 429 })).toBe(true);
    expect(isAuthRateLimited(error('over_request_rate_limit', 'Too many requests'))).toBe(true);
    expect(isAuthRateLimited(error('other', 'Request rate limit reached'))).toBe(true);
    expect(
      isAuthRateLimited({
        ...error('user_already_exists', 'User already registered'),
        status: 422,
      }),
    ).toBe(false);
    expect(isAuthRateLimited(null)).toBe(false);
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
    // Exactly what `.env.example` ships: copying the template must read as "not
    // configured" instead of producing requests to a host that does not exist.
    expect(
      normalizeSupabaseConfig({
        url: 'https://x.x.x.supabase.co',
        publishableKey: 'x.x.x',
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
    expect(buildAuthCallbackUrl('https://mdverse.dev')).toBe(
      'https://mdverse.dev/auth/callback?next=%2Fdashboard',
    );
    expect(buildAuthCallbackUrl('https://mdverse.dev', 'https://evil.example')).toBe(
      'https://mdverse.dev/auth/callback?next=%2Fdashboard',
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

describe('auth rate limiting (per-isolate buckets)', () => {
  it('defines a budget for every auth route, strictest on sign-in', () => {
    const routes = ['signin', 'signup', 'resend', 'forgot', 'update', 'oauth', 'callback'];
    for (const route of routes) {
      const config = AUTH_RATE_LIMITS[route as keyof typeof AUTH_RATE_LIMITS];
      expect(config.capacity).toBeGreaterThan(0);
      expect(config.windowSeconds).toBeGreaterThan(0);
    }
    expect(AUTH_RATE_LIMITS.signin.capacity).toBeLessThanOrEqual(AUTH_RATE_LIMITS.oauth.capacity);
  });

  it('allows up to capacity, then blocks with a retry hint', () => {
    const store = new Map();
    const config = { capacity: 3, windowSeconds: 60 };
    const now = 1_000_000;

    expect(checkRateLimit(store, 'k', config, now)).toMatchObject({ allowed: true, remaining: 2 });
    expect(checkRateLimit(store, 'k', config, now)).toMatchObject({ allowed: true, remaining: 1 });
    expect(checkRateLimit(store, 'k', config, now)).toMatchObject({ allowed: true, remaining: 0 });

    const blocked = checkRateLimit(store, 'k', config, now + 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('resets the window after it expires and isolates keys', () => {
    const store = new Map();
    const config = { capacity: 1, windowSeconds: 60 };
    const now = 1_000_000;

    expect(checkRateLimit(store, 'a', config, now).allowed).toBe(true);
    expect(checkRateLimit(store, 'a', config, now).allowed).toBe(false);
    // A different key is unaffected.
    expect(checkRateLimit(store, 'b', config, now).allowed).toBe(true);
    // After the window, the first key is usable again.
    expect(checkRateLimit(store, 'a', config, now + 61_000).allowed).toBe(true);
  });

  it('cools down email sends per address', () => {
    expect(EMAIL_RESEND_COOLDOWN_SECONDS).toBe(60);
    const store = new Map();
    const now = 1_000_000;

    expect(checkEmailCooldown(store, 'a@b.com', 60, now).allowed).toBe(true);
    const blocked = checkEmailCooldown(store, 'a@b.com', 60, now + 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    // Another address is unaffected.
    expect(checkEmailCooldown(store, 'c@d.com', 60, now + 1000).allowed).toBe(true);
    // After the cooldown, the same address may receive mail again.
    expect(checkEmailCooldown(store, 'a@b.com', 60, now + 61_000).allowed).toBe(true);
  });
});

describe('honeypot and identifier hygiene', () => {
  it('names the trap field both sides agree on', () => {
    expect(HONEYPOT_FIELD).toBe('website');
    expect(TURNSTILE_FIELD).toBe('cf-turnstile-response');
  });

  it('flags only a deliberately filled trap field', () => {
    expect(isHoneypotFilled('')).toBe(false);
    expect(isHoneypotFilled('   ')).toBe(false);
    expect(isHoneypotFilled(null)).toBe(false);
    expect(isHoneypotFilled(undefined)).toBe(false);
    expect(isHoneypotFilled('http://spam.example')).toBe(true);
  });

  it('hashes identifiers deterministically without keeping the raw value', () => {
    const hashed = hashForLog('ana@mail.com');
    expect(hashed).toBe(hashForLog('ana@mail.com'));
    expect(hashed).toMatch(/^[0-9a-f]{8}$/);
    expect(hashed).not.toContain('ana@mail.com');
    expect(hashForLog('other@mail.com')).not.toBe(hashed);
  });

  it('builds bucket keys that never contain the raw email', () => {
    const key = bucketKey('signin', ['1.2.3.4', 'ana@mail.com']);
    expect(key.startsWith('signin:')).toBe(true);
    expect(key).not.toContain('ana@mail.com');
    expect(key).not.toContain('1.2.3.4');
    expect(key).toBe(bucketKey('signin', ['1.2.3.4', 'ana@mail.com']));
  });

  it('prefers the Cloudflare IP header, then the first forwarded entry', () => {
    const cf = new Headers({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' });
    expect(clientIpFromHeaders(cf)).toBe('1.2.3.4');
    const xff = new Headers({ 'x-forwarded-for': '5.6.7.8, 9.9.9.9' });
    expect(clientIpFromHeaders(xff)).toBe('5.6.7.8');
    expect(clientIpFromHeaders(new Headers())).toBeNull();
  });

  it('keys attempts without leaking the raw identifier', () => {
    const request = new Request('https://mdverse.dev/auth/signin', {
      headers: { 'cf-connecting-ip': '1.2.3.4' },
    });
    const attempt = authAttemptFor('signin', request, 'ana@mail.com');
    expect(attempt.route).toBe('signin');
    expect(attempt.key).not.toContain('ana@mail.com');
    expect(attempt.key).not.toContain('1.2.3.4');
  });
});

describe('turnstile hook (env-gated)', () => {
  it('is skipped until a secret is configured', () => {
    expect(shouldEnforceTurnstile(null)).toBe(false);
    expect(shouldEnforceTurnstile(undefined)).toBe(false);
    expect(shouldEnforceTurnstile('')).toBe(false);
    expect(shouldEnforceTurnstile('   ')).toBe(false);
    expect(shouldEnforceTurnstile('secret')).toBe(true);
  });

  it('skips verification without touching the network when unconfigured', async () => {
    await expect(maybeVerifyTurnstile(null, null)).resolves.toEqual({ ok: true, skipped: true });
    await expect(maybeVerifyTurnstile('token', undefined)).resolves.toEqual({
      ok: true,
      skipped: true,
    });
  });

  it('fails closed when enforced but no token was submitted', async () => {
    await expect(maybeVerifyTurnstile(null, 'secret')).resolves.toEqual({
      ok: false,
      skipped: false,
    });
    await expect(maybeVerifyTurnstile('', 'secret')).resolves.toEqual({
      ok: false,
      skipped: false,
    });
  });
});

describe('rate_limited feedback', () => {
  it('maps the code to a coarse wait-a-minute notice', () => {
    expect(isAuthErrorCode('rate_limited')).toBe(true);
    const notice = authNotice({ error: 'rate_limited' });
    expect(notice?.tone).toBe('error');
    expect(notice?.message).toMatch(/wait/i);
  });

  it('redirects with the same shape plus a Retry-After header', () => {
    const response = rateLimitedRedirect('/login?error=rate_limited', 42);
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/login?error=rate_limited');
    expect(response.headers.get('Retry-After')).toBe('42');
  });
});
