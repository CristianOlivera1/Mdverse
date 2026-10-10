// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initCollaborateDialog } from '../../src/lib/app/collaborateDialog';

const DOCUMENT_ID = '11111111-2222-3333-4444-555555555555';

const SLOTS = [
  'subtitle',
  'notice',
  'skeleton',
  'unavailable',
  'readonly',
  'manage',
  'role-line',
  'people',
  'people-count',
  'people-empty',
  'invitations-block',
  'invitations',
  'requests-block',
  'requests',
  'requests-count',
  'document-url',
  'link-options',
];

const collaboration = {
  document: {
    id: DOCUMENT_ID,
    title: 'Roadmap',
    visibility: 'private',
    role: 'owner',
    canManage: true,
  },
  people: [],
  invitations: [],
  links: [],
  requests: [
    {
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      requesterId: 'user-2',
      name: 'Maria',
      username: 'maria',
      message: 'I am the new contractor.',
      createdAt: '2026-10-08T10:00:00.000Z',
    },
  ],
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function mount(): void {
  const slots = SLOTS.map((slot) =>
    slot === 'document-url'
      ? `<input data-collab="${slot}" />`
      : `<div data-collab="${slot}"></div>`,
  ).join('');

  document.body.innerHTML = `
    <button data-collab-open-btn hidden></button>
    <dialog data-collab-dialog>
      ${slots}
      <button data-collab="close"></button>
      <button data-action="copy-document"><span data-copy-label>Copy</span></button>
      <form data-collab-form="invite"></form>
      <form data-collab-form="visibility"></form>
    </dialog>
    <template data-collab-template="person"></template>
    <template data-collab-template="invitation"></template>
    <template data-collab-template="request">
      <li>
        <span data-field="name"></span>
        <span data-field="meta"></span>
        <p data-field="note" hidden></p>
        <button data-action="approve">Approve</button>
        <button data-action="deny">Deny</button>
      </li>
    </template>
  `;
}

/** jsdom has no `showModal`; the dialog only needs it to stop throwing. */
function polyfillDialog(): void {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
}

beforeEach(() => {
  polyfillDialog();
  mount();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  // The URL persists between tests in a file, and one of them reads it.
  window.history.replaceState({}, '', '/');
});

const activeDocumentEvent = () =>
  new CustomEvent('mdverse:active-document', {
    detail: { id: DOCUMENT_ID, title: 'Roadmap', collaborative: true, role: 'owner' },
  });

describe('collaboration dialog, access requests', () => {
  it('shows the pending request with the note the visitor left', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(collaboration)),
    );

    initCollaborateDialog();
    document.dispatchEvent(
      new CustomEvent('mdverse:active-document', {
        detail: { id: DOCUMENT_ID, title: 'Roadmap', collaborative: true, role: 'owner' },
      }),
    );
    await flush();

    document.querySelector<HTMLButtonElement>('[data-collab-open-btn]')!.click();
    await flush();

    const rows = document.querySelectorAll('[data-request]');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('[data-field="name"]')!.textContent).toBe('Maria');
    expect(rows[0].querySelector('[data-field="meta"]')!.textContent).toContain('@maria');
    const note = rows[0].querySelector<HTMLElement>('[data-field="note"]')!;
    expect(note.textContent).toBe('I am the new contractor.');
    expect(note.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-collab="requests-block"]')!.hidden).toBe(
      false,
    );
    expect(document.querySelector<HTMLElement>('[data-collab="requests-count"]')!.textContent).toBe(
      '(1)',
    );
  });

  it('hides the inbox when nobody is asking', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ ...collaboration, requests: [] })),
    );

    initCollaborateDialog();
    document.dispatchEvent(
      new CustomEvent('mdverse:active-document', {
        detail: { id: DOCUMENT_ID, title: 'Roadmap', collaborative: true, role: 'owner' },
      }),
    );
    await flush();
    document.querySelector<HTMLButtonElement>('[data-collab-open-btn]')!.click();
    await flush();

    expect(document.querySelector<HTMLElement>('[data-collab="requests-block"]')!.hidden).toBe(
      true,
    );
    expect(document.querySelectorAll('[data-request]')).toHaveLength(0);
  });

  it('approves through the share endpoint with the chosen role', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          calls.push({ url, body: JSON.parse(String(init.body)) });
          return json({ ok: true, notice: { tone: 'success', message: 'Access granted.' } });
        }
        return json(collaboration);
      }),
    );

    initCollaborateDialog();
    document.dispatchEvent(
      new CustomEvent('mdverse:active-document', {
        detail: { id: DOCUMENT_ID, title: 'Roadmap', collaborative: true, role: 'owner' },
      }),
    );
    await flush();
    document.querySelector<HTMLButtonElement>('[data-collab-open-btn]')!.click();
    await flush();

    document.querySelector<HTMLButtonElement>('[data-action="approve"]')!.click();
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`/documents/${DOCUMENT_ID}/share/request`);
    expect(calls[0].body).toEqual({
      action: 'approve',
      request: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      role: 'reader',
    });
  });

  it('sends a denial without a role', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          calls.push(JSON.parse(String(init.body)));
          return json({ ok: true, notice: { tone: 'info', message: 'Request denied.' } });
        }
        return json(collaboration);
      }),
    );

    initCollaborateDialog();
    document.dispatchEvent(
      new CustomEvent('mdverse:active-document', {
        detail: { id: DOCUMENT_ID, title: 'Roadmap', collaborative: true, role: 'owner' },
      }),
    );
    await flush();
    document.querySelector<HTMLButtonElement>('[data-collab-open-btn]')!.click();
    await flush();

    document.querySelector<HTMLButtonElement>('[data-action="deny"]')!.click();
    await flush();

    expect(calls).toEqual([
      {
        action: 'deny',
        request: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      },
    ]);
  });
});

