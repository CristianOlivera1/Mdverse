import { describe, expect, it } from 'vitest';

import {
  dashboardFeedbackUrl,
  isDocumentErrorCode,
  shareFailureCode,
  shareFeedbackParams,
  shareNotice,
} from '../../src/lib/documents/messages';
import {
  canEdit,
  canManage,
  describeInviteSummary,
  expiryDate,
  isInviteRole,
  isVisibility,
  linkIsActive,
  maskToken,
  MAX_INVITES_PER_REQUEST,
  MAX_LINK_EXPIRY_DAYS,
  parseInviteEmails,
  roleRank,
  ROLE_LABELS,
  shareUrl,
  sortCollaborators,
  VISIBILITY_LABELS,
} from '../../src/lib/documents/sharing';

describe('parseInviteEmails', () => {
  it('splits on commas, semicolons and whitespace', () => {
    const parsed = parseInviteEmails('ana@example.com, luis@example.com;eva@example.com\nx@y.es');
    expect(parsed.valid).toEqual([
      'ana@example.com',
      'luis@example.com',
      'eva@example.com',
      'x@y.es',
    ]);
    expect(parsed.invalid).toEqual([]);
  });

  it('normalises to lowercase and drops duplicates', () => {
    const parsed = parseInviteEmails('  Ana@Example.COM,ana@example.com ');
    expect(parsed.valid).toEqual(['ana@example.com']);
  });

  it('reports the addresses that are not addresses, without dropping the rest', () => {
    const parsed = parseInviteEmails('ana@example.com, not-an-email, ana@');
    expect(parsed.valid).toEqual(['ana@example.com']);
    expect(parsed.invalid).toEqual(['not-an-email', 'ana@']);
  });

  it('caps one request instead of inviting a pasted address book', () => {
    const many = Array.from({ length: MAX_INVITES_PER_REQUEST + 5 }, (_, i) => `a${i}@x.com`);
    expect(parseInviteEmails(many.join(' ')).valid).toHaveLength(MAX_INVITES_PER_REQUEST);
  });

  it('handles a missing or non-string value', () => {
    expect(parseInviteEmails(undefined)).toEqual({ valid: [], invalid: [] });
    expect(parseInviteEmails(42)).toEqual({ valid: [], invalid: [] });
  });
});

describe('roles and visibility', () => {
  it('orders roles the way the database does, with the owner on top', () => {
    expect(roleRank('reader')).toBeLessThan(roleRank('editor'));
    expect(roleRank('editor')).toBeLessThan(roleRank('admin'));
    // The owner is not a collaborator row, but ranks with a co-owner: a share
    // link must never downgrade them.
    expect(roleRank('owner')).toBe(roleRank('admin'));
  });

  it('treats editing as editor and above, managing as owner/admin only', () => {
    expect(canEdit('reader')).toBe(false);
    expect(canEdit('editor')).toBe(true);
    expect(canManage('editor')).toBe(false);
    expect(canManage('admin')).toBe(true);
    expect(canManage('owner')).toBe(true);
  });

  it('accepts only the roles a human may hand out', () => {
    expect(isInviteRole('reader')).toBe(true);
    expect(isInviteRole('editor')).toBe(true);
    expect(isInviteRole('admin')).toBe(false);
    expect(isInviteRole(undefined)).toBe(false);
  });

  it('accepts only the three visibilities', () => {
    expect(isVisibility('private')).toBe(true);
    expect(isVisibility('unlisted')).toBe(true);
    expect(isVisibility('public')).toBe(true);
    expect(isVisibility('secret')).toBe(false);
  });

  it('labels every role and visibility, so the page never renders a raw enum', () => {
    for (const role of ['owner', 'admin', 'editor', 'reader'] as const) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
    for (const visibility of ['private', 'unlisted', 'public'] as const) {
      expect(VISIBILITY_LABELS[visibility].label).toBeTruthy();
      expect(VISIBILITY_LABELS[visibility].hint).toBeTruthy();
    }
  });

  it('sorts collaborators by power, then by name', () => {
    const sorted = sortCollaborators([
      { role: 'reader' as const, name: 'Zoe' },
      { role: 'editor' as const, name: 'Bea' },
      { role: 'reader' as const, name: 'Ana' },
    ]);
    expect(sorted.map((entry) => entry.name)).toEqual(['Bea', 'Ana', 'Zoe']);
  });
});

