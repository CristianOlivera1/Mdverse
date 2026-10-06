import { describe, expect, it } from 'vitest';

import { migrateLegacyDocuments, type StorageLike } from '../../src/lib/documents/migrate';

function fakeStorage(
  entries: Record<string, string>,
): StorageLike & { data: Record<string, string> } {
  const data = { ...entries };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe('migrateLegacyDocuments', () => {
  it('imports non-empty legacy drafts as documents', () => {
    const storage = fakeStorage({
      'mdviewer:panel-a:content': '# Draft A',
      'mdviewer:panel-b:content': 'Draft B',
    });

    const result = migrateLegacyDocuments(storage);

    expect(result.migrated).toBe(true);
    expect(result.documents).toHaveLength(2);
    expect(result.documents[0]).toMatchObject({ id: 'legacy-1', content: '# Draft A' });
    expect(result.documents[1]).toMatchObject({ id: 'legacy-2', content: 'Draft B' });
    expect(storage.data['mdverse:legacy-migrated']).toBe('true');
  });

  it('ignores empty legacy panels', () => {
    const storage = fakeStorage({
      'mdviewer:panel-a:content': '   ',
      'mdviewer:panel-b:content': '',
    });

    const result = migrateLegacyDocuments(storage);

    expect(result.migrated).toBe(false);
    expect(result.documents).toHaveLength(0);
  });

  it('runs only once', () => {
    const storage = fakeStorage({
      'mdverse:legacy-migrated': 'true',
      'mdviewer:panel-a:content': '# A',
    });

    expect(migrateLegacyDocuments(storage).migrated).toBe(false);
  });
});
