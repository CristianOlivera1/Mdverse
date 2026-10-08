import * as commands from '../editor/commands';
import type { EditOp } from '../editor/commands';
import { downloadMarkdown, exportDocument } from '../editor/exportDocument';
import { buildSearchRegex, countMatches, replaceAllMatches } from '../editor/findReplace';
import { PREF_KEYS, readNumberPref, readPref, writePref } from '../editor/prefs';
import { wordAt, type TextState } from '../editor/text';
import { createCursorOverlay } from '../collab/overlay';
import type { CursorOverlay } from '../collab/overlay';
import { describePeers } from '../collab/presence';
import type { Peer } from '../collab/presence';
import { avatarAura } from '../auth/avatarAura';
import type { CollabSession, CollabStatus, RemoteCursor, RemoteSave } from '../collab/session';
import { canEditDocument } from '../documents/access';
import { openCloudDocuments } from '../documents/cloudApi';
import type { CloudSession } from '../documents/cloudApi';
import { conflictPolicy } from '../documents/conflict';
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
import type { CloudDocument, OpenDocument, SaveDocumentResult } from '../documents/types';
import { HIGHLIGHT_THEME_CSS } from '../markdown/highlightTheme';
import { renderDiagram } from '../markdown/mermaid';
import { renderMarkdown } from '../markdown/render';
import { confirmChoice } from './confirmDialog';
import { closeMenus, initMenus } from './menus';

const MIN_ZOOM = 0.7;
const MAX_ZOOM = 1.8;
const MIN_SPLIT = 20;
const MAX_SPLIT = 80;
const MAX_OPEN_DOCUMENTS = 20;

const AUTOSAVE_DELAY = 1200;
const RETRY_DELAY = 5000;

function focusWithoutScroll(element: HTMLElement): void {
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

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
  hasScrolled: boolean;
  timer?: number;
  savedScroll?: [number, number];
}

const INLINE_MARKERS: Record<string, string> = {
  bold: '**',
  italic: '*',
  strike: '~~',
  code: '`',
};

/** Commands that rewrite text; a document this account may only read refuses them. */
const EDIT_COMMANDS: ReadonlySet<string> = new Set([
  ...Object.keys(INLINE_MARKERS),
  'link',
  'heading',
  'quote',
  'ul',
  'ol',
  'task',
  'table',
  'fence',
  'mermaid',
  'hr',
  'undo',
  'redo',
  'clear-active',
  'clear-all',
  'replace-all',
]);

