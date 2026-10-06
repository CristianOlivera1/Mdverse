import * as commands from '../editor/commands';
import type { EditOp } from '../editor/commands';
import { downloadMarkdown, exportDocument } from '../editor/exportDocument';
import { buildSearchRegex, countMatches, replaceAllMatches } from '../editor/findReplace';
import { PREF_KEYS, readNumberPref, readPref, writePref } from '../editor/prefs';
import { wordAt, type TextState } from '../editor/text';
import { openCloudDocuments } from '../documents/cloudApi';
import type { CloudSession } from '../documents/cloudApi';
import { migrateLegacyDocuments } from '../documents/migrate';
import {
  createDocument,
  loadActiveDocumentId,
  loadOpenDocuments,
  nextUntitledTitle,
  normalizeTitle,
  saveActiveDocumentId,
  saveOpenDocuments,
  WELCOME_MARKDOWN,
} from '../documents/store';
import type { OpenDocument, SaveDocumentResult } from '../documents/types';
import { HIGHLIGHT_THEME_CSS } from '../markdown/highlightTheme';
import { renderDiagram } from '../markdown/mermaid';
import { renderMarkdown } from '../markdown/render';

const MIN_ZOOM = 0.7;
const MAX_ZOOM = 1.8;
const MIN_SPLIT = 20;
const MAX_SPLIT = 80;
const MAX_OPEN_DOCUMENTS = 20;

/** Quiet period before an autosave leaves for the server, per document. */
const AUTOSAVE_DELAY = 1200;
/** How long to wait before retrying a save that failed for a transient reason. */
const RETRY_DELAY = 5000;

type ScrollSource = 'code' | 'preview';

interface Pane {
  readonly docId: string;
  readonly root: HTMLElement;
  readonly textarea: HTMLTextAreaElement;
  readonly preview: HTMLElement;
  readonly findbar: HTMLElement;
  readonly findInput: HTMLInputElement;
  readonly replaceInput: HTMLInputElement;
  readonly findCount: HTMLElement;
  readonly caseButton: HTMLElement;
  readonly splitter: HTMLElement;
  caseSensitive: boolean;
  scrollGuard: ScrollSource | null;
  timer?: number;
  savedScroll?: [number, number];
}

/** Formatting commands that simply wrap the selection with a marker. */
const INLINE_MARKERS: Record<string, string> = {
  bold: '**',
  italic: '*',
  strike: '~~',
  code: '`',
};

