import { describe, expect, it } from 'vitest';

import {
  canEditDocument,
  canManageDocument,
  describeAccess,
  documentAccess,
} from '../../src/lib/documents/access';
import {
  MAX_DRAFT_BYTES,
  MAX_IMPORTED_DRAFTS,
  parseDraftList,
} from '../../src/lib/documents/drafts';
import { describeSize, firstLine, formatTimestamp } from '../../src/lib/documents/format';
import { isDocumentId } from '../../src/lib/documents/ids';
import {
  collectLocalDrafts,
  countLocalDrafts,
  type DraftStorage,
} from '../../src/lib/documents/importDrafts';
import {
  dashboardFeedbackUrl,
  documentFailureCode,
  documentHistoryUrl,
  documentNotice,
} from '../../src/lib/documents/messages';
import { slugForTitle } from '../../src/lib/documents/repository';
import { isCloudDocument, parseCloudDocuments } from '../../src/lib/documents/types';

describe('documentAccess', () => {
  it('gives the owner priority over any collaborator row', () => {
    expect(documentAccess({ ownerId: 'a', viewerId: 'a', collaboratorRole: 'reader' })).toBe(
      'owner',
    );
  });

  it('uses the collaborator role for everyone else', () => {
    expect(documentAccess({ ownerId: 'a', viewerId: 'b', collaboratorRole: 'editor' })).toBe(
      'editor',
    );
    expect(documentAccess({ ownerId: 'a', viewerId: 'b', collaboratorRole: 'admin' })).toBe(
      'admin',
    );
  });

  it('falls back to reader — the least privileged role — when no row exists', () => {
    expect(documentAccess({ ownerId: 'a', viewerId: 'b' })).toBe('reader');
    expect(documentAccess({ ownerId: 'a', viewerId: 'b', collaboratorRole: null })).toBe('reader');
  });
});

describe('access capabilities', () => {
  it('lets owner, editor and admin write', () => {
    expect(canEditDocument('owner')).toBe(true);
    expect(canEditDocument('editor')).toBe(true);
    expect(canEditDocument('admin')).toBe(true);
    expect(canEditDocument('reader')).toBe(false);
  });

  it('only lets the owner or an admin hand out access', () => {
    expect(canManageDocument('owner')).toBe(true);
    expect(canManageDocument('admin')).toBe(true);
    expect(canManageDocument('editor')).toBe(false);
    expect(canManageDocument('reader')).toBe(false);
  });

  it('describes every role in English', () => {
    expect(describeAccess('owner')).toBe('Owner');
    expect(describeAccess('admin')).toBe('Can manage');
    expect(describeAccess('editor')).toBe('Can edit');
    expect(describeAccess('reader')).toBe('Can view');
  });
});

describe('isDocumentId', () => {
  it('accepts a UUID in any case', () => {
    expect(isDocumentId('2f1c9d3e-8a44-4f0b-9c1d-2b7e5f6a0d31')).toBe(true);
    expect(isDocumentId('2F1C9D3E-8A44-4F0B-9C1D-2B7E5F6A0D31')).toBe(true);
  });

  it('rejects anything else, including the slugs the old editor used', () => {
    expect(isDocumentId('doc-1')).toBe(false);
    expect(isDocumentId('')).toBe(false);
    expect(isDocumentId('2f1c9d3e8a444f0b9c1d2b7e5f6a0d31')).toBe(false);
    expect(isDocumentId('2f1c9d3e-8a44-4f0b-9c1d-2b7e5f6a0d3z')).toBe(false);
  });
});

describe('slugForTitle', () => {
  it('mirrors slugifyHeading for ordinary titles', () => {
    expect(slugForTitle('Release notes')).toBe('release-notes');
    expect(slugForTitle('  Trim me  ')).toBe('trim-me');
  });

  it('keeps a slug inside the column limit', () => {
    expect(slugForTitle('x'.repeat(200)).length).toBeLessThanOrEqual(64);
  });

  it('never returns an empty slug, which the check constraint would reject', () => {
    expect(slugForTitle('❤')).toBe('untitled');
    expect(slugForTitle('***')).toBe('untitled');
  });
});

describe('parseCloudDocuments', () => {
  const valid = {
    id: 'a',
    title: 'A',
    content: 'body',
    revision: 3,
    role: 'owner',
    visibility: 'private',
    updatedAt: '2026-10-06T12:00:00.000Z',
    slug: 'a',
  };

  it('keeps well-formed entries', () => {
    expect(isCloudDocument(valid)).toBe(true);
    expect(parseCloudDocuments({ documents: [valid] })).toHaveLength(1);
    // The visibility travels with the document: the editor needs it to know
    // whether a link can reach it.
    expect(isCloudDocument({ ...valid, visibility: undefined })).toBe(false);
  });

  it('drops malformed entries instead of passing them to the editor', () => {
    const payload = {
      documents: [
        valid,
        null,
        { id: 'b' },
        { ...valid, content: 42 },
        { ...valid, role: 'nope' },
        { ...valid, visibility: 'secret' },
      ],
    };
    expect(parseCloudDocuments(payload)).toEqual([valid]);
  });

  it('survives a payload that is not the expected shape at all', () => {
    expect(parseCloudDocuments(null)).toEqual([]);
    expect(parseCloudDocuments('nope')).toEqual([]);
    expect(parseCloudDocuments({})).toEqual([]);
    expect(parseCloudDocuments({ documents: {} })).toEqual([]);
  });
});

