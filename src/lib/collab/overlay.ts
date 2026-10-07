import { caretBox, caretIsVisible, selectionBox } from './cursor';
import type { Peer } from './presence';
import type { RemoteCursor } from './session';

export interface CursorOverlay {
  update(cursors: readonly RemoteCursor[], peers: readonly Peer[], text: string): void;
  destroy(): void;
}

interface Placement {
  readonly bar: HTMLElement;
  readonly flag: HTMLElement;
  readonly block: HTMLElement;
}

export function createCursorOverlay(
  host: HTMLElement,
  textarea: HTMLTextAreaElement,
): CursorOverlay {
  const layer = document.createElement('div');
  layer.className = 'collab-layer';
  layer.style.position = 'absolute';
  layer.style.inset = '0';
  layer.style.overflow = 'hidden';
  layer.style.pointerEvents = 'none';
  host.append(layer);

  const placements = new Map<string, Placement>();
  let lastCursors: readonly RemoteCursor[] = [];
  let lastPeers: readonly Peer[] = [];
  let lastText = '';

  function metrics(): {
    charWidth: number;
    lineHeight: number;
    paddingX: number;
    paddingY: number;
  } {
    const style = window.getComputedStyle(textarea);
    const fontSize = Number.parseFloat(style.fontSize) || 14;
    const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.625;

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    let charWidth = fontSize * 0.6;
    if (context) {
      context.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
      charWidth = context.measureText('M').width || charWidth;
    }

    return {
      charWidth,
      lineHeight,
      paddingX: Number.parseFloat(style.paddingLeft) || 0,
      paddingY: Number.parseFloat(style.paddingTop) || 0,
    };
  }

  function ensure(userId: string): Placement {
    const known = placements.get(userId);
    if (known) return known;

    const bar = document.createElement('span');
    const flag = document.createElement('span');
    const block = document.createElement('span');

    for (const element of [block, bar, flag]) {
      element.style.position = 'absolute';
      element.style.pointerEvents = 'none';
    }

    bar.style.width = '2px';
    bar.style.borderRadius = '1px';
    block.style.borderRadius = '2px';

    flag.className =
      'absolute rounded-t rounded-br px-1 text-[10px] font-medium leading-4 text-black whitespace-nowrap';
    flag.style.position = 'absolute';
    flag.style.transform = 'translateY(-100%)';
    flag.style.maxWidth = '12rem';
    flag.style.overflow = 'hidden';
    flag.style.textOverflow = 'ellipsis';

    layer.append(block, bar, flag);

    const placement = { bar, flag, block };
    placements.set(userId, placement);
    return placement;
  }

  function paint(): void {
    const pane = currentPaneSize();
    const geometry = metrics();

    const seen = new Set<string>();
    for (const cursor of lastCursors) {
      const peer = lastPeers.find((entry) => entry.id === cursor.userId);
      if (!peer) continue;

      const box = caretBox({
        text: lastText,
        offset: cursor.from,
        charWidth: geometry.charWidth,
        lineHeight: geometry.lineHeight,
        paddingX: geometry.paddingX,
        paddingY: geometry.paddingY,
        scrollTop: textarea.scrollTop,
        scrollLeft: textarea.scrollLeft,
      });

      const placement = ensure(peer.id);
      seen.add(peer.id);

      const visible = caretIsVisible(box, pane, geometry.lineHeight);
      placement.bar.style.display = visible ? 'block' : 'none';
      placement.flag.style.display = visible ? 'block' : 'none';
      placement.block.style.display = 'none';

      if (!visible) continue;

      placement.bar.style.background = peer.color;
      placement.bar.style.left = `${box.x}px`;
      placement.bar.style.top = `${box.y}px`;
      placement.bar.style.height = `${geometry.lineHeight}px`;

      placement.flag.style.background = peer.color;
      placement.flag.style.color = '#000';
      placement.flag.style.left = `${Math.max(0, box.x)}px`;
      placement.flag.style.top = `${box.y}px`;
      placement.flag.textContent = peer.name;

      const selection = selectionBox({
        text: lastText,
        offset: cursor.from,
        to: cursor.to,
        charWidth: geometry.charWidth,
        lineHeight: geometry.lineHeight,
        paddingX: geometry.paddingX,
        paddingY: geometry.paddingY,
        scrollTop: textarea.scrollTop,
        scrollLeft: textarea.scrollLeft,
      });

      if (selection) {
        placement.block.style.display = 'block';
        placement.block.style.background = peer.color;
        placement.block.style.opacity = '0.22';
        placement.block.style.left = `${selection.x}px`;
        placement.block.style.top = `${selection.y}px`;
        placement.block.style.width = `${selection.width}px`;
        placement.block.style.height = `${selection.height}px`;
      }
    }

    for (const [userId, placement] of placements) {
      if (seen.has(userId)) continue;
      placement.bar.remove();
      placement.flag.remove();
      placement.block.remove();
      placements.delete(userId);
    }
  }

  function currentPaneSize(): { width: number; height: number } {
    return { width: textarea.clientWidth, height: textarea.clientHeight };
  }

  const onScroll = (): void => paint();
  textarea.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);

  return {
    update(cursors, peers, text): void {
      lastCursors = cursors;
      lastPeers = peers;
      lastText = text;
      paint();
    },

    destroy(): void {
      textarea.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      layer.remove();
      placements.clear();
    },
  };
}
