// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAnchorOverlay, resolveAnchor, stackTops } from '../../src/lib/comments/anchors';
import type { CommentThread } from '../../src/lib/comments/api';

describe('anchors keep to the text that is actually there', () => {
  it('clamps a range to the current document length', () => {
    expect(resolveAnchor({ from: 10, to: 20, quote: 'x' }, 100)).toEqual({ from: 10, to: 20 });
    expect(resolveAnchor({ from: 90, to: 999, quote: 'x' }, 100)).toEqual({ from: 90, to: 100 });
  });

  it('ignores an anchor with nothing left to point at', () => {
    expect(resolveAnchor(null, 100)).toBeNull();
    expect(resolveAnchor({ from: 10, to: 10, quote: '' }, 100)).toBeNull();
    // The document shrank past the comment: it has no range any more.
    expect(resolveAnchor({ from: 200, to: 240, quote: 'x' }, 100)).toBeNull();
  });

  it('truncates fractional offsets, which a textarea cannot use', () => {
    expect(resolveAnchor({ from: 3.7, to: 9.2, quote: 'x' }, 100)).toEqual({ from: 3, to: 9 });
  });
});

describe('marker stacking', () => {
  it('leaves markers alone while their lines stay apart', () => {
    expect(stackTops([10, 60, 120], 28)).toEqual([10, 60, 120]);
  });

  it('pushes a crowded marker just below the one above it', () => {
    expect(stackTops([10, 12, 30, 30], 28)).toEqual([10, 38, 66, 94]);
  });
});

const THREAD: CommentThread = {
  root: {
    id: 'c1',
    documentId: 'doc-1',
    authorId: 'user-1',
    authorName: 'Daniel Noboa',
    authorInitials: 'DN',
    authorColor: '#2563eb',
    parentId: null,
    body: 'Revisa esto',
    anchor: { from: 9, to: 35, quote: 'A paragraph worth commenting on.' },
    resolved: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  replies: [],
};

function fakeRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

/** jsdom has no layout, so the range is told where it landed. */
function stubRangeRects(...rects: DOMRect[]): void {
  const proto = Range.prototype as unknown as { getClientRects?: () => DOMRectList };
  if (typeof proto.getClientRects !== 'function')
    proto.getClientRects = () => [] as unknown as DOMRectList;
  vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue(rects as unknown as DOMRectList);
}

function mountEditor(): { pane: HTMLElement; textarea: HTMLTextAreaElement } {
  document.body.innerHTML =
    '<section data-pane><div class="code-pane"><textarea data-r="textarea"></textarea></div></section>';
  const pane = document.querySelector('.code-pane') as HTMLElement;
  const textarea = pane.querySelector('textarea') as HTMLTextAreaElement;
  textarea.value = '# Title\n\nA paragraph worth commenting on.\n';
  return { pane, textarea };
}

describe('the comment rail in the editor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('marks the anchored line with the author on a blob, and underlines the range', () => {
    const { pane, textarea } = mountEditor();
    stubRangeRects(fakeRect(20, 40, 120, 18));

    const activated: string[] = [];
    const overlay = createAnchorOverlay(textarea, {
      onActivate: (thread) => activated.push(thread.root.id),
    });
    expect(overlay).not.toBeNull();

    overlay?.setThreads([THREAD]);
    overlay?.refresh();

    expect(pane.classList.contains('has-comment-rail')).toBe(true);
    const marker = pane.querySelector<HTMLButtonElement>('button[data-thread-id="c1"]');
    expect(marker).not.toBeNull();
    expect(marker?.textContent).toContain('DN');

    const underlineLayer = pane.querySelector('[data-r="comment-underline-layer"]');
    expect(underlineLayer?.childElementCount).toBe(1);
    // The browser normalises the author colour to its rgb() form.
    expect((underlineLayer?.firstElementChild as HTMLElement).style.borderBottom).toBe(
      '2px solid rgb(37, 99, 235)',
    );

    marker?.click();
    expect(activated).toEqual(['c1']);

    overlay?.destroy();
    expect(pane.querySelector('button[data-thread-id="c1"]')).toBeNull();
    expect(pane.classList.contains('has-comment-rail')).toBe(false);
  });

  it('drops every mark when the switch is off and brings them back when it is on', () => {
    const { pane, textarea } = mountEditor();
    stubRangeRects(fakeRect(20, 40, 120, 18));

    const overlay = createAnchorOverlay(textarea, { onActivate: () => {} });
    overlay?.setThreads([THREAD]);
    overlay?.refresh();
    expect(pane.querySelector('button[data-thread-id="c1"]')).not.toBeNull();

    overlay?.setVisible(false);
    overlay?.refresh();
    expect(pane.querySelector('button[data-thread-id="c1"]')).toBeNull();
    expect(pane.classList.contains('has-comment-rail')).toBe(false);

    overlay?.setVisible(true);
    overlay?.refresh();
    expect(pane.querySelector('button[data-thread-id="c1"]')).not.toBeNull();
  });

  it('shows the comment itself on hover', () => {
    const { textarea } = mountEditor();
    stubRangeRects(fakeRect(20, 40, 120, 18));

    const overlay = createAnchorOverlay(textarea, { onActivate: () => {} });
    overlay?.setThreads([THREAD]);
    overlay?.refresh();

    const popover = document.querySelector<HTMLElement>('[data-r="comment-popover"]');
    expect(popover?.hidden).toBe(true);

    const marker = document.querySelector<HTMLButtonElement>('button[data-thread-id="c1"]');
    marker?.dispatchEvent(new MouseEvent('mouseenter'));

    expect(popover?.hidden).toBe(false);
    expect(popover?.textContent).toContain('Revisa esto');
    expect(popover?.textContent).toContain('Daniel Noboa');
  });

  it('leaves a comment with no anchor out of the rail', () => {
    const { pane, textarea } = mountEditor();
    stubRangeRects(fakeRect(20, 40, 120, 18));

    const overlay = createAnchorOverlay(textarea, { onActivate: () => {} });
    overlay?.setThreads([{ root: { ...THREAD.root, anchor: null }, replies: [] }]);
    overlay?.refresh();

    expect(pane.querySelector('button[data-thread-id]')).toBeNull();
    expect(pane.classList.contains('has-comment-rail')).toBe(false);
  });

  it('paints when the tab comes back even if the queued frame never ran', () => {
    const { pane, textarea } = mountEditor();
    stubRangeRects(fakeRect(20, 40, 120, 18));

    // A hidden tab drops the queued frame; the handle must not block the next paint.
    const pending = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(7);
    const overlay = createAnchorOverlay(textarea, { onActivate: () => {} });
    overlay?.setThreads([THREAD]);
    expect(pane.querySelector('button[data-thread-id="c1"]')).toBeNull();

    document.dispatchEvent(new Event('visibilitychange'));
    pending.mockRestore();

    expect(pane.querySelector('button[data-thread-id="c1"]')).not.toBeNull();
    expect(pane.classList.contains('has-comment-rail')).toBe(true);
  });

  it('does not attach itself to a textarea that is not in a code pane', () => {
    document.body.innerHTML = '<textarea data-r="textarea"></textarea>';
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(createAnchorOverlay(textarea, { onActivate: () => {} })).toBeNull();
  });
});