export function initEditorApp(): void {
  initMenus();

  const panesHost = document.getElementById('editor-panes');
  const tabsHost = document.getElementById('editor-tabs');
  const template = document.getElementById('editor-pane-template') as HTMLTemplateElement | null;
  if (!panesHost || !tabsHost || !template) return;

  const panesHostEl: HTMLElement = panesHost;
  const tabsHostEl: HTMLElement = tabsHost;
  const paneTemplate: HTMLTemplateElement = template;

  document.head.insertAdjacentHTML('beforeend', `<style>${HIGHLIGHT_THEME_CSS}</style>`);

  let documents = loadOpenDocuments();
  let activeId = '';
  let syncScroll = readPref(PREF_KEYS.sync) !== '0';
  let renaming = false;
  let toastTimer: number | undefined;

  let cloud: CloudSession | null = null;
  const revisions = new Map<string, number>();
  const lastSaved = new Map<string, string>();
  const saveTimers = new Map<string, number>();
  const conflicted = new Set<string>();
  const saving = new Set<string>();
  const pendingSaves = new Set<string>();
  let booted = false;

  let collab: CollabSession | null = null;
  let collabStatus: CollabStatus = 'connecting';
  let overlay: CursorOverlay | null = null;
  let overlayHost: HTMLElement | null = null;
  let peers: Peer[] = [];
  let remoteCursors: RemoteCursor[] = [];
  let viewerId = '';

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
    if (!cloud) saveOpenDocuments(documents);
    saveActiveDocumentId(activeId);
  }

  function queueCloudSave(doc: OpenDocument, immediate = false, keepalive = false): void {
    if (!cloud || conflicted.has(doc.id)) return;

    window.clearTimeout(saveTimers.get(doc.id));
    saveTimers.delete(doc.id);

    if (saving.has(doc.id)) {
      pendingSaves.add(doc.id);
      return;
    }

    const run = (): void => {
      void runCloudSave(doc, keepalive);
    };

    if (immediate) run();
    else saveTimers.set(doc.id, window.setTimeout(run, AUTOSAVE_DELAY));
  }

  async function runCloudSave(doc: OpenDocument, keepalive = false): Promise<void> {
    const revision = revisions.get(doc.id);
    if (!cloud || revision === undefined) return;

    const content = doc.content;

    showStatus('Saving…', 900);
    saving.add(doc.id);

    let result: SaveDocumentResult;
    try {
      result = await cloud.save({
        id: doc.id,
        content,
        revision,
        keepalive,
        title: doc.title,
      });
    } finally {
      saving.delete(doc.id);
    }

    applySaveResult(doc, result, content);

    if (pendingSaves.delete(doc.id) && !conflicted.has(doc.id)) {
      queueCloudSave(doc, true, keepalive);
    }
  }

  function applySaveResult(
    doc: OpenDocument,
    result: SaveDocumentResult,
    savedContent?: string,
  ): void {
    if (result.ok) {
      revisions.set(doc.id, result.revision);
      if (savedContent !== undefined) lastSaved.set(doc.id, savedContent);
      collab?.announceSave({ documentId: doc.id, revision: result.revision });
      showStatus('Saved', 1200);
      return;
    }

    if ('revision' in result) {
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
        showStatus('Could not save - retrying', 2500);
        window.setTimeout(() => queueCloudSave(doc, true), RETRY_DELAY);
    }
  }

  /** Local drafts are always editable; shared rows carry the role that decides. */
  function isReadOnly(doc: OpenDocument | undefined): boolean {
    return doc !== undefined && !canEditDocument(doc.role ?? 'owner');
  }

  function denyEdit(): void {
    showStatus('View only — only the owner and editors can change this document', 3500);
  }

  /** Replaces what is on screen with the newer server copy, without asking. */
  function acceptServerVersion(doc: OpenDocument, server: CloudDocument): void {
    doc.title = server.title;
    doc.content = server.content;
    lastSaved.set(doc.id, server.content);
    const pane = panes.get(doc.id);
    if (pane) {
      pane.textarea.value = server.content;
      renderPane(pane);
      if (doc.id === activeId) updateStatus();
    }
    renderTabs();
  }

  async function resolveConflict(doc: OpenDocument): Promise<void> {
    if (!cloud) return;

    const server = await cloud.fetch(doc.id);
    if (!server) {
      conflicted.delete(doc.id);
      showStatus('Could not check the other version - retrying', 3000);
      window.setTimeout(() => queueCloudSave(doc, true), RETRY_DELAY);
      return;
    }
    revisions.set(doc.id, server.revision);

    if (server.content === doc.content && server.title === doc.title) {
      lastSaved.set(doc.id, server.content);
      conflicted.delete(doc.id);
      showStatus('Synced', 1600);
      return;
    }

    // Only the owner is asked which version survives. An invited editor never
    // overwrites the owner, so their copy follows the newer version quietly.
    if (conflictPolicy(doc.role ?? 'reader') === 'follow-server') {
      conflicted.delete(doc.id);
      acceptServerVersion(doc, server);
      showStatus('Loaded the newer version from the owner', 3000);
      return;
    }

    const decision = await confirmChoice({
      title: `“${doc.title}” changed somewhere else`,
      message:
        'Another window saved a newer version. Keep the text open here to save it over that one, or load the newer version and replace what is here.',
      confirmLabel: 'Keep my text here',
      cancelLabel: 'Load the newer version',
    });

    conflicted.delete(doc.id);

    // Dismissed: nothing is decided and nothing is written; the next save asks again.
    if (decision === 'dismiss') {
      showStatus('Changed elsewhere — your next save will ask what to keep', 4000);
      return;
    }

    if (decision === 'confirm') {
      queueCloudSave(doc, true);
      return;
    }

    acceptServerVersion(doc, server);
    showStatus('Loaded the server version', 2000);
  }

  async function renameDocument(doc: OpenDocument, rawTitle: string): Promise<void> {
    doc.title = normalizeTitle(rawTitle);

    if (!cloud) {
      persist();
      return;
    }

    if (saving.has(doc.id)) pendingSaves.add(doc.id);
    else await runCloudSave(doc);

    announceActiveDocument();
  }

  const PRESENCE_MAX_VISIBLE = 3;

  function createPresenceAvatar(peer: Peer): HTMLElement {
    const aura = avatarAura(peer.id || peer.name, peer.name, 'sm');
    const el = document.createElement('div');
    el.className =
      'relative h-6 w-6 rounded-full overflow-hidden transition-all duration-200 ease-out dock-avatar';
    el.style.zIndex = '1';
    el.title = peer.name;

    const base = document.createElement('div');
    base.className = 'absolute inset-0 pointer-events-none';
    base.setAttribute('aria-hidden', 'true');
    base.style.cssText = aura.baseLayer;

    const veil = document.createElement('div');
    veil.className = 'absolute inset-0 pointer-events-none';
    veil.setAttribute('aria-hidden', 'true');
    veil.style.cssText = aura.softVeil;

    const label = document.createElement('span');
    label.className =
      'relative z-10 flex h-full w-full items-center justify-center text-[10px] font-semibold text-white';
    label.style.textShadow = '0 1px 2px rgba(0,0,0,0.65)';
    label.textContent = peer.initials;

    el.append(base, veil, label);
    return el;
  }

  function createPresenceOverflow(count: number, names: string): HTMLElement {
    const el = document.createElement('div');
    el.className =
      'relative h-6 w-6 rounded-full overflow-hidden ring-1 ring-white/10 border-2 border-neutral-950 bg-neutral-800 transition-all duration-200 ease-out dock-avatar';
    el.style.zIndex = '1';
    el.title = names;

    const label = document.createElement('span');
    label.className =
      'relative z-10 flex h-full w-full items-center justify-center text-[10px] font-semibold text-neutral-200';
    label.textContent = `+${count}`;

    el.append(label);
    return el;
  }

  function bindDockPhysics(host: HTMLElement): void {
    const avatars = [...host.children] as HTMLElement[];
    avatars.forEach((node, i) => {
      node.addEventListener('mouseenter', () => {
        avatars.forEach((other, j) => {
          const distance = Math.abs(i - j);
          if (distance === 0) {
            other.style.transform = 'scale(1.18) translateY(-4px)';
            other.style.zIndex = '20';
          } else if (distance === 1) {
            other.style.transform = 'scale(1.04) translateY(-1px)';
            other.style.zIndex = '10';
          } else {
            other.style.transform = 'scale(1)';
            other.style.zIndex = '1';
          }
        });
      });
    });
    host.onmouseleave = () => {
      for (const node of avatars) {
        node.style.transform = 'scale(1) translateY(0)';
        node.style.zIndex = '1';
      }
    };
  }

  function renderPresence(): void {
    const hosts = [...document.querySelectorAll<HTMLElement>('[data-presence-root]')];
    if (hosts.length === 0) return;

    const others = peers.filter((peer) => peer.id !== viewerId);
    const empty = peers.length === 0;
    const title = peers.length > 0 ? describePeers(peers, viewerId) : '';
    const visible = others.slice(0, PRESENCE_MAX_VISIBLE);
    const rest = others.slice(PRESENCE_MAX_VISIBLE);
    const hasOverflow = others.length > PRESENCE_MAX_VISIBLE;

    for (const host of hosts) {
      host.replaceChildren();
      host.hidden = empty;
      host.title = title;

      for (const peer of visible) host.append(createPresenceAvatar(peer));

      if (hasOverflow) {
        host.append(
          createPresenceOverflow(
            others.length - PRESENCE_MAX_VISIBLE,
            rest.map((peer) => peer.name).join(', '),
          ),
        );
      }

      bindDockPhysics(host);

      // The mobile copy lives in a padded wrapper; collapse it when empty.
      const wrap = host.closest<HTMLElement>('[data-presence-wrap]');
      if (wrap) wrap.hidden = host.hidden;
    }
  }

  function setCollabStatus(next: CollabStatus): void {
    const badge = document.getElementById('status-collab');
    if (badge) {
      badge.textContent =
        next === 'online' ? 'Synced' : next === 'offline' ? 'Offline' : 'Connecting…';
      badge.className =
        next === 'offline' ? 'shrink-0 text-amber-400/80' : 'shrink-0 text-neutral-600';
    }

    const was = collabStatus;
    collabStatus = next;
    if (next === 'online' && was !== 'online') flushAll();
  }

  function syncOverlay(): void {
    const pane = currentPane();
    if (!collab || !pane) {
      overlay?.destroy();
      overlay = null;
      overlayHost = null;
      return;
    }

    const host = pane.root.querySelector<HTMLElement>('.code-pane');
    if (!host) return;

    if (host === overlayHost && overlay) {
      overlay.update(remoteCursors, peers, pane.textarea.value);
      return;
    }

    overlay?.destroy();
    overlay = createCursorOverlay(host, pane.textarea);
    overlayHost = host;
    overlay.update(remoteCursors, peers, pane.textarea.value);
  }

  function handleCursors(cursors: RemoteCursor[]): void {
    remoteCursors = cursors;
    overlay?.update(remoteCursors, peers, currentPane()?.textarea.value ?? '');
  }

  function handleRemoteSave(save: RemoteSave): void {
    const known = revisions.get(save.documentId);
    if (known === undefined || save.revision <= known) return;

    const doc = documentById(save.documentId);
    const dirty = doc ? doc.content !== lastSaved.get(save.documentId) : false;

    if (dirty || conflicted.has(save.documentId)) {
      showStatus('Changed elsewhere - your next save will ask what to keep', 4000);
      return;
    }

    revisions.set(save.documentId, save.revision);
    if (!doc) return;

    void (async () => {
      const server = await cloud?.fetch(save.documentId);
      if (!server || revisions.get(save.documentId) !== server.revision) return;

      doc.title = server.title;
      doc.content = server.content;
      lastSaved.set(doc.id, server.content);

      const pane = panes.get(doc.id);
      if (pane) {
        const caret = Math.min(pane.textarea.selectionStart, server.content.length);
        pane.textarea.value = server.content;
        pane.textarea.setSelectionRange(caret, caret);
        renderPane(pane);
      }

      renderTabs();
      if (doc.id === activeId) updateStatus();

      const editor = peers.find((peer) => peer.id === save.editorId);
      showStatus(editor ? `Updated by ${editor.name}` : 'Updated elsewhere', 2200);
    })();
  }

  async function openCollabSession(session: CloudSession): Promise<void> {
    if (!session.viewer) return;
    viewerId = session.viewer.id;

    try {
      const { openCollab } = await import('../collab/session');
      collab = openCollab(
        { userId: session.viewer.id, name: session.viewer.name },
        {
          onPeers(list) {
            peers = list;
            renderPresence();
            overlay?.update(remoteCursors, peers, currentPane()?.textarea.value ?? '');
          },
          onStatus: setCollabStatus,
          onRemoteSave: handleRemoteSave,
          onCursors: handleCursors,
        },
      );
      if (collab) setCollabStatus('connecting');
    } catch {
      collab = null;
    }
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
    if (isReadOnly(documentById(pane.docId))) {
      denyEdit();
      return;
    }
    applyEdit(pane.textarea, compute(stateOf(pane.textarea)));
  }

  function renderPane(pane: Pane): void {
    const doc = documentById(pane.docId);
    if (!doc) return;
    void renderMarkdown(pane.preview, doc.content, { renderDiagram }).then(
      () => {
        if (!pane.hasScrolled) pane.preview.scrollTop = 0;
      },
      () => {},
    );
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
    if (!cloud) return;

    documents.forEach((doc) => {
      if (doc.content !== lastSaved.get(doc.id)) queueCloudSave(doc, true, keepalive);
    });
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
    let queued = false;
    source.addEventListener(
      'scroll',
      (event: Event) => {
        if (event.isTrusted) pane.hasScrolled = true;
        if (pane.scrollGuard === sourceName) {
          pane.scrollGuard = null;
          return;
        }
        if (!syncScroll || queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
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
              if (pane.scrollGuard === targetName) pane.scrollGuard = null;
            }),
          );
        });
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
    if (isReadOnly(documentById(pane.docId))) {
      denyEdit();
      return;
    }
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
    if (isReadOnly(doc)) {
      denyEdit();
      return;
    }
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
      if (documentById(id)?.role === 'reader') {
        showStatus('View only — only the owner and editors can save changes', 3500);
      }
      if (pane.savedScroll) {
        pane.textarea.scrollTop = pane.savedScroll[0];
        pane.preview.scrollTop = pane.savedScroll[1];
      } else {
        pane.textarea.setSelectionRange(0, 0);
        pane.textarea.scrollTop = 0;
        pane.preview.scrollTop = 0;
      }
      focusWithoutScroll(pane.textarea);
    }

    renderTabs();
    persist();
    updateStatus();

    collab?.setDocument(id);
    syncOverlay();
    announceActiveDocument();
  }

  /** The header's collaboration dialog follows whichever tab is on screen. */
  function announceActiveDocument(): void {
    const doc = documentById(activeId);
    if (!doc) return;

    const badge = document.getElementById('role-badge');
    if (badge) badge.hidden = doc.role !== 'reader';

    document.dispatchEvent(
      new CustomEvent('mdverse:active-document', {
        detail: {
          id: doc.id,
          title: doc.title,
          collaborative: cloud !== null,
          role: doc.role ?? 'owner',
        },
      }),
    );
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
        lastSaved.set(created.id, created.content);
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
    pendingSaves.delete(id);
    conflicted.delete(id);
    documents = documents.filter((item) => item.id !== id);
    if (activeId === id) activeId = documents[0].id;

    if (cloud) {
      const session = cloud;
      revisions.delete(id);
      lastSaved.delete(id);
      void session.remove(id).then((removed) => {
        if (!removed) toast(`Could not delete “${doc.title}” - it is still online`);
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
    if (isReadOnly(documentById(pane.docId))) {
      denyEdit();
      return;
    }
    if (!window.confirm('Clear the active document? This cannot be undone.')) return;
    pane.textarea.value = '';
    pane.textarea.dispatchEvent(new Event('input'));
    toast('Cleared');
  }

  function clearAll(): void {
    // Documents this account can only read keep their text; nobody clears them here.
    const editable = [...panes.values()].filter(
      (pane) => !isReadOnly(documentById(pane.docId)),
    );
    if (!editable.some((pane) => pane.textarea.value)) {
      if (editable.length < panes.size) denyEdit();
      return;
    }
    if (!window.confirm('Clear every document? This cannot be undone.')) return;
    editable.forEach((pane) => {
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

    if (pane && EDIT_COMMANDS.has(name) && isReadOnly(documentById(pane.docId))) {
      denyEdit();
      return;
    }

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
      hasScrolled: false,
    };
    panes.set(doc.id, pane);

    const formatTrigger = root.querySelector<HTMLElement>('[data-menu="format"]');
    const formatPanel = root.querySelector<HTMLElement>('[data-pop="format"]');
    const menuName = `format-${doc.id}`;
    if (formatTrigger) formatTrigger.dataset.menu = menuName;
    if (formatPanel) formatPanel.dataset.pop = menuName;

    const { textarea } = pane;
    textarea.value = doc.content;
    // A role that cannot save never gets to type: the code pane becomes a viewer.
    const editable = !isReadOnly(doc);
    textarea.readOnly = !editable;
    textarea.setAttribute('aria-readonly', String(!editable));
    root.classList.toggle('is-readonly', !editable);
    textarea.setSelectionRange(0, 0);
    textarea.scrollTop = 0;
    pane.preview.scrollTop = 0;

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

    const shareCursor = (): void =>
      collab?.setCursor(textarea.selectionStart, textarea.selectionEnd);
    ['keyup', 'click', 'select', 'input'].forEach((eventName) =>
      textarea.addEventListener(eventName, shareCursor),
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

    const tab = target.closest<HTMLElement>('[data-tab-id]');
    if (tab?.dataset.tabId) {
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
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeMenus();
    const pane = currentPane();
    if (pane && !pane.findbar.hidden) closeFind(pane);
  });

  window.addEventListener('pagehide', () => {
    flushAll(true);
    collab?.close();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushAll(true);
  });

  function mountAll(preferred?: string | null): void {
    documents.forEach(mountPane);
    const remembered = documentById(loadActiveDocumentId() ?? '');
    const target = documentById(preferred ?? '') ?? remembered ?? documents[0];
    activate(target.id);
  }

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
    for (const entry of session.documents) {
      revisions.set(entry.id, entry.revision);
      lastSaved.set(entry.id, entry.content);
    }
    documents = session.documents.map((entry) => ({
      id: entry.id,
      title: entry.title,
      content: entry.content,
      role: entry.role,
    }));
    await openCollabSession(session);

    if (documents.length === 0) {
      try {
        const created = await session.create(nextUntitledTitle([]), WELCOME_MARKDOWN);
        revisions.set(created.id, created.revision);
        lastSaved.set(created.id, created.content);
        documents = [{ id: created.id, title: created.title, content: created.content }];
      } catch {
        cloud = null;
        documents = [createDocument([], WELCOME_MARKDOWN)];
        toast('Could not reach your documents - this session stays in the browser');
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

  document.addEventListener('mdverse:request-active-document', () => announceActiveDocument());
}
