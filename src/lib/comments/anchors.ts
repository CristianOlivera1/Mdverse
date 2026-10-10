import { timeAgo } from './api';
import type { CommentAnchor, CommentThread } from './api';
import { renderAuraAvatar } from './panel';

const MARKER_SIZE = 26;
export const RAIL_WIDTH = 44;
const GUTTER_CLASS = 'has-comment-rail';
const MARKER_CAP = 200;
const POPOVER_WIDTH = 268;

const BLOB_SVG =
  '<svg viewBox="0 0 370 369" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false">' +
  '<path d="M336.829 90.6699C356.082 122.875 364.936 157.255 362.855 194.225C358.22 276.563 298.283 343.056 220.668 358.484C207.592 361.083 194.363 362.162 181.032 362.119C128.739 361.95 76.4461 361.819 24.153 361.646C6.95614 361.59 7.14767 361.548 6.70977 344.784C5.37387 293.645 6.39082 242.499 6.08794 191.358C5.77706 138.872 22.9782 93.2112 60.6347 56.2093C90.8204 26.5486 127.302 9.45137 169.695 6.53883C241.635 1.59646 296.796 30.7336 336.829 90.6699Z" fill="black" stroke-width="12" stroke="#D2D2D2"/>' +
  '</svg>';

const raf: (callback: FrameRequestCallback) => number =
  typeof requestAnimationFrame === 'function'
    ? (callback) => window.requestAnimationFrame(callback)
    : (callback) => window.setTimeout(() => callback(Date.now()), 16);
const caf: (handle: number) => void =
  typeof cancelAnimationFrame === 'function'
    ? (handle) => window.cancelAnimationFrame(handle)
    : (handle) => window.clearTimeout(handle);

const MIRROR_PROPS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontStretch',
  'letterSpacing',
  'wordSpacing',
  'textIndent',
  'textTransform',
  'lineHeight',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'boxSizing',
  'tabSize',
  'whiteSpace',
  'overflowWrap',
  'wordBreak',
] as const;

export interface MarkerBox {
  readonly thread: CommentThread;
  readonly y: number;
  readonly rects: ReadonlyArray<{ x: number; y: number; w: number; h: number }>;
}

export interface AnchorOverlayOptions {
  readonly onActivate: (thread: CommentThread, anchor: CommentAnchor) => void;
}

export interface AnchorOverlay {
  setThreads(threads: readonly CommentThread[]): void;
  setVisible(visible: boolean): void;
  refresh(): void;
  destroy(): void;
}

export function resolveAnchor(
  anchor: CommentAnchor | null | undefined,
  length: number,
): { from: number; to: number } | null {
  if (!anchor) return null;
  const from = Math.min(Math.max(Math.trunc(anchor.from), 0), length);
  const to = Math.min(Math.max(Math.trunc(anchor.to), 0), length);
  if (to <= from) return null;
  return { from, to };
}

export function stackTops(centres: readonly number[], step: number): number[] {
  const tops: number[] = [];
  let lowest = Number.NEGATIVE_INFINITY;
  for (const centre of centres) {
    const top = centre < lowest ? lowest : centre;
    tops.push(top);
    lowest = top + step;
  }
  return tops;
}

