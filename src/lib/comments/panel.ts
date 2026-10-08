import { createComment, fetchComments, groupIntoThreads, resolveComment, timeAgo } from './api';
import type { Comment, CommentThread } from './api';
import { fetchMentionCandidates, renderCommentBody } from './mentions';
import type { MentionCandidate } from './mentions';
import { avatarAura } from '../auth/avatarAura';
import { initials } from '../auth/profile';

interface PanelOptions {
  onHighlightAnchor?: (from: number, to: number) => void;
}

export interface CommentPanel {
  open(anchor?: { from: number; to: number; quote: string }): void;
  close(): void;
  setDocument(documentId: string, canComment: boolean): void;
  refresh(): void;
  readonly isOpen: boolean;
}

const PANEL_WIDTH = 360;

const CLS = {
  panel:
    'fixed right-0 top-0 bottom-0 z-40 flex w-[360px] max-w-[92vw] flex-col border-l border-[#1f1f1f] bg-[#0b0b0b] shadow-[-12px_0_40px_#0008]',
  header: 'flex hf items-center gap-2 border-b border-[#1f1f1f] px-3',
  headerTitle: 'text-[13px] font-medium text-neutral-200',
  headerCount:
    'rounded-full bg-[#1f1f1f] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-neutral-400',
  scroll: 'flex-1 overflow-y-auto px-3 py-3',
  thread: 'mb-3 rounded-xl border border-[#1f1f1f] bg-[#101010]',
  threadBody: 'px-3 py-2.5',
  threadHead: 'flex items-start gap-2.5',
  avatarThread:
    'relative mt-0.5 h-6 w-6 shrink-0 select-none overflow-hidden rounded-full ring-1 ring-white/10',
  avatarMention:
    'relative h-5 w-5 shrink-0 select-none overflow-hidden rounded-full ring-1 ring-white/10',
  avatarLayer: 'absolute inset-0 pointer-events-none',
  avatarLabel:
    'relative z-10 flex h-full w-full items-center justify-center text-[10px] font-semibold text-white',
  author: 'text-[12px] font-medium text-neutral-200 leading-tight',
  time: 'text-[11px] text-neutral-600',
  comment: 'mt-1.5 text-[13px] leading-relaxed text-neutral-300 whitespace-pre-wrap break-words',
  quote:
    'mb-2 flex w-full items-center gap-1.5 rounded-md border border-[#1f1f1f] bg-[#0b0b0b] px-2 py-1 text-left text-[11px] text-neutral-500 transition hover:text-neutral-300',
  replyRow: 'mt-2.5 flex items-center gap-2 border-t border-[#1f1f1f] pt-2.5',
  reply: 'ml-7 mt-2.5 border-l border-[#1f1f1f] pl-3',
  input:
    'min-w-0 flex-1 rounded-lg border border-[#2a2a2a] bg-[#141414] px-2.5 py-1.5 text-[12px] text-neutral-200 outline-none transition focus:border-[#3b3b3b] placeholder:text-neutral-600',
  iconBtn:
    'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-600 transition hover:bg-[#1f1f1f] hover:text-neutral-200',
  composer: 'border-t border-[#1f1f1f] px-3 py-3',
  anchorChip:
    'mb-2 flex items-center gap-2 rounded-lg border-l-2 border-[#2563eb] bg-[#101010] px-2.5 py-1.5 text-[11px] text-neutral-500',
  composerInput:
    'w-full resize-none rounded-xl border border-[#2a2a2a] bg-[#141414] px-3 py-2 text-[13px] leading-relaxed text-neutral-200 outline-none transition focus:border-[#3b3b3b] placeholder:text-neutral-600',
  composerRow: 'mt-2 flex items-center justify-between gap-2',
  primary:
    'inline-flex h-7 items-center gap-1.5 rounded-lg bg-[#2563eb] px-3 text-[12px] font-medium text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-50',
  ghost: 'text-[11px] text-neutral-500 transition hover:text-neutral-300',
  mentionMenu:
    'absolute bottom-full left-0 z-50 mb-1 w-full overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] shadow-[0_12px_32px_#000a]',
  mentionItem:
    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-neutral-300 transition hover:bg-[#171717] hover:text-white',
  hint: 'px-3 py-2 text-center text-[12px] text-neutral-600',
  empty:
    'flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-neutral-600',
  failed: 'text-[12px] text-red-400',
  spinner: 'h-4 w-4 animate-spin text-neutral-600',
  toast:
    'pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-[#2a2a2a] bg-[#141414] px-3 py-1.5 text-[12px] text-neutral-200 opacity-0 transition-opacity',
} as const;

const ACCENT = '#2563eb';

function escHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Canonical aura avatar, mirroring `createPresenceAvatar` in editorApp.ts:
 * relative rounded-full overflow-hidden ring-1 ring-white/10 container with
 * base + softVeil aura layers and a centered initials overlay. Hash key is
 * always `seed || name` (stable id first), never the bare display name, so
 * avatar colors survive renames — same contract as `Avatar.astro`.
 */
function renderAuraAvatar(seed: string, name: string, sizeClass: string): HTMLElement {
  const aura = avatarAura(seed || name, name, 'sm');
  const avatar = document.createElement('span');
  avatar.className = sizeClass;

  const base = document.createElement('span');
  base.className = CLS.avatarLayer;
  base.setAttribute('aria-hidden', 'true');
  base.style.cssText = aura.baseLayer;

  const veil = document.createElement('span');
  veil.className = CLS.avatarLayer;
  veil.setAttribute('aria-hidden', 'true');
  veil.style.cssText = aura.softVeil;

  const label = document.createElement('span');
  label.className = CLS.avatarLabel;
  label.style.textShadow = '0 1px 2px rgba(0,0,0,0.65)';
  label.textContent = initials(name);

  avatar.append(base, veil, label);
  return avatar;
}

function icon(paths: string, size = 14): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const ICON_CHECK = icon('<polyline points="20 6 9 17 4 12"/>');
const ICON_SEND = icon('<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>');
const ICON_JUMPS = icon('<path d="M7 17 17 7"/><path d="M7 7h10v10"/>');

export function createCommentPanel(host: HTMLElement, opts: PanelOptions = {}): CommentPanel {
  let documentId = '';
  let canComment = false;
  let threads: CommentThread[] = [];
  let candidates: MentionCandidate[] = [];
  let pendingAnchor: { from: number; to: number; quote: string } | null = null;
  let open = false;
  let loading = false;
  let loadedFor = '';

  /** Reply draft per root id, so a reconcile never eats what the user typed. */
  const drafts = new Map<string, string>();
  const nodes = new Map<string, HTMLElement>();

  const panel = document.createElement('aside');
  panel.id = 'comment-panel';
  panel.className = CLS.panel;
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', 'Comments');
  panel.style.transform = `translateX(${PANEL_WIDTH}px)`;
  panel.style.transition = 'transform .2s cubic-bezier(.4,0,.2,1)';

  const header = document.createElement('div');
  header.className = CLS.header;

  const title = document.createElement('span');
  title.className = CLS.headerTitle;
  title.textContent = 'Comments';

  const count = document.createElement('span');
  count.className = CLS.headerCount;
  count.hidden = true;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = `${CLS.iconBtn} ml-auto`;
  closeBtn.title = 'Close comments (Esc)';
  closeBtn.innerHTML = icon('<path d="M18 6 6 18M6 6l12 12"/>', 16);
  closeBtn.addEventListener('click', () => api.close());

  header.append(title, count, closeBtn);

  const scroll = document.createElement('div');
  scroll.className = CLS.scroll;

  const composer = document.createElement('form');
  composer.className = CLS.composer;

  const anchorChip = document.createElement('div');
  anchorChip.className = CLS.anchorChip;
  anchorChip.hidden = true;
  const anchorText = document.createElement('span');
  anchorText.className = 'min-w-0 flex-1 truncate';
  anchorChip.append(anchorText);

  const composerBox = document.createElement('div');
  composerBox.className = 'relative';

  const mentionMenu = document.createElement('div');
  mentionMenu.className = CLS.mentionMenu;
  mentionMenu.hidden = true;

  const textarea = document.createElement('textarea');
  textarea.rows = 2;
  textarea.maxLength = 4000;
  textarea.placeholder = 'Write a comment…  Use @ to mention someone';
  textarea.className = CLS.composerInput;

  const composerRow = document.createElement('div');
  composerRow.className = CLS.composerRow;

  const hint = document.createElement('span');
  hint.className = CLS.ghost;
  hint.textContent = 'Ctrl+Enter to post';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = CLS.primary;
  submitBtn.innerHTML = `${ICON_SEND}<span>Comment</span>`;

  composerRow.append(hint, submitBtn);
  composerBox.append(mentionMenu, textarea);
  composer.append(anchorChip, composerBox, composerRow);

  panel.append(header, scroll, composer);
  host.append(panel);

  const status = document.createElement('div');
  status.className = CLS.toast;
  panel.append(status);

  let statusTimer: number | undefined;
  function flash(message: string, tone: 'info' | 'error' = 'info'): void {
    status.textContent = message;
    status.style.color = tone === 'error' ? '#f87171' : '#e5e5e5';
    status.style.opacity = '1';
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      status.style.opacity = '0';
    }, 3200);
  }

  let mentionQuery: string | null = null;
  let mentionIndex = 0;
  let mentionStart = -1;

  function matchingCandidates(): MentionCandidate[] {
    if (mentionQuery === null) return [];
    const query = mentionQuery.toLowerCase();
    return candidates
      .filter(
        (candidate) =>
          candidate.username.toLowerCase().includes(query) ||
          candidate.name.toLowerCase().includes(query),
      )
      .slice(0, 6);
  }

  function closeMentionMenu(): void {
    mentionQuery = null;
    mentionStart = -1;
    mentionMenu.hidden = true;
  }

  function renderMentionMenu(): void {
    const matches = matchingCandidates();
    if (matches.length === 0) {
      closeMentionMenu();
      return;
    }
    mentionMenu.replaceChildren(
      ...matches.map((candidate, index) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = CLS.mentionItem;
        item.dataset.index = String(index);
        if (index === mentionIndex) item.classList.add('bg-[#171717]', 'text-white');
        const avatar = renderAuraAvatar(candidate.userId, candidate.name, CLS.avatarMention);
        const label = document.createElement('span');
        label.className = 'min-w-0 flex-1 truncate';
        label.innerHTML = `${escHtml(candidate.name)} <span class="text-neutral-600">@${escHtml(candidate.username)}</span>`;
        item.append(avatar, label);
        item.addEventListener('mousedown', (event) => {
          event.preventDefault();
          applyMention(candidate);
        });
        return item;
      }),
    );
    mentionMenu.hidden = false;
  }

  function detectMention(): void {
    const caret = textarea.selectionStart ?? 0;
    const before = textarea.value.slice(0, caret);
    const match = /(?:^|[\s(])@([a-z0-9_]*)$/.exec(before);
    if (!match || candidates.length === 0) {
      closeMentionMenu();
      return;
    }
    mentionQuery = match[1];
    mentionStart = caret - match[1].length - 1;
    mentionIndex = 0;
    renderMentionMenu();
  }

  function applyMention(candidate: MentionCandidate): void {
    if (mentionStart < 0) return;
    const caret = textarea.selectionStart ?? 0;
    const value = textarea.value;
    const next = `${value.slice(0, mentionStart)}@${candidate.username} ${value.slice(caret)}`;
    textarea.value = next.slice(0, 4000);
    const position = mentionStart + candidate.username.length + 2;
    textarea.setSelectionRange(position, position);
    closeMentionMenu();
    textarea.focus();
  }

  textarea.addEventListener('input', detectMention);
  textarea.addEventListener('click', detectMention);
  textarea.addEventListener('blur', () => window.setTimeout(closeMentionMenu, 120));
  textarea.addEventListener('keydown', (event) => {
    if (mentionMenu.hidden) {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        composer.requestSubmit();
      }
      return;
    }
    const matches = matchingCandidates();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      mentionIndex = (mentionIndex + 1) % matches.length;
      renderMentionMenu();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      mentionIndex = (mentionIndex - 1 + matches.length) % matches.length;
      renderMentionMenu();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      const chosen = matches[mentionIndex];
      if (chosen) applyMention(chosen);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      closeMentionMenu();
    }
  });

  function usernames(): Set<string> {
    return new Set(candidates.map((candidate) => candidate.username));
  }

  function signatureOf(thread: CommentThread): string {
    return `${thread.root.id}:${thread.root.resolved}:${thread.replies.map((reply) => reply.id).join(',')}`;
  }

  function renderAvatar(comment: Comment): HTMLElement {
    return renderAuraAvatar(comment.authorId, comment.authorName, CLS.avatarThread);
  }

  function renderBody(comment: Comment): HTMLElement {
    const body = document.createElement('div');
    body.className = CLS.comment;
    body.append(renderCommentBody(comment.body, usernames()));
    return body;
  }

  function renderLeaf(comment: Comment, isRoot: boolean): HTMLElement {
    const wrap = document.createElement('div');
    wrap.dataset.commentId = comment.id;

    const head = document.createElement('div');
    head.className = CLS.threadHead;

    const meta = document.createElement('div');
    meta.className = 'min-w-0 flex-1';
    meta.innerHTML =
      `<div class="${CLS.author}">${escHtml(comment.authorName)}</div>` +
      `<div class="${CLS.time}">${timeAgo(comment.createdAt)}${comment.pending ? ' · sending…' : ''}</div>`;

    head.append(renderAvatar(comment), meta);

    if (isRoot) {
      const actions = document.createElement('div');
      actions.className = 'flex shrink-0 items-center gap-1';
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.className = CLS.iconBtn;
      jump.title = 'Jump to the selection';
      jump.innerHTML = ICON_JUMPS;
      jump.hidden = !comment.anchor;
      jump.addEventListener('click', () => {
        if (comment.anchor) opts.onHighlightAnchor?.(comment.anchor.from, comment.anchor.to);
      });
      actions.append(jump);

      if (canComment && !comment.pending) {
        const resolveBtn = document.createElement('button');
        resolveBtn.type = 'button';
        resolveBtn.className = CLS.iconBtn;
        resolveBtn.title = 'Resolve thread';
        resolveBtn.innerHTML = ICON_CHECK;
        resolveBtn.addEventListener('click', () => void resolveThread(comment.id));
        actions.append(resolveBtn);
      }
      head.append(actions);
    }

    wrap.append(head, renderBody(comment));

    if (comment.failed) {
      const failed = document.createElement('div');
      failed.className = CLS.failed;
      failed.textContent = 'Could not send.';
      wrap.append(failed);
    }

    return wrap;
  }

  function renderReplyInput(thread: CommentThread): HTMLElement {
    const row = document.createElement('div');
    row.className = CLS.replyRow;

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 4000;
    input.placeholder = 'Reply…';
    input.className = CLS.input;
    input.value = drafts.get(thread.root.id) ?? '';
    input.dataset.rootId = thread.root.id;

    const send = document.createElement('button');
    send.type = 'button';
    send.className = CLS.iconBtn;
    send.title = 'Send reply (Enter)';
    send.innerHTML = ICON_SEND;

    const submit = (): void => {
      const value = input.value.trim();
      if (!value) return;
      drafts.delete(thread.root.id);
      input.value = '';
      void sendReply(thread.root.id, value);
    };

    send.addEventListener('click', submit);
    input.addEventListener('input', () => drafts.set(thread.root.id, input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });

    row.append(input, send);
    return row;
  }

  function renderThread(thread: CommentThread): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = CLS.thread;
    wrap.dataset.rootId = thread.root.id;
    wrap.dataset.signature = signatureOf(thread);

    const body = document.createElement('div');
    body.className = CLS.threadBody;

    if (thread.root.anchor?.quote) {
      const quote = document.createElement('button');
      quote.type = 'button';
      quote.className = CLS.quote;
      quote.innerHTML = `${icon('<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>', 12)}<span class="min-w-0 flex-1 truncate">${escHtml(thread.root.anchor.quote.slice(0, 90))}</span>`;
      quote.addEventListener('click', () => {
        const anchor = thread.root.anchor;
        if (anchor) opts.onHighlightAnchor?.(anchor.from, anchor.to);
      });
      body.append(quote);
    }

    body.append(renderLeaf(thread.root, true));

    const replies = document.createElement('div');
    replies.dataset.replies = thread.root.id;
    for (const reply of thread.replies) {
      const leaf = renderLeaf(reply, false);
      leaf.className = CLS.reply;
      replies.append(leaf);
    }
    body.append(replies);

    if (canComment && !thread.root.pending && !thread.root.failed) {
      const replyRow = renderReplyInput(thread);
      replyRow.className = CLS.replyRow;
      body.append(replyRow);
    }

    wrap.append(body);
    return wrap;
  }

  function emptyState(): HTMLElement {
    const empty = document.createElement('div');
    empty.className = CLS.empty;
    empty.innerHTML =
      '<div class="text-[13px] font-medium text-neutral-500">No comments yet</div>' +
      '<div class="text-[12px]">Select text and press <span class="text-neutral-400">C</span>, or write below.</div>';
    return empty;
  }

  function loadingState(): HTMLElement {
    const el = document.createElement('div');
    el.className = CLS.hint;
    el.innerHTML = `<span class="${CLS.spinner} inline-block align-middle"></span> Loading…`;
    return el;
  }

  function renderAll(): void {
    nodes.clear();
    scroll.replaceChildren();

    if (loading && threads.length === 0) {
      scroll.append(loadingState());
      return;
    }
    if (threads.length === 0) {
      scroll.append(emptyState());
      return;
    }
    for (const thread of threads) {
      const node = renderThread(thread);
      nodes.set(thread.root.id, node);
      scroll.append(node);
    }
  }

  /** Rebuilds a single thread in place, preserving the reply draft. */
  function refreshThreadNode(thread: CommentThread): void {
    const previous = nodes.get(thread.root.id);
    const node = renderThread(thread);
    nodes.set(thread.root.id, node);
    if (previous && previous.parentElement === scroll) scroll.replaceChild(node, previous);
    else scroll.append(node);
  }

  function updateCount(): void {
    count.textContent = String(threads.length);
    count.hidden = threads.length === 0;
    document.dispatchEvent(
      new CustomEvent('mdverse:comments-changed', { detail: { documentId, threads } }),
    );
  }

  /** Adds or replaces a root thread locally, then renders just that node. */
  function upsertRoot(comment: Comment): void {
    const existing = threads.findIndex((thread) => thread.root.id === comment.id);
    if (existing >= 0) {
      const thread = threads[existing];
      threads[existing] = { root: comment, replies: thread.replies };
      refreshThreadNode(threads[existing]);
    } else {
      const thread: CommentThread = { root: comment, replies: [] };
      threads.push(thread);
      if (nodes.size === 0) scroll.replaceChildren();
      const node = renderThread(thread);
      nodes.set(comment.id, node);
      scroll.append(node);
    }
    updateCount();
  }

  /**
   * Swaps the optimistic placeholder for the server-confirmed comment.
   *
   * The server owns the ids, so a confirmed comment never shares the
   * `pending-…` id of its placeholder: looking it up by id would only ever
   * find the optimistic node and leave it stranded next to its own server copy
   * ("You · sending…" beside the real author). The thread is re-keyed here and
   * the old DOM node is replaced in place, so the list never reorders.
   */
  function replaceRoot(optimisticId: string, comment: Comment): void {
    const index = threads.findIndex((thread) => thread.root.id === optimisticId);
    if (index < 0) {
      upsertRoot(comment);
      return;
    }
    const thread = threads[index];
    const previous = nodes.get(optimisticId);
    thread.root = comment;
    nodes.delete(optimisticId);
    const node = renderThread(thread);
    nodes.set(comment.id, node);
    if (previous && previous.parentElement === scroll) scroll.replaceChild(node, previous);
    else scroll.append(node);
    updateCount();
  }

  function sortThreads(): void {
    threads.sort((a, b) => a.root.createdAt.localeCompare(b.root.createdAt));
  }

  function signatureFor(threads: CommentThread[]): Map<string, CommentThread> {
    return new Map(threads.map((thread) => [thread.root.id, thread]));
  }

  async function loadComments(): Promise<void> {
    if (!documentId) return;
    loading = true;
    if (threads.length === 0) renderAll();

    const [comments, mentionList] = await Promise.all([
      fetchComments(documentId),
      fetchMentionCandidates(documentId),
    ]);

    threads = groupIntoThreads(comments);
    sortThreads();
    candidates = mentionList;
    loading = false;
    loadedFor = documentId;
    renderAll();
    updateCount();
  }

  async function loadCandidates(): Promise<void> {
    if (!documentId) return;
    candidates = await fetchMentionCandidates(documentId);
    for (const thread of threads) refreshThreadNode(thread);
  }

  /** Fetches and reconciles: only threads whose content changed are rebuilt. */
  async function reconcile(): Promise<void> {
    if (!documentId) return;
    const comments = await fetchComments(documentId);
    const next = groupIntoThreads(comments);
    sortThreads();

    const incoming = signatureFor(next);
    threads = threads.filter((thread) => {
      const optimistic = thread.root.pending || thread.root.failed;
      if (optimistic) return true;
      const stillThere = incoming.has(thread.root.id);
      if (!stillThere) nodes.get(thread.root.id)?.remove();
      nodes.delete(thread.root.id);
      return stillThere;
    });

    for (const thread of next) {
      const current = threads.find((entry) => entry.root.id === thread.root.id);
      if (!current) {
        threads.push(thread);
        continue;
      }
      if (signatureOf(current) !== signatureOf(thread)) {
        current.root = thread.root;
        current.replies = thread.replies;
        refreshThreadNode(current);
      }
    }

    if (threads.length === 0) renderAll();
    loadedFor = documentId;
    updateCount();
  }

  function makeOptimistic(body: string, anchor: { from: number; to: number; quote: string } | null, parentId: string | null): Comment {
    return {
      id: `pending-${Math.random().toString(36).slice(2)}`,
      documentId,
      authorId: 'me',
      authorName: 'You',
      authorInitials: 'Y',
      authorColor: ACCENT,
      parentId,
      body,
      anchor: anchor ?? null,
      resolved: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pending: true,
    };
  }

  /**
   * Wraps `createComment` so a transport failure surfaces as a failed comment
   * instead of a rejected promise. Without it, a fetch that throws (or an
   * empty/non-JSON response) leaves the optimistic node frozen on "sending…"
   * forever and never re-enables the submit button.
   */
  async function postComment(
    input: Parameters<typeof createComment>[0],
  ): Promise<{ ok: true; comment: Comment } | { ok: false; error: string }> {
    try {
      return await createComment(input);
    } catch {
      return { ok: false, error: 'Could not reach the server — comment not sent' };
    }
  }

  async function sendReply(rootId: string, body: string): Promise<void> {
    const thread = threads.find((entry) => entry.root.id === rootId);
    if (!thread) return;

    const optimistic = makeOptimistic(body, null, rootId);
    thread.replies.push(optimistic);
    refreshThreadNode(thread);

    const result = await postComment({ documentId, body, parentId: rootId });
    if (result.ok) {
      const index = thread.replies.findIndex((reply) => reply.id === optimistic.id);
      if (index >= 0) thread.replies[index] = result.comment;
    } else {
      const index = thread.replies.findIndex((reply) => reply.id === optimistic.id);
      if (index >= 0) thread.replies[index] = { ...optimistic, pending: false, failed: true };
      flash(result.error, 'error');
    }
    refreshThreadNode(thread);
  }

  async function submitComment(): Promise<void> {
    const body = textarea.value.trim();
    if (!body || !documentId) return;

    const anchor = pendingAnchor;
    submitBtn.disabled = true;

    const optimistic = makeOptimistic(body, anchor, null);
    upsertRoot(optimistic);
    textarea.value = '';
    closeMentionMenu();
    clearAnchor();

    const result = await postComment({ documentId, body, anchor: anchor ?? undefined });
    submitBtn.disabled = false;

    if (result.ok) {
      replaceRoot(optimistic.id, result.comment);
    } else {
      upsertRoot({ ...optimistic, pending: false, failed: true });
      flash(result.error, 'error');
    }
    scroll.scrollTop = 0;
  }

  async function resolveThread(rootId: string): Promise<void> {
    const previous = threads;
    const node = nodes.get(rootId);
    threads = threads.filter((thread) => thread.root.id !== rootId);
    node?.remove();
    nodes.delete(rootId);
    updateCount();

    const result = await resolveComment(rootId);
    if (!result.ok) {
      threads = previous;
      renderAll();
      updateCount();
      flash(result.error, 'error');
    }
  }

  function clearAnchor(): void {
    pendingAnchor = null;
    anchorChip.hidden = true;
  }

  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitComment();
  });

  const api: CommentPanel = {
    get isOpen() {
      return open;
    },

    open(anchor) {
      open = true;
      panel.style.transform = 'translateX(0)';
      if (anchor && canComment) {
        pendingAnchor = anchor;
        anchorText.textContent = `“${anchor.quote.slice(0, 80)}${anchor.quote.length > 80 ? '…' : ''}”`;
        anchorChip.hidden = false;
        textarea.focus();
      }
      if (documentId && loadedFor !== documentId && !loading) void loadComments();
    },

    close() {
      open = false;
      panel.style.transform = `translateX(${PANEL_WIDTH}px)`;
      clearAnchor();
      closeMentionMenu();
    },

    setDocument(id, canEdit) {
      if (id === documentId && canEdit === canComment) return;
      documentId = id;
      canComment = canEdit;
      threads = [];
      nodes.clear();
      drafts.clear();
      candidates = [];
      loadedFor = '';
      updateCount();
      scroll.replaceChildren();
      if (documentId) void loadCandidates();
      if (open && documentId) void loadComments();
    },

    refresh() {
      if (documentId) void reconcile();
    },
  };

  renderAll();
  return api;
}