describe('collaboration dialog, arriving from the email', () => {
  it('opens itself when the notification link asks for it', async () => {
    window.history.replaceState({}, '', `/?doc=${DOCUMENT_ID}&collaborate=1`);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(collaboration)),
    );

    initCollaborateDialog();
    document.dispatchEvent(activeDocumentEvent());
    await flush();

    expect(document.querySelector<HTMLDialogElement>('[data-collab-dialog]')!.open).toBe(true);
    expect(document.querySelectorAll('[data-request]')).toHaveLength(1);
  });

  it('stays closed on an ordinary visit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(collaboration)),
    );

    initCollaborateDialog();
    document.dispatchEvent(activeDocumentEvent());
    await flush();

    expect(document.querySelector<HTMLDialogElement>('[data-collab-dialog]')!.open).toBe(false);
  });
});

describe('collaboration dialog, document link', () => {
  it('offers the editor address of the document being managed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(collaboration)),
    );

    initCollaborateDialog();
    document.dispatchEvent(
      new CustomEvent('mdverse:active-document', {
        detail: { id: DOCUMENT_ID, title: 'Roadmap', collaborative: true, role: 'owner' },
      }),
    );
    await flush();
    document.querySelector<HTMLButtonElement>('[data-collab-open-btn]')!.click();
    await flush();

    const field = document.querySelector<HTMLInputElement>('[data-collab="document-url"]')!;
    expect(field.value).toContain(`/?doc=${DOCUMENT_ID}`);
    expect(field.value.startsWith(window.location.origin)).toBe(true);
  });

  it('hands out the editor address even once a link can reach the document', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...collaboration,
          document: { ...collaboration.document, visibility: 'unlisted', slug: 'roadmap' },
        }),
      ),
    );

    initCollaborateDialog();
    document.dispatchEvent(activeDocumentEvent());
    await flush();
    document.querySelector<HTMLButtonElement>('[data-collab-open-btn]')!.click();
    await flush();

    // The dialog hands out the editor address whatever the reach is; the
    // read-only page under `/d/` is for search engines, not for this field.
    const field = document.querySelector<HTMLInputElement>('[data-collab="document-url"]')!;
    expect(field.value).toContain(`/?doc=${DOCUMENT_ID}`);
    expect(field.value).not.toContain('/d/');
  });
});

