const BOUND_FLAG = 'menusBound';

const allPanels = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-pop]')];

const triggerFor = (panel: HTMLElement): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-menu="${panel.dataset.pop}"]`);

export function closeMenus(except?: HTMLElement | null): void {
  allPanels().forEach((panel) => {
    if (panel === except || panel.hidden) return;
    panel.hidden = true;
    const trigger = triggerFor(panel);
    if (trigger) {
      trigger.classList.remove('on');
      trigger.setAttribute('aria-expanded', 'false');
    }
  });
}

export function openMenu(panel: HTMLElement, trigger: HTMLElement): void {
  panel.hidden = false;
  const bounds = trigger.getBoundingClientRect();
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const below = viewportHeight - bounds.bottom - 8;
  const above = bounds.top - 8;
  const prefersUp = panel.classList.contains('fm-pop');
  const openBelow = prefersUp
    ? above < height && below >= height
    : below >= height || below >= above;
  panel.style.left = `${Math.max(8, Math.min(bounds.right - width, viewportWidth - width - 8))}px`;
  panel.style.top = `${Math.max(8, openBelow ? bounds.bottom + 8 : bounds.top - height - 8)}px`;
  trigger.classList.add('on');
  trigger.setAttribute('aria-expanded', 'true');
}

export function initMenus(): void {
  if (document.documentElement.dataset[BOUND_FLAG] === 'true') return;
  document.documentElement.dataset[BOUND_FLAG] = 'true';

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    const menuTrigger = target.closest<HTMLElement>('[data-menu]');
    if (menuTrigger) {
      const panel = document.querySelector<HTMLElement>(
        `[data-pop="${menuTrigger.dataset.menu}"]`,
      );
      if (!panel) return;
      const willOpen = panel.hidden;
      closeMenus(panel);
      if (willOpen) openMenu(panel, menuTrigger);
      else closeMenus();
      return;
    }

    if (!target.closest('[data-pop]')) closeMenus();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeMenus();
  });

  window.addEventListener('resize', () => closeMenus());
}