export function initEditorApp(): void {
  const panesHost = document.getElementById('editor-panes');
  const tabsHost = document.getElementById('editor-tabs');
  const template = document.getElementById('editor-pane-template') as HTMLTemplateElement | null;
  if (!panesHost || !tabsHost || !template) return;

  // Non-nullable aliases: TypeScript does not preserve the narrowing above
  // inside the closures declared further down.
  const panesHostEl: HTMLElement = panesHost;
  const tabsHostEl: HTMLElement = tabsHost;
  const paneTemplate: HTMLTemplateElement = template;

  // The highlight theme is shared with the export path, so it is injected once.
  document.head.insertAdjacentHTML('beforeend', `<style>${HIGHLIGHT_THEME_CSS}</style>`);

  let documents = loadOpenDocuments();
  let activeId = '';
  let syncScroll = readPref(PREF_KEYS.sync) !== '0';
  let renaming = false;
  let toastTimer: number | undefined;

  /**
   * Cloud mode: the tabs are rows in `public.documents` instead of entries in
   * `localStorage`. It is decided once at boot by `openCloudDocuments()`, which
   * answers `null` for anonymous visitors — so this page stays identical for
   * everybody (and cacheable) and the decision is the request's.
   */
  let cloud: CloudSession | null = null;
  /** Last revision confirmed by the server, per document. */
  const revisions = new Map<string, number>();
  const saveTimers = new Map<string, number>();
  /** Documents whose version moved on elsewhere; autosave pauses for them. */
  const conflicted = new Set<string>();
  let booted = false;

  const panes = new Map<string, Pane>();

  const documentById = (id: string): OpenDocument | undefined =>
    documents.find((doc) => doc.id === id);

  function bootDocuments(): void {
    if (documents.length) return;
    const migration = migrateLegacyDocuments(localStorage);
    documents = migration.documents.length
      ? migration.documents.map((doc) => ({ ...doc, content: doc.content }))
      : [createDocument([], WELCOME_MARKDOWN)];
  }

  function persist(): void {
    // In cloud mode the documents live in Postgres: caching them here would leave
    // one account's text in the browser for the next visitor to read. The active
    // tab stays a preference (it is just an id).
    if (!cloud) saveOpenDocuments(documents);
    saveActiveDocumentId(activeId);
  }

  function queueCloudSave(doc: OpenDocument, immediate = false, keepalive = false): void {
    if (!cloud || conflicted.has(doc.id)) return;

    window.clearTimeout(saveTimers.get(doc.id));
    saveTimers.delete(doc.id);

    const run = (): void => {
      void runCloudSave(doc, keepalive);
    };

    if (immediate) run();
    else saveTimers.set(doc.id, window.setTimeout(run, AUTOSAVE_DELAY));
  }

  async function runCloudSave(doc: OpenDocument, keepalive = false): Promise<void> {
    const revision = revisions.get(doc.id);
    if (!cloud || revision === undefined) return;

    showStatus('Saving…', 900);
    const result = await cloud.save({
      id: doc.id,
      content: doc.content,
      revision,
      keepalive,
    });
    applySaveResult(doc, result);
  }

  function applySaveResult(doc: OpenDocument, result: SaveDocumentResult): void {
    if (result.ok) {
      revisions.set(doc.id, result.revision);
      showStatus('Saved', 1200);
      return;
    }

    if ('revision' in result) {
      // The server moved on: adopt its revision and ask what to keep.
      revisions.set(doc.id, result.revision);
      conflicted.add(doc.id);
      void resolveConflict(doc);
      return;
    }

    switch (result.reason) {
      case 'forbidden':
        showStatus('Your role on this document is read-only', 4000);
        return;
      case 'missing':
        showStatus('This document no longer exists', 4000);
        return;
      default:
        showStatus('Could not save — retrying', 2500);
        window.setTimeout(() => queueCloudSave(doc, true), RETRY_DELAY);
    }
  }

  /**
   * Two writers touched the same document. Nothing is discarded on its own: the
   * user chooses between their text and the newer server version.
   */
  async function resolveConflict(doc: OpenDocument): Promise<void> {
    if (!cloud) return;

    const server = await cloud.fetch(doc.id);
    if (!server) {
      showStatus('This document no longer exists', 4000);
      return;
    }
    revisions.set(doc.id, server.revision);

    const keepMine = window.confirm(
      `“${doc.title}” was changed somewhere else.\n\n` +
        'OK: keep the text open here and save it over the other version.\n' +
        'Cancel: load the newer version from the server (your local text is replaced).',
    );

    conflicted.delete(doc.id);

    if (keepMine) {
      queueCloudSave(doc, true);
      return;
    }

    doc.title = server.title;
    doc.content = server.content;
    const pane = panes.get(doc.id);
    if (pane) {
      pane.textarea.value = server.content;
      renderPane(pane);
      if (doc.id === activeId) updateStatus();
    }
    renderTabs();
    showStatus('Loaded the server version', 2000);
  }

  /** Rename keeps the content in the same request, so a pending edit is not lost. */
  async function renameDocument(doc: OpenDocument, rawTitle: string): Promise<void> {
    doc.title = normalizeTitle(rawTitle);

    if (!cloud) {
      persist();
      return;
    }

    const revision = revisions.get(doc.id);
    if (revision === undefined) return;

    showStatus('Saving…', 900);
    applySaveResult(
      doc,
      await cloud.save({ id: doc.id, content: doc.content, revision, title: doc.title }),
    );
  }

  function currentPane(): Pane | undefined {
    return panes.get(activeId);
  }

  function showStatus(message: string, hold = 1400): void {
    const element = document.getElementById('status-message');
    if (!element) return;
    element.textContent = message;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      element.textContent = '';
    }, hold);
  }

  function toast(message: string): void {
    showStatus(message);
  }

  function updateStatus(): void {
    const pane = currentPane();
    const position = document.getElementById('status-position');
    const info = document.getElementById('status-info');
    if (!pane || !position || !info) return;

    const { value, selectionStart } = pane.textarea;
    const before = value.slice(0, selectionStart);
    const index = documents.findIndex((doc) => doc.id === activeId);
    position.textContent =
      `Document ${index + 1} · Line ${before.split('\n').length}, ` +
      `Col ${selectionStart - before.lastIndexOf('\n')}`;

    const trimmed = value.trim();
    info.textContent =
      `${value ? value.split('\n').length : 0} lines · ` +
      `${trimmed ? trimmed.split(/\s+/).length : 0} words · ${value.length} characters`;
  }

  const stateOf = (textarea: HTMLTextAreaElement): TextState => ({
    value: textarea.value,
    start: textarea.selectionStart,
    end: textarea.selectionEnd,
  });

  /**
   * Apply a computed edit through `document.execCommand`, which keeps the
   * browser's native undo/redo stack intact, with a `setRangeText` fallback.
   */
  function applyEdit(textarea: HTMLTextAreaElement, edit: EditOp | null): void {
    if (!edit) return;
    textarea.focus();
    if (edit.from !== edit.to || edit.insert) {
      textarea.setSelectionRange(edit.from, edit.to);
      const ok =
        edit.insert === ''
          ? document.execCommand('delete')
          : document.execCommand('insertText', false, edit.insert);
      if (!ok) {
        textarea.setRangeText(edit.insert, edit.from, edit.to, 'end');
        textarea.dispatchEvent(new Event('input'));
      }
    }
    textarea.setSelectionRange(edit.selStart, edit.selEnd);
  }

  function editWith(pane: Pane, compute: (state: TextState) => EditOp | null): void {
    applyEdit(pane.textarea, compute(stateOf(pane.textarea)));
  }

  function renderPane(pane: Pane): void {
    const doc = documentById(pane.docId);
    if (!doc) return;
    void renderMarkdown(pane.preview, doc.content, { renderDiagram });
  }

  function scheduleWork(pane: Pane): void {
    window.clearTimeout(pane.timer);
    pane.timer = window.setTimeout(
      () => {
        const doc = documentById(pane.docId);
        if (!doc) return;
        doc.content = pane.textarea.value;
        persist();
        queueCloudSave(doc);
        renderPane(pane);
        if (pane.docId === activeId) updateStatus();
      },
      Math.min(350, 80 + pane.textarea.value.length / 150),
    );
  }

  function flushPane(pane: Pane): void {
    window.clearTimeout(pane.timer);
    const doc = documentById(pane.docId);
    if (!doc) return;
    doc.content = pane.textarea.value;
  }

  function flushAll(keepalive = false): void {
    panes.forEach(flushPane);
    persist();
    if (cloud) documents.forEach((doc) => queueCloudSave(doc, true, keepalive));
  }

  const scrollRatio = (element: HTMLElement): number => {
    const max = element.scrollHeight - element.clientHeight;
    return max > 0 ? element.scrollTop / max : 0;
  };

  function linkScroll(
    pane: Pane,
    source: HTMLElement,
    target: HTMLElement,
    sourceName: ScrollSource,
    targetName: ScrollSource,
  ): void {
    source.addEventListener(
      'scroll',
      () => {
        if (pane.scrollGuard === sourceName) {
          pane.scrollGuard = null;
          return;
        }
        if (!syncScroll) return;
        const next = scrollRatio(source) * (target.scrollHeight - target.clientHeight);
        if (Math.abs(target.scrollTop - next) < 1) return;
        pane.scrollGuard = targetName;
        target.scrollTop = next;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            pane.scrollGuard = null;
          }),
        );
      },
      { passive: true },
    );
  }

  function updateFindCount(pane: Pane): void {
    const regex = buildSearchRegex({
      query: pane.findInput.value,
      caseSensitive: pane.caseSensitive,
    });
    pane.findCount.textContent = regex ? `${countMatches(pane.textarea.value, regex)} matches` : '';
  }

  function openFind(pane: Pane, replaceMode: boolean): void {
    const { textarea } = pane;
    let query = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
    if (!query || query.includes('\n')) {
      const word = wordAt(textarea.value, textarea.selectionStart);
      query = word ? textarea.value.slice(word[0], word[1]) : '';
    }
    if (query) pane.findInput.value = query;
    pane.findbar.hidden = false;
    updateFindCount(pane);
    const target = replaceMode && pane.findInput.value ? pane.replaceInput : pane.findInput;
    target.focus();
    target.select();
  }

  function closeFind(pane: Pane): void {
    pane.findbar.hidden = true;
    pane.textarea.focus();
  }

  function replaceAll(pane: Pane): void {
    const regex = buildSearchRegex({
      query: pane.findInput.value,
      caseSensitive: pane.caseSensitive,
    });
    if (!regex) return;
    const current = pane.textarea.value;
    const next = replaceAllMatches(current, regex, pane.replaceInput.value);
    if (next === current) return;
    const caret = Math.min(pane.textarea.selectionStart, next.length);
    applyEdit(pane.textarea, {
      from: 0,
      to: current.length,
      insert: next,
      selStart: caret,
      selEnd: caret,
    });
    updateFindCount(pane);
    toast('Replaced');
  }

  function buildTitle(doc: OpenDocument): HTMLElement {
    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = doc.title;
    title.addEventListener('dblclick', () => beginRename(doc, title));
    return title;
  }

  function buildTab(doc: OpenDocument): HTMLElement {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.dataset.tabId = doc.id;
    tab.setAttribute('role', 'tab');

    const close = document.createElement('span');
    close.className = 'tab-close';
    close.dataset.closeTab = doc.id;
    close.setAttribute('role', 'button');
    close.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

    tab.append(buildTitle(doc), close);
    return tab;
  }

  /**
   * Reuse the existing tab nodes instead of rebuilding them on every render:
   * replacing the DOM would swallow the double-click that starts a rename.
   */
  function renderTabs(): void {
    const existing = new Map(
      [...tabsHostEl.querySelectorAll<HTMLElement>('[data-tab-id]')].map((element) => [
        element.dataset.tabId as string,
        element,
      ]),
    );

    existing.forEach((element, id) => {
      if (!documents.some((doc) => doc.id === id)) element.remove();
    });

    documents.forEach((doc, index) => {
      const tab = existing.get(doc.id) ?? buildTab(doc);
      tab.className = doc.id === activeId ? 'tab on' : 'tab';
      tab.setAttribute('aria-selected', String(doc.id === activeId));
      tab.title = doc.title;

      const title = tab.querySelector<HTMLElement>('.tab-title');
      if (title && title.textContent !== doc.title) title.textContent = doc.title;
      tab
        .querySelector<HTMLElement>('.tab-close')
        ?.setAttribute('aria-label', `Close ${doc.title}`);

      if (tabsHostEl.children[index] !== tab) {
        tabsHostEl.insertBefore(tab, tabsHostEl.children[index] ?? null);
      }
    });
  }

  function beginRename(doc: OpenDocument, titleElement: HTMLElement): void {
    if (renaming) return;
    renaming = true;

    const input = document.createElement('input');
    input.className = 'tab-input';
    input.value = doc.title;
    titleElement.replaceWith(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = (save: boolean): void => {
      if (finished) return;
      finished = true;
      renaming = false;
      if (save) {
        void renameDocument(doc, input.value);
      }
      input.replaceWith(buildTitle(doc));
      renderTabs();
      updateStatus();
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('blur', () => finish(true));
  }

  function renameActiveDocument(): void {
    const tab = tabsHostEl.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`);
    const title = tab?.querySelector<HTMLElement>('.tab-title');
    const doc = documentById(activeId);
    if (title && doc) beginRename(doc, title);
  }

  function activate(id: string): void {
    if (activeId && activeId !== id) {
      const previous = panes.get(activeId);
      if (previous)
        previous.savedScroll = [previous.textarea.scrollTop, previous.preview.scrollTop];
    }

    activeId = id;
    panes.forEach((pane, paneId) => {
      pane.root.style.display = paneId === id ? '' : 'none';
    });

    const pane = panes.get(id);
    if (pane) {
      if (pane.savedScroll) {
        pane.textarea.scrollTop = pane.savedScroll[0];
        pane.preview.scrollTop = pane.savedScroll[1];
      }
      pane.textarea.focus();
    }

    renderTabs();
    persist();
    updateStatus();
  }

  async function addDocument(): Promise<void> {
    if (!booted) return;
    if (documents.length >= MAX_OPEN_DOCUMENTS) {
      toast('Tab limit reached');
      return;
    }

    if (cloud) {
      try {
        const created = await cloud.create(nextUntitledTitle(documents));
        revisions.set(created.id, created.revision);
        const doc: OpenDocument = {
          id: created.id,
          title: created.title,
          content: created.content,
        };
        documents.push(doc);
        mountPane(doc);
        activate(doc.id);
      } catch {
        toast('Could not create the document');
      }
      return;
    }

    const doc = createDocument(documents);
    documents.push(doc);
    mountPane(doc);
    activate(doc.id);
  }

  function requestClose(id: string): void {
    if (documents.length <= 1) {
      toast('At least one document must stay open');
      return;
    }
    const doc = documentById(id);
    if (!doc) return;

    const question = cloud
      ? `Delete “${doc.title}”? It disappears for everyone who can see it, history included.`
      : `Close “${doc.title}”? Its content is deleted from this browser.`;
    if (!window.confirm(question)) return;

    const closing = panes.get(id);
    if (closing) flushPane(closing);
    closing?.root.remove();
    panes.delete(id);
    window.clearTimeout(saveTimers.get(id));
    saveTimers.delete(id);
    conflicted.delete(id);
    documents = documents.filter((item) => item.id !== id);
    if (activeId === id) activeId = documents[0].id;

    if (cloud) {
      const session = cloud;
      revisions.delete(id);
      void session.remove(id).then((removed) => {
        if (!removed) toast(`Could not delete “${doc.title}” — it is still online`);
      });
    }

    activate(activeId);
  }

  function paneFor(source: HTMLElement | null): Pane | undefined {
    const root = source?.closest<HTMLElement>('[data-pane]');
    const id = root?.dataset.paneId;
    return id ? panes.get(id) : currentPane();
  }

  function clearActive(): void {
    const pane = currentPane();
    if (!pane) return;
    if (!pane.textarea.value) return;
    if (!window.confirm('Clear the active document? This cannot be undone.')) return;
    pane.textarea.value = '';
    pane.textarea.dispatchEvent(new Event('input'));
    toast('Cleared');
  }

  function clearAll(): void {
    const dirty = [...panes.values()].some((pane) => pane.textarea.value);
    if (!dirty) return;
    if (!window.confirm('Clear every document? This cannot be undone.')) return;
    panes.forEach((pane) => {
      pane.textarea.value = '';
      pane.textarea.dispatchEvent(new Event('input'));
    });
    toast('Cleared');
  }

  function setPanel(mode: 'code' | 'preview'): void {
    document.body.dataset.panel = mode;
    document.querySelectorAll<HTMLElement>('[data-command^="panel-"]').forEach((button) => {
      button.classList.toggle('on', button.dataset.command === `panel-${mode}`);
    });
  }

  function setSplit(percent: number): void {
    const clamped = Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, percent));
    document.documentElement.style.setProperty('--split', `${clamped}%`);
    writePref(PREF_KEYS.split, String(clamped));
  }

  function setZoom(zoom: number): void {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 10) / 10));
    document.documentElement.style.setProperty('--z', String(clamped));
    writePref(PREF_KEYS.zoom, String(clamped));
    const label = document.getElementById('zoom-value');
    if (label) label.textContent = `${Math.round(clamped * 100)}%`;
  }

  function toggleSyncUi(): void {
    document.querySelectorAll<HTMLElement>('[data-command="toggle-sync"]').forEach((element) => {
      element.classList.toggle('on', syncScroll);
    });
  }

  function openPreviewTab(): void {
    const doc = documentById(activeId);
    if (!doc) return;
    flushAll();
    const url = new URL('/preview', window.location.origin);
    url.searchParams.set('doc', doc.id);
    const opened = window.open(url.toString(), `mdverse-preview-${doc.id}`);
    if (opened) opened.focus();
    else toast('Allow pop-ups to open the preview');
  }

  function runCommand(name: string, source: HTMLElement | null): void {
    const pane = paneFor(source);
    const doc = documentById(activeId);

    if (name in INLINE_MARKERS) {
      if (pane) editWith(pane, (state) => commands.wrapInline(state, INLINE_MARKERS[name]));
      return;
    }

    switch (name) {
      case 'link':
        if (pane) editWith(pane, commands.insertLink);
        return;
      case 'heading':
        if (pane) editWith(pane, commands.cycleHeading);
        return;
      case 'quote':
        if (pane) editWith(pane, commands.toggleBlockquote);
        return;
      case 'ul':
        if (pane) editWith(pane, commands.toggleBulletList);
        return;
      case 'ol':
        if (pane) editWith(pane, commands.toggleOrderedList);
        return;
      case 'task':
        if (pane) editWith(pane, commands.toggleTaskList);
        return;
      case 'table':
        if (pane) editWith(pane, commands.insertTable);
        return;
      case 'fence':
        if (pane) editWith(pane, commands.insertCodeFence);
        return;
      case 'mermaid':
        if (pane) editWith(pane, commands.insertMermaidDiagram);
        return;
      case 'hr':
        if (pane) editWith(pane, commands.insertHorizontalRule);
        return;
      case 'find':
        if (pane) openFind(pane, false);
        return;
      case 'undo':
        pane?.textarea.focus();
        document.execCommand('undo');
        return;
      case 'redo':
        pane?.textarea.focus();
        document.execCommand('redo');
        return;
      case 'copy':
        if (!pane) return;
        navigator.clipboard
          .writeText(pane.textarea.value)
          .then(() => toast('Copied'))
          .catch(() => toast('Could not copy'));
        return;
      case 'download':
        if (pane && doc) downloadMarkdown(pane.textarea.value, doc.title);
        return;
      case 'export-html':
        if (pane && doc)
          void exportDocument({
            kind: 'html',
            markdown: pane.textarea.value,
            fallbackName: doc.title,
          });
        return;
      case 'export-pdf':
        if (!pane || !doc) return;
        void exportDocument({
          kind: 'pdf',
          markdown: pane.textarea.value,
          fallbackName: doc.title,
        }).then((result) => {
          if (!result.ok && result.reason === 'popup-blocked') {
            toast('Allow pop-ups to export as PDF');
          }
        });
        return;
      case 'toggle-sync':
        syncScroll = !syncScroll;
        writePref(PREF_KEYS.sync, syncScroll ? '1' : '0');
        toggleSyncUi();
        toast(syncScroll ? 'Scroll synced' : 'Scroll independent');
        return;
      case 'zoom-in':
        setZoom(readNumberPref(PREF_KEYS.zoom, 1) + 0.1);
        return;
      case 'zoom-out':
        setZoom(readNumberPref(PREF_KEYS.zoom, 1) - 0.1);
        return;
      case 'zoom-reset':
        setZoom(1);
        return;
      case 'clear-active':
        clearActive();
        return;
      case 'clear-all':
        clearAll();
        return;
      case 'popout':
        openPreviewTab();
        return;
      case 'panel-code':
        setPanel('code');
        return;
      case 'panel-preview':
        setPanel('preview');
        return;
      case 'new-document':
        void addDocument();
        return;
      case 'toggle-case':
        if (pane) {
          pane.caseSensitive = !pane.caseSensitive;
          pane.caseButton.classList.toggle('on', pane.caseSensitive);
          updateFindCount(pane);
        }
        return;
      case 'replace-all':
        if (pane) replaceAll(pane);
        return;
      case 'find-close':
        if (pane) closeFind(pane);
        return;
      default:
        return;
    }
  }

  const allPanels = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-pop]')];

  const triggerFor = (panel: HTMLElement): HTMLElement | null =>
    document.querySelector<HTMLElement>(`[data-menu="${panel.dataset.pop}"]`);

  function closeMenus(except?: HTMLElement | null): void {
    allPanels().forEach((panel) => {
      if (panel === except || panel.hidden) return;
      panel.hidden = true;
      const trigger = triggerFor(panel);
      if (trigger) {
        trigger.classList.remove('on');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function openMenu(panel: HTMLElement, trigger: HTMLElement): void {
    panel.hidden = false;
    const bounds = trigger.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const below = viewportHeight - bounds.bottom - 8;
    const above = bounds.top - 8;
    const prefersUp = panel.classList.contains('fm-pop');
    const openBelow = prefersUp
      ? above < height && below >= height
      : below >= height || below >= above;
    panel.style.left = `${Math.max(8, Math.min(bounds.right - width, viewportWidth - width - 8))}px`;
    panel.style.top = `${Math.max(8, openBelow ? bounds.bottom + 8 : bounds.top - height - 8)}px`;
    trigger.classList.add('on');
    trigger.setAttribute('aria-expanded', 'true');
  }

  function mountPane(doc: OpenDocument): Pane {
    const fragment = paneTemplate.content.cloneNode(true) as DocumentFragment;
    const root = fragment.firstElementChild as HTMLElement;
    root.dataset.paneId = doc.id;
    panesHostEl.append(root);

    const query = <T extends Element>(selector: string): T => {
      const element = root.querySelector<T>(selector);
      if (!element) throw new Error(`Editor pane is missing ${selector}`);
      return element;
    };

    const pane: Pane = {
      docId: doc.id,
      root,
      textarea: query<HTMLTextAreaElement>('[data-r="textarea"]'),
      preview: query<HTMLElement>('[data-r="preview"]'),
      findbar: query<HTMLElement>('[data-r="findbar"]'),
      findInput: query<HTMLInputElement>('[data-r="find-input"]'),
      replaceInput: query<HTMLInputElement>('[data-r="replace-input"]'),
      findCount: query<HTMLElement>('[data-r="find-count"]'),
      caseButton: query<HTMLElement>('[data-command="toggle-case"]'),
      splitter: query<HTMLElement>('[data-r="splitter"]'),
      caseSensitive: false,
      scrollGuard: null,
    };
    panes.set(doc.id, pane);

    // Each pane needs its own menu ids, otherwise the first pane always wins.
    const formatTrigger = root.querySelector<HTMLElement>('[data-menu="format"]');
    const formatPanel = root.querySelector<HTMLElement>('[data-pop="format"]');
    const menuName = `format-${doc.id}`;
    if (formatTrigger) formatTrigger.dataset.menu = menuName;
    if (formatPanel) formatPanel.dataset.pop = menuName;

    const { textarea } = pane;
    textarea.value = doc.content;

    textarea.addEventListener('input', () => {
      scheduleWork(pane);
      updateStatus();
    });
    textarea.addEventListener('focusin', () => {
      if (activeId !== doc.id) activate(doc.id);
    });
    ['keyup', 'click', 'focus'].forEach((eventName) =>
      textarea.addEventListener(eventName, () => updateStatus()),
    );

    pane.findInput.addEventListener('input', () => updateFindCount(pane));
    pane.findbar.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeFind(pane);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        replaceAll(pane);
      }
    });

    let dragging = false;
    pane.splitter.addEventListener('pointerdown', (event) => {
      dragging = true;
      pane.splitter.setPointerCapture(event.pointerId);
      document.body.classList.add('select-none');
    });
    pane.splitter.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const bounds = pane.root.getBoundingClientRect();
      setSplit(((event.clientX - bounds.left) / bounds.width) * 100);
    });
    ['pointerup', 'pointercancel'].forEach((eventName) =>
      pane.splitter.addEventListener(eventName, () => {
        dragging = false;
        document.body.classList.remove('select-none');
      }),
    );

    linkScroll(pane, textarea, pane.preview, 'code', 'preview');
    linkScroll(pane, pane.preview, textarea, 'preview', 'code');

    textarea.addEventListener('keydown', (event) => onShortcut(event, pane));

    renderPane(pane);
    return pane;
  }

  function onShortcut(event: KeyboardEvent, pane: Pane): void {
    const { textarea } = pane;
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const state = stateOf(textarea);
    let handled = false;

    if (ctrl && !event.altKey) {
      if (event.shiftKey) {
        switch (key) {
          case 'l':
            openFind(pane, true);
            handled = true;
            break;
          case 'k':
            editWith(pane, commands.deleteLine);
            handled = true;
            break;
          case 'x':
            editWith(pane, (value) => commands.wrapInline(value, '~~'));
            handled = true;
            break;
          case 'Enter':
            editWith(pane, (value) => commands.insertLine(value, false));
            handled = true;
            break;
          default:
            break;
        }
      } else {
        switch (key) {
          case 'b':
            editWith(pane, (value) => commands.wrapInline(value, '**'));
            handled = true;
            break;
          case 'i':
            editWith(pane, (value) => commands.wrapInline(value, '*'));
            handled = true;
            break;
          case 'e':
            editWith(pane, (value) => commands.wrapInline(value, '`'));
            handled = true;
            break;
          case 'k':
            editWith(pane, commands.insertLink);
            handled = true;
            break;
          case 'h':
            openFind(pane, false);
            handled = true;
            break;
          case '/':
            editWith(pane, commands.toggleComment);
            handled = true;
            break;
          case 'l': {
            const selection = commands.selectLineRange(state);
            textarea.setSelectionRange(selection.start, selection.end);
            handled = true;
            break;
          }
          case 't':
            void addDocument();
            handled = true;
            break;
          case 'w':
            requestClose(activeId);
            handled = true;
            break;
          case 'Enter':
            editWith(pane, (value) => commands.insertLine(value, true));
            handled = true;
            break;
          default:
            break;
        }
      }
    } else if (event.altKey && !ctrl && (key === 'ArrowUp' || key === 'ArrowDown')) {
      const direction: -1 | 1 = key === 'ArrowUp' ? -1 : 1;
      editWith(pane, (value) =>
        event.shiftKey
          ? commands.duplicateLines(value, direction)
          : commands.moveLines(value, direction),
      );
      handled = true;
    } else if (key === 'F2') {
      renameActiveDocument();
      handled = true;
    } else if (key === 'Tab' && !ctrl && !event.altKey) {
      const selection = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
      if (event.shiftKey || selection.includes('\n')) {
        editWith(pane, (value) => commands.indentLines(value, event.shiftKey));
      } else {
        applyEdit(textarea, {
          from: state.start,
          to: state.end,
          insert: '  ',
          selStart: state.start + 2,
          selEnd: state.start + 2,
        });
      }
      handled = true;
    } else if (key === 'Enter' && !event.shiftKey && !ctrl && !event.altKey) {
      const edit = commands.continueList(state);
      if (edit) {
        applyEdit(textarea, edit);
        handled = true;
      }
    }

    if (handled) event.preventDefault();
  }

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    const closeTab = target.closest<HTMLElement>('[data-close-tab]');
    if (closeTab?.dataset.closeTab) {
      requestClose(closeTab.dataset.closeTab);
      return;
    }

    const menuTrigger = target.closest<HTMLElement>('[data-menu]');
    if (menuTrigger) {
      const panel = document.querySelector<HTMLElement>(`[data-pop="${menuTrigger.dataset.menu}"]`);
      if (!panel) return;
      const willOpen = panel.hidden;
      closeMenus(panel);
      if (willOpen) openMenu(panel, menuTrigger);
      else closeMenus();
      return;
    }

    const tab = target.closest<HTMLElement>('[data-tab-id]');
    if (tab?.dataset.tabId) {
      // Do not re-activate (or refocus) the tab that is already open, otherwise
      // the double-click that starts a rename would be swallowed.
      if (tab.dataset.tabId !== activeId) activate(tab.dataset.tabId);
      return;
    }

    const commandButton = target.closest<HTMLElement>('button[data-command]');
    if (commandButton?.dataset.command) {
      runCommand(commandButton.dataset.command, commandButton);
      if (!commandButton.closest('[data-keep]') && commandButton.closest('[data-pop]'))
        closeMenus();
      return;
    }

    if (!target.closest('[data-pop]')) closeMenus();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeMenus();
    const pane = currentPane();
    if (pane && !pane.findbar.hidden) closeFind(pane);
  });

  window.addEventListener('resize', () => closeMenus());
  window.addEventListener('pagehide', () => flushAll(true));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushAll(true);
  });

  function mountAll(preferred?: string | null): void {
    documents.forEach(mountPane);
    const remembered = documentById(loadActiveDocumentId() ?? '');
    const target = documentById(preferred ?? '') ?? remembered ?? documents[0];
    activate(target.id);
  }

  /**
   * Signed in → the tabs come from the server; anonymous (or unreachable) → the
   * local `localStorage` editor, exactly as before phase 3.
   */
  async function boot(): Promise<void> {
    const requested = new URLSearchParams(window.location.search).get('doc');
    const session = await openCloudDocuments();

    if (!session) {
      bootDocuments();
      booted = true;
      mountAll(requested);
      return;
    }

    cloud = session;
    for (const entry of session.documents) revisions.set(entry.id, entry.revision);
    documents = session.documents.map((entry) => ({
      id: entry.id,
      title: entry.title,
      content: entry.content,
    }));

    // A brand new account opens the same welcome document the local editor
    // starts with, so the screen is never empty.
    if (documents.length === 0) {
      try {
        const created = await session.create(nextUntitledTitle([]), WELCOME_MARKDOWN);
        revisions.set(created.id, created.revision);
        documents = [{ id: created.id, title: created.title, content: created.content }];
      } catch {
        // The account answered once and then failed: keep the user typing, but
        // locally and without pretending it will be saved.
        cloud = null;
        documents = [createDocument([], WELCOME_MARKDOWN)];
        toast('Could not reach your documents — this session stays in the browser');
      }
    }

    booted = true;
    mountAll(requested);
  }

  setSplit(readNumberPref(PREF_KEYS.split, 50));
  setZoom(readNumberPref(PREF_KEYS.zoom, 1));
  toggleSyncUi();
  setPanel(document.body.dataset.panel === 'preview' ? 'preview' : 'code');
  showStatus('Loading your documents…', 4000);
  void boot();
}
