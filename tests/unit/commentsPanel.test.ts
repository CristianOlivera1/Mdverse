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

const OTHER_COMMENT = { ...serverComment, authorId: 'user-2', authorName: 'Ana Torres' };

/** jsdom has no `showModal`, and the dialog is only opened to be clicked. */
function stubDialog(): void {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal?: () => void;
    close?: () => void;
  };
  if (typeof proto.showModal !== 'function') proto.showModal = () => {};
  if (typeof proto.close !== 'function') proto.close = () => {};
}

function mountFor(viewer: { userId: string; role: string }): {
  host: HTMLElement;
  panel: ReturnType<typeof createCommentPanel>;
} {
  const host = document.createElement('div');
  document.body.append(host);
  const panel = createCommentPanel(host);
  panel.setDocument(DOCUMENT_ID, true, true, viewer);
  panel.open();
  return { host, panel };
}

function buttonByTitle(host: HTMLElement, title: string): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
}

function serverFor(comment: typeof serverComment): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/mentions')) return json({ people: [] });
      if (init?.method === 'PATCH') return json({ ...comment, body: 'editado', edited: true });
      if (init?.method === 'DELETE') return json({ ok: true });
      return json([comment]);
    }),
  );
}

describe('comment panel optimistic root', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
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

describe('comment panel edit and delete', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.replaceChildren();
  });

  it('rewrites your own comment and reports it as edited', async () => {
    serverFor(serverComment);
    const { host } = mountFor({ userId: 'user-1', role: 'editor' });
    await flush();

    const edit = buttonByTitle(host, 'Edit comment');
    expect(edit).not.toBeNull();
    edit?.click();

    const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit comment"]');
    expect(input?.value).toBe('prueba');
    if (!input) return;
    input.value = 'editado';

    const save = [...host.querySelectorAll('button')].find((btn) => btn.textContent === 'Save');
    save?.click();
    await flush();

    expect(host.textContent).toContain('editado');
    expect(host.textContent).toContain('edited');
    expect(host.querySelector('textarea[aria-label="Edit comment"]')).toBeNull();

    const patched = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(String(patched?.[0])).toBe('/api/comments/server-comment-1');
    expect(JSON.parse(String((patched?.[1] as RequestInit).body))).toEqual({ body: 'editado' });
  });

  it('offers nobody else an edit, and only the manager a delete', async () => {
    serverFor(OTHER_COMMENT);
    const { host } = mountFor({ userId: 'user-1', role: 'editor' });
    await flush();

    // An editor may resolve and reply, but not rewrite or remove somebody's words.
    expect(buttonByTitle(host, 'Edit comment')).toBeNull();
    expect(buttonByTitle(host, 'Delete comment')).toBeNull();
  });

  it('deletes a comment the author asks to delete, once the dialog confirms', async () => {
    stubDialog();
    serverFor(serverComment);
    const { host } = mountFor({ userId: 'user-1', role: 'reader' });
    await flush();

    buttonByTitle(host, 'Delete comment')?.click();
    await flush();

    const confirm = document.querySelector<HTMLButtonElement>('dialog [data-cf="confirm"]');
    expect(confirm?.textContent).toBe('Delete');
    confirm?.click();
    await flush();

    expect(host.querySelectorAll('div[data-root-id]')).toHaveLength(0);
    expect(host.textContent).toContain('No comments yet');

    const deleted = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => (call[1] as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(String(deleted?.[0])).toBe('/api/comments/server-comment-1');
  });
});

describe('comment panel mark switch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.replaceChildren();
  });

  it('reports the marks as visible until the switch is turned off, then remembers it', async () => {
    serverFor(serverComment);
    const seen: Array<{ markersVisible?: boolean }> = [];
    document.addEventListener('mdverse:comments-changed', (event) => {
      seen.push((event as CustomEvent<{ markersVisible?: boolean }>).detail);
    });

    const { host } = mountFor({ userId: 'user-1', role: 'editor' });
    await flush();

    expect(seen.at(-1)?.markersVisible).toBe(true);

    const toggle = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Hide marks in the editor"]',
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    toggle?.click();

    expect(seen.at(-1)?.markersVisible).toBe(false);
    expect(localStorage.getItem('mdverse:comment-marks')).toBe('0');
    expect(
      host
        .querySelector('button[aria-label="Show marks in the editor"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('false');
  });
});
