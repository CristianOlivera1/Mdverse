import { PREF_KEYS, readJsonPref, readPref, writePref } from '../editor/prefs';
import type { OpenDocument } from './types';

export const UNTITLED = 'Untitled';
const MAX_TITLE_LENGTH = 120;
const MAX_OPEN_DOCUMENTS = 20;

export const WELCOME_MARKDOWN = [
  '# Welcome to your Markdown viewer',
  '',
  'Type on the left and watch the preview update **in real time** on the right.',
  '',
  '## Shortcuts (VS Code style)',
  '',
  '| Shortcut | Action |',
  '|---|---|',
  '| `Ctrl+B` / `Ctrl+I` / `Ctrl+E` | Bold / italic / code |',
  '| `Ctrl+K` | Link |',
  '| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |',
  '| `Ctrl+Shift+L` | Select all matches and replace |',
  '| `Ctrl+H` | Find and replace |',
  '| `Alt+↑/↓` · `Shift+Alt+↑/↓` | Move · duplicate line |',
  '| `Ctrl+Shift+K` · `Ctrl+L` | Delete · select line |',
  '| `Ctrl+Enter` · `Ctrl+Shift+Enter` | New line below · above |',
  '| `Ctrl+/` · `Tab` / `Shift+Tab` | Comment · indent / outdent |',
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
