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
  'links',
  'links-empty',
  'requests-block',
  'requests',
  'requests-count',
  'document-url',
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
      <form data-collab-form="link"></form>
      <form data-collab-form="visibility"></form>
    </dialog>
    <template data-collab-template="person"></template>
    <template data-collab-template="invitation"></template>
    <template data-collab-template="link"></template>
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

    expect(document.querySelector<HTMLElement>('[data-collab="requests-block"]')!.hidden).toBe(true);
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
});
