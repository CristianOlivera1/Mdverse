import { describe, expect, it } from 'vitest';

import {
  describeAccessDecision,
  describeAccessRequestOutcome,
  isAccessRequestDecision,
  isAccessRequestOutcome,
  MAX_ACCESS_REQUEST_MESSAGE,
  normalizeAccessMessage,
} from '../../src/lib/documents/accessRequests';
import { parseCollaborationState } from '../../src/lib/documents/collaboration';

describe('normalizeAccessMessage', () => {
  it('trims the note and reads an empty one as no note at all', () => {
    expect(normalizeAccessMessage('  let me in  ')).toBe('let me in');
    expect(normalizeAccessMessage('   ')).toBeNull();
    expect(normalizeAccessMessage('')).toBeNull();
  });

  it('ignores anything that is not a string', () => {
    expect(normalizeAccessMessage(undefined)).toBeNull();
    expect(normalizeAccessMessage(42)).toBeNull();
    expect(normalizeAccessMessage({ message: 'x' })).toBeNull();
  });

  it('caps the note at the length the database accepts', () => {
    const long = 'a'.repeat(MAX_ACCESS_REQUEST_MESSAGE + 200);
    expect(normalizeAccessMessage(long)).toHaveLength(MAX_ACCESS_REQUEST_MESSAGE);
  });
});

describe('access request vocabulary', () => {
  it('accepts only the outcomes the database can return', () => {
    for (const outcome of ['requested', 'already_requested', 'already_has_access', 'not_found']) {
      expect(isAccessRequestOutcome(outcome)).toBe(true);
    }
    expect(isAccessRequestOutcome('approved')).toBe(false);
    expect(isAccessRequestOutcome(undefined)).toBe(false);
  });

  it('accepts only the decisions the database can return', () => {
    for (const decision of ['approved', 'denied', 'not_found']) {
      expect(isAccessRequestDecision(decision)).toBe(true);
    }
    expect(isAccessRequestDecision('requested')).toBe(false);
  });

  it('never dresses a request as an error', () => {
    expect(describeAccessRequestOutcome('requested').tone).toBe('success');
    expect(describeAccessRequestOutcome('already_requested').tone).toBe('info');
    expect(describeAccessRequestOutcome('already_has_access').tone).toBe('success');
    // A missing document is the one honest error: there is nothing to ask about.
    expect(describeAccessRequestOutcome('not_found').tone).toBe('error');
  });

  it('speaks to the owner in the second person about what just happened', () => {
    expect(describeAccessDecision('approved').message).toContain('granted');
    expect(describeAccessDecision('denied').tone).toBe('info');
    expect(describeAccessDecision('not_found').tone).toBe('error');
  });
});

describe('parseCollaborationState', () => {
  const base = {
    document: { id: 'doc-1', title: 'Roadmap', role: 'owner', canManage: true },
  };

  it('reads the pending requests, keeping the requester note', () => {
    const state = parseCollaborationState({
      ...base,
      requests: [
        {
          id: 'req-1',
          requesterId: 'user-2',
          name: 'Maria',
          username: 'maria',
          message: 'I am the new contractor.',
          createdAt: '2026-10-08T10:00:00.000Z',
        },
      ],
    });

    expect(state?.requests).toHaveLength(1);
    expect(state?.requests[0]).toMatchObject({ id: 'req-1', name: 'Maria' });
    expect(state?.requests[0].message).toBe('I am the new contractor.');
  });

  it('turns an empty note into null rather than an empty string', () => {
    const state = parseCollaborationState({
      ...base,
      requests: [{ id: 'req-1', requesterId: 'u', name: 'A', message: '' }],
    });
    expect(state?.requests[0].message).toBeNull();
  });

  it('reads no requests as none, not as a broken payload', () => {
    expect(parseCollaborationState(base)?.requests).toEqual([]);
    expect(parseCollaborationState({ ...base, requests: 'nope' })?.requests).toEqual([]);
  });

  it('drops a request row without an id instead of rendering a broken one', () => {
    const state = parseCollaborationState({
      ...base,
      requests: [{ requesterId: 'u' }, { id: 'req-2', name: 'Ok' }],
    });
    expect(state?.requests.map((entry) => entry.id)).toEqual(['req-2']);
  });
});