describe('share links', () => {
  const now = new Date('2026-10-06T12:00:00.000Z');

  it('turns a day count into an absolute timestamp', () => {
    expect(expiryDate(7, now)).toBe('2026-10-13T12:00:00.000Z');
  });

  it('reads "never" as no expiry, and caps an absurd number of days', () => {
    expect(expiryDate(0, now)).toBeNull();
    expect(expiryDate(-3, now)).toBeNull();
    expect(expiryDate(10_000, now)).toBe(
      new Date(now.getTime() + MAX_LINK_EXPIRY_DAYS * 86_400_000).toISOString(),
    );
  });

  it('knows an expired link from an active one, and "never" from both', () => {
    expect(linkIsActive({ expires_at: null }, now)).toBe(true);
    expect(linkIsActive({ expires_at: '2026-10-07T00:00:00.000Z' }, now)).toBe(true);
    expect(linkIsActive({ expires_at: '2026-10-05T00:00:00.000Z' }, now)).toBe(false);
    expect(linkIsActive({ expires_at: 'not a date' }, now)).toBe(false);
  });

  it('builds the public address without doubling or losing slashes', () => {
    expect(shareUrl('https://mdverse.app/', 'abc')).toBe('https://mdverse.app/s/abc');
    expect(shareUrl('https://mdverse.app', 'a b')).toBe('https://mdverse.app/s/a%20b');
  });

  it('masks a token so a screenshot does not leak it', () => {
    const token = 'a'.repeat(40) + '1234';
    expect(maskToken(token)).toBe(`${'a'.repeat(6)}…1234`);
    expect(maskToken('short')).toBe('short');
  });
});

describe('describeInviteSummary', () => {
  it('says nothing when nothing happened', () => {
    expect(describeInviteSummary({ added: 0, invited: 0, yours: 0, invalid: 0 })).toBeNull();
  });

  it('distinguishes accounts that exist from invitations that wait', () => {
    expect(describeInviteSummary({ added: 1, invited: 0, yours: 0, invalid: 0 })).toBe(
      '1 account added as a collaborator.',
    );
    expect(describeInviteSummary({ added: 2, invited: 0, yours: 0, invalid: 0 })).toBe(
      '2 accounts added.',
    );
    expect(describeInviteSummary({ added: 0, invited: 1, yours: 0, invalid: 0 })).toContain(
      'becomes access as soon as that address signs up',
    );
  });

  it('mentions the owner and the unusable addresses in the same sentence', () => {
    const message = describeInviteSummary({ added: 0, invited: 0, yours: 1, invalid: 2 });
    expect(message).toContain('already owns this document');
    expect(message).toContain('2 addresses were not email addresses');
  });
});

describe('sharing notices', () => {
  it('maps a database refusal onto the sentence that explains it', () => {
    expect(shareFailureCode('forbidden', 'invite_failed')).toBe('forbidden');
    expect(shareFailureCode('invalid_email', 'invite_failed')).toBe('email_invalid');
    expect(shareFailureCode('error', 'link_failed')).toBe('link_failed');
  });

  it('renders each success code', () => {
    expect(shareNotice({ link: 'created' })?.message).toBe('Link created.');
    expect(shareNotice({ link: 'revoked' })?.message).toBe('Link revoked.');
    expect(shareNotice({ role: '1' })?.message).toBe('Role updated.');
    expect(shareNotice({ removed: '1' })?.message).toBe('Access removed.');
    expect(shareNotice({ visibility: '1' })?.message).toContain('updated');
    expect(shareNotice({ invited: '1' })?.message).toContain('invitation sent');
    expect(shareNotice({ added: '3' })?.message).toContain('3 accounts added');
  });

  it('prefers an error over any success flag', () => {
    const notice = shareNotice({ error: 'forbidden', link: 'created' });
    expect(notice?.tone).toBe('error');
  });

  it('answers an access request without dressing it as an error', () => {
    expect(shareNotice({ request: 'approved' })?.tone).toBe('success');
    // Granted but not announced: honest middle ground, never a success.
    expect(shareNotice({ request: 'unnotified' })?.tone).toBe('info');
    expect(shareNotice({ request: 'unnotified' })?.message).toContain('did not go out');
    expect(shareNotice({ request: 'denied' })?.tone).toBe('info');
    expect(shareNotice({ request: 'something-else' })).toBeNull();
  });

  it('carries the request decision through the feedback payload', () => {
    expect(shareFeedbackParams({ requestDecision: 'approved' }).toString()).toBe(
      'request=approved',
    );
  });

  it('knows nothing to report', () => {
    expect(shareNotice({})).toBeNull();
    expect(shareNotice({ error: 'not-a-code' })).toBeNull();
  });

  it('keeps the sharing codes in the shared catalog', () => {
    for (const code of [
      'invite_failed',
      'email_invalid',
      'role_failed',
      'link_failed',
      'request_failed',
    ]) {
      expect(isDocumentErrorCode(code)).toBe(true);
    }
  });

  it('keeps the feedback payload to codes and counts', () => {
    expect(shareFeedbackParams({ invited: 2, invalid: 1 }).toString()).toBe('invited=2&invalid=1');
    expect(shareFeedbackParams().toString()).toBe('');
    expect(shareFeedbackParams({ error: 'forbidden' }).toString()).toBe('error=forbidden');
  });

  it('leaves the dashboard catalog untouched', () => {
    expect(dashboardFeedbackUrl({ created: true })).toBe('/dashboard?created=1');
  });
});