export function createAnchorOverlay(
  textarea: HTMLTextAreaElement,
  opts: AnchorOverlayOptions,
): AnchorOverlay | null {
  const closestPane = textarea.closest<HTMLElement>('.code-pane');
  if (!closestPane) return null;
  const pane: HTMLElement = closestPane;

  let threads: readonly CommentThread[] = [];
  let visible = true;
  let frame = 0;
  let destroyed = false;
  let cacheKey = '';
  let cacheBoxes: MarkerBox[] = [];
  let hideTimer: number | undefined;

  const markers = new Map<string, HTMLElement>();

  const underlineLayer = document.createElement('div');
  underlineLayer.className = 'absolute inset-0 overflow-hidden pointer-events-none';
  underlineLayer.dataset.r = 'comment-underline-layer';
  underlineLayer.style.zIndex = '6';

  const rail = document.createElement('div');
  rail.className = 'absolute top-0 right-0 bottom-0 overflow-hidden pointer-events-none';
  rail.dataset.r = 'comment-rail';
  rail.style.width = `${RAIL_WIDTH}px`;
  rail.style.zIndex = '7';

  const popover = document.createElement('div');
  popover.className =
    'fixed z-50 rounded-xl border border-[#1f1f1f] bg-[#101010] p-3 shadow-[0_16px_40px_#000c]';
  popover.dataset.r = 'comment-popover';
  popover.style.width = `${POPOVER_WIDTH}px`;
  popover.style.pointerEvents = 'auto';
  popover.hidden = true;

  pane.append(underlineLayer, rail);
  document.body.append(popover);

  function anchoredThreads(): CommentThread[] {
    return threads
      .filter((thread) => thread.root.anchor && !thread.root.resolved)
      .slice(0, MARKER_CAP);
  }

  function buildMirror(): HTMLDivElement {
    const style = getComputedStyle(textarea);
    const rect = textarea.getBoundingClientRect();
    const mirror = document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    mirror.style.position = 'fixed';
    mirror.style.top = `${rect.top}px`;
    mirror.style.left = `${rect.left}px`;
    mirror.style.width = `${rect.width}px`;
    mirror.style.height = `${rect.height}px`;
    mirror.style.visibility = 'hidden';
    mirror.style.pointerEvents = 'none';
    mirror.style.overflow = 'hidden';
    mirror.style.zIndex = '-9999';
    for (const prop of MIRROR_PROPS) mirror.style[prop] = style[prop];
    mirror.append(document.createTextNode(textarea.value));
    return mirror;
  }

  function measure(list: readonly CommentThread[]): MarkerBox[] {
    const rect = textarea.getBoundingClientRect();
    const key = [
      textarea.value.length,
      textarea.scrollTop,
      textarea.scrollLeft,
      Math.round(rect.width),
      Math.round(rect.height),
      list
        .map((thread) => `${thread.root.id}:${thread.root.anchor?.from}:${thread.root.anchor?.to}`)
        .join('|'),
    ].join(':');
    if (key === cacheKey) return cacheBoxes;

    const paneRect = pane.getBoundingClientRect();
    const mirror = buildMirror();
    document.body.append(mirror);
    mirror.scrollTop = textarea.scrollTop;
    mirror.scrollLeft = textarea.scrollLeft;

    const node = mirror.firstChild;
    const boxes: MarkerBox[] = [];
    try {
      if (node && node.nodeType === Node.TEXT_NODE) {
        const range = document.createRange();
        for (const thread of list) {
          const span = resolveAnchor(thread.root.anchor, textarea.value.length);
          if (!span) continue;
          range.setStart(node, span.from);
          range.setEnd(node, span.to);
          const rects: Array<{ x: number; y: number; w: number; h: number }> = [];
          for (const box of range.getClientRects()) {
            if (box.height <= 0 || box.width <= 0) continue;
            rects.push({
              x: box.left - paneRect.left,
              y: box.top - paneRect.top,
              w: box.width,
              h: box.height,
            });
          }
          const first = rects[0];
          if (!first) continue;
          boxes.push({ thread, y: first.y + first.h / 2, rects });
        }
      }
    } catch {
      //
    } finally {
      mirror.remove();
    }

    cacheKey = key;
    cacheBoxes = boxes;
    return boxes;
  }

  function buildUnderline(
    rect: { x: number; y: number; w: number; h: number },
    color: string,
  ): HTMLElement {
    const box = document.createElement('div');
    box.className = 'absolute rounded-[2px]';
    box.style.left = `${Math.round(rect.x)}px`;
    box.style.top = `${Math.round(rect.y)}px`;
    box.style.width = `${Math.round(rect.w)}px`;
    box.style.height = `${Math.round(rect.h)}px`;
    box.style.borderBottom = `2px solid ${color}`;
    box.style.background = 'rgba(255,255,255,.05)';
    box.style.opacity = '.8';
    return box;
  }

  function buildMarker(thread: CommentThread): HTMLElement {
    const root = thread.root;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.threadId = root.id;
    button.className = 'absolute flex items-center justify-center';
    button.style.width = `${MARKER_SIZE}px`;
    button.style.height = `${MARKER_SIZE}px`;
    button.style.right = '10px';
    button.style.padding = '0';
    button.style.border = '0';
    button.style.background = 'transparent';
    button.style.cursor = 'pointer';
    button.style.pointerEvents = 'auto';
    button.title = `${root.authorName}: ${root.body.slice(0, 90)}`;
    button.setAttribute('aria-label', `Comment on this selection by ${root.authorName}`);

    const blob = document.createElement('span');
    blob.className = 'absolute inset-0';
    blob.setAttribute('aria-hidden', 'true');
    blob.innerHTML = BLOB_SVG;

    const avatar = renderAuraAvatar(
      root.authorId,
      root.authorName,
      'relative h-[17px] w-[17px] shrink-0 select-none overflow-hidden rounded-full ring-1 ring-white/15',
    );

    button.append(blob, avatar);

    button.addEventListener('mouseenter', () => showPopover(button, thread));
    button.addEventListener('mouseleave', scheduleHidePopover);
    button.addEventListener('focus', () => showPopover(button, thread));
    button.addEventListener('blur', scheduleHidePopover);
    button.addEventListener('click', () => {
      if (root.anchor) opts.onActivate(thread, root.anchor);
    });

    return button;
  }

  function showPopover(button: HTMLElement, thread: CommentThread): void {
    window.clearTimeout(hideTimer);
    const root = thread.root;
    popover.replaceChildren();

    const head = document.createElement('div');
    head.className = 'flex items-center gap-2';
    head.append(
      renderAuraAvatar(
        root.authorId,
        root.authorName,
        'relative h-6 w-6 shrink-0 select-none overflow-hidden rounded-full ring-1 ring-white/10',
      ),
    );

    const meta = document.createElement('div');
    meta.className = 'min-w-0 flex-1';
    const name = document.createElement('div');
    name.className = 'truncate text-[12px] font-medium text-neutral-200';
    name.textContent = root.authorName;
    const when = document.createElement('div');
    when.className = 'text-[11px] text-neutral-600';
    when.textContent = `${timeAgo(root.createdAt)}${root.edited ? ' · edited' : ''}`;
    meta.append(name, when);
    head.append(meta);

    const body = document.createElement('p');
    body.className =
      'mt-2 max-h-24 overflow-hidden whitespace-pre-wrap break-words text-[12px] leading-relaxed text-neutral-400';
    body.textContent = root.body.length > 220 ? `${root.body.slice(0, 220)}…` : root.body;

    const footer = document.createElement('div');
    footer.className = 'mt-2 text-[11px] text-neutral-600';
    const replies =
      thread.replies.length === 0
        ? ''
        : thread.replies.length === 1
          ? '1 reply · '
          : `${thread.replies.length} replies · `;
    footer.textContent = `${replies}Click to open the thread`;

    popover.append(head, body, footer);
    popover.hidden = false;

    const rect = button.getBoundingClientRect();
    const width = popover.offsetWidth || POPOVER_WIDTH;
    const height = popover.offsetHeight;
    let left = rect.left - width - 10;
    if (left < 8) left = Math.min(rect.right + 10, window.innerWidth - width - 8);
    let top = rect.top + rect.height / 2 - height / 2;
    top = Math.min(Math.max(top, 8), Math.max(8, window.innerHeight - height - 8));
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function scheduleHidePopover(): void {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      popover.hidden = true;
    }, 140);
  }

  function hidePopover(): void {
    window.clearTimeout(hideTimer);
    popover.hidden = true;
  }

  function paint(): void {
    frame = 0;
    if (destroyed) return;

    const list = visible ? anchoredThreads() : [];
    pane.classList.toggle(GUTTER_CLASS, list.length > 0);

    if (list.length === 0) {
      underlineLayer.replaceChildren();
      rail.replaceChildren();
      markers.clear();
      hidePopover();
      cacheKey = '';
      cacheBoxes = [];
      return;
    }

    const boxes = [...measure(list)].sort((a, b) => a.y - b.y);
    const maxTop = Math.max(0, pane.clientHeight - MARKER_SIZE - 2);
    const tops = stackTops(
      boxes.map((box) => box.y - MARKER_SIZE / 2),
      MARKER_SIZE + 2,
    );

    const alive = new Set(boxes.map((box) => box.thread.root.id));
    for (const [id, node] of markers) {
      if (alive.has(id)) continue;
      node.remove();
      markers.delete(id);
    }

    underlineLayer.replaceChildren();
    boxes.forEach((box, index) => {
      const root = box.thread.root;
      let node = markers.get(root.id);
      if (!node) {
        node = buildMarker(box.thread);
        markers.set(root.id, node);
        rail.append(node);
      }
      node.style.top = `${Math.round(Math.min(Math.max(tops[index] ?? 0, 0), maxTop))}px`;
      for (const rect of box.rects) {
        underlineLayer.append(buildUnderline(rect, root.authorColor));
      }
    });
  }

  function schedule(): void {
    if (frame || destroyed) return;
    frame = raf(paint);
  }

  function repaintNow(): void {
    if (destroyed) return;
    frame = 0;
    cacheKey = '';
    paint();
  }

  const onScroll = (): void => {
    hidePopover();
    schedule();
  };
  const onLayout = (): void => schedule();
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') repaintNow();
  };

  textarea.addEventListener('scroll', onScroll, { passive: true });
  textarea.addEventListener('input', onLayout);
  window.addEventListener('resize', onLayout);
  document.addEventListener('visibilitychange', onVisibility);
  popover.addEventListener('mouseenter', () => window.clearTimeout(hideTimer));
  popover.addEventListener('mouseleave', scheduleHidePopover);

  const resizeObserver =
    typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule()) : null;
  resizeObserver?.observe(textarea);

  const layoutObserver =
    typeof MutationObserver === 'function' ? new MutationObserver(() => schedule()) : null;
  if (layoutObserver) {
    layoutObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
    layoutObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['style', 'data-panel'],
    });
  }

  return {
    setThreads(next) {
      threads = next;
      schedule();
    },

    setVisible(next) {
      if (next === visible) return;
      visible = next;
      hidePopover();
      schedule();
    },

    refresh() {
      repaintNow();
    },

    destroy() {
      destroyed = true;
      window.clearTimeout(hideTimer);
      if (frame) caf(frame);
      textarea.removeEventListener('scroll', onScroll);
      textarea.removeEventListener('input', onLayout);
      window.removeEventListener('resize', onLayout);
      document.removeEventListener('visibilitychange', onVisibility);
      resizeObserver?.disconnect();
      layoutObserver?.disconnect();
      pane.classList.remove(GUTTER_CLASS);
      markers.clear();
      underlineLayer.remove();
      rail.remove();
      popover.remove();
    },
  };
}