// ── Selection bubble ─────────────────────────────────────────────────────────

/**
 * The floating "comment" bubble that appears when text is selected in the
 * textarea. Anchor-safe: it reads the selection range without stealing focus.
 */
export function createSelectionBubble(
  textarea: HTMLTextAreaElement,
  onAddComment: (anchor: { from: number; to: number; quote: string }) => void,
): () => void {
  const bubble = document.createElement('button');
  bubble.type = 'button';
  bubble.title = 'Add a comment to the selection (C)';
  bubble.className =
    'fixed z-30 h-7 w-7 items-center justify-center rounded-full border border-[#1f1f1f] bg-[#141414] text-neutral-300 shadow-[0_6px_18px_#000a] transition hover:bg-[#1f1f1f] hover:text-white';
  bubble.style.display = 'none';
  bubble.innerHTML = icon(
    '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2">' +
    '<path d="M12 8v3m0 0v3m0-3h3m-3 0H9" />' +
    '<path stroke-linejoin="round" d="M14 19c3.771 0 5.657 0 6.828-1.172S22 14.771 22 11s0-5.657-1.172-6.828S17.771 3 14 3h-4C6.229 3 4.343 3 3.172 4.172S2 7.229 2 11s0 5.657 1.172 6.828c.653.654 1.528.943 2.828 1.07" />' +
    '<path d="M14 19c-1.236 0-2.598.5-3.841 1.145c-1.998 1.037-2.997 1.556-3.489 1.225s-.399-1.355-.212-3.404L6.5 17.5" />' +
    '</g>',
    14
  );
  document.body.append(bubble);

  let hideTimer: number | undefined;

  function hide(): void {
    bubble.style.display = 'none';
  }

  function show(): void {
    const { selectionStart, selectionEnd, value } = textarea;
    if (selectionStart === selectionEnd || !value.slice(selectionStart, selectionEnd).trim()) {
      hide();
      return;
    }

    const rect = textarea.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 20;
    const linesBefore = value.slice(0, selectionEnd).split('\n').length - 1;
    const top = rect.top + (linesBefore + 1) * lineHeight - textarea.scrollTop + 2;
    bubble.style.top = `${Math.min(top, rect.bottom - 30)}px`;
    bubble.style.left = `${rect.right - 40}px`;
    bubble.style.display = 'flex';
  }

  textarea.addEventListener('mouseup', () => window.setTimeout(show, 10));
  textarea.addEventListener('keyup', (event) => {
    if (event.shiftKey) show();
    else hide();
  });
  bubble.addEventListener('mouseenter', () => window.clearTimeout(hideTimer));
  bubble.addEventListener('mouseleave', () => {
    hideTimer = window.setTimeout(hide, 150);
  });
  bubble.addEventListener('mousedown', (event) => event.preventDefault());
  bubble.addEventListener('click', () => {
    const { selectionStart, selectionEnd, value } = textarea;
    if (selectionStart === selectionEnd) return;
    const quote = value.slice(selectionStart, selectionEnd).trim().slice(0, 200);
    onAddComment({ from: selectionStart, to: selectionEnd, quote });
    hide();
  });

  return () => {
    window.clearTimeout(hideTimer);
    bubble.remove();
  };
}
