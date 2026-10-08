import {
  describeAccessRequestOutcome,
  isAccessRequestOutcome,
  normalizeAccessMessage,
} from '../documents/accessRequests';

export interface AccessGateOptions {
  readonly documentId: string;
  readonly signedIn: boolean;
  readonly host?: HTMLElement;
}

interface Notice {
  tone: 'success' | 'info' | 'error';
  message: string;
}

const TONE_CLASSES: Record<Notice['tone'], string> = {
  success: 'border-emerald-900 bg-emerald-950/30 text-emerald-300',
  info: 'border-neutral-700 bg-neutral-900 text-neutral-300',
  error: 'border-red-900 bg-red-950/40 text-red-300',
};

function editorLink(documentId: string): string {
  return `/?doc=${encodeURIComponent(documentId)}`;
}

export function showAccessGate(options: AccessGateOptions): void {
  const { documentId, signedIn, host } = options;

  const root = document.createElement('div');
  root.className = host
    ? 'not-prose mx-auto max-w-lg py-16 text-left'
    : 'fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-6';

  const card = document.createElement('div');
  card.className = host
    ? ''
    : 'w-full max-w-md rounded-2xl border border-neutral-800 bg-[#0b0b0b] p-6 shadow-2xl';
  root.append(card);

  card.innerHTML = `
    <img src="/svg/logo-calligraphy.svg" alt="Mdverse logo" class="h-7 w-auto my-2" width="136" height="33">
    <h1 class="mt-1 text-lg font-semibold text-neutral-100">This document is not open to you</h1>
    <p class="mt-2 text-xs leading-relaxed text-neutral-400">
      You do not have access to this document. Ask the owner - they get an email and can let you
      in. A document that was deleted answers exactly the same way.
    </p>
    <p data-gate="signed-out" class="mt-2 text-xs leading-relaxed text-neutral-400" hidden>
      Sign in first: access is granted to an account, and the owner needs to know who is asking.
    </p>
    <div data-gate="form" class="mt-4" hidden>
      <label class="block text-[11px] text-neutral-500" for="access-gate-note">
        Add a note (optional)
      </label>
      <textarea
        id="access-gate-note"
        rows="2"
        maxlength="500"
        placeholder="Who you are, or why you need it"
        class="mt-1 w-full rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
      ></textarea>
    </div>
    <p data-gate="notice" class="mt-4 rounded-lg border px-3 py-2 text-xs" hidden></p>
    <div class="mt-5 flex flex-wrap items-center gap-2">
      <button type="button" data-gate="submit" class="hb on">
        <span data-gate="submit-label">Request access</span>
      </button>
      <a href="/dashboard" class="hb" data-gate="leave">Back to your documents</a>
    </div>
  `;

  const signedOutLine = card.querySelector<HTMLElement>('[data-gate="signed-out"]');
  const formBlock = card.querySelector<HTMLElement>('[data-gate="form"]');
  const noticeEl = card.querySelector<HTMLElement>('[data-gate="notice"]');
  const submit = card.querySelector<HTMLButtonElement>('[data-gate="submit"]');
  const submitLabel = card.querySelector<HTMLElement>('[data-gate="submit-label"]');
  const leave = card.querySelector<HTMLAnchorElement>('[data-gate="leave"]');
  const note = card.querySelector<HTMLTextAreaElement>('#access-gate-note');

  const showNotice = (notice: Notice): void => {
    if (!noticeEl) return;
    noticeEl.textContent = notice.message;
    noticeEl.className = `mt-4 rounded-lg border px-3 py-2 text-xs ${TONE_CLASSES[notice.tone]}`;
    noticeEl.hidden = false;
  };

  if (host) host.replaceChildren(root);
  else document.body.append(root);

  if (!signedIn) {
    if (signedOutLine) signedOutLine.hidden = false;
    if (formBlock) formBlock.hidden = true;
    if (submitLabel) submitLabel.textContent = 'Sign in to ask';
    if (leave) leave.textContent = 'Back to the home page';
    submit?.addEventListener('click', () => {
      window.location.href = `/login?next=${encodeURIComponent(editorLink(documentId))}`;
    });
    return;
  }

  if (formBlock) formBlock.hidden = false;

  let mode: 'request' | 'reload' = 'request';

  const fail = (message: string): void => {
    showNotice({ tone: 'error', message });
    if (submit) submit.disabled = false;
    if (submitLabel) submitLabel.textContent = 'Request access';
  };

  submit?.addEventListener('click', () => {
    if (mode === 'reload') {
      window.location.reload();
      return;
    }
    if (!submit || !submitLabel) return;

    submit.disabled = true;
    submitLabel.textContent = 'Sending…';

    void fetch(`/api/documents/${encodeURIComponent(documentId)}/access-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ message: normalizeAccessMessage(note?.value) }),
    })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null);
        const outcome = (payload as { outcome?: unknown } | null)?.outcome;

        if (!isAccessRequestOutcome(outcome)) {
          fail('We could not send the request. Please try again.');
          return;
        }

        if (outcome === 'not_found') {
          fail(describeAccessRequestOutcome(outcome).message);
          return;
        }

        showNotice(describeAccessRequestOutcome(outcome));

        if (outcome === 'already_has_access') {
          mode = 'reload';
          submitLabel.textContent = 'Reload the document';
          if (formBlock) formBlock.hidden = true;
          return;
        }

        submitLabel.textContent = outcome === 'requested' ? 'Request sent' : 'Already asked';
        if (formBlock) formBlock.hidden = true;
      })
      .catch(() => fail('We could not reach the server. Please try again.'));
  });
}
