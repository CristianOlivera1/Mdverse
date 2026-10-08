// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { showAccessGate } from '../../src/lib/app/accessGate';

const DOCUMENT_ID = '11111111-2222-3333-4444-555555555555';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function submitButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>('[data-gate="submit"]');
  if (!button) throw new Error('the gate rendered no submit button');
  return button;
}

function notice(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-gate="notice"]');
  if (!element) throw new Error('the gate rendered no notice');
  return element;
}

/** Lets the fetch → json → render promise chain settle. */
async function flush(): Promise<void> {
  for (let index = 0; index < 4; index++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('access gate, signed in', () => {
  it('posts the note to the document it was opened for', async () => {
    const fetchMock = vi.fn(async () => json({ ok: true, outcome: 'requested' }));
    vi.stubGlobal('fetch', fetchMock);

    showAccessGate({ documentId: DOCUMENT_ID, signedIn: true });
    const note = document.querySelector<HTMLTextAreaElement>('#access-gate-note');
    note!.value = '  I am the new contractor.  ';
    submitButton().click();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/documents/${DOCUMENT_ID}/access-request`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ message: 'I am the new contractor.' });
  });

  it('confirms the request and stops the form', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true, outcome: 'requested' })));

    showAccessGate({ documentId: DOCUMENT_ID, signedIn: true });
    submitButton().click();
    await flush();

    expect(notice().textContent).toContain('Request sent');
    expect(submitButton().disabled).toBe(true);
    expect(submitButton().textContent).toContain('Request sent');
    // The composer is gone: asking twice is not the intended action.
    expect(document.querySelector<HTMLElement>('[data-gate="form"]')?.hidden).toBe(true);
  });

  it('reports a repeated ask without pretending it failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true, outcome: 'already_requested' })));

    showAccessGate({ documentId: DOCUMENT_ID, signedIn: true });
    submitButton().click();
    await flush();

    expect(notice().textContent).toContain('already asked');
    expect(notice().className).toContain('border-neutral-700');
  });

  it('leaves the button usable when there is nothing to ask about', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ok: false, outcome: 'not_found' }, 404)));

    showAccessGate({ documentId: DOCUMENT_ID, signedIn: true });
    submitButton().click();
    await flush();

    expect(notice().textContent).toContain('not available');
    expect(notice().className).toContain('border-red-900');
    // Not stuck on "Sending…": the visitor can try again.
    expect(submitButton().disabled).toBe(false);
    expect(submitButton().textContent).toContain('Request access');
  });

  it('survives a transport failure without freezing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );

    showAccessGate({ documentId: DOCUMENT_ID, signedIn: true });
    submitButton().click();
    await flush();

    expect(notice().textContent).toContain('could not reach the server');
    expect(submitButton().disabled).toBe(false);
  });

  it('offers a reload when the visitor already has access, and never asks twice', async () => {
    const fetchMock = vi.fn(async () => json({ ok: true, outcome: 'already_has_access' }));
    vi.stubGlobal('fetch', fetchMock);

    showAccessGate({ documentId: DOCUMENT_ID, signedIn: true });
    submitButton().click();
    await flush();

    expect(submitButton().textContent).toContain('Reload the document');

    // The second click must reload, not fire the request again: two stacked
    // listeners on one button would do the opposite.
    submitButton().click();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('access gate, signed out', () => {
  it('asks for a sign-in instead of collecting a note nobody can attribute', () => {
    showAccessGate({ documentId: DOCUMENT_ID, signedIn: false });

    expect(submitButton().textContent).toContain('Sign in to ask');
    expect(document.querySelector<HTMLElement>('[data-gate="form"]')?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-gate="signed-out"]')?.hidden).toBe(false);
  });

  it('points the way out at the home page, since there is no document to return to', () => {
    showAccessGate({ documentId: DOCUMENT_ID, signedIn: false });
    expect(document.querySelector('[data-gate="leave"]')?.textContent).toContain('home page');
  });
});

describe('access gate rendering', () => {
  it('replaces the host contents instead of appending to them', () => {
    const host = document.createElement('div');
    host.innerHTML = '<p>Rendering…</p>';
    document.body.append(host);

    showAccessGate({ documentId: DOCUMENT_ID, signedIn: true, host });

    expect(host.querySelector('p')?.textContent).not.toBe('Rendering…');
    expect(host.querySelectorAll('h1')).toHaveLength(1);
  });

  it('overlays the page when no host is given', () => {
    showAccessGate({ documentId: DOCUMENT_ID, signedIn: true });
    expect(document.body.querySelector('.fixed.inset-0')).not.toBeNull();
  });
});
