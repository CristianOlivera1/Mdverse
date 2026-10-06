import type { OpenDocument } from './types';

/** Minimal storage surface so the migration can be unit-tested without a DOM. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Keys written by the original static viewer (`visor-markdown.html`). */
export const LEGACY_CONTENT_KEYS = [
  'mdviewer:panel-a:content',
  'mdviewer:panel-b:content',
] as const;

export interface MigrateOptions {
  /** Key that marks the migration as already done. */
  readonly doneKey?: string;
  readonly idPrefix?: string;
  readonly defaultTitle?: string;
}

export interface MigrateResult {
  readonly documents: OpenDocument[];
  readonly migrated: boolean;
}

/**
 * Build documents from the drafts the static viewer left in `localStorage`, so
 * users do not lose their content when the app moves to the database
 * (block 5.3 of the plan). Empty legacy panels are ignored.
 */
export function migrateLegacyDocuments(
  storage: StorageLike,
  options: MigrateOptions = {},
): MigrateResult {
  const {
    doneKey = 'mdverse:legacy-migrated',
    idPrefix = 'legacy',
    defaultTitle = 'Untitled',
  } = options;

  if (storage.getItem(doneKey) === 'true') return { documents: [], migrated: false };

  const documents: OpenDocument[] = [];
  LEGACY_CONTENT_KEYS.forEach((key, index) => {
    const content = storage.getItem(key);
    if (content && content.trim()) {
      documents.push({ id: `${idPrefix}-${index + 1}`, title: defaultTitle, content });
    }
  });

  if (documents.length) storage.setItem(doneKey, 'true');
  return { documents, migrated: documents.length > 0 };
}
