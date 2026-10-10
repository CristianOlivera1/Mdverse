import { canManageDocument, describeAccess } from '../documents/access';
import {
  loadCollaboration,
  runShareAction,
  type CollaborationInvitation,
  type CollaborationPerson,
  type CollaborationRequest,
  type CollaborationState,
  type ManagedAction,
  type ShareActionFields,
} from '../documents/collaboration';
import { formatTimestamp } from '../documents/format';
import type { DocumentAccess } from '../documents/types';
import { generalAccessFor, ROLE_LABELS, type GeneralAccess } from '../documents/sharing';
import { confirmAction } from './confirmDialog';
import { closeMenus } from './menus';
import { syncMiniSelects } from './miniSelect';

interface ActiveDocument {
  readonly id: string;
  readonly title: string;
  readonly collaborative: boolean;
  readonly role?: DocumentAccess;
}

interface ActOptions {
  form?: HTMLFormElement;
  disable?: readonly HTMLButtonElement[];
  revert?: () => void;
  reset?: boolean;
}

export function initCollaborateDialog(): void {
  const found = document.querySelector<HTMLDialogElement>('[data-collab-dialog]');
  const openButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-collab-open-btn]')];
  if (!found || openButtons.length === 0) return;

  const dialog: HTMLDialogElement = found;

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
  const notice = pick<HTMLElement>('[data-collab="notice"]');
  const skeleton = pick<HTMLElement>('[data-collab="skeleton"]');
  const unavailable = pick<HTMLElement>('[data-collab="unavailable"]');
  const readonlyBlock = pick<HTMLElement>('[data-collab="readonly"]');
  const manageBlock = pick<HTMLElement>('[data-collab="manage"]');
  const roleLine = pick<HTMLElement>('[data-collab="role-line"]');
  const peopleList = pick<HTMLElement>('[data-collab="people"]');
  const peopleCount = pick<HTMLElement>('[data-collab="people-count"]');
  const peopleEmpty = pick<HTMLElement>('[data-collab="people-empty"]');
  const invitationsBlock = pick<HTMLElement>('[data-collab="invitations-block"]');
  const invitationsList = pick<HTMLElement>('[data-collab="invitations"]');
  const requestsBlock = pick<HTMLElement>('[data-collab="requests-block"]');
  const requestsList = pick<HTMLElement>('[data-collab="requests"]');
  const requestsCount = pick<HTMLElement>('[data-collab="requests-count"]');
  const documentUrlInput = pick<HTMLInputElement>('[data-collab="document-url"]');
  const linkOptions = pick<HTMLElement>('[data-collab="link-options"]');
  const inviteForm = pick<HTMLFormElement>('[data-collab-form="invite"]');
  const visibilityForm = pick<HTMLFormElement>('[data-collab-form="visibility"]');
  const accessInputs = [
    ...visibilityForm.querySelectorAll<HTMLInputElement>('[data-collab-access]'),
  ];
  const linkRoleInputs = [
    ...visibilityForm.querySelectorAll<HTMLInputElement>('[data-collab-link-role]'),
  ];
  const publishedInput = visibilityForm.querySelector<HTMLInputElement>('[data-collab-published]');
  const personTemplate = template('person');
  const invitationTemplate = template('invitation');
  const requestTemplate = template('request');

  let wantsCollaborate = new URLSearchParams(window.location.search).get('collaborate') === '1';

  let active: ActiveDocument | null = null;
  let state: CollaborationState | null = null;
  let busy = false;

  function showNotice(tone: 'success' | 'error' | 'info', message: string): void {
    notice.textContent = message;

    const tones: Record<typeof tone, readonly string[]> = {
      error: ['border-red-900', 'bg-red-950/40', 'text-red-300'],
      success: ['border-emerald-900', 'bg-emerald-950/30', 'text-emerald-300'],
      info: ['border-neutral-700', 'bg-neutral-900', 'text-neutral-300'],
    };
    const active = tones[tone];

    for (const classes of Object.values(tones)) {
      const on = classes === active;
      for (const cls of classes) notice.classList.toggle(cls, on);
    }
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

  function setPending(button: HTMLButtonElement, pending: boolean): void {
    const label = button.querySelector<HTMLElement>('[data-collab-submit-label]');
    const spinner = button.querySelector<HTMLElement>('[data-collab-spinner]');
    button.disabled = pending;
    button.setAttribute('aria-busy', pending ? 'true' : 'false');
    if (label) label.hidden = pending;
    if (spinner) spinner.hidden = !pending;
  }

  /**
   * Keyed list update. A row keeps its DOM node across a refresh, so changing one
   * person's role never rebuilds the whole list: only the rows that truly appeared
   * or disappeared are created or removed, and an untouched row is left alone (no
   * lost focus, no dropdown churn, no scroll jump).
   */
  function reconcile<T>(
    list: HTMLElement,
    items: readonly T[],
    attribute: string,
    keyOf: (item: T) => string,
    create: (item: T) => HTMLElement,
    update: (row: HTMLElement, item: T) => void,
  ): void {
    const known = new Map<string, HTMLElement>();
    for (const row of list.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
      const key = row.getAttribute(attribute);
      if (key) known.set(key, row);
    }

    const kept = new Set<string>();
    items.forEach((item, index) => {
      const key = keyOf(item);
      kept.add(key);

      const current = known.get(key);
      const row = current ?? create(item);
      if (current) update(row, item);

      const at = list.children.item(index);
      if (at !== row) list.insertBefore(row, at);
    });

    for (const [key, row] of known) {
      if (!kept.has(key)) row.remove();
    }
  }

  function personMeta(person: CollaborationPerson): string {
    return person.username
      ? `@${person.username} · added ${formatTimestamp(person.addedAt)}`
      : `added ${formatTimestamp(person.addedAt)}`;
  }

  function updatePersonRow(row: HTMLElement, person: CollaborationPerson): void {
    row.dataset.role = person.role;

    const name = row.querySelector<HTMLElement>('[data-field="name"]');
    if (name) name.textContent = person.name;
    const meta = row.querySelector<HTMLElement>('[data-field="meta"]');
    if (meta) meta.textContent = personMeta(person);

    const input = row.querySelector<HTMLInputElement>('[data-field="role"]');
    if (input) {
      input.setAttribute('aria-label', `Role for ${person.name}`);
      if (input.value !== person.role) {
        input.value = person.role;
        const root = row.querySelector<HTMLElement>('[data-msel]');
        if (root) syncMiniSelects(root);
      }
    }

    const remove = row.querySelector<HTMLButtonElement>('[data-action="remove"]');
    if (remove) remove.setAttribute('aria-label', `Remove ${person.name}`);
  }

  function createPersonRow(person: CollaborationPerson): HTMLElement {
    const row = fill(personTemplate, {
      name: person.name,
      meta: personMeta(person),
      role: person.role,
    });
    row.dataset.user = person.userId;

    const root = row.querySelector<HTMLElement>('[data-msel]');
    if (root) syncMiniSelects(root);
    updatePersonRow(row, person);
    return row;
  }

  function renderPeople(people: readonly CollaborationPerson[]): void {
    reconcile(
      peopleList,
      people,
      'data-user',
      (person) => person.userId,
      createPersonRow,
      updatePersonRow,
    );

    const total = people.length + 1; // plus you
    peopleCount.textContent = `(${total})`;
    peopleEmpty.hidden = people.length > 0;
  }

  function invitationMeta(invitation: CollaborationInvitation): string {
    return `${ROLE_LABELS[invitation.role]} when they sign up · invited ${formatTimestamp(invitation.createdAt)}`;
  }

  function updateInvitationRow(row: HTMLElement, invitation: CollaborationInvitation): void {
    const email = row.querySelector<HTMLElement>('[data-field="email"]');
    if (email) email.textContent = invitation.email;
    const meta = row.querySelector<HTMLElement>('[data-field="meta"]');
    if (meta) meta.textContent = invitationMeta(invitation);
  }

  function createInvitationRow(invitation: CollaborationInvitation): HTMLElement {
    const row = fill(invitationTemplate, {
      email: invitation.email,
      meta: invitationMeta(invitation),
    });
    row.dataset.invitation = invitation.id;
    return row;
  }

  function renderInvitations(pending: readonly CollaborationInvitation[]): void {
    invitationsBlock.hidden = pending.length === 0;
    reconcile(
      invitationsList,
      pending,
      'data-invitation',
      (invitation) => invitation.id,
      createInvitationRow,
      updateInvitationRow,
    );
  }

  function requestMeta(request: CollaborationRequest): string {
    return request.username
      ? `@${request.username} - asked ${formatTimestamp(request.createdAt)}`
      : `asked ${formatTimestamp(request.createdAt)}`;
  }

  /** The role picker is deliberately untouched: a refresh never discards a pending choice. */
  function updateRequestRow(row: HTMLElement, request: CollaborationRequest): void {
    const name = row.querySelector<HTMLElement>('[data-field="name"]');
    if (name) name.textContent = request.name;
    const meta = row.querySelector<HTMLElement>('[data-field="meta"]');
    if (meta) meta.textContent = requestMeta(request);

    const note = row.querySelector<HTMLElement>('[data-field="note"]');
    if (note) {
      note.textContent = request.message ?? '';
      note.hidden = !request.message;
    }
  }

  function createRequestRow(request: CollaborationRequest): HTMLElement {
    const row = fill(requestTemplate, {
      name: request.name,
      meta: requestMeta(request),
      role: 'reader',
    });
    row.dataset.request = request.id;

    const root = row.querySelector<HTMLElement>('[data-msel]');
    if (root) syncMiniSelects(root);
    updateRequestRow(row, request);
    return row;
  }

  function renderRequests(requests: readonly CollaborationRequest[]): void {
    requestsBlock.hidden = requests.length === 0;
    requestsCount.textContent = requests.length > 0 ? `(${requests.length})` : '';

    reconcile(
      requestsList,
      requests,
      'data-request',
      (request) => request.id,
      createRequestRow,
      updateRequestRow,
    );
  }

  /**
   * Every share link opens the document in the editor. The address is the same
   * whoever holds it; the reach and the role the link grants decide what they may
   * do once they are there. The published read-only page under `/d/<slug>` keeps
   * serving search engines and readers who followed an older link - it is not this
   * field's job to hand it out.
   */
  function documentAddress(next: CollaborationState): string {
    return `/?doc=${encodeURIComponent(next.id)}`;
  }

  function renderDocumentLink(next: CollaborationState): void {
    documentUrlInput.value = new URL(documentAddress(next), window.location.origin).toString();
  }

  function syncAccessOptions(): void {
    const selected = accessInputs.find((input) => input.checked)?.value ?? 'restricted';
    linkOptions.hidden = selected !== 'link';
  }

  function renderAccess(next: CollaborationState): void {
    const access = generalAccessFor(next.visibility);
    for (const input of accessInputs) input.checked = input.value === access;
    for (const input of linkRoleInputs) input.checked = input.value === next.linkRole;
    if (publishedInput) publishedInput.checked = next.visibility === 'public';
    syncAccessOptions();
  }

  /** A stable string per section, so `render` repaints only the parts that actually moved. */
  function fingerprint<T>(values: readonly T[], project: (value: T) => string): string {
    return values.map(project).join('\n');
  }

  function sectionChanged<T>(
    before: readonly T[] | null,
    after: readonly T[],
    project: (value: T) => string,
  ): boolean {
    if (!before) return true;
    if (before.length !== after.length) return true;
    return fingerprint(before, project) !== fingerprint(after, project);
  }

  const personFields = (person: CollaborationPerson): string =>
    `${person.userId}:${person.role}:${person.name}:${person.username}:${person.addedAt}`;
  const invitationFields = (invitation: CollaborationInvitation): string =>
    `${invitation.id}:${invitation.email}:${invitation.role}:${invitation.createdAt}`;
  const requestFields = (request: CollaborationRequest): string =>
    `${request.id}:${request.name}:${request.username}:${request.message}:${request.createdAt}`;

  function addressChanged(before: CollaborationState, after: CollaborationState): boolean {
    return before.id !== after.id;
  }

  function accessChanged(before: CollaborationState, after: CollaborationState): boolean {
    return before.visibility !== after.visibility || before.linkRole !== after.linkRole;
  }

  function render(next: CollaborationState, previous: CollaborationState | null): void {
    if (!previous || previous.title !== next.title) subtitle.textContent = next.title;
    if (!previous || previous.role !== next.role) {
      roleLine.textContent = `Your role here is ${describeAccess(next.role).toLowerCase()}.`;
    }
    if (!previous || previous.canManage !== next.canManage) {
      readonlyBlock.hidden = next.canManage;
      manageBlock.hidden = !next.canManage;
    }

    state = next;
    if (!next.canManage) return;

    if (sectionChanged(previous?.people ?? null, next.people, personFields)) {
      renderPeople(next.people);
    }
    if (sectionChanged(previous?.invitations ?? null, next.invitations, invitationFields)) {
      renderInvitations(next.invitations);
    }
    if (sectionChanged(previous?.requests ?? null, next.requests, requestFields)) {
      renderRequests(next.requests);
    }
    if (!previous || addressChanged(previous, next)) renderDocumentLink(next);
    if (!previous || accessChanged(previous, next)) renderAccess(next);
  }

  async function refresh(options: { skeleton?: boolean } = {}): Promise<void> {
    const document_ = active;
    if (!document_) return;

    const withSkeleton = options.skeleton !== false;
    const previous = withSkeleton ? null : state;

    if (withSkeleton) {
      skeleton.hidden = false;
      unavailable.hidden = true;
      readonlyBlock.hidden = true;
      manageBlock.hidden = true;
    }

    const next = await loadCollaboration(document_.id);
    skeleton.hidden = true;

    if (!next) {
      if (!withSkeleton) return;
      state = null;
      unavailable.hidden = false;
      return;
    }

    render(next, previous);
  }

  async function act(
    action: ManagedAction,
    fields: ShareActionFields,
    options: ActOptions = {},
  ): Promise<void> {
    const document_ = active;
    if (!document_ || busy) return;

    busy = true;
    const submit = options.form?.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) setPending(submit, true);
    for (const button of options.disable ?? []) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }

    try {
      const feedback = await runShareAction(document_.id, action, fields);
      if (feedback.ok) {
        if (options.reset !== false) {
          options.form?.reset();
          if (options.form) syncMiniSelects(options.form);
        }
        showNotice(feedback.tone ?? 'success', feedback.message);
        await refresh({ skeleton: false });
      } else {
        showNotice('error', feedback.message);
        options.revert?.();
      }
    } finally {
      busy = false;
      if (submit) setPending(submit, false);
      for (const button of options.disable ?? []) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    }
  }

  function canShare(): boolean {
    return active?.collaborative === true && canManageDocument(active.role ?? 'reader');
  }

  function openDialog(): void {
    if (!canShare()) return;

    closeMenus();
    clearNotice();
    if (!dialog.open) dialog.showModal();
    void refresh();
  }

  for (const button of openButtons) button.addEventListener('click', openDialog);
  pick<HTMLElement>('[data-collab="close"]').addEventListener('click', () => dialog.close());

  document.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-collab-open]');
    const id = button?.dataset.docId;
    if (!id) return;

    active = {
      id,
      title: button.dataset.docTitle || 'Untitled',
      collaborative: true,
      role: 'owner',
    };
    openDialog();
  });

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
      { form: inviteForm },
    );
  });

  for (const input of accessInputs) input.addEventListener('change', syncAccessOptions);

  visibilityForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(visibilityForm);
    const access: GeneralAccess = data.get('access') === 'link' ? 'link' : 'restricted';
    const published = data.get('published') !== null;

    const fields: ShareActionFields = { access, published: published ? 1 : 0 };
    if (access === 'link') {
      fields.linkRole = data.get('linkRole') === 'editor' ? 'editor' : 'reader';
    }

    void act('visibility', fields, { form: visibilityForm, reset: false });
  });

  requestsList.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
    const row = button?.closest<HTMLElement>('[data-request]');
    if (!button || !row?.dataset.request) return;

    const approve = button.dataset.action === 'approve';
    const roleInput = row.querySelector<HTMLInputElement>('[data-field="role"]');
    const msel = row.querySelector<HTMLElement>('[data-msel]');
    const trigger = msel?.querySelector<HTMLButtonElement>('[data-msel-btn]');

    void act(
      'request',
      {
        action: approve ? 'approve' : 'deny',
        request: row.dataset.request,
        ...(approve ? { role: roleInput?.value ?? 'reader' } : {}),
      },
      { disable: trigger ? [trigger, button] : [button] },
    );
  });

  pick<HTMLButtonElement>('[data-action="copy-document"]').addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const label = button.querySelector<HTMLElement>('[data-copy-label]');

    void navigator.clipboard
      ?.writeText(documentUrlInput.value)
      .then(() => {
        if (label) label.textContent = 'Copied';
        window.setTimeout(() => {
          if (label) label.textContent = 'Copy';
        }, 1500);
      })
      .catch(() => {
        /* Clipboard blocked: the field next to the button still holds the URL. */
      });
  });

  peopleList.addEventListener('change', (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-field="role"]');
    const row = input?.closest<HTMLElement>('[data-user]');
    if (!input || !row?.dataset.user) return;

    const msel = input.closest<HTMLElement>('[data-msel]');
    const trigger = msel?.querySelector<HTMLButtonElement>('[data-msel-btn]');
    const original = row.dataset.role ?? input.value;

    void act(
      'collaborator',
      { action: 'role', user: row.dataset.user, role: input.value },
      {
        disable: trigger ? [trigger] : [],
        revert: () => {
          input.value = original;
          if (msel) syncMiniSelects(msel);
        },
      },
    );
  });

  peopleList.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-action="remove"]',
    );
    const row = button?.closest<HTMLElement>('[data-user]');
    if (!button || !row?.dataset.user) return;

    const userId = row.dataset.user;
    const name = row.querySelector('[data-field="name"]')?.textContent?.trim() || 'this person';
    void confirmAction({
      title: `Remove ${name}?`,
      message: 'They immediately lose access to this document.',
      confirmLabel: 'Remove',
      danger: true,
    }).then((confirmed) => {
      if (!confirmed) return;
      void act('collaborator', { action: 'remove', user: userId }, { disable: [button] });
    });
  });

  invitationsList.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-action="revoke"]',
    );
    const row = button?.closest<HTMLElement>('[data-invitation]');
    if (!button || !row?.dataset.invitation) return;

    const invitationId = row.dataset.invitation;
    const email =
      row.querySelector('[data-field="email"]')?.textContent?.trim() || 'this invitation';
    void confirmAction({
      title: `Revoke the invitation for ${email}?`,
      message: 'They will no longer be able to claim access with it.',
      confirmLabel: 'Revoke',
      danger: true,
    }).then((confirmed) => {
      if (!confirmed) return;
      void act('invitation', { invitation: invitationId }, { disable: [button] });
    });
  });

  document.addEventListener('mdverse:active-document', (event) => {
    const detail = (event as CustomEvent<Partial<ActiveDocument>>).detail;
    if (typeof detail?.id !== 'string') return;

    active = {
      id: detail.id,
      title: typeof detail.title === 'string' ? detail.title : 'Untitled',
      collaborative: detail.collaborative === true,
      role: detail.role ?? 'reader',
    };
    for (const button of openButtons) button.hidden = !canShare();
    for (const section of document.querySelectorAll<HTMLElement>('[data-collab-section]')) {
      section.hidden = !canShare();
    }
    if (!canShare() && dialog.open) dialog.close();

    if (wantsCollaborate && canShare()) {
      wantsCollaborate = false;
      openDialog();
      return;
    }

    if (dialog.open && state?.id !== active.id) {
      clearNotice();
      state = null;
      void refresh();
    }
  });

  document.dispatchEvent(new Event('mdverse:request-active-document'));
}
