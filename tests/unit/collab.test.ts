import { describe, expect, it } from 'vitest';

import {
  caretBox,
  caretIsVisible,
  clampOffset,
  lineColumnAt,
  selectionBox,
  visualColumn,
} from '../../src/lib/collab/cursor';
import {
  CURSOR_TTL_MS,
  describePeers,
  PEER_COLORS,
  peerColor,
  peersFromState,
  toPeer,
} from '../../src/lib/collab/presence';

describe('peerColor', () => {
  it('is stable for one account and inside the palette for everybody', () => {
    expect(peerColor('user-1')).toBe(peerColor('user-1'));
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', '']) {
      expect(PEER_COLORS).toContain(peerColor(id));
    }
  });
});

describe('toPeer', () => {
  it('shapes a payload into something renderable', () => {
    const peer = toPeer({ userId: 'u1', name: 'Ana Pérez', at: 1_000 });
    expect(peer).toMatchObject({ id: 'u1', name: 'Ana Pérez', initials: 'AP', at: 1_000 });
    expect(peer?.color).toBe(peerColor('u1'));
  });

  it('falls back to a placeholder name, and rejects a payload without an account', () => {
    expect(toPeer({ userId: 'u1', name: '   ' })?.name).toBe('Guest');
    expect(toPeer({ userId: '', name: 'Ana' })).toBeNull();
    expect(toPeer(undefined as never)).toBeNull();
  });
});

describe('peersFromState', () => {
  const now = 1_000_000;

  it('folds the same account in two tabs into one peer, newest heartbeat wins', () => {
    const peers = peersFromState(
      {
        a: [{ userId: 'u1', name: 'Ana', at: now - 500 }],
        b: [{ userId: 'u1', name: 'Ana', at: now - 10 }],
      },
      now,
    );
    expect(peers).toHaveLength(1);
    expect(peers[0].at).toBe(now - 10);
  });

  it('drops a heartbeat older than the staleness window', () => {
    const peers = peersFromState(
      {
        a: [{ userId: 'u1', name: 'Ana', at: now - 60_000 }],
        b: [{ userId: 'u2', name: 'Luis', at: now }],
      },
      now,
    );
    expect(peers.map((peer) => peer.name)).toEqual(['Luis']);
  });

  it('sorts by name and survives a state that is missing or malformed', () => {
    const peers = peersFromState(
      {
        a: [{ userId: 'u1', name: 'Zoe', at: now }],
        b: [{ userId: 'u2', name: 'Ana', at: now }],
        c: 'nope' as never,
      },
      now,
    );
    expect(peers.map((peer) => peer.name)).toEqual(['Ana', 'Zoe']);
    expect(peersFromState(null, now)).toEqual([]);
    expect(peersFromState({}, now)).toEqual([]);
  });
});

describe('describePeers', () => {
  const peer = (id: string, name: string) => toPeer({ userId: id, name, at: 0 })!;

  it('counts the others, never the reader', () => {
    expect(describePeers([], 'me')).toBe('Only you here');
    expect(describePeers([peer('me', 'Me')], 'me')).toBe('Only you here');
    expect(describePeers([peer('me', 'Me'), peer('u1', 'Ana')], 'me')).toBe('You and Ana');
    expect(describePeers([peer('me', 'Me'), peer('u1', 'Ana'), peer('u2', 'Luis')], 'me')).toBe(
      'You, Ana and Luis',
    );
    expect(
      describePeers(
        [peer('me', 'Me'), peer('u1', 'Ana'), peer('u2', 'Luis'), peer('u3', 'Zoe')],
        'me',
      ),
    ).toBe('You, Ana and 2 more');
  });
});

