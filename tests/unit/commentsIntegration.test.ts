/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initComments } from '../../src/lib/app/commentsIntegration';

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** The editor announces the tab it just opened; the panel follows that event. */
function announce(detail: { id: string; role: string; signedIn: boolean; userId?: string }): void {
  document.dispatchEvent(new CustomEvent('mdverse:active-document', { detail }));
}

const ANCHORED_COMMENT = {
  id: 'c1',
  documentId: 'doc-1',
  authorId: 'user-1',
  authorName: 'Daniel Noboa',
  authorInitials: 'DN',
  authorColor: '#2563eb',
  parentId: null,
  body: 'Revisa esto',
  anchor: { from: 0, to: 4, quote: 'hola' },
  resolved: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/** jsdom has no layout to measure against. */
function stubRangeRects(): void {
  const proto = Range.prototype as unknown as { getClientRects?: () => DOMRectList };
  if (typeof proto.getClientRects !== 'function')
    proto.getClientRects = () => [] as unknown as DOMRectList;
  vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([
    { x: 20, y: 40, top: 40, left: 20, width: 40, height: 18, right: 60, bottom: 58 } as DOMRect,
  ] as unknown as DOMRectList);
}

async function settle(): Promise<void> {
  for (let index = 0; index < 4; index++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('comments integration and the account state', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('never touches the comments API for a visitor without an account', async () => {
    const fetchSpy = vi.fn(async () => json([]));
    vi.stubGlobal('fetch', fetchSpy);

    document.body.innerHTML = '<div id="comment-panel-host"></div>';
    initComments();
    announce({ id: 'doc-1', role: 'owner', signedIn: false });
    await settle();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads comments and mention candidates once there is an account', async () => {
    const fetchSpy = vi.fn(async () => json([]));
    vi.stubGlobal('fetch', fetchSpy);

    document.body.innerHTML = '<div id="comment-panel-host"></div>';
    initComments();
    announce({ id: 'doc-1', role: 'owner', signedIn: true });
    await settle();

    const urls = fetchSpy.mock.calls.map((args: unknown[]) => String(args[0]));
    expect(urls.some((url) => url.includes('/api/comments?documentId=doc-1'))).toBe(true);
    expect(urls.some((url) => url.includes('/api/documents/doc-1/mentions'))).toBe(true);
  });

  it('puts the marks on the editor as soon as the panel reports the comments', async () => {
    stubRangeRects();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/mentions')) return json({ people: [] });
        return json([ANCHORED_COMMENT]);
      }),
    );

    document.body.innerHTML =
      '<div id="comment-panel-host"></div>' +
      '<section data-pane><div class="code-pane"><textarea data-r="textarea"></textarea></div></section>';
    (document.querySelector('textarea') as HTMLTextAreaElement).value = 'hola mundo';

    initComments();
    announce({ id: 'doc-1', role: 'owner', signedIn: true, userId: 'user-1' });
    await settle();

    // No frame is needed: the marks land with the data, not with the next paint.
    const pane = document.querySelector('.code-pane') as HTMLElement;
    expect(pane.classList.contains('has-comment-rail')).toBe(true);
    expect(pane.querySelector('button[data-thread-id="c1"]')).not.toBeNull();
  });
});
