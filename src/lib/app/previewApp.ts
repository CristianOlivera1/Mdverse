import { PREF_KEYS, readJsonPref, readPref, writePref } from '../editor/prefs';
import { isDocumentId } from '../documents/ids';
import { isCloudDocument } from '../documents/types';
import type { OpenDocument } from '../documents/types';
import { renderDiagram } from '../markdown/mermaid';
import { renderMarkdown } from '../markdown/render';
import { buildTocHtml, collectHeadings } from '../markdown/toc';
import { showAccessGate } from './accessGate';

export function initPreviewApp(): void {
  const rootElement = document.getElementById('preview-root');
  const contentElement = document.getElementById('preview-content');
  const scrollElement = document.getElementById('preview-scroll');
  const statusElement = document.getElementById('preview-status');
  const shareButton = document.querySelector<HTMLButtonElement>('#preview-share');
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
  let shareId: string | null = null;

  function copyPreviewLink(): void {
    const id = shareId;
    if (!id || !isDocumentId(id)) return;

    const url = new URL(window.location.href);
    url.searchParams.set('doc', id);

    void navigator.clipboard
      ?.writeText(url.toString())
      .then(() => {
        if (!shareButton) return;
        shareButton.classList.add('text-emerald-400');
        shareButton.title = 'Link copied';
        window.setTimeout(() => {
          shareButton.classList.remove('text-emerald-400');
          shareButton.title = 'Copy a link to this preview';
        }, 1500);
      })
      .catch(() => {
        /* Clipboard blocked: the address bar still holds the same URL. */
      });
  }

  shareButton?.addEventListener('click', copyPreviewLink);

  const readDocuments = (): OpenDocument[] =>
    readJsonPref<OpenDocument[]>(PREF_KEYS.openDocuments, []);

  type LoadResult =
    | { kind: 'loaded'; doc: OpenDocument }
    | { kind: 'signed-out'; documentId: string }
    | { kind: 'unavailable'; documentId: string }
    | { kind: 'none' };

  async function loadDocument(): Promise<LoadResult> {
    const list = readDocuments();
    const local = requestedId ? list.find((doc) => doc.id === requestedId) : list[0];
    if (local) return { kind: 'loaded', doc: local };
    if (!requestedId || !isDocumentId(requestedId)) return { kind: 'none' };

    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(requestedId)}`, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (response.status === 401) return { kind: 'signed-out', documentId: requestedId };
      if (!response.ok) return { kind: 'unavailable', documentId: requestedId };

      const payload: unknown = await response.json();
      const found = (payload as { document?: unknown }).document;
      return isCloudDocument(found)
        ? { kind: 'loaded', doc: { id: found.id, title: found.title, content: found.content } }
        : { kind: 'unavailable', documentId: requestedId };
    } catch {
      return { kind: 'unavailable', documentId: requestedId };
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
    const result = await loadDocument();

    if (result.kind !== 'loaded') {
      shareId = null;
      if (shareButton) shareButton.hidden = true;

      if (result.kind === 'none') {
        content.innerHTML = '<p class="text-neutral-500">No document is available.</p>';
        navs.forEach((nav) => {
          nav.innerHTML = buildTocHtml([]);
        });
        if (status) status.textContent = 'No document';
        return;
      }

      showAccessGate({
        documentId: result.documentId,
        signedIn: result.kind !== 'signed-out',
        host: content,
      });
      if (status) status.textContent = 'No access';
      return;
    }

    const doc = result.doc;
    const applied = await renderMarkdown(content, doc.content, { renderDiagram });
    if (!applied) return;
    shareId = doc.id;
    if (shareButton) shareButton.hidden = !isDocumentId(doc.id);
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
    .querySelector('[data-logo-refresh]')
    ?.addEventListener('click', () => window.location.reload());
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
