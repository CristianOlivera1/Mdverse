import { downloadBlob } from '../export/download';
import { EXPORT_CSS } from '../markdown/exportTheme';
import { HIGHLIGHT_THEME_CSS } from '../markdown/highlightTheme';
import { escapeHtml } from '../markdown/toc';
import { renderMarkdown } from '../markdown/render';
import { renderDiagram } from '../markdown/mermaid';
import { slugifyHeading } from '../markdown/slug';

export { EXPORT_CSS, downloadBlob };

export type ExportKind = 'html' | 'pdf' | 'docx';

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
  /** Why it failed, when it did. `engine` covers a document that could not render. */
  readonly reason?: 'empty' | 'engine' | 'network';
}

function localName(title: string, extension: string): string {
  return `${slugifyHeading(title) || 'document'}.${extension}`;
}

export async function exportDocument({
  kind,
  markdown,
  fallbackName,
}: ExportRequest): Promise<ExportResult> {
  if (!markdown.trim()) return { ok: false, reason: 'empty' };

  if (kind === 'pdf') return exportPdf(markdown, fallbackName);
  if (kind === 'docx') return exportDocx(markdown, fallbackName);

  const html = await buildExportHtml(markdown, fallbackName);
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), localName(fallbackName, 'html'));
  return { ok: true };
}

async function exportPdf(markdown: string, title: string): Promise<ExportResult> {
  try {
    const { renderPdf } = await import('../export/pdf');
    const blob = await renderPdf(markdown, {
      title,
      brand: 'Mdverse',
      url: typeof window !== 'undefined' ? window.location.host : undefined,
    });

    downloadBlob(blob, localName(title, 'pdf'));
    return { ok: true };
  } catch (error) {
    console.warn('[export] PDF generation failed:', error);
    return { ok: false, reason: 'engine' };
  }
}

async function exportDocx(markdown: string, title: string): Promise<ExportResult> {
  let response: Response;
  try {
    response = await fetch('/api/export/docx', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ markdown, title }),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }

  if (!response.ok) {
    console.warn('[export] DOCX server returned', response.status);
    return { ok: false, reason: 'engine' };
  }

  const blob = await response.blob();
  downloadBlob(blob, localName(title, 'docx'));
  return { ok: true };
}

export function downloadMarkdown(markdown: string, fileName: string): void {
  downloadBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), localName(fileName, 'md'));
}