describe('collaboration dialog, reach, role and listing', () => {
  /** The controls the real dialog ships; the shared mount keeps the forms empty. */
  function mountReachForm(): HTMLFormElement {
    const form = document.querySelector<HTMLFormElement>('form[data-collab-form="visibility"]')!;
    form.innerHTML = `
      <input type="radio" name="access" value="restricted" data-collab-access="restricted" />
      <input type="radio" name="access" value="link" data-collab-access="link" />
      <input type="radio" name="linkRole" value="reader" data-collab-link-role="reader" />
      <input type="radio" name="linkRole" value="editor" data-collab-link-role="editor" />
      <input type="checkbox" name="published" data-collab-published />
      <button type="submit"></button>
    `;
    return form;
  }

  async function openWith(payload: unknown): Promise<void> {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(payload)),
    );
    initCollaborateDialog();
    document.dispatchEvent(activeDocumentEvent());
    await flush();
    document.querySelector<HTMLButtonElement>('[data-collab-open-btn]')!.click();
    await flush();
  }

  it('shows the stored reach, role and listing, and hides them while restricted', async () => {
    mountReachForm();
    await openWith({
      ...collaboration,
      document: {
        ...collaboration.document,
        visibility: 'unlisted',
        linkRole: 'editor',
        slug: 'roadmap',
      },
    });

    expect(document.querySelector<HTMLInputElement>('[data-collab-access="link"]')!.checked).toBe(
      true,
    );
    expect(
      document.querySelector<HTMLInputElement>('[data-collab-link-role="editor"]')!.checked,
    ).toBe(true);
    expect(document.querySelector<HTMLInputElement>('[data-collab-published]')!.checked).toBe(
      false,
    );
    expect(document.querySelector<HTMLElement>('[data-collab="link-options"]')!.hidden).toBe(false);
  });

  it('hides the link options on a restricted document', async () => {
    mountReachForm();
    await openWith(collaboration);

    expect(
      document.querySelector<HTMLInputElement>('[data-collab-access="restricted"]')!.checked,
    ).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-collab="link-options"]')!.hidden).toBe(true);
  });

  it('sends the reach, the role and the listing choice to the endpoint', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          calls.push({ url: String(input), body: JSON.parse(String(init.body)) });
          return json({ ok: true, notice: { tone: 'success', message: 'Updated.' } });
        }
        return json(collaboration);
      }),
    );

    const form = mountReachForm();
    initCollaborateDialog();
    document.dispatchEvent(activeDocumentEvent());
    await flush();
    document.querySelector<HTMLButtonElement>('[data-collab-open-btn]')!.click();
    await flush();

    document.querySelector<HTMLInputElement>('[data-collab-access="link"]')!.checked = true;
    document.querySelector<HTMLInputElement>('[data-collab-link-role="editor"]')!.checked = true;
    document.querySelector<HTMLInputElement>('[data-collab-published]')!.checked = true;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`/documents/${DOCUMENT_ID}/share/visibility`);
    expect(calls[0].body).toEqual({ access: 'link', published: 1, linkRole: 'editor' });
  });

  it('keeps the stored role when the reach is restricted', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          calls.push(JSON.parse(String(init.body)));
          return json({ ok: true, notice: { tone: 'success', message: 'Updated.' } });
        }
        return json(collaboration);
      }),
    );

    const form = mountReachForm();
    initCollaborateDialog();
    document.dispatchEvent(activeDocumentEvent());
    await flush();
    document.querySelector<HTMLButtonElement>('[data-collab-open-btn]')!.click();
    await flush();

    document.querySelector<HTMLInputElement>('[data-collab-access="restricted"]')!.checked = true;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();

    expect(calls).toEqual([{ access: 'restricted', published: 0 }]);
  });
});

describe('collaboration dialog, in-place updates', () => {
  const PEOPLE = [
    {
      userId: 'user-1',
      name: 'Ana',
      username: 'ana',
      role: 'reader',
      addedAt: '2026-10-01T10:00:00.000Z',
    },
    {
      userId: 'user-2',
      name: 'Bea',
      username: 'bea',
      role: 'editor',
      addedAt: '2026-10-02T10:00:00.000Z',
    },
  ];

  /** The person template the real dialog ships, trimmed to what these checks read. */
  function mountPeopleTemplate(): void {
    document.querySelector('[data-collab-template="person"]')!.innerHTML = `
      <li>
        <span data-field="name"></span>
        <span data-field="meta"></span>
        <input data-field="role" />
        <button data-action="remove"></button>
      </li>
    `;
  }

  it('repaints only the row whose role changed, without rebuilding the list', async () => {
    const calls: unknown[] = [];
    let people = [...PEOPLE];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          calls.push(JSON.parse(String(init.body)));
          // The server answers with the new role; the dialog must reflect it in place.
          people = PEOPLE.map((person) =>
            person.userId === 'user-1' ? { ...person, role: 'editor' } : person,
          );
          return json({ ok: true, notice: { tone: 'success', message: 'Updated.' } });
        }
        return json({ ...collaboration, people });
      }),
    );

    mountPeopleTemplate();
    initCollaborateDialog();
    document.dispatchEvent(activeDocumentEvent());
    await flush();
    document.querySelector<HTMLButtonElement>('[data-collab-open-btn]')!.click();
    await flush();

    expect(document.querySelectorAll('[data-user]')).toHaveLength(2);

    const skeleton = document.querySelector<HTMLElement>('[data-collab="skeleton"]')!;
    let flashed = false;
    const observer = new MutationObserver(() => {
      if (!skeleton.hidden) flashed = true;
    });
    observer.observe(skeleton, { attributes: true, attributeFilter: ['hidden'] });

    const bea = document.querySelector<HTMLElement>('[data-user="user-2"]')!;
    const ana = document.querySelector<HTMLElement>('[data-user="user-1"]')!;
    const role = ana.querySelector<HTMLInputElement>('[data-field="role"]')!;
    role.value = 'editor';
    role.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    observer.disconnect();

    expect(calls).toEqual([{ action: 'role', user: 'user-1', role: 'editor' }]);

    // Nobody else's row was thrown away and rebuilt.
    expect(bea.isConnected).toBe(true);
    expect(document.querySelector('[data-user="user-2"]')).toBe(bea);

    // Both are editors now, so the promotion moves Ana to the front without recreating her either.
    const rows = [...document.querySelectorAll<HTMLElement>('[data-user]')];
    expect(rows.map((row) => row.dataset.user)).toEqual(['user-1', 'user-2']);
    expect(rows[0]).toBe(ana);

    // No loading placeholder covered the content while the role was saved.
    expect(flashed).toBe(false);
    expect(skeleton.hidden).toBe(true);
  });
});
