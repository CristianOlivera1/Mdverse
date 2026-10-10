import * as commands from '../editor/commands';
import type { EditOp } from '../editor/commands';
import { downloadMarkdown, exportDocument } from '../editor/exportDocument';
import { countMatches, replaceAllMatches } from '../editor/findReplace';

import { PREF_KEYS, readNumberPref, readPref, writePref } from '../editor/prefs';
import { escapeRegExp, wordAt, type TextState } from '../editor/text';

import { createCursorOverlay } from '../collab/overlay';
import type { CursorOverlay } from '../collab/overlay';
import { describePeers } from '../collab/presence';
import type { Peer } from '../collab/presence';
import { avatarAura } from '../auth/avatarAura';
import type { CollabSession, CollabStatus, RemoteCursor, RemoteSave } from '../collab/session';
import { canEditDocument, canManageDocument } from '../documents/access';
import { openCloudDocuments } from '../documents/cloudApi';
import type { CloudSession } from '../documents/cloudApi';
import { isDocumentId } from '../documents/ids';
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
import { isCloudDocument } from '../documents/types';
import type { CloudDocument, OpenDocument, SaveDocumentResult } from '../documents/types';
import { HIGHLIGHT_THEME_CSS } from '../markdown/highlightTheme';
import { renderDiagram } from '../markdown/mermaid';
import { renderMarkdown } from '../markdown/render';
import { taskToggleAt } from '../markdown/taskList';
import { buildTocHtml, collectHeadings } from '../markdown/toc';
import { showAccessGate } from './accessGate';
import { confirmAction, confirmChoice } from './confirmDialog';
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

interface FindCache {
  readonly key: string;
  readonly boxes: ReadonlyArray<{
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  }>;
}

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
  readonly wordButton: HTMLElement | null;
  readonly regexButton: HTMLElement | null;
  readonly replaceButton: HTMLButtonElement;
  readonly replaceSpinner: HTMLElement | null;
  readonly replaceLabel: HTMLElement | null;
  readonly replaceIcon: HTMLElement | null;
  readonly findLayer: HTMLElement;
  readonly findPool: HTMLElement[];
  findCache: FindCache | null;
  readonly splitter: HTMLElement;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  scrollGuard: ScrollSource | null;
  hasScrolled: boolean;
  timer?: number;
  findTimer?: number;
  savedScroll?: [number, number];
}

const INLINE_MARKERS: Record<string, string> = {
  bold: '**',
  italic: '*',
  strike: '~~',
  code: '`',
};

