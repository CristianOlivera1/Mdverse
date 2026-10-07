/**
 * Notices shown after a document action.
 *
 * Same contract as the auth catalog: a route redirects with a short code and the
 * page renders the matching sentence, so no database message and no exception
 * text ever travels through the URL or reaches the screen.
 */

import type { AuthNotice } from '../auth/messages';
import type { ShareFailure } from './repository';
import { describeInviteSummary } from './sharing';
import type { SaveDocumentResult } from './types';

export const DOCUMENT_ERROR_CODES = [
  'not_found',
  'forbidden',
  'stale',
  'create_failed',
  'rename_failed',
  'delete_failed',
  'restore_failed',
  'import_failed',
  'invite_failed',
  'email_invalid',
  'role_failed',
  'remove_failed',
  'link_failed',
  'visibility_failed',
] as const;

export type DocumentErrorCode = (typeof DOCUMENT_ERROR_CODES)[number];

const ERROR_MESSAGES: Record<DocumentErrorCode, string> = {
  not_found: 'That document no longer exists, or you no longer have access to it.',
  forbidden: 'Your role on this document does not allow that.',
  stale: 'This document changed in another window after the page was loaded. Reload and try again.',
  create_failed: 'We could not create the document. Please try again.',
  rename_failed: 'We could not rename the document. Please try again.',
  delete_failed: 'We could not delete the document. Please try again.',
  restore_failed: 'We could not restore that version. Please try again.',
  import_failed: 'We could not import your browser drafts. Please try again.',
  invite_failed: 'We could not invite that address. Please try again.',
  email_invalid: 'That does not look like an email address.',
  role_failed: 'We could not change that role. Only the owner can.',
  remove_failed: 'We could not remove that person. Only the owner can.',
  link_failed: 'We could not create or revoke that link. Please try again.',
  visibility_failed: 'We could not change who can reach the document.',
};

/** Maps a failed save onto the notice that explains it. */
export function documentFailureCode(
  result: Extract<SaveDocumentResult, { ok: false }>,
  fallback: DocumentErrorCode,
): DocumentErrorCode {
  switch (result.reason) {
    case 'conflict':
      return 'stale';
    case 'forbidden':
      return 'forbidden';
    case 'missing':
      return 'not_found';
    default:
      return fallback;
  }
}

export function isDocumentErrorCode(value: unknown): value is DocumentErrorCode {
  return typeof value === 'string' && (DOCUMENT_ERROR_CODES as readonly string[]).includes(value);
}

export interface DocumentNoticeParams {
  error?: string | null;
  created?: string | null;
  renamed?: string | null;
  deleted?: string | null;
  restored?: string | null;
  imported?: string | null;
}

/** Resolves the notice to show on the dashboard or the history page. */
export function documentNotice(params: DocumentNoticeParams): AuthNotice | null {
  if (isDocumentErrorCode(params.error)) {
    return { tone: 'error', message: ERROR_MESSAGES[params.error] };
  }

  if (params.created === '1') return { tone: 'success', message: 'Document created.' };
  if (params.renamed === '1') return { tone: 'success', message: 'Document renamed.' };
  if (params.deleted === '1') return { tone: 'success', message: 'Document deleted.' };
  if (params.restored === '1') return { tone: 'success', message: 'Version restored.' };

  const imported = Number.parseInt(params.imported ?? '', 10);
  if (Number.isFinite(imported) && imported > 0) {
    return {
      tone: 'success',
      message: imported === 1 ? 'Imported 1 draft.' : `Imported ${imported} drafts.`,
    };
  }

  return null;
}

