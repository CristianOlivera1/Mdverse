import { EXPORT_CSS } from '../markdown/exportTheme';
import { HIGHLIGHT_THEME_CSS } from '../markdown/highlightTheme';
import { escapeHtml } from '../markdown/toc';
import { renderMarkdown } from '../markdown/render';
import { renderDiagram } from '../markdown/mermaid';
import { slugifyHeading } from '../markdown/slug';

export { EXPORT_CSS };

export type ExportKind = 'html' | 'pdf';

export interface ExportRequest {
  readonly kind: ExportKind;
  readonly markdown: string;
  readonly fallbackName: string;
}

export async function buildExportHtml(markdown: string, title: string): Promise<string> {
  const host = document.createElement('div');
  await renderMarkdown(host, markdown, { renderDiagram });
  const documentTitle = (host.querySelector('h1, h2')?.textContent ?? title).trim();
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${escapeHtml(documentTitle)}</title>` +
    `<style>${EXPORT_CSS}${HIGHLIGHT_THEME_CSS}</style>` +
    `</head><body><article>${host.innerHTML}</article></body></html>`
  );
}

export interface ExportResult {
  readonly ok: boolean;
  readonly reason?: 'empty' | 'popup-blocked' | 'aborted';
}

/** Print window (PDF) or `.html` download; structured result instead of `alert()`. */
export async function exportDocument({
  kind,
  markdown,
  fallbackName,
}: ExportRequest): Promise<ExportResult> {
  if (!markdown.trim()) return { ok: false, reason: 'empty' };

  const printWindow = kind === 'pdf' ? window.open('', '_blank') : null;
  if (kind === 'pdf' && !printWindow) return { ok: false, reason: 'popup-blocked' };

  const html = await buildExportHtml(markdown, fallbackName);
  const printable = printWindow
    ? html.replace(
        '</body>',
        '<script>addEventListener("load",()=>setTimeout(()=>print(),400))</script></body>',
      )
    : html;

  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(printable);
    printWindow.document.close();
    return { ok: true };
  }

  const url = URL.createObjectURL(new Blob([printable], { type: 'text/html;charset=utf-8' }));
  const anchor = Object.assign(document.createElement('a'), {
    href: url,
    download: `${slugifyHeading(fallbackName) || 'document'}.html`,
  });
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return { ok: true };
}

export function downloadMarkdown(markdown: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const anchor = Object.assign(document.createElement('a'), {
    href: url,
    download: `${slugifyHeading(fileName) || 'document'}.md`,
  });
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