describe('parseDraftList', () => {
  it('keeps titled, non-empty drafts and normalises the title', () => {
    expect(parseDraftList([{ title: '  Notes  ', content: '# Hi' }])).toEqual([
      { title: 'Notes', content: '# Hi' },
    ]);
    expect(parseDraftList([{ content: 'body' }])).toEqual([{ title: 'Untitled', content: 'body' }]);
  });

  it('skips empty, oversized and non-string drafts', () => {
    const oversized = 'x'.repeat(MAX_DRAFT_BYTES + 1);
    expect(
      parseDraftList([{ content: '   ' }, { content: oversized }, { content: 7 }, 'nope']),
    ).toEqual([]);
  });

  it('caps the batch, so one import cannot create an unbounded number of rows', () => {
    const many = Array.from({ length: MAX_IMPORTED_DRAFTS + 5 }, (_, index) => ({
      content: `draft ${index}`,
    }));
    expect(parseDraftList(many)).toHaveLength(MAX_IMPORTED_DRAFTS);
  });

  it('returns nothing when the body is not a list', () => {
    expect(parseDraftList(undefined)).toEqual([]);
    expect(parseDraftList({ drafts: [] })).toEqual([]);
  });
});

describe('format helpers', () => {
  it('formats timestamps in UTC, so the server locale cannot change the copy', () => {
    expect(formatTimestamp('2026-10-06T15:22:00.000Z')).toBe('6 Oct 2026, 15:22 UTC');
  });

  it('returns an empty string for a value that is not a date', () => {
    expect(formatTimestamp('not-a-date')).toBe('');
  });

  it('describes sizes in the units the database measures', () => {
    expect(describeSize('')).toBe('0 B');
    expect(describeSize('a'.repeat(900))).toBe('900 B');
    expect(describeSize('a'.repeat(2048))).toBe('2.0 KB');
    expect(describeSize('a'.repeat(1024 * 1024))).toBe('1.0 MB');
  });

  it('summarises a document with its first non-empty line', () => {
    expect(firstLine('\n\n# Title\nbody')).toBe('Title');
    expect(firstLine('    ')).toBe('');
    expect(firstLine('x'.repeat(100))).toHaveLength(72);
  });
});

describe('document notices', () => {
  it('maps error codes to copy and success codes to tone', () => {
    expect(documentNotice({ error: 'stale' })).toEqual({
      tone: 'error',
      message: expect.stringContaining('changed in another window'),
    });
    expect(documentNotice({ created: '1' })).toEqual({
      tone: 'success',
      message: 'Document created.',
    });
    expect(documentNotice({ imported: '3' })?.message).toBe('Imported 3 drafts.');
    expect(documentNotice({ imported: '1' })?.message).toBe('Imported 1 draft.');
  });

  it('ignores unknown codes and empty parameters', () => {
    expect(documentNotice({ error: 'nope' })).toBeNull();
    expect(documentNotice({})).toBeNull();
    expect(documentNotice({ imported: '0' })).toBeNull();
  });

  it('translates a failed save into the notice that explains it', () => {
    expect(
      documentFailureCode({ ok: false, reason: 'conflict', revision: 4 }, 'rename_failed'),
    ).toBe('stale');
    expect(documentFailureCode({ ok: false, reason: 'forbidden' }, 'rename_failed')).toBe(
      'forbidden',
    );
    expect(documentFailureCode({ ok: false, reason: 'missing' }, 'rename_failed')).toBe(
      'not_found',
    );
    expect(documentFailureCode({ ok: false, reason: 'error' }, 'rename_failed')).toBe(
      'rename_failed',
    );
  });

  it('builds the feedback URLs the routes redirect to', () => {
    expect(dashboardFeedbackUrl({})).toBe('/dashboard');
    expect(dashboardFeedbackUrl({ deleted: true })).toBe('/dashboard?deleted=1');
    expect(dashboardFeedbackUrl({ error: 'not_found' })).toBe('/dashboard?error=not_found');
    expect(documentHistoryUrl('abc')).toBe('/documents/abc/history');
    expect(documentHistoryUrl('abc', { restored: true })).toBe('/documents/abc/history?restored=1');
    expect(documentHistoryUrl('abc', { error: 'stale' })).toBe(
      '/documents/abc/history?error=stale',
    );
  });
});

describe('collectLocalDrafts', () => {
  function stubStorage(entries: Record<string, string>): DraftStorage {
    const store = new Map(Object.entries(entries));
    return {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
      removeItem: (key) => void store.delete(key),
    };
  }

  it('reads the open tabs the editor kept, skipping empty ones', () => {
    const storage = stubStorage({
      'mdverse:open-documents': JSON.stringify([
        { id: 'doc-1', title: 'Notes', content: '# Notes' },
        { id: 'doc-2', title: 'Empty', content: '   ' },
      ]),
    });

    expect(collectLocalDrafts(storage)).toEqual([{ title: 'Notes', content: '# Notes' }]);
  });

  it('adds the drafts the original static viewer left behind', () => {
    const storage = stubStorage({
      'mdviewer:panel-a:content': '# From the old viewer',
    });

    expect(countLocalDrafts(storage)).toBe(1);
    expect(collectLocalDrafts(storage)[0]).toEqual({
      title: 'Untitled',
      content: '# From the old viewer',
    });
  });

  it('returns nothing for storage that was never used, or holds junk', () => {
    expect(collectLocalDrafts(stubStorage({}))).toEqual([]);
    expect(collectLocalDrafts(stubStorage({ 'mdverse:open-documents': '{not json' }))).toEqual([]);
    expect(
      collectLocalDrafts(stubStorage({ 'mdverse:open-documents': JSON.stringify([1, 2, 3]) })),
    ).toEqual([]);
  });
});