/** Query string carrying the notice, for a redirect back to `/dashboard`. */
export function dashboardFeedbackUrl(feedback: {
  error?: DocumentErrorCode;
  created?: boolean;
  renamed?: boolean;
  deleted?: boolean;
  imported?: number;
}): string {
  const params = new URLSearchParams();
  if (feedback.error) params.set('error', feedback.error);
  if (feedback.created) params.set('created', '1');
  if (feedback.renamed) params.set('renamed', '1');
  if (feedback.deleted) params.set('deleted', '1');
  if (feedback.imported !== undefined) params.set('imported', String(feedback.imported));

  const query = params.toString();
  return query.length > 0 ? `/dashboard?${query}` : '/dashboard';
}

/** Maps a failed sharing action onto the notice that explains it. */
export function shareFailureCode(
  reason: ShareFailure,
  fallback: DocumentErrorCode,
): DocumentErrorCode {
  switch (reason) {
    case 'forbidden':
      return 'forbidden';
    case 'missing':
      return 'not_found';
    case 'invalid_email':
      return 'email_invalid';
    default:
      return fallback;
  }
}

/** Outcome of a sharing action, as a short code — never as database or exception text. */
export interface ShareFeedback {
  error?: DocumentErrorCode;
  invited?: number;
  added?: number;
  yours?: number;
  invalid?: number;
  roleUpdated?: boolean;
  removed?: boolean;
  linkCreated?: boolean;
  linkRevoked?: boolean;
  visibilityUpdated?: boolean;
}

/** Query string for the same outcome, so the page and the JSON answer share one wording. */
export function shareFeedbackParams(feedback: ShareFeedback = {}): URLSearchParams {
  const params = new URLSearchParams();
  if (feedback.error) params.set('error', feedback.error);
  if (feedback.invited) params.set('invited', String(feedback.invited));
  if (feedback.added) params.set('added', String(feedback.added));
  if (feedback.yours) params.set('yours', String(feedback.yours));
  if (feedback.invalid) params.set('invalid', String(feedback.invalid));
  if (feedback.roleUpdated) params.set('role', '1');
  if (feedback.removed) params.set('removed', '1');
  if (feedback.linkCreated) params.set('link', 'created');
  if (feedback.linkRevoked) params.set('link', 'revoked');
  if (feedback.visibilityUpdated) params.set('visibility', '1');
  return params;
}

export function sharePageUrl(documentId: string, feedback: ShareFeedback = {}): string {
  const base = `/documents/${encodeURIComponent(documentId)}/share`;
  const query = shareFeedbackParams(feedback).toString();
  return query.length > 0 ? `${base}?${query}` : base;
}

export interface ShareNoticeParams {
  error?: string | null;
  invited?: string | null;
  added?: string | null;
  yours?: string | null;
  invalid?: string | null;
  role?: string | null;
  removed?: string | null;
  link?: string | null;
  visibility?: string | null;
}

/** Resolves the notice shown on the share page (reuses the dashboard catalog). */
export function shareNotice(params: ShareNoticeParams): AuthNotice | null {
  if (isDocumentErrorCode(params.error)) {
    return { tone: 'error', message: ERROR_MESSAGES[params.error] };
  }

  const count = (value: string | null | undefined): number => {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };

  const message = describeInviteSummary({
    invited: count(params.invited),
    added: count(params.added),
    yours: count(params.yours),
    invalid: count(params.invalid),
  });
  if (message !== null) return { tone: 'success', message };

  if (params.role === '1') return { tone: 'success', message: 'Role updated.' };
  if (params.removed === '1') return { tone: 'success', message: 'Access removed.' };
  if (params.link === 'created') return { tone: 'success', message: 'Link created.' };
  if (params.link === 'revoked') return { tone: 'success', message: 'Link revoked.' };
  if (params.visibility === '1') {
    return { tone: 'success', message: 'Who can reach the document has been updated.' };
  }

  return null;
}

export function documentHistoryUrl(
  documentId: string,
  options: { error?: DocumentErrorCode; restored?: boolean } = {},
): string {
  const base = `/documents/${encodeURIComponent(documentId)}/history`;
  if (options.error) return `${base}?error=${options.error}`;
  return options.restored ? `${base}?restored=1` : base;
}