describe('clampOffset and lineColumnAt', () => {
  const text = 'one\ntwo\nthree';

  it('keeps an offset inside the text', () => {
    expect(clampOffset(text, -5)).toBe(0);
    expect(clampOffset(text, 4.7)).toBe(4);
    expect(clampOffset(text, 999)).toBe(text.length);
    expect(clampOffset(text, Number.NaN)).toBe(0);
  });

  it('reports 1-based lines and 0-based columns', () => {
    expect(lineColumnAt(text, 0)).toEqual({ line: 1, column: 0 });
    expect(lineColumnAt(text, 4)).toEqual({ line: 2, column: 0 });
    expect(lineColumnAt(text, 6)).toEqual({ line: 2, column: 2 });
    expect(lineColumnAt(text, text.length)).toEqual({ line: 3, column: 5 });
  });
});

describe('visualColumn', () => {
  it('counts characters, except that a tab advances to the next stop', () => {
    expect(visualColumn('abcd', 2)).toBe(2);
    expect(visualColumn('\tab', 1)).toBe(4);
    expect(visualColumn('ab\tc', 3)).toBe(4);
    expect(visualColumn('abcdef\tx', 7)).toBe(8);
  });
});

describe('caretBox', () => {
  const geometry = {
    text: 'one\ntwo',
    offset: 5,
    charWidth: 8,
    lineHeight: 20,
    paddingX: 16,
    paddingY: 12,
    scrollTop: 0,
    scrollLeft: 0,
  };

  it('places a caret on its line and column', () => {
    expect(caretBox({ ...geometry, offset: 0 })).toEqual({ x: 16, y: 12 });
    expect(caretBox({ ...geometry, offset: 1 })).toEqual({ x: 24, y: 12 });
    expect(caretBox({ ...geometry, offset: 4 })).toEqual({ x: 16, y: 32 });
    expect(caretBox({ ...geometry, offset: 6 })).toEqual({ x: 32, y: 32 });
  });

  it('follows the scroll, so a caret does not float away from its text', () => {
    expect(caretBox({ ...geometry, offset: 6, scrollTop: 20, scrollLeft: 8 })).toEqual({
      x: 24,
      y: 12,
    });
  });

  it('aligns a caret after a tab with the visual grid', () => {
    const box = caretBox({ ...geometry, text: '\tx', offset: 1 });
    expect(box.x).toBe(16 + 4 * 8);
  });
});

describe('selectionBox', () => {
  const geometry = {
    text: 'hello world',
    offset: 0,
    to: 0,
    charWidth: 8,
    lineHeight: 20,
    paddingX: 16,
    paddingY: 12,
    scrollTop: 0,
    scrollLeft: 0,
  };

  it('spans a selection that stays on one line', () => {
    expect(selectionBox({ ...geometry, offset: 0, to: 5 })).toEqual({
      x: 16,
      y: 12,
      width: 40,
      height: 20,
    });
  });

  it('has nothing to draw for an empty selection', () => {
    expect(selectionBox({ ...geometry, offset: 3, to: 3 })).toBeNull();
  });

  it('leaves a multi-line selection to the browser', () => {
    expect(selectionBox({ ...geometry, text: 'a\nb', offset: 0, to: 3 })).toBeNull();
  });

  it('accepts a backwards selection', () => {
    expect(selectionBox({ ...geometry, offset: 5, to: 0 })?.width).toBe(40);
  });
});

describe('caretIsVisible', () => {
  const viewport = { width: 400, height: 300 };

  it('keeps carets inside the pane and drops the rest', () => {
    expect(caretIsVisible({ x: 20, y: 40 }, viewport, 20)).toBe(true);
    expect(caretIsVisible({ x: 20, y: -40 }, viewport, 20)).toBe(false);
    expect(caretIsVisible({ x: 20, y: 320 }, viewport, 20)).toBe(false);
    expect(caretIsVisible({ x: -40, y: 40 }, viewport, 20)).toBe(false);
    expect(caretIsVisible({ x: 900, y: 40 }, viewport, 20)).toBe(false);
  });
});

describe('cursor lifetime', () => {
  it('expires well before the presence window', () => {
    expect(CURSOR_TTL_MS).toBeGreaterThan(1_000);
    expect(CURSOR_TTL_MS).toBeLessThan(45_000);
  });
});
