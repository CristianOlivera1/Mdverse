/**
 * The editor header's collaboration dialog.
 *
 * It follows whichever tab is on screen (the editor announces it), reads the
 * current state once per document, and sends every change to the same endpoints the
 * share page posts to — which answer JSON when asked. Nothing here decides who may
 * do what: Postgres does, and a refused action comes back as a notice.
 */

import { describeAccess } from '../documents/access';
import {
  loadCollaboration,
  runShareAction,
  type CollaborationLink,
  type CollaborationPerson,
  type CollaborationState,
  type ManagedAction,
  type ShareActionFields,
} from '../documents/collaboration';
import { formatTimestamp } from '../documents/format';
import { linkIsActive, maskToken, ROLE_LABELS, shareUrl } from '../documents/sharing';

interface ActiveDocument {
  readonly id: string;
  readonly title: string;
  readonly collaborative: boolean;
}

export function initCollaborateDialog(): void {
  const found = document.querySelector<HTMLDialogElement>('[data-collab-dialog]');
  const trigger = document.getElementById('collaborate-open');
  if (!found || !(trigger instanceof HTMLButtonElement)) return;

  const dialog: HTMLDialogElement = found;
  const openButton: HTMLButtonElement = trigger;

  const pick = <T extends Element>(selector: string): T => {
    const element = dialog.querySelector<T>(selector);
    if (!element) throw new Error(`The collaboration dialog is missing ${selector}`);
    return element;
  };

  const template = (name: string): HTMLTemplateElement => {
    const element = document.querySelector<HTMLTemplateElement>(`[data-collab-template="${name}"]`);
    if (!element) throw new Error(`Missing the ${name} row template`);
    return element;
  };

  const subtitle = pick<HTMLElement>('[data-collab="subtitle"]');
  const fullPage = pick<HTMLAnchorElement>('[data-collab="full-page"]');
  const notice = pick<HTMLElement>('[data-collab="notice"]');
  const loading = pick<HTMLElement>('[data-collab="loading"]');
  const unavailable = pick<HTMLElement>('[data-collab="unavailable"]');
  const readonlyBlock = pick<HTMLElement>('[data-collab="readonly"]');
  const manageBlock = pick<HTMLElement>('[data-collab="manage"]');
  const roleLine = pick<HTMLElement>('[data-collab="role-line"]');
  const peopleList = pick<HTMLElement>('[data-collab="people"]');
  const peopleCount = pick<HTMLElement>('[data-collab="people-count"]');
  const peopleEmpty = pick<HTMLElement>('[data-collab="people-empty"]');
  const invitationsBlock = pick<HTMLElement>('[data-collab="invitations-block"]');
  const invitationsList = pick<HTMLElement>('[data-collab="invitations"]');
  const linksList = pick<HTMLElement>('[data-collab="links"]');
  const linksEmpty = pick<HTMLElement>('[data-collab="links-empty"]');
  const inviteForm = pick<HTMLFormElement>('[data-collab-form="invite"]');
  const linkForm = pick<HTMLFormElement>('[data-collab-form="link"]');
  const visibilityForm = pick<HTMLFormElement>('[data-collab-form="visibility"]');
  const personTemplate = template('person');
  const invitationTemplate = template('invitation');
  const linkTemplate = template('link');

  let active: ActiveDocument | null = null;
  let state: CollaborationState | null = null;
  let busy = false;

  function showNotice(tone: 'success' | 'error', message: string): void {
    notice.textContent = message;
    notice.classList.toggle('border-red-900', tone === 'error');
    notice.classList.toggle('bg-red-950/40', tone === 'error');
    notice.classList.toggle('text-red-300', tone === 'error');
    notice.classList.toggle('border-emerald-900', tone === 'success');
    notice.classList.toggle('bg-emerald-950/30', tone === 'success');
    notice.classList.toggle('text-emerald-300', tone === 'success');
    notice.hidden = false;
  }

  function clearNotice(): void {
    notice.hidden = true;
    notice.textContent = '';
  }

  function fill(templateEl: HTMLTemplateElement, values: Record<string, string>): HTMLElement {
    const fragment = templateEl.content.cloneNode(true) as DocumentFragment;
    const root = fragment.firstElementChild as HTMLElement;
    for (const [field, value] of Object.entries(values)) {
      const target = root.querySelector<HTMLElement>(`[data-field="${field}"]`);
      if (!target) continue;
      // A <select> is not an <input>: writing textContent there would eat its options.
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement
      ) {
        target.value = value;
      } else {
        target.textContent = value;
      }
    }
    return root;
  }

  function renderPeople(people: readonly CollaborationPerson[]): void {
    peopleList.replaceChildren(
      ...people.map((person) => {
        const row = fill(personTemplate, {
          name: person.name,
          meta: person.username
            ? `@${person.username} · added ${formatTimestamp(person.addedAt)}`
            : `added ${formatTimestamp(person.addedAt)}`,
          role: person.role,
        });

        row.dataset.user = person.userId;
        const select = row.querySelector<HTMLSelectElement>('[data-field="role"]');
        if (select) select.setAttribute('aria-label', `Role for ${person.name}`);
        const remove = row.querySelector<HTMLButtonElement>('[data-action="remove"]');
        if (remove) remove.setAttribute('aria-label', `Remove ${person.name}`);

        return row;
      }),
    );

    const total = people.length + 1; // plus you
    peopleCount.textContent = `(${total})`;
    peopleEmpty.hidden = people.length > 0;
  }

  function renderInvitations(pending: CollaborationState['invitations']): void {
    invitationsBlock.hidden = pending.length === 0;
    invitationsList.replaceChildren(
      ...pending.map((invitation) => {
        const row = fill(invitationTemplate, {
          email: invitation.email,
          meta: `${ROLE_LABELS[invitation.role]} when they sign up · invited ${formatTimestamp(invitation.createdAt)}`,
        });
        row.dataset.invitation = invitation.id;
        return row;
      }),
    );
  }

  function renderLinks(links: readonly CollaborationLink[], origin: string): void {
    const now = new Date();
    linksEmpty.hidden = links.length > 0;

    linksList.replaceChildren(
      ...links.map((link) => {
        const active_ = linkIsActive({ expires_at: link.expiresAt }, now);
        const expiry = link.expiresAt
          ? `${active_ ? 'expires' : 'expired'} ${formatTimestamp(link.expiresAt)}`
          : 'never expires';

        const row = fill(linkTemplate, {
          meta: `${ROLE_LABELS[link.role]} · ${expiry} · ${maskToken(link.token)}`,
          url: shareUrl(origin, link.token),
        });

        row.dataset.link = link.id;
        if (!active_) row.classList.add('opacity-60');
        return row;
      }),
    );
  }

  function render(next: CollaborationState): void {
    state = next;
    subtitle.textContent = next.title;
    fullPage.href = `/documents/${encodeURIComponent(next.id)}/share`;
    roleLine.textContent = `Your role here is ${describeAccess(next.role).toLowerCase()}.`;

    readonlyBlock.hidden = next.canManage;
    manageBlock.hidden = !next.canManage;
    if (!next.canManage) return;

    renderPeople(next.people);
    renderInvitations(next.invitations);
    renderLinks(next.links, window.location.origin);
    for (const radio of visibilityForm.querySelectorAll<HTMLInputElement>(
      'input[name="visibility"]',
    )) {
      radio.checked = radio.value === next.visibility;
    }
  }

  async function refresh(): Promise<void> {
    const document_ = active;
    if (!document_) return;

    loading.hidden = false;
    unavailable.hidden = true;
    const next = await loadCollaboration(document_.id);
    loading.hidden = true;

    if (!next) {
      state = null;
      readonlyBlock.hidden = true;
      manageBlock.hidden = true;
      unavailable.hidden = false;
      return;
    }

    render(next);
  }

  async function act(
    action: ManagedAction,
    fields: ShareActionFields,
    form?: HTMLFormElement,
  ): Promise<void> {
    const document_ = active;
    if (!document_ || busy) return;

    busy = true;
    const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.disabled = true;

    try {
      const feedback = await runShareAction(document_.id, action, fields);
      if (feedback.ok) form?.reset();
      showNotice(feedback.ok ? 'success' : 'error', feedback.message);
      if (feedback.ok) await refresh();
    } finally {
      busy = false;
      if (submit) submit.disabled = false;
    }
  }

  function openDialog(): void {
    if (!active?.collaborative) return;

    clearNotice();
    dialog.showModal();
    // Always read again: the last look may be minutes old, and someone may have been
    // added or removed in another window since.
    void refresh();
  }

  openButton.addEventListener('click', openDialog);
  pick<HTMLElement>('[data-collab="close"]').addEventListener('click', () => dialog.close());

  // Clicking the backdrop lands on the dialog itself; the panel is a child of it.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  inviteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(inviteForm);
    void act(
      'invite',
      {
        emails: String(data.get('emails') ?? ''),
        role: String(data.get('role') ?? 'reader'),
      },
      inviteForm,
    );
  });

  linkForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(linkForm);
    void act(
      'link',
      {
        action: 'create',
        role: String(data.get('role') ?? 'reader'),
        expiry: String(data.get('expiry') ?? '0'),
      },
      linkForm,
    );
  });

  visibilityForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(visibilityForm);
    void act('visibility', { visibility: String(data.get('visibility') ?? '') });
  });

  peopleList.addEventListener('change', (event) => {
    const select = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-field="role"]');
    const row = select?.closest<HTMLElement>('[data-user]');
    if (!select || !row?.dataset.user) return;

    void act('collaborator', { action: 'role', user: row.dataset.user, role: select.value });
  });

  peopleList.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-action="remove"]');
    const row = button?.closest<HTMLElement>('[data-user]');
    if (!row?.dataset.user) return;
    if (!window.confirm('Remove this person from the document?')) return;

    void act('collaborator', { action: 'remove', user: row.dataset.user });
  });

  invitationsList.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-action="revoke"]');
    const row = button?.closest<HTMLElement>('[data-invitation]');
    if (!row?.dataset.invitation) return;

    void act('invitation', { invitation: row.dataset.invitation });
  });

  linksList.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLElement>('[data-action]');
    const row = button?.closest<HTMLElement>('[data-link]');
    if (!button || !row?.dataset.link) return;

    if (button.dataset.action === 'revoke') {
      void act('link', { action: 'revoke', link: row.dataset.link });
      return;
    }

    const field = row.querySelector<HTMLInputElement>('[data-field="url"]');
    if (!field) return;

    void navigator.clipboard
      ?.writeText(field.value)
      .then(() => {
        button.textContent = 'Copied';
        window.setTimeout(() => {
          button.textContent = 'Copy';
        }, 1500);
      })
      .catch(() => {
        /* Clipboard blocked: the field next to the button still holds the URL. */
      });
  });

  // The editor tells us which tab is on screen; we ask once in case it booted first.
  document.addEventListener('mdverse:active-document', (event) => {
    const detail = (event as CustomEvent<Partial<ActiveDocument>>).detail;
    if (typeof detail?.id !== 'string') return;

    active = {
      id: detail.id,
      title: typeof detail.title === 'string' ? detail.title : 'Untitled',
      collaborative: detail.collaborative === true,
    };
    openButton.hidden = !active.collaborative;

    if (dialog.open && state?.id !== active.id) {
      clearNotice();
      state = null;
      void refresh();
    }
  });

  document.dispatchEvent(new Event('mdverse:request-active-document'));
}
