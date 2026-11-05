import { PREF_KEYS, readJsonPref, readPref, writePref } from '../editor/prefs';
import type { CloudCollection, OpenDocument } from './types';

export const UNTITLED = 'Untitled';
const MAX_TITLE_LENGTH = 120;
const MAX_OPEN_DOCUMENTS = 20;

export const WELCOME_MARKDOWN = [
  '# Welcome to your Markdown viewer',
  '',
  'Type on the left and watch the preview update **in real time** on the right.',
  '',
  '## Try the essentials',
  '',
  '- [ ] Task lists keep track of what matters',
  '- ==Highlight== what matters, and math just works: $E = mc^2$',
  '',
  '$$',
  '\\int_0^\\infty e^{-x} \\, dx = 1',
  '$$',
  '',
  '## Code and diagrams',
  '',
  '```js',
  'const greet = (name) => `Hello, ${name}`; // syntax highlighting',
  '```',
  '',
  '```mermaid',
  'flowchart LR',
  '    A["You write Markdown"] --> B{"Any diagrams?"}',
  '    B -- Yes --> C["Mermaid draws them"]',
  '    B -- No --> D["Shown as plain text"]',
  '```',
  '',
  '## Shortcuts (VS Code style)',
  '',
  '| Shortcut | Action |',
  '|---|---|',
  '| `Ctrl+B` / `Ctrl+I` | Bold / italic |',
  '| `Ctrl+K` | Link |',
  '| `Ctrl+H` | Find and replace |',
  '| `Ctrl+/` | Comment |',
  '| `Tab` / `Shift+Tab` | Indent / outdent |',
  '',
].join('\n');

export function documentId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeTitle(title: string): string {
  const trimmed = title.trim().slice(0, MAX_TITLE_LENGTH);
  return trimmed || UNTITLED;
}

/** Next free `Untitled` name; titles stay unique per tab. */
export function nextUntitledTitle(existing: readonly OpenDocument[]): string {
  const titles = new Set(existing.map((doc) => doc.title));
  if (!titles.has(UNTITLED)) return UNTITLED;
  for (let index = 2; index <= existing.length + 1; index++) {
    const candidate = `${UNTITLED} ${index}`;
    if (!titles.has(candidate)) return candidate;
  }
  return `${UNTITLED} ${existing.length + 2}`;
}

export function createDocument(existing: readonly OpenDocument[], content = ''): OpenDocument {
  return { id: documentId(), title: nextUntitledTitle(existing), content };
}

export function loadOpenDocuments(): OpenDocument[] {
  return readJsonPref<OpenDocument[]>(PREF_KEYS.openDocuments, []).filter(
    (doc) => doc && typeof doc.id === 'string' && typeof doc.content === 'string',
  );
}

export function saveOpenDocuments(documents: readonly OpenDocument[]): void {
  writePref(PREF_KEYS.openDocuments, JSON.stringify(documents.slice(0, MAX_OPEN_DOCUMENTS)));
}

export function loadActiveDocumentId(): string | null {
  return readPref(PREF_KEYS.activeTab);
}

export function saveActiveDocumentId(id: string): void {
  writePref(PREF_KEYS.activeTab, id);
}

/** Id of the collection every signed-out draft falls back to. */
export const LOCAL_COLLECTION = 'local';

/**
 * Collections for a signed-out session. They group the drafts this browser
 * keeps, so the header reads the same with or without an account; only the
 * storage differs (localStorage here, `public.collections` when signed in).
 */
export function loadLocalCollections(): CloudCollection[] {
  const stored = readJsonPref<CloudCollection[]>(PREF_KEYS.localCollections, []);
  const collections = (Array.isArray(stored) ? stored : []).filter(
    (entry): entry is CloudCollection =>
      typeof entry?.id === 'string' &&
      typeof entry?.name === 'string' &&
      entry.name.trim().length > 0,
  );

  const current = collections.map((entry) =>
    entry.isDefault && entry.name.trim().toLowerCase() === 'general'
      ? { ...entry, name: 'Collection 1' }
      : entry,
  );

  if (current.some((entry) => entry.isDefault)) return current;

  return [{ id: LOCAL_COLLECTION, name: 'Collection 1', isDefault: true }, ...current];
}

export function saveLocalCollections(collections: readonly CloudCollection[]): void {
  writePref(PREF_KEYS.localCollections, JSON.stringify(collections));
}
