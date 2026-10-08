export function wrapTables(root: ParentNode): void {
  root.querySelectorAll('table').forEach((table) => {
    if (table.parentElement?.classList.contains('table-scroll')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll';
    table.replaceWith(wrapper);
    wrapper.append(table);
  });
}

function copyCode(pre: HTMLPreElement, button: HTMLButtonElement): void {
  const label = button.textContent ?? 'Copy';
  const text = pre.textContent ?? '';
  const settle = (next: string): void => {
    button.textContent = next;
    window.setTimeout(() => {
      if (button.isConnected) button.textContent = label;
    }, 1500);
  };

  void navigator.clipboard
    ?.writeText(text)
    .then(() => settle('Copied'))
    .catch(() => settle('Press Ctrl+C'));
}

export function enhanceCodeBlocks(root: ParentNode): void {
  root.querySelectorAll<HTMLPreElement>('pre').forEach((pre) => {
    if (pre.closest('.mermaid-box') || pre.parentElement?.classList.contains('code-block')) return;

    const language = pre.querySelector('code')?.className.match(/language-([\w+#.-]+)/)?.[1] ?? '';

    const bar = document.createElement('div');
    bar.className = 'code-bar';
    const label = document.createElement('span');
    label.className = 'code-lang';
    label.textContent = language;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.textContent = 'Copy';
    button.addEventListener('click', () => copyCode(pre, button));

    bar.append(label, button);

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    pre.replaceWith(wrapper);
    wrapper.append(bar, pre);
  });
}

export function addHeadingAnchors(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach((heading) => {
    if (!heading.id || heading.querySelector(':scope > .heading-anchor')) return;
    const anchor = document.createElement('a');
    anchor.className = 'heading-anchor';
    anchor.href = `#${heading.id}`;
    anchor.setAttribute('aria-label', 'Link to this section');
    heading.append(anchor);
  });
}

export async function renderMath(root: ParentNode): Promise<void> {
  const nodes = [...root.querySelectorAll<HTMLElement>('.kd-math')];
  if (nodes.length === 0) return;

  let katex: typeof import('katex') | null = null;
  try {
    katex = await import('katex');
  } catch (error) {
    console.warn('[markdown] KaTeX could not load; showing the formula source:', error);
  }

  for (const node of nodes) {
    const tex = node.dataset.tex ?? '';
    const displayMode = node.dataset.display === 'true';

    if (!katex) {
      node.textContent = displayMode ? `$$${tex}$$` : `$${tex}$`;
      node.classList.add(displayMode ? 'kd-math-block' : 'kd-math-inline', 'kd-math-error');
      continue;
    }

    try {
      node.innerHTML = katex.renderToString(tex, {
        displayMode,
        throwOnError: false,
        strict: false,
        trust: false,
      });
      node.classList.add(displayMode ? 'kd-math-block' : 'kd-math-inline');
    } catch {
      node.textContent = tex;
      node.classList.add('kd-math-error');
    }
  }
}

let overlay: HTMLElement | null = null;

function closeLightbox(): void {
  if (overlay) overlay.hidden = true;
}

function openLightbox(src: string, alt: string): void {
  if (!overlay) {
    const element = document.createElement('div');
    element.className = 'image-lightbox';
    element.hidden = true;
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-modal', 'true');
    element.setAttribute('aria-label', 'Image preview');

    const image = document.createElement('img');
    image.alt = '';
    element.append(image);
    element.addEventListener('click', closeLightbox);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeLightbox();
    });
    document.body.append(element);
    overlay = element;
  }

  const image = overlay.querySelector('img');
  if (image) {
    image.src = src;
    image.alt = alt;
  }
  overlay.hidden = false;
}

export function attachImageLightbox(root: ParentNode): void {
  root.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    if (image.dataset.lightbox === 'on') return;
    image.dataset.lightbox = 'on';
    image.classList.add('zoomable');
    image.addEventListener('click', () =>
      openLightbox(image.currentSrc || image.src, image.alt || ''),
    );
  });
}

export function attachTaskToggles(root: ParentNode, onToggle: (index: number) => void): void {
  root.querySelectorAll<HTMLInputElement>('li > input[type="checkbox"]').forEach((box, index) => {
    box.disabled = false;
    box.removeAttribute('disabled');
    box.dataset.taskIndex = String(index);

    const item = box.closest('li');
    const text = item?.textContent?.trim() ?? '';
    box.setAttribute('aria-label', text ? `Task: ${text.slice(0, 80)}` : 'Task');

    box.addEventListener('click', (event) => {
      event.preventDefault();
      onToggle(index);
    });
  });
}
