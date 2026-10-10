/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initComments } from '../../src/lib/app/commentsIntegration';

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** The editor announces the tab it just opened; the panel follows that event. */
function announce(detail: { id: string; role: string; signedIn: boolean }): void {
  document.dispatchEvent(new CustomEvent('mdverse:active-document', { detail }));
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
});
