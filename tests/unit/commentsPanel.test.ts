// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCommentPanel } from '../../src/lib/comments/panel';

const DOCUMENT_ID = 'doc-1';

const serverComment = {
  id: 'server-comment-1',
  documentId: DOCUMENT_ID,
  authorId: 'user-1',
  authorName: 'Daniel noboa',
  authorInitials: 'DN',
  authorColor: '#2563eb',
  parentId: null,
  body: 'prueba',
  anchor: null,
  resolved: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Lets the panel's promise chain (load → submit → render) settle. */
async function flush(): Promise<void> {
  for (let index = 0; index < 4; index++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function mount(): { host: HTMLElement; panel: ReturnType<typeof createCommentPanel> } {
  const host = document.createElement('div');
  document.body.append(host);
  const panel = createCommentPanel(host);
  panel.setDocument(DOCUMENT_ID, true);
  panel.open();
  return { host, panel };
}

async function typeAndSubmit(host: HTMLElement, text: string): Promise<void> {
  const form = host.querySelector('form') as HTMLFormElement;
  const textarea = form.querySelector('textarea') as HTMLTextAreaElement;
  textarea.value = text;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
}

describe('comment panel optimistic root', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('shows the posted comment once, under the real author, with no "sending…" left', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/mentions')) return json({ people: [] });
        if (init?.method === 'POST') return json(serverComment, 201);
        return json([]);
      }),
    );

    const { host } = mount();
    await flush();
    await typeAndSubmit(host, 'prueba');

    // Thread wrappers are divs; the reply input also carries data-root-id.
    const roots = host.querySelectorAll('div[data-root-id]');
    expect(roots).toHaveLength(1);
    expect(roots[0].getAttribute('data-root-id')).toBe(serverComment.id);
    expect(host.textContent).toContain('Daniel noboa');
    expect(host.textContent).not.toContain('sending');
  });

  it('asks the API nothing and offers a way in when the visitor has no account', async () => {
    const fetchSpy = vi.fn(async () => json([]));
    vi.stubGlobal('fetch', fetchSpy);

    const host = document.createElement('div');
    document.body.append(host);
    const panel = createCommentPanel(host);
    panel.setDocument(DOCUMENT_ID, false, false);
    panel.open();
    await flush();

    // This is the regression: a signed-out editor used to fire
    // `GET /api/comments` and `/mentions` for every document and log a 401 each.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Comments need an account');
    expect(host.querySelector('a[href^="/login"]')).not.toBeNull();
    // Nothing this visitor could post, so the composer is not offered either.
    expect((host.querySelector('form') as HTMLFormElement).hidden).toBe(true);
  });

  it('marks the comment failed and re-enables the button when the request throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/mentions')) return json({ people: [] });
        if (init?.method === 'POST') throw new Error('offline');
        return json([]);
      }),
    );

    const { host } = mount();
    await flush();
    await typeAndSubmit(host, 'prueba');

    expect(host.textContent).toContain('Could not send.');
    expect(host.textContent).not.toContain('sending');
    const submit = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
  });
});