/** Shown whenever someone without write access reaches for the text. */
const READ_ONLY_STATUS = 'View only - only the owner and editors can change this document';

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
  'toggle-word',
  'toggle-regex',
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
  let pendingHash: string | null = null;

  // Single index bound to the ACTIVE preview pane (mirrors previewApp.ts).
  // Inactive panes keep rendering, but only the visible preview feeds the TOC.
  const tocFloat = document.getElementById('toc-float');
  const tocNavs = [...document.querySelectorAll<HTMLElement>('.toc')];
  let tocHeadings: HTMLElement[] = [];
  let tocSignature = '';
  let tocCurrent = -1;
  let tocFrame = 0;

  // Deep-link heading (`?doc=<id>#<heading>`) not yet consumed by the active
  // pane. Consumed when a post-render pass finds the element; dropped on the
  // first user scroll or doc switch. Null in the common no-hash case.

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
    // Server documents come back from the account, never from here, and a public
    // document opened from a link is a view rather than something to keep. Only
    // the browser's own drafts are written back.
    if (!cloud) saveOpenDocuments(documents.filter((doc) => doc.role === undefined));
    saveActiveDocumentId(activeId);
  }

  // The URL is the source of truth for the active tab: boot prefers `?doc=`
  // over localStorage, so every switch rewrites it (replaceState: no history
  // spam, back button untouched). Reloads and copied links then reopen this tab.
  // A doc switch also drops the `#hash`: it addresses a heading of the previous
  // document, and keeping it would jump the new preview to a stale anchor.
  // Same-doc calls (e.g. after an in-preview anchor click) leave the URL alone.
  function syncDocParam(id: string): void {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('doc') === id) return;
      url.searchParams.set('doc', id);
      url.hash = '';
      pendingHash = null;
      window.history.replaceState(null, '', url);
    } catch {
      // Non-http(s) contexts (file://, sandbox): localStorage still restores.
    }
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
    showStatus(READ_ONLY_STATUS, 3500);
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
      showStatus('Changed elsewhere - your next save will ask what to keep', 4000);
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

  // Export busy state: the three exports render async (HTML/mermaid, pdfmake,
  // server round-trip + image downloads for DOCX), so both menu triggers and
  // their slow options go disabled with a spinner until the file settles.
  // Instant actions (`copy`, `download`) intentionally skip this.
  function setExportBusy(busy: boolean): void {
    for (const trigger of document.querySelectorAll<HTMLElement>(
      '[data-menu="export"], [data-menu="export-m"]',
    )) {
      if (trigger instanceof HTMLButtonElement) trigger.disabled = busy;
      trigger.setAttribute('aria-busy', busy ? 'true' : 'false');
      trigger.querySelector('[data-export-spinner]')?.toggleAttribute('hidden', !busy);
      trigger.querySelector('[data-export-chevron]')?.toggleAttribute('hidden', busy);
    }
    for (const option of document.querySelectorAll<HTMLButtonElement>(
      '[data-pop="export"] [data-command^="export-"], [data-pop="export-m"] [data-command^="export-"]',
    )) {
      option.disabled = busy;
    }
  }

  function runExport(
    kind: 'html' | 'pdf' | 'docx',
    pane: Pane,
    doc: OpenDocument,
    workingMessage: string,
    failureMessage: string,
  ): void {
    showStatus(workingMessage, 4000);
    setExportBusy(true);
    const settle = (result: { ok: boolean; reason?: string }): void => {
      setExportBusy(false);
      if (!result.ok && result.reason !== 'empty') toast(failureMessage);
    };
    void exportDocument({ kind, markdown: pane.textarea.value, fallbackName: doc.title }).then(
      settle,
      () => settle({ ok: false }),
    );
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

  /** A checkbox click in the preview rewrites the marker in the source. */
  function toggleTask(pane: Pane, index: number): void {
    const doc = documentById(pane.docId);
    if (!doc) return;
    if (isReadOnly(doc)) {
      denyEdit();
      return;
    }

    // The textarea, not `doc.content`: the document lags behind by one debounce.
    const toggle = taskToggleAt(pane.textarea.value, index);
    if (!toggle) return;

    pane.textarea.setRangeText(toggle.insert, toggle.from, toggle.to, 'preserve');
    pane.textarea.dispatchEvent(new Event('input'));
  }

  function renderPane(pane: Pane): void {
    const doc = documentById(pane.docId);
    if (!doc) return;
    void renderMarkdown(pane.preview, doc.content, {
      renderDiagram,
      onToggleTask: (index) => toggleTask(pane, index),
    }).then(
      () => {
        if (!pane.hasScrolled) pane.preview.scrollTop = 0;
        consumePendingHash(pane);
        if (pane.docId === activeId) buildEditorToc();
      },
      () => { },
    );
  }

  function consumePendingHash(pane: Pane): void {
    if (!pendingHash || pane.docId !== activeId) return;
    let target: Element | null;
    try {
      target = pane.preview.querySelector(`[id="${CSS.escape(pendingHash)}"]`);
    } catch {
      target = null;
    }
    if (!target) return;
    pendingHash = null;
    target.scrollIntoView({ block: 'start' });
    pane.hasScrolled = true;
  }

  function markToc(): void {
    tocFrame = 0;
    const preview = currentPane()?.preview;
    if (!preview || !tocHeadings.length) return;
    const top = preview.getBoundingClientRect().top + 24;
    let index = 0;
    for (let i = 0; i < tocHeadings.length; i++) {
      if (tocHeadings[i].getBoundingClientRect().top <= top) index = i;
      else break;
    }
    if (index === tocCurrent) return;
    tocCurrent = index;
    tocNavs.forEach((nav) => {
      nav.querySelector('.on')?.classList.remove('on');
      const link = nav.querySelector<HTMLElement>(`a[data-id="${tocHeadings[index].id}"]`);
      if (link) {
        link.classList.add('on');
        link.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function scheduleTocMark(): void {
    if (!tocFrame) tocFrame = requestAnimationFrame(markToc);
  }

  function buildEditorToc(): void {
    const preview = currentPane()?.preview;
    if (!preview) return;
    tocHeadings = [...preview.querySelectorAll<HTMLElement>('h1, h2, h3, h4')];
    const next = tocHeadings
      .map((heading) => heading.tagName + heading.id + heading.textContent)
      .join('|');
    if (next !== tocSignature) {
      tocSignature = next;
      const html = buildTocHtml(collectHeadings(preview, 'h1, h2, h3, h4'));
      tocNavs.forEach((nav) => {
        nav.innerHTML = html;
      });
    }
    tocCurrent = -1;
    markToc();
  }

  function syncTocHash(id: string): void {
    try {
      const url = new URL(window.location.href);
      url.hash = id;
      window.history.replaceState(null, '', url);
    } catch {
      // Non-http(s) contexts: the view still scrolls, the URL just lags.
    }
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
        if (event.isTrusted) {
          pane.hasScrolled = true;
          pendingHash = null;
        }
        // The scroll-spy rides this same listener: no second scroll pipeline.
        if (sourceName === 'preview' && pane.docId === activeId) scheduleTocMark();
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

  // ─── Find highlights ──────────────────────────────────────────────────────
  // Uses the browser's own Range geometry for pixel-perfect placement:
  // 1. Create a hidden mirror <div> that replicates the textarea's text and
  //    typography exactly (including wrapping).
  // 2. For each match, wrap the matching text nodes in a <mark> element and
  //    call getBoundingClientRect() on it - the browser resolves the position
  //    including padding, border, scroll offsets, zoom and font metrics.
  // 3. Convert from viewport coords to pane-relative coords and paint a
  //    highlight box in the overlay layer.
  //
  // The mirror is attached to the document only during measurement (< 1ms),
  // then removed. Cached per (content, query, case, width) key so scrolling
  // only re-places boxes without re-measuring.
  const FIND_HIGHLIGHT_CAP = 500;
  const FIND_DEBOUNCE_MS = 120;

  function findOptions(pane: Pane) {
    return {
      query: pane.findInput.value,
      caseSensitive: pane.caseSensitive,
      wholeWord: pane.wholeWord,
      useRegex: pane.useRegex,
    };
  }

  function buildPaneRegex(pane: Pane): RegExp | null {
    const { query, caseSensitive, wholeWord, useRegex } = findOptions(pane);
    if (!query) return null;
    try {
      const pattern = useRegex ? query : wholeWord
        ? `\\b${escapeRegExp(query)}\\b`
        : escapeRegExp(query);
      return new RegExp(pattern, caseSensitive ? 'g' : 'gi');
    } catch {
      return null; // invalid regex pattern
    }
  }

  function updateFindCount(pane: Pane): void {
    const regex = buildPaneRegex(pane);
    if (!regex) {
      pane.findCount.textContent = '';
      return;
    }
    const count = countMatches(pane.textarea.value, regex);
    pane.findCount.textContent = count === 0
      ? 'No results'
      : `${count} match${count === 1 ? '' : 'es'}`;
  }

  function ensureFindBox(pane: Pane, index: number): HTMLElement {
    const known = pane.findPool[index];
    if (known) return known;
    const box = document.createElement('div');
    box.style.position = 'absolute';
    box.style.pointerEvents = 'none';
    box.style.background = 'rgba(59,130,246,.28)';
    box.style.borderRadius = '2px';
    box.style.display = 'none';
    pane.findLayer.append(box);
    pane.findPool.push(box);
    return box;
  }

  function paintFindHighlights(pane: Pane): void {
    const regex = buildPaneRegex(pane);
    // Hide when the bar is closed or query is empty; pooled nodes stay in the
    // DOM (display:none) so reopening avoids reallocating them.
    if (pane.findbar.hidden || !regex) {
      pane.findLayer.style.display = 'none';
      for (const box of pane.findPool) box.style.display = 'none';
      pane.findCache = null;
      return;
    }
    pane.findLayer.style.display = '';

    // Cache key includes content length, query, all flags and textarea geometry.
    // Range geometry is scroll-dependent (viewport coords), so include scroll.
    const { textarea } = pane;
    const style = window.getComputedStyle(textarea);
    const value = textarea.value;
    const taRect = textarea.getBoundingClientRect();
    const opts = findOptions(pane);
    const key = `${value.length}:${opts.query}:${opts.caseSensitive ? 1 : 0}:${opts.wholeWord ? 1 : 0}:${opts.useRegex ? 1 : 0}:${Math.round(taRect.width)}:${Math.round(taRect.height)}:${textarea.scrollTop}:${textarea.scrollLeft}`;

    if (pane.findCache?.key !== key) {
      const boxes = measureFindRows(pane, value, regex, style);
      if (!boxes) {
        for (let i = 0; i < pane.findPool.length; i++) pane.findPool[i].style.display = 'none';
        return;
      }
      pane.findCache = { key, boxes };
    }
    placeFindBoxes(pane);
  }

  /** CSS properties cloned from textarea to the mirror so layout is identical. */
  const MIRROR_CLONE_PROPS = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch',
    'letterSpacing', 'wordSpacing', 'textIndent', 'textTransform',
    'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'boxSizing', 'tabSize', 'whiteSpace', 'overflowWrap', 'wordBreak',
  ] as const;

  /**
   * Builds a hidden mirror <div> that replicates the textarea's typography.
   * Caller is responsible for appending to document.body and removing it.
   */
  function buildMirror(
    textarea: HTMLTextAreaElement,
    style: CSSStyleDeclaration,
    taRect: DOMRect,
  ): HTMLDivElement {
    const mirror = document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    // CRITICAL: position at the SAME viewport coords as the textarea so that
    // Range.getClientRects() returns coords in the same space. If we use
    // top:0/left:0 the y values are wrong for any textarea that isn't at the
    // very top of the viewport (e.g. everything below a header).
    mirror.style.position = 'fixed';
    mirror.style.top = `${taRect.top}px`;
    mirror.style.left = `${taRect.left}px`;
    mirror.style.width = `${taRect.width}px`;
    mirror.style.height = `${taRect.height}px`;
    mirror.style.visibility = 'hidden';
    mirror.style.pointerEvents = 'none';
    mirror.style.zIndex = '-9999';
    mirror.style.overflow = 'hidden';
    for (const prop of MIRROR_CLONE_PROPS) mirror.style[prop] = style[prop];
    return mirror;
  }

  function measureFindRows(
    pane: Pane,
    value: string,
    regex: RegExp,
    style: CSSStyleDeclaration,
  ): ReadonlyArray<{ readonly x: number; readonly y: number; readonly w: number; readonly h: number }> | null {
    // Collect all match ranges (capped).
    regex.lastIndex = 0;
    const ranges: Array<{ from: number; to: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(value)) !== null) {
      if (m[0] === '') { regex.lastIndex += 1; continue; }
      ranges.push({ from: m.index, to: m.index + m[0].length });
      if (ranges.length >= FIND_HIGHLIGHT_CAP) break;
    }
    if (ranges.length === 0) return [];

    const { textarea } = pane;
    const host = pane.findLayer.offsetParent as HTMLElement | null;
    if (!host) return null; // pane not yet in layout

    const hostRect = host.getBoundingClientRect();
    const taRect = textarea.getBoundingClientRect();

    // Build mirror at the SAME screen position as the textarea.
    const mirror = buildMirror(textarea, style, taRect);
    const textNode = document.createTextNode(value);
    mirror.appendChild(textNode);
    document.body.appendChild(mirror);

    // We need to scroll the mirror to match the textarea's scroll position
    // so that getBoundingClientRect() on ranges reflects the visible area.
    mirror.scrollTop = textarea.scrollTop;
    mirror.scrollLeft = textarea.scrollLeft;

    const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
    try {
      const range = document.createRange();
      for (const { from, to } of ranges) {
        range.setStart(textNode, from);
        range.setEnd(textNode, to);
        const rects = range.getClientRects();
        // A match may span visual lines (word-wrapped): paint one box per rect.
        for (let ri = 0; ri < rects.length; ri++) {
          const r = rects[ri];
          if (r.width < 1) continue;
          // Convert from viewport coords to pane-relative (offsetParent-relative).
          const x = r.left - hostRect.left;
          const y = r.top - hostRect.top;
          // Only paint boxes inside the visible scroll band.
          const bandTop = taRect.top - hostRect.top;
          const bandBottom = bandTop + textarea.clientHeight;
          const bandLeft = taRect.left - hostRect.left;
          const bandRight = bandLeft + textarea.clientWidth;
          if (y + r.height < bandTop || y > bandBottom) continue;
          if (x + r.width < bandLeft || x > bandRight) continue;
          boxes.push({ x, y, w: r.width, h: r.height });
        }
      }
    } finally {
      mirror.remove();
    }
    return boxes;
  }

  function placeFindBoxes(pane: Pane): void {
    const cache = pane.findCache;
    if (!cache) {
      for (const box of pane.findPool) box.style.display = 'none';
      return;
    }
    const boxes = cache.boxes;
    let placed = 0;
    for (const box of boxes) {
      const node = ensureFindBox(pane, placed);
      placed += 1;
      node.style.display = 'block';
      node.style.left = `${Math.round(box.x)}px`;
      node.style.top = `${Math.round(box.y)}px`;
      node.style.width = `${Math.round(box.w)}px`;
      node.style.height = `${Math.round(box.h)}px`;
    }
    for (let i = placed; i < pane.findPool.length; i++) {
      pane.findPool[i].style.display = 'none';
    }
  }

  function refreshFind(pane: Pane): void {
    updateFindCount(pane);
    paintFindHighlights(pane);
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
    refreshFind(pane);
    const target = replaceMode && pane.findInput.value ? pane.replaceInput : pane.findInput;
    target.focus();
    target.select();
  }

  function closeFind(pane: Pane): void {
    window.clearTimeout(pane.findTimer);
    pane.findTimer = undefined;
    pane.findbar.hidden = true;
    paintFindHighlights(pane);
    pane.textarea.focus();
  }

  function setReplaceBusy(pane: Pane, busy: boolean): void {
    pane.replaceButton.disabled = busy;
    pane.replaceButton.setAttribute('aria-busy', busy ? 'true' : 'false');
    pane.replaceSpinner?.toggleAttribute('hidden', !busy);
    // Label: only set when going busy. The idle text is restored either by
    // flashReplaceSuccess (success path) or by the finally block (error/no-match).
    if (busy && pane.replaceLabel) pane.replaceLabel.textContent = 'Replacing…';
  }

  /** Briefly show a success state on the Replace All button. */
  function flashReplaceSuccess(pane: Pane, count: number): void {
    const btn = pane.replaceButton;
    const label = pane.replaceLabel;
    if (!label) return;
    label.textContent = `✓ ${count} replaced`;
    btn.classList.add('!bg-emerald-600');
    btn.classList.remove('!bg-blue-600');
    // Re-enable the button during the success flash so the user can click again
    btn.disabled = false;
    window.setTimeout(() => {
      label.textContent = 'Replace all';
      btn.classList.remove('!bg-emerald-600');
      btn.classList.add('!bg-blue-600');
    }, 2000);
  }

  function replaceAll(pane: Pane): void {
    if (isReadOnly(documentById(pane.docId))) {
      denyEdit();
      return;
    }
    const regex = buildPaneRegex(pane);
    if (!regex) return;
    setReplaceBusy(pane, true);
    try {
      const current = pane.textarea.value;
      const replacement = pane.replaceInput.value;
      const next = replaceAllMatches(current, regex, replacement);
      if (next === current) {
        toast('No matches');
        return;
      }
      const replaceCount = countMatches(current, regex);
      const caret = Math.min(pane.textarea.selectionStart, next.length);
      applyEdit(pane.textarea, {
        from: 0,
        to: current.length,
        insert: next,
        selStart: caret,
        selEnd: caret,
      });
      refreshFind(pane);
      flashReplaceSuccess(pane, replaceCount);
      // Don't restore disabled here on success - flashReplaceSuccess already did it.
      return;
    } finally {
      // Always hide the spinner and reset aria-busy.
      // On the success path, flashReplaceSuccess already set the label and re-enabled the button.
      // On the no-match / error path, we restore everything here.
      pane.replaceSpinner?.toggleAttribute('hidden', true);
      pane.replaceButton.setAttribute('aria-busy', 'false');
      pane.replaceButton.disabled = false;
      // Restore label only if flashReplaceSuccess didn't already change it (success shows "✓ …")
      if (pane.replaceLabel && !pane.replaceLabel.textContent?.startsWith('✓')) {
        pane.replaceLabel.textContent = 'Replace all';
      }
    }
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
        showStatus(READ_ONLY_STATUS, 3500);
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
    syncDocParam(id);
    updateStatus();

    buildEditorToc();
    tocFloat?.classList.add('hidden');

    collab?.setDocument(id);
    syncOverlay();
    if (pane) paintFindHighlights(pane);
    announceActiveDocument();
  }
  const declaredSignedIn = document.body.dataset.signedIn;

  function hasAccount(): boolean {
    if (declaredSignedIn === 'true') return true;
    if (declaredSignedIn === 'false') return false;
    return cloud !== null;
  }

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
          signedIn: hasAccount(),
          role: doc.role ?? 'owner',
          userId: viewerId || cloud?.viewer?.id || '',
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

  async function requestClose(id: string): Promise<void> {
    if (documents.length <= 1) {
      toast('At least one document must stay open');
      return;
    }
    const doc = documentById(id);
    if (!doc) return;

    // Closing a server document is a delete - but only for whoever may delete
    // it. A reader (an invited one, or anyone reading a public document) gets a
    // plain tab close instead: offering "Delete" for somebody else's page, and
    // firing a request RLS is going to refuse, is a lie about what just happened.
    const deleteOnline = cloud !== null && canManageDocument(doc.role ?? 'reader');

    const confirmed = await confirmAction({
      title: deleteOnline ? `Delete “${doc.title}”?` : `Close “${doc.title}”?`,
      message: deleteOnline
        ? 'It disappears for everyone who can see it, history included.'
        : doc.role !== undefined
          ? 'It closes the tab here. The document stays online.'
          : 'Its content is deleted from this browser.',
      confirmLabel: deleteOnline ? 'Delete' : 'Close',
      danger: true,
    });
    if (!confirmed) return;

    const closing = panes.get(id);
    if (closing) flushPane(closing);
    if (closing) window.clearTimeout(closing.findTimer);
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
      if (deleteOnline) {
        void session.remove(id).then((removed) => {
          if (!removed) toast(`Could not delete “${doc.title}” - it is still online`);
        });
      }
    }

    activate(activeId);
  }

  function paneFor(source: HTMLElement | null): Pane | undefined {
    const root = source?.closest<HTMLElement>('[data-pane]');
    const id = root?.dataset.paneId;
    return id ? panes.get(id) : currentPane();
  }

  async function clearActive(): Promise<void> {
    const pane = currentPane();
    if (!pane) return;
    if (!pane.textarea.value) return;
    if (isReadOnly(documentById(pane.docId))) {
      denyEdit();
      return;
    }
    const confirmed = await confirmAction({
      title: 'Clear the active document?',
      message: 'Its content is deleted and cannot be undone.',
      confirmLabel: 'Clear',
      danger: true,
    });
    if (!confirmed) return;
    pane.textarea.value = '';
    pane.textarea.dispatchEvent(new Event('input'));
    toast('Cleared');
  }

  async function clearAll(): Promise<void> {
    // Documents this account can only read keep their text; nobody clears them here.
    const editable = [...panes.values()].filter(
      (pane) => !isReadOnly(documentById(pane.docId)),
    );
    if (!editable.some((pane) => pane.textarea.value)) {
      if (editable.length < panes.size) denyEdit();
      return;
    }
    const confirmed = await confirmAction({
      title: 'Clear every document?',
      message: 'Their contents are deleted and cannot be undone.',
      confirmLabel: 'Clear all',
      danger: true,
    });
    if (!confirmed) return;
    editable.forEach((pane) => {
      pane.textarea.value = '';
      pane.textarea.dispatchEvent(new Event('input'));
    });
    toast('Cleared');
  }

  function setPanel(mode: 'code' | 'preview'): void {
    document.body.dataset.panel = mode;
    tocFloat?.classList.add('hidden');
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
        if (pane && doc) runExport('html', pane, doc, 'Building HTML…', 'Could not export the HTML - try again');
        return;
      case 'export-pdf':
        if (!pane || !doc) return;
        runExport('pdf', pane, doc, 'Rendering PDF…', 'Could not render the PDF - try again');
        return;
      case 'export-docx':
        if (!pane || !doc) return;
        runExport('docx', pane, doc, 'Building Word document…', 'Could not build the Word document - try again');
        return;
      case 'toggle-comments':
        // Handled entirely by commentsIntegration.ts via DOM event delegation
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
        void clearActive();
        return;
      case 'clear-all':
        void clearAll();
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
          pane.caseButton.setAttribute('aria-pressed', String(pane.caseSensitive));
          refreshFind(pane);
        }
        return;
      case 'toggle-word':
        if (pane && pane.wordButton) {
          pane.wholeWord = !pane.wholeWord;
          pane.wordButton.classList.toggle('on', pane.wholeWord);
          pane.wordButton.setAttribute('aria-pressed', String(pane.wholeWord));
          refreshFind(pane);
        }
        return;
      case 'toggle-regex':
        if (pane && pane.regexButton) {
          pane.useRegex = !pane.useRegex;
          pane.regexButton.classList.toggle('on', pane.useRegex);
          pane.regexButton.setAttribute('aria-pressed', String(pane.useRegex));
          // In regex mode whole-word doesn't apply
          if (pane.wordButton) pane.wordButton.toggleAttribute('disabled', pane.useRegex);
          refreshFind(pane);
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
      wordButton: root.querySelector<HTMLElement>('[data-command="toggle-word"]'),
      regexButton: root.querySelector<HTMLElement>('[data-command="toggle-regex"]'),
      replaceButton: query<HTMLButtonElement>('[data-command="replace-all"]'),
      replaceSpinner: root.querySelector<HTMLElement>('[data-replace-spinner]'),
      replaceLabel: root.querySelector<HTMLElement>('[data-replace-label]'),
      replaceIcon: root.querySelector<HTMLElement>('[data-replace-icon]'),
      findLayer: document.createElement('div'),
      findPool: [],
      findCache: null,
      splitter: query<HTMLElement>('[data-r="splitter"]'),
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
      scrollGuard: null,
      hasScrolled: false,
    };
    // Same host as `collab-layer` (created later in `syncOverlay`, so remote
    // cursors keep painting above these highlights), below the floating
    // findbar (z-index 10). `paintFindHighlights` owns its visibility.
    pane.findLayer.className = 'find-layer';
    pane.findLayer.style.position = 'absolute';
    pane.findLayer.style.inset = '0';
    pane.findLayer.style.overflow = 'hidden';
    pane.findLayer.style.pointerEvents = 'none';
    pane.findLayer.style.display = 'none';
    query<HTMLElement>('.code-pane').append(pane.findLayer);
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
      refreshFind(pane);
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

    // Debounced (120ms): the count is an exact lazy pass and the repaint
    // touches up to 300 pooled nodes - neither belongs on every keystroke.
    // The replace field only moves the count line (same single pass, via
    // `updateFindCount`), so it stays immediate.
    pane.findInput.addEventListener('input', () => {
      window.clearTimeout(pane.findTimer);
      pane.findTimer = window.setTimeout(() => refreshFind(pane), FIND_DEBOUNCE_MS);
    });
    pane.replaceInput.addEventListener('input', () => updateFindCount(pane));
    // Scroll repaint rides its own rAF-throttled listener (passive), mirroring
    // how the collab overlay repaints - independent of the sync-scroll pipe.
    let findScrollQueued = false;
    textarea.addEventListener(
      'scroll',
      () => {
        if (findScrollQueued) return;
        findScrollQueued = true;
        requestAnimationFrame(() => {
          findScrollQueued = false;
          paintFindHighlights(pane);
        });
      },
      { passive: true },
    );
    pane.findbar.addEventListener('keydown', (event) => {
      const ctrl = event.ctrlKey || event.metaKey;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeFind(pane);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        replaceAll(pane);
      } else if (event.altKey && !ctrl) {
        // Alt+C = toggle case, Alt+W = whole word, Alt+R = regex (like VSCode)
        switch (event.key.toLowerCase()) {
          case 'c':
            event.preventDefault();
            pane.caseSensitive = !pane.caseSensitive;
            pane.caseButton.classList.toggle('on', pane.caseSensitive);
            pane.caseButton.setAttribute('aria-pressed', String(pane.caseSensitive));
            refreshFind(pane);
            break;
          case 'w':
            event.preventDefault();
            if (pane.wordButton && !pane.useRegex) {
              pane.wholeWord = !pane.wholeWord;
              pane.wordButton.classList.toggle('on', pane.wholeWord);
              pane.wordButton.setAttribute('aria-pressed', String(pane.wholeWord));
              refreshFind(pane);
            }
            break;
          case 'r':
            event.preventDefault();
            if (pane.regexButton) {
              pane.useRegex = !pane.useRegex;
              pane.regexButton.classList.toggle('on', pane.useRegex);
              pane.regexButton.setAttribute('aria-pressed', String(pane.useRegex));
              if (pane.wordButton) pane.wordButton.toggleAttribute('disabled', pane.useRegex);
              refreshFind(pane);
            }
            break;
        }
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
            void requestClose(activeId);
            handled = true;
            break;
          case 'Enter':
            editWith(pane, (value) => commands.insertLine(value, true));
            handled = true;
            break;
          case 'c': {
            // Ctrl+C with no selection → copy the entire current line (VSCode)
            if (textarea.selectionStart === textarea.selectionEnd) {
              const lineRange = commands.selectLineRange(state);
              const lineText = textarea.value.slice(lineRange.start, lineRange.end);
              void navigator.clipboard.writeText(lineText + '\n').catch(() =>
                toast('Copy failed - check clipboard permissions'),
              );
              handled = true;
            }
            // With a selection, let the browser handle normal Ctrl+C.
            break;
          }
          case 'd': {
            // Ctrl+D → select next occurrence of word/selection (VSCode)
            const curSel = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
            const searchWord = curSel || (() => {
              const w = wordAt(textarea.value, textarea.selectionStart);
              return w ? textarea.value.slice(w[0], w[1]) : '';
            })();
            if (searchWord) {
              const searchFrom = curSel ? textarea.selectionEnd : textarea.selectionStart;
              let found = textarea.value.indexOf(searchWord, searchFrom);
              if (found === -1) found = textarea.value.indexOf(searchWord); // wrap
              if (found !== -1) textarea.setSelectionRange(found, found + searchWord.length);
            }
            handled = true;
            break;
          }
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
      void requestClose(closeTab.dataset.closeTab);
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
    tocFloat?.classList.add('hidden');
    const pane = currentPane();
    if (pane && !pane.findbar.hidden) closeFind(pane);
  });

  // One shared listener (not per-pane): repaints only the visible pane, so
  // closed tabs leave nothing behind.
  window.addEventListener('resize', () => {
    const pane = currentPane();
    if (pane) paintFindHighlights(pane);
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

  /**
   * Reads one document by id with whatever the caller is: signed in, or not.
   * `/api/documents/:id` answers a `public` document even without a session, and
   * 401 for anything else, so `null` here means "not readable from this browser".
   */
  async function fetchReadableDocument(id: string): Promise<CloudDocument | null> {
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!response.ok) return null;

      const payload: unknown = await response.json();
      const found = (payload as { document?: unknown }).document;
      return isCloudDocument(found) ? found : null;
    } catch {
      return null;
    }
  }

  /**
   * A `?doc=<id>` that is not in this account's tabs can still be one it is
   * allowed to *read*: a document published as `public`, or shared by link as
   * `unlisted`, is visible to anyone holding the address, RLS included, but
   * `listDocuments` keeps it out of the tab list on purpose -
   * else "my documents" would fill up with strangers' pages. The preview already
   * reads such a document straight from the API; this gives the editor the same
   * reach, as a read-only tab that is never persisted to the account. A signed-out
   * visitor gets the same tab: `role` is `reader`, so nothing here is writable.
   */
  async function openReadableDocument(requested: string | null): Promise<void> {
    if (!requested || !isDocumentId(requested) || documentById(requested)) return;

    const found = await fetchReadableDocument(requested);
    if (!found) return;

    revisions.set(found.id, found.revision);
    lastSaved.set(found.id, found.content);
    documents = [
      ...documents,
      { id: found.id, title: found.title, content: found.content, role: found.role },
    ];
  }

  async function boot(): Promise<void> {
    const requested = new URLSearchParams(window.location.search).get('doc');
    try {
      pendingHash = decodeURIComponent(window.location.hash.slice(1)) || null;
    } catch {
      pendingHash = null;
    }
    // No session in the markup means no session to ask about: the request would
    // only ever answer 401.
    const session = declaredSignedIn === 'false' ? null : await openCloudDocuments();

    if (!session) {
      // Signed out, a `?doc=` link can still be readable: a document published as
      // `public`, or shared by link, answers the anonymous request. Load it before
      // seeding, so a visitor who only followed a link does not also get a draft.
      await openReadableDocument(requested);
      bootDocuments();
      booted = true;
      mountAll(requested);
      gateForMissingDocument(requested, false);
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
    await openReadableDocument(requested);

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
    gateForMissingDocument(requested, true);
  }

  /**
   * A `?doc=<id>` that is not among the documents this account can open means one
   * of two things, and they look identical from here: RLS hid it, or it is gone.
   * Either way the fallback used to be silent - the editor quietly showed a
   * different document. The gate says what happened and offers the one action
   * that can change it.
   */
  function gateForMissingDocument(requested: string | null, signedIn: boolean): void {
    if (!requested || !isDocumentId(requested)) return;
    if (documentById(requested)) return;

    // Put the address back. `mountAll` fell back to another document and
    // `syncDocParam` rewrote `?doc=` to it; left that way, the gate would talk
    // about a document the URL no longer names, and reloading would land on the
    // wrong one.
    syncDocParam(requested);
    showAccessGate({ documentId: requested, signedIn });
  }

  setSplit(readNumberPref(PREF_KEYS.split, 50));
  setZoom(readNumberPref(PREF_KEYS.zoom, 1));
  toggleSyncUi();
  setPanel(document.body.dataset.panel === 'preview' ? 'preview' : 'code');

  tocNavs.forEach((nav) =>
    nav.addEventListener('click', (event) => {
      const link = (event.target as HTMLElement).closest<HTMLElement>('a[data-id]');
      if (!link?.dataset.id) return;
      event.preventDefault();
      const id = link.dataset.id;
      syncTocHash(id);
      tocHeadings
        .find((heading) => heading.id === id)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      tocFloat?.classList.add('hidden');
    }),
  );

  document
    .getElementById('toc-fab')
    ?.addEventListener('click', () => tocFloat?.classList.toggle('hidden'));
  showStatus('Loading your documents…', 4000);
  void boot();

  document.addEventListener('mdverse:request-active-document', () => announceActiveDocument());
}
