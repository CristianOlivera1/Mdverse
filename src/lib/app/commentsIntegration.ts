import { createCommentPanel, createSelectionBubble } from '../comments/panel';
import type { CommentPanel } from '../comments/panel';
import { createAnchorOverlay } from '../comments/anchors';
import type { AnchorOverlay } from '../comments/anchors';
import type { CommentThread } from '../comments/api';

let activeDocumentId = '';
let canComment = false;
let signedIn = true;
let destroyBubble: (() => void) | null = null;
let panel: CommentPanel | null = null;
let overlay: AnchorOverlay | null = null;
let threads: CommentThread[] = [];
let markersVisible = true;

function toast(msg: string): void {
  document.dispatchEvent(new CustomEvent('mdverse:toast', { detail: msg }));
}

function activeTextarea(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>('[data-pane]:not([style*="none"]) [data-r="textarea"]');
}

function applyMarkers(): void {
  if (!overlay) return;
  overlay.setVisible(markersVisible);
  overlay.setThreads(markersVisible ? threads : []);
  overlay.refresh();
}

function mountAnchorOverlay(): void {
  const textarea = activeTextarea();
  if (!textarea) return;

  overlay = createAnchorOverlay(textarea, {
    onActivate(thread, anchor) {
      const ta = activeTextarea();
      if (ta) {
        ta.focus();
        ta.setSelectionRange(anchor.from, anchor.to);
      }
      panel?.open();
      setToggleState(true);
      panel?.focusThread(thread.root.id);
    },
  });
  applyMarkers();
}

function setToggleState(open: boolean): void {
  const btn = document.getElementById('comments-toggle-btn');
  if (btn) {
    btn.setAttribute('aria-pressed', String(open));
    btn.classList.toggle('on', open);
  }

  const editorPanes = document.getElementById('editor-panes');
  if (editorPanes) {
    editorPanes.style.transition = 'margin-right 0.22s cubic-bezier(.4,0,.2,1)';
    editorPanes.style.marginRight = open ? '360px' : '0';
  }
}

function updateBadge(threads: CommentThread[]): void {
  const badge = document.getElementById('comments-badge');
  if (!badge) return;
  const count = threads.length;
  badge.textContent = count > 0 ? String(count) : '';
  badge.classList.toggle('hidden', count === 0);
}

export function initComments(): void {
  const host = document.getElementById('comment-panel-host');
  if (!host) return;

  panel = createCommentPanel(host, {
    onHighlightAnchor(from, to) {
      const ta = activeTextarea();
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(from, to);
      const lineHeight = parseInt(getComputedStyle(ta).lineHeight) || 20;
      const linesBeforeAnchor = ta.value.slice(0, from).split('\n').length - 1;
      ta.scrollTop = Math.max(0, linesBeforeAnchor * lineHeight - ta.clientHeight / 2);
    },
  });

  document.addEventListener('mdverse:active-document', (e) => {
    const detail = (
      e as CustomEvent<{
        id: string;
        role: string;
        collaborative: boolean;
        signedIn?: boolean;
        userId?: string;
      }>
    ).detail;
    activeDocumentId = detail?.id ?? '';
    const role = detail?.role ?? 'reader';
    signedIn = detail?.signedIn !== false;
    canComment = signedIn && (role === 'owner' || role === 'editor' || role === 'admin');

    panel?.setDocument(activeDocumentId, canComment, signedIn, {
      userId: detail?.userId ?? '',
      role,
    });

    destroyBubble?.();
    const ta = activeTextarea();
    if (signedIn && ta && activeDocumentId) {
      destroyBubble = createSelectionBubble(ta, (anchor) => {
        if (!canComment) {
          toast('You need editor access to add comments');
          return;
        }
        panel?.open(anchor);
        setToggleState(true);
      });
    }

    overlay?.destroy();
    overlay = null;
    threads = [];
    mountAnchorOverlay();

    if (signedIn) panel?.refresh();
  });

  document.dispatchEvent(new CustomEvent('mdverse:request-active-document'));

  document.addEventListener('mdverse:comments-changed', (e) => {
    const detail = (e as CustomEvent<{ threads?: CommentThread[]; markersVisible?: boolean }>)
      .detail;
    threads = detail?.threads ?? [];
    if (typeof detail?.markersVisible === 'boolean') markersVisible = detail.markersVisible;
    updateBadge(threads);
    applyMarkers();
  });

  document.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-command="toggle-comments"]');
    if (!btn) return;

    if (panel?.isOpen) {
      panel.close();
      setToggleState(false);
    } else {
      if (!activeDocumentId) {
        toast('Open a document to view comments');
        return;
      }
      panel?.open();
      setToggleState(true);
    }
  });

  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const isMainTextarea = target.matches('[data-r="textarea"]');

    if (e.key === 'c' && isMainTextarea && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const ta = target as HTMLTextAreaElement;
      const { selectionStart, selectionEnd } = ta;
      if (selectionStart !== selectionEnd) {
        e.preventDefault();
        if (!signedIn) {
          toast('Sign in to comment');
          return;
        }
        if (!canComment) {
          toast('You need editor access to add comments');
          return;
        }
        const quote = ta.value.slice(selectionStart, selectionEnd).trim().slice(0, 200);
        panel?.open({ from: selectionStart, to: selectionEnd, quote });
        setToggleState(true);
      }
    }

    if (e.key === 'Escape' && panel?.isOpen) {
      panel.close();
      setToggleState(false);
    }
  });
}
