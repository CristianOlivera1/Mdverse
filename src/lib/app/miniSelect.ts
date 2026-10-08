function openRoots(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-msel]')].filter(
    (root) => root.querySelector<HTMLElement>('[data-msel-pop]')?.hidden === false,
  );
}

function closeAll(except?: HTMLElement): void {
  for (const root of openRoots()) {
    if (root === except) continue;
    const pop = root.querySelector<HTMLElement>('[data-msel-pop]');
    const trigger = root.querySelector<HTMLElement>('[data-msel-btn]');
    if (pop) pop.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
  }
}

function positionPop(pop: HTMLElement, trigger: HTMLElement): void {
  const bounds = trigger.getBoundingClientRect();
  const width = pop.offsetWidth;
  const height = pop.offsetHeight;
  const margin = 8;

  const left = Math.max(margin, Math.min(bounds.left, window.innerWidth - width - margin));
  const below = window.innerHeight - bounds.bottom - margin;
  const openBelow = below >= height || below >= bounds.top;
  const top = openBelow ? bounds.bottom + 6 : bounds.top - height - 6;

  pop.style.left = `${left}px`;
  pop.style.top = `${Math.max(margin, top)}px`;
  pop.style.minWidth = `${Math.max(190, Math.round(bounds.width))}px`;
}

export function syncMiniSelects(scope: ParentNode): void {
  const roots =
    scope instanceof Element && scope.matches('[data-msel]')
      ? [scope as HTMLElement]
      : [...scope.querySelectorAll<HTMLElement>('[data-msel]')];

  for (const root of roots) {
    const input = root.querySelector<HTMLInputElement>('[data-msel-value]');
    if (!input) continue;

    const options = [...root.querySelectorAll<HTMLElement>('[data-msel-option]')];
    for (const option of options) {
      option.setAttribute(
        'aria-selected',
        option.dataset.mselOption === input.value ? 'true' : 'false',
      );
    }

    const match = options.find((option) => option.dataset.mselOption === input.value);
    const label = root.querySelector<HTMLElement>('[data-msel-label]');
    if (label) label.textContent = match?.querySelector<HTMLElement>('[data-msel-text]')
      ?.textContent ?? input.value;
  }
}

let wired = false;

export function initMiniSelects(): void {
  if (wired) return;
  wired = true;

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    const option = target.closest<HTMLElement>('[data-msel-option]');
    if (option) {
      const root = option.closest<HTMLElement>('[data-msel]');
      const input = root?.querySelector<HTMLInputElement>('[data-msel-value]');
      if (root && input && option.dataset.mselOption) {
        const changed = input.value !== option.dataset.mselOption;
        input.value = option.dataset.mselOption;
        syncMiniSelects(root);
        if (changed) input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      closeAll();
      return;
    }

    const trigger = target.closest<HTMLElement>('[data-msel-btn]');
    if (trigger) {
      const root = trigger.closest<HTMLElement>('[data-msel]');
      const pop = root?.querySelector<HTMLElement>('[data-msel-pop]');
      if (!root || !pop) return;
      const willOpen = pop.hidden;
      closeAll(root);
      if (willOpen) {
        pop.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        positionPop(pop, trigger);
      }
      return;
    }

    if (!target.closest('[data-msel]')) closeAll();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAll();
  });

  window.addEventListener('resize', () => closeAll());

  // Any scroll (the dialog body included) would otherwise leave the panel behind.
  document.addEventListener(
    'scroll',
    (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-msel-pop]')) {
        closeAll();
      }
    },
    true,
  );

  // `reset` does not bubble, so listen in the capture phase or the event never
  // gets past the form. Hidden inputs are not resettable at all, hence the walk
  // back to each select's own recorded default.
  document.addEventListener(
    'reset',
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      window.setTimeout(() => {
        for (const input of form.querySelectorAll<HTMLInputElement>('[data-msel-value]')) {
          if (input.dataset.mselDefault !== undefined) input.value = input.dataset.mselDefault;
        }
        syncMiniSelects(form);
      }, 0);
    },
    true,
  );
}
