import { PREF_KEYS, readJsonPref, readPref, writePref } from '../editor/prefs';
import { isDocumentId } from '../documents/ids';
import { isCloudDocument } from '../documents/types';
import type { OpenDocument } from '../documents/types';
import { renderDiagram } from '../markdown/mermaid';
import { renderMarkdown } from '../markdown/render';
import { buildTocHtml, collectHeadings } from '../markdown/toc';

export function initPreviewApp(): void {
  const rootElement = document.getElementById('preview-root');
  const contentElement = document.getElementById('preview-content');
  const scrollElement = document.getElementById('preview-scroll');
  const statusElement = document.getElementById('preview-status');
  if (!rootElement || !contentElement || !scrollElement) return;

  const root: HTMLElement = rootElement;
  const content: HTMLElement = contentElement;
  const scroll: HTMLElement = scrollElement;
  const status: HTMLElement | null = statusElement;

  const params = new URLSearchParams(window.location.search);
  const requestedId = params.get('doc');
  const navs = [...document.querySelectorAll<HTMLElement>('.toc')];
  const float = document.getElementById('toc-float');

  let headings: HTMLElement[] = [];
  let signature = '';
  let current = -1;
  let frame = 0;
  let renderTimer: number | undefined;
  let hashConsumed = false;

  const readDocuments = (): OpenDocument[] =>
    readJsonPref<OpenDocument[]>(PREF_KEYS.openDocuments, []);

  async function loadDocument(): Promise<OpenDocument | undefined> {
    const list = readDocuments();
    const local = requestedId ? list.find((doc) => doc.id === requestedId) : list[0];
    if (local) return local;
    if (!requestedId || !isDocumentId(requestedId)) return undefined;

    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(requestedId)}`, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!response.ok) return undefined;

      const payload: unknown = await response.json();
      const found = (payload as { document?: unknown }).document;
      return isCloudDocument(found)
        ? { id: found.id, title: found.title, content: found.content }
        : undefined;
    } catch {
      return undefined;
    }
  }

  document.documentElement.style.setProperty('--z', readPref(PREF_KEYS.zoom) ?? '1');
  root.dataset.toc = readPref(PREF_KEYS.toc) || 'open';

  function mark(): void {
    frame = 0;
    if (!headings.length) return;
    const top = scroll.getBoundingClientRect().top + 24;
    let index = 0;
    for (let i = 0; i < headings.length; i++) {
      if (headings[i].getBoundingClientRect().top <= top) index = i;
      else break;
    }
    if (index === current) return;
    current = index;
    navs.forEach((nav) => {
      nav.querySelector('.on')?.classList.remove('on');
      const link = nav.querySelector<HTMLElement>(`a[data-id="${headings[index].id}"]`);
      if (link) {
        link.classList.add('on');
        link.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function buildToc(): void {
    headings = [...content.querySelectorAll<HTMLElement>('h1, h2, h3, h4')];
    const next = headings
      .map((heading) => heading.tagName + heading.id + heading.textContent)
      .join('|');
    if (next !== signature) {
      signature = next;
      const html = buildTocHtml(collectHeadings(content, 'h1, h2, h3, h4'));
      navs.forEach((nav) => {
        nav.innerHTML = html;
      });
    }
    current = -1;
    mark();
  }

  function syncHash(id: string): void {
    try {
      const url = new URL(window.location.href);
      url.hash = id;
      window.history.replaceState(null, '', url);
    } catch {
      // Non-http(s) contexts: the view still scrolls, the URL just lags.
    }
  }

  // Deep links (`/preview?doc=<id>#<heading>`) land on the heading once, right
  // after the first render that produces it. Later renders never yank the view.
  function honorInitialHash(): void {
    if (hashConsumed) return;
    hashConsumed = true;
    let raw: string;
    try {
      raw = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return;
    }
    if (!raw) return;
    let target: Element | null;
    try {
      target = content.querySelector(`[id="${CSS.escape(raw)}"]`);
    } catch {
      return;
    }
    target?.scrollIntoView({ block: 'start' });
  }

  async function render(): Promise<void> {
    const doc = await loadDocument();
    if (!doc) {
      content.innerHTML = '<p class="text-neutral-500">No document is available.</p>';
      if (status) status.textContent = 'No document';
      return;
    }

    const applied = await renderMarkdown(content, doc.content, { renderDiagram });
    if (!applied) return;
    buildToc();
    honorInitialHash();
    document.title = `${doc.title} · Mdverse`;
    if (status) status.textContent = `Synced · ${new Date().toLocaleTimeString('en-US')}`;
  }

  function scheduleRender(): void {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => void render(), 120);
  }

  navs.forEach((nav) =>
    nav.addEventListener('click', (event) => {
      const link = (event.target as HTMLElement).closest<HTMLElement>('a[data-id]');
      if (!link?.dataset.id) return;
      event.preventDefault();
      syncHash(link.dataset.id);
      headings
        .find((heading) => heading.id === link.dataset.id)
        ?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      float?.classList.add('hidden');
    }),
  );

  content.addEventListener('click', (event) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!link) return;
    event.preventDefault();
    let id: string;
    try {
      id = decodeURIComponent((link.getAttribute('href') ?? '').slice(1));
    } catch {
      return;
    }
    if (!id) return;
    syncHash(id);
    let target: Element | null;
    try {
      target = content.querySelector(`[id="${CSS.escape(id)}"]`);
    } catch {
      return;
    }
    target?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  });

  scroll.addEventListener(
    'scroll',
    () => {
      if (!frame) frame = requestAnimationFrame(mark);
    },
    { passive: true },
  );

  const setToc = (value: string): void => {
    root.dataset.toc = value;
    writePref(PREF_KEYS.toc, value);
  };

  document.getElementById('toc-close')?.addEventListener('click', () => setToc('closed'));
  document.getElementById('toc-open')?.addEventListener('click', () => setToc('open'));
  document
    .getElementById('toc-fab')
    ?.addEventListener('click', () => float?.classList.toggle('hidden'));

  window.addEventListener('storage', (event) => {
    if (event.key === PREF_KEYS.zoom || event.key === null) {
      document.documentElement.style.setProperty('--z', readPref(PREF_KEYS.zoom) ?? '1');
    }
    if (event.key === PREF_KEYS.openDocuments || event.key === null) scheduleRender();
  });

  void render();
}
