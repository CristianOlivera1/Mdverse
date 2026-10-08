export const ACCESS_REQUEST_OUTCOMES = [
  'requested',
  'already_requested',
  'already_has_access',
  'not_found',
] as const;

export type AccessRequestOutcome = (typeof ACCESS_REQUEST_OUTCOMES)[number];

export function isAccessRequestOutcome(value: unknown): value is AccessRequestOutcome {
  return typeof value === 'string' && (ACCESS_REQUEST_OUTCOMES as readonly string[]).includes(value);
}

export const ACCESS_REQUEST_DECISIONS = ['approved', 'denied', 'not_found'] as const;

export type AccessRequestDecision = (typeof ACCESS_REQUEST_DECISIONS)[number];

export function isAccessRequestDecision(value: unknown): value is AccessRequestDecision {
  return (
    typeof value === 'string' && (ACCESS_REQUEST_DECISIONS as readonly string[]).includes(value)
  );
}

/** Matches the check constraint on `document_access_requests.message`. */
export const MAX_ACCESS_REQUEST_MESSAGE = 500;

/**
 * Trims the requester's note and caps it, so the route never sends the database
 * a value its own check constraint will reject.
 */
export function normalizeAccessMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_ACCESS_REQUEST_MESSAGE);
}

export interface AccessRequestNotice {
  readonly tone: 'success' | 'info' | 'error';
  readonly message: string;
}

/**
 * What the door screen says after an attempt. `not_found` and a hidden document
 * are the same answer on purpose: the screen never reveals which one it is.
 */
export function describeAccessRequestOutcome(outcome: AccessRequestOutcome): AccessRequestNotice {
  switch (outcome) {
    case 'requested':
      return {
        tone: 'success',
        message: 'Request sent. The owner gets an email and can let you in.',
      };
    case 'already_requested':
      return {
        tone: 'info',
        message: 'You have already asked for access. The owner has not answered yet.',
      };
    case 'already_has_access':
      return {
        tone: 'success',
        message: 'You already have access to this document. Reload to open it.',
      };
    default:
      return {
        tone: 'error',
        message: 'That document is not available. The link may be wrong, or it was deleted.',
      };
  }
}

/** What the owner sees once a request has been answered. */
export function describeAccessDecision(decision: AccessRequestDecision): AccessRequestNotice {
  switch (decision) {
    case 'approved':
      return { tone: 'success', message: 'Access granted and the requester was told.' };
    case 'denied':
      return { tone: 'info', message: 'Request denied.' };
    default:
      return { tone: 'error', message: 'That request is no longer there.' };
  }
}
