import { HIGHLIGHT_THEME_CSS } from '../markdown/highlightTheme';
import { escapeHtml } from '../markdown/toc';
import { renderMarkdown } from '../markdown/render';
import { renderDiagram } from '../markdown/mermaid';
import { slugifyHeading } from '../markdown/slug';

export const EXPORT_CSS =
  '*{box-sizing:border-box;print-color-adjust:exact;-webkit-print-color-adjust:exact}' +
  'body{margin:0;background:#fff;color:#1f2328;font:16px/1.65 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}' +
  'article{max-width:820px;margin:0 auto;padding:40px 24px}' +
  'h1,h2,h3,h4{line-height:1.25;margin:1.6em 0 .6em}h1{font-size:2em}' +
  'h1,h2{border-bottom:1px solid #d8dee4;padding-bottom:.3em}h2{font-size:1.5em}' +
  'a{color:#0969da}code{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:.88em}' +
  ':not(pre)>code{background:#eff1f3;padding:.15em .4em;border-radius:4px}' +
  'pre{background:#0a0a0a;color:#e5e5e5;padding:14px 16px;border-radius:8px;overflow:auto}' +
  'table{border-collapse:collapse;margin:1em 0;width:100%}th,td{border:1px solid #d0d7de;padding:6px 12px;text-align:left}' +
  'th{background:#f6f8fa}blockquote{margin:1em 0;padding:0 1em;color:#59636e;border-left:4px solid #d0d7de}' +
  'hr{border:0;border-top:1px solid #d8dee4}img{max-width:100%}' +
  '.mermaid-box{margin:1.2em 0;padding:16px;background:#050505;border-radius:10px;text-align:center;overflow:auto;break-inside:avoid}' +
  '.mermaid-box svg{max-width:100%;height:auto}.mermaid-err{color:#f87171;text-align:left;font-size:12px}' +
  '@page{margin:16mm}@media print{pre,table,tr,blockquote{break-inside:avoid}h1,h2,h3,h4{break-after:avoid}}';

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
