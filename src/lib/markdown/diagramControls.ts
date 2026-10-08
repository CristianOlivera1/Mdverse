const MIN_SCALE = 0.2;
const MAX_SCALE = 8;
const STEP = 1.25;
const WHEEL_FACTOR = 1.12;

interface View {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

const clamp = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export function attachDiagramControls(box: HTMLElement): void {
  if (box.dataset.controls === 'on') return;

  const svg = box.querySelector('svg');
  if (!svg) return;
  box.dataset.controls = 'on';

  const viewBox = svg.viewBox?.baseVal;
  const width = viewBox && viewBox.width > 0 ? viewBox.width : 0;
  const height = viewBox && viewBox.height > 0 ? viewBox.height : 0;
  if (width > 0 && height > 0) {
    svg.removeAttribute('style');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
  }

  const viewport = document.createElement('div');
  viewport.className = 'diagram-viewport';

  const stage = document.createElement('div');
  stage.className = 'diagram-stage';
  stage.append(svg);
  viewport.append(stage);

  const bar = document.createElement('div');
  bar.className = 'diagram-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Diagram controls');
  bar.innerHTML =
    '<button type="button" data-diagram="out" title="Zoom out" aria-label="Zoom out">−</button>' +
    '<span class="diagram-level" data-diagram="level">100%</span>' +
    '<button type="button" data-diagram="in" title="Zoom in" aria-label="Zoom in">+</button>' +
    '<button type="button" data-diagram="fit" title="Fit to width" aria-label="Fit to width">Fit</button>' +
    '<button type="button" data-diagram="reset" title="Actual size" aria-label="Actual size">1:1</button>';

  box.replaceChildren(viewport, bar);

  const level = bar.querySelector<HTMLElement>('[data-diagram="level"]');
  let view: View = { scale: 1, x: 0, y: 0 };
  let adjusted = false;

  const apply = (): void => {
    stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    if (level) level.textContent = `${Math.round(view.scale * 100)}%`;
  };

  const fit = (): void => {
    const available = viewport.clientWidth - 2;
    if (available <= 0 || width <= 0) {
      apply();
      return;
    }
    const scale = clamp(Math.min(1, available / width));
    view = { scale, x: Math.max(0, (available - width * scale) / 2), y: 0 };
    apply();
  };

  const zoomAt = (factor: number, cx: number, cy: number): void => {
    const next = clamp(view.scale * factor);
    if (next === view.scale) return;
    const k = next / view.scale;
    view = { scale: next, x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k };
    adjusted = true;
    apply();
  };

  viewport.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      zoomAt(
        event.deltaY < 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR,
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    },
    { passive: false },
  );

  let panning = false;
  let from = { x: 0, y: 0 };
  let origin = { x: 0, y: 0 };

  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    panning = true;
    from = { x: event.clientX, y: event.clientY };
    origin = { x: view.x, y: view.y };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-panning');
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!panning) return;
    view = {
      scale: view.scale,
      x: origin.x + (event.clientX - from.x),
      y: origin.y + (event.clientY - from.y),
    };
    adjusted = true;
    apply();
  });

  const endPan = (event: PointerEvent): void => {
    if (!panning) return;
    panning = false;
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    viewport.classList.remove('is-panning');
  };
  viewport.addEventListener('pointerup', endPan);
  viewport.addEventListener('pointercancel', endPan);

  viewport.addEventListener('dblclick', () => {
    fit();
    adjusted = false;
  });

  bar.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-diagram]')?.dataset
      .diagram;
    if (!action || action === 'level') return;

    const rect = viewport.getBoundingClientRect();
    if (action === 'in') zoomAt(STEP, rect.width / 2, rect.height / 2);
    else if (action === 'out') zoomAt(1 / STEP, rect.width / 2, rect.height / 2);
    else if (action === 'fit') {
      fit();
      adjusted = false;
    } else if (action === 'reset') {
      view = { scale: 1, x: 0, y: 0 };
      adjusted = true;
      apply();
    }
  });

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      if (!adjusted) fit();
    }).observe(viewport);
  }

  requestAnimationFrame(() => {
    if (box.isConnected && !adjusted) fit();
  });
}
