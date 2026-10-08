export interface ConfirmOptions {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** Paints the confirm button red. Use it when the action destroys something. */
  readonly danger?: boolean;
}

/** A decision, or a dismissal (Escape, the backdrop) that decides nothing. */
export type ConfirmChoice = 'confirm' | 'cancel' | 'dismiss';

let dialog: HTMLDialogElement | null = null;
let pending: ((choice: ConfirmChoice) => void) | null = null;

function pick<T extends Element>(root: HTMLElement, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`The confirmation dialog is missing ${selector}`);
  return element;
}

function settle(choice: ConfirmChoice): void {
  const resolve = pending;
  pending = null;
  dialog?.close();
  resolve?.(choice);
}

function build(): HTMLDialogElement {
  const element = document.createElement('dialog');
  element.className = 'cf-dialog';
  element.setAttribute('aria-labelledby', 'cf-title');
  element.setAttribute('aria-describedby', 'cf-message');
  element.innerHTML = [
    '<div class="px-4 pt-4 pb-3">',
    '  <h2 id="cf-title" class="text-sm font-medium text-neutral-100" data-cf="title"></h2>',
    '  <p id="cf-message" class="mt-2 text-xs leading-relaxed text-neutral-400" data-cf="message"></p>',
    '</div>',
    '<div class="flex items-center justify-end gap-2 border-t border-neutral-800 px-4 py-3">',
    '  <button type="button" class="hb" data-cf="cancel"></button>',
    '  <button type="button" class="hb" data-cf="confirm"></button>',
    '</div>',
  ].join('\n');

  pick<HTMLButtonElement>(element, '[data-cf="cancel"]').addEventListener('click', () =>
    settle('cancel'),
  );
  pick<HTMLButtonElement>(element, '[data-cf="confirm"]').addEventListener('click', () =>
    settle('confirm'),
  );

  // Escape and the backdrop decide nothing, and say so. Closing ourselves keeps the
  // promise settling exactly once, even when the browser closes the dialog for us.
  element.addEventListener('cancel', (event) => {
    event.preventDefault();
    settle('dismiss');
  });
  element.addEventListener('click', (event) => {
    if (event.target === element) settle('dismiss');
  });

  document.body.append(element);
  return element;
}

/**
 * Asks a question and reports which button ended it — for when a dismissal must be
 * told apart from an explicit "no".
 */
export function confirmChoice(options: ConfirmOptions): Promise<ConfirmChoice> {
  const element = dialog ?? (dialog = build());
  if (pending) settle('dismiss');

  pick<HTMLElement>(element, '[data-cf="title"]').textContent = options.title;
  pick<HTMLElement>(element, '[data-cf="message"]').textContent = options.message;

  const cancel = pick<HTMLButtonElement>(element, '[data-cf="cancel"]');
  const confirm = pick<HTMLButtonElement>(element, '[data-cf="confirm"]');
  cancel.textContent = options.cancelLabel ?? 'Cancel';
  confirm.textContent = options.confirmLabel ?? 'Confirm';
  confirm.classList.toggle('cf-danger', options.danger === true);

  return new Promise((resolve) => {
    pending = resolve;
    element.showModal();
    // Focus lands on the safe choice: one Enter on a fresh dialog destroys nothing.
    cancel.focus();
  });
}

/** Resolves `false` for cancel, Escape and the backdrop - every close that is not a yes. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return confirmChoice(options).then((choice) => choice === 'confirm');
}

/**
 * Forms carrying `data-confirm` ask first and only then post. Attributes:
 * `data-confirm` (the sentence), `data-confirm-title`, `data-confirm-label`,
 * `data-confirm-cancel`, and `data-confirm-danger` for the red confirm button.
 */
export function initConfirmForms(): void {
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.dataset.confirm === undefined || form.dataset.confirmAccepted === 'true') return;

    event.preventDefault();
    void confirmAction({
      title: form.dataset.confirmTitle ?? 'Are you sure?',
      message: form.dataset.confirm,
      confirmLabel: form.dataset.confirmLabel ?? 'Confirm',
      cancelLabel: form.dataset.confirmCancel ?? 'Cancel',
      danger: form.hasAttribute('data-confirm-danger'),
    }).then((confirmed) => {
      if (!confirmed) return;
      form.dataset.confirmAccepted = 'true';
      form.requestSubmit();
    });
  });
}
