import { isLikelyEmail, normalizeEmail } from '../auth/profile';
import type { CollaboratorRole, DocumentVisibility } from '../supabase/types';
import type { DocumentAccess } from './types';

export const INVITE_ROLES = ['reader', 'editor'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export const ROLE_LABELS: Record<DocumentAccess, string> = {
  owner: 'Owner',
  admin: 'Owner',
  editor: 'Can edit',
  reader: 'Can view',
};

export const ROLE_HINTS: Record<InviteRole, string> = {
  reader: 'Reads the document and its history, and may comment.',
  editor: 'Edits the text. Cannot publish, delete or change who has access.',
};

export const GENERAL_ACCESS = ['restricted', 'link'] as const;
export type GeneralAccess = (typeof GENERAL_ACCESS)[number];

export const GENERAL_ACCESS_LABELS: Record<
  GeneralAccess,
  { readonly label: string; readonly hint: string }
> = {
  restricted: {
    label: 'Restricted',
    hint: 'Only you and the people you invite. Nobody else can open it, link or not.',
  },
  link: {
    label: 'Anyone with the link',
    hint: 'Anyone who has the address opens it - no invitation needed. Not listed anywhere.',
  },
};

export const LINK_ROLE_LABELS: Record<
  InviteRole,
  { readonly label: string; readonly hint: string }
> = {
  reader: {
    label: 'Can view',
    hint: 'Reads the document, signs in to comment. Nobody with the link edits the text.',
  },
  editor: {
    label: 'Can edit',
    hint: 'Anyone signed in with the link edits the text. Cannot publish or change who has access.',
  },
};

export const PUBLISH_LABELS = {
  label: 'List it publicly',
  hint: 'Adds a page anyone can open and search engines may index. Editing still needs the role above.',
} as const;

export function generalAccessFor(visibility: DocumentVisibility): GeneralAccess {
  return visibility === 'private' ? 'restricted' : 'link';
}

export function visibilityFor(access: GeneralAccess, published: boolean): DocumentVisibility {
  if (access === 'restricted') return 'private';
  return published ? 'public' : 'unlisted';
}

export function isGeneralAccess(value: unknown): value is GeneralAccess {
  return typeof value === 'string' && (GENERAL_ACCESS as readonly string[]).includes(value);
}

export const MAX_INVITES_PER_REQUEST = 10;

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseInviteEmails(raw: unknown): { valid: string[]; invalid: string[] } {
  const text = typeof raw === 'string' ? raw : '';
  const chunks = text
    .split(/[,;\s]+/)
    .map((chunk) => normalizeEmail(chunk))
    .filter((chunk) => chunk.length > 0);

  const valid: string[] = [];
  const invalid: string[] = [];

  for (const chunk of chunks) {
    const looksRight = EMAIL_SHAPE.test(chunk) && isLikelyEmail(chunk) && chunk.length <= 320;
    if (!looksRight) {
      if (!invalid.includes(chunk)) invalid.push(chunk);
      continue;
    }
    if (!valid.includes(chunk)) valid.push(chunk);
  }

  return { valid: valid.slice(0, MAX_INVITES_PER_REQUEST), invalid };
}

export function isInviteRole(value: unknown): value is InviteRole {
  return typeof value === 'string' && (INVITE_ROLES as readonly string[]).includes(value);
}

export const VISIBILITIES: readonly DocumentVisibility[] = ['private', 'unlisted', 'public'];

export function isVisibility(value: unknown): value is DocumentVisibility {
  return typeof value === 'string' && (VISIBILITIES as readonly string[]).includes(value);
}

export function roleRank(role: DocumentAccess): number {
  switch (role) {
    case 'owner':
    case 'admin':
      return 3;
    case 'editor':
      return 2;
    case 'reader':
      return 1;
    default:
      return 0;
  }
}

export function canEdit(access: DocumentAccess): boolean {
  return roleRank(access) >= 2;
}

export function canManage(access: DocumentAccess): boolean {
  return roleRank(access) >= 3;
}

export interface LinkExpiry {
  readonly days: number;
  readonly label: string;
}

export const LINK_EXPIRIES: readonly LinkExpiry[] = [
  { days: 7, label: 'In 7 days' },
  { days: 30, label: 'In 30 days' },
  { days: 0, label: 'Never' },
];

export const MAX_LINK_EXPIRY_DAYS = 365;

export function expiryDate(days: number, now: Date = new Date()): string | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  const capped = Math.min(Math.floor(days), MAX_LINK_EXPIRY_DAYS);
  return new Date(now.getTime() + capped * 24 * 60 * 60 * 1000).toISOString();
}

export function linkIsActive(
  link: { readonly expires_at: string | null },
  now: Date = new Date(),
): boolean {
  if (!link.expires_at) return true;
  const at = new Date(link.expires_at);
  return !Number.isNaN(at.getTime()) && at.getTime() > now.getTime();
}

export function shareUrl(origin: string, token: string): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/s/${encodeURIComponent(token)}`;
}

export function maskToken(token: string): string {
  if (token.length <= 10) return token;
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

export const INVITE_STATUSES = ['owner', 'collaborator', 'invited'] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export function isInviteStatus(value: unknown): value is InviteStatus {
  return typeof value === 'string' && (INVITE_STATUSES as readonly string[]).includes(value);
}

export interface InviteSummary {
  readonly added: number;
  readonly invited: number;
  readonly yours: number;
  readonly invalid: number;
  readonly emailsSent?: number;
  readonly emailsFailed?: number;
}

export function describeInviteSummary(summary: InviteSummary): string | null {
  const parts: string[] = [];
  if (summary.added > 0) {
    parts.push(
      summary.added === 1 ? '1 account added as a collaborator' : `${summary.added} accounts added`,
    );
  }
  if (summary.invited > 0) {
    parts.push(
      summary.invited === 1
        ? '1 invitation sent - it becomes access as soon as that address signs up'
        : `${summary.invited} invitations sent`,
    );
  }
  if (summary.yours > 0) {
    parts.push(
      summary.yours === 1
        ? 'one of those addresses already owns this document'
        : `${summary.yours} of those addresses already own this document`,
    );
  }
  if (summary.invalid > 0) {
    parts.push(
      summary.invalid === 1
        ? '1 address was not an email address and was skipped'
        : `${summary.invalid} addresses were not email addresses and were skipped`,
    );
  }

  const sentence = parts.length > 0 ? `${parts.join('; ')}.` : '';
  const message = `${sentence}${describeEmailOutcome(summary)}`.trim();

  return message.length > 0 ? message : null;
}

/**
 * The second half of an invite notice. Access and delivery are two different
 * things: reporting "added as a collaborator" while the email was rejected is how
 * people end up waiting for a message that will never arrive.
 */
function describeEmailOutcome(summary: InviteSummary): string {
  if ((summary.emailsFailed ?? 0) > 0) {
    return ' The invitation email was rejected, so share the link instead.';
  }
  if ((summary.emailsSent ?? 0) > 0) {
    return ' The invitation email is on its way.';
  }
  return '';
}

export function sortCollaborators<T extends { role: CollaboratorRole; name: string }>(
  entries: readonly T[],
): T[] {
  return [...entries].sort(
    (a, b) => roleRank(b.role) - roleRank(a.role) || a.name.localeCompare(b.name),
  );
}

export function isSelfInvite(email: string, ownEmail: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  return normalized.length > 0 && normalized === normalizeEmail(ownEmail);
}
