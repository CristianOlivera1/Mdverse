/**
 * Server-side export: a published document as one file that opens anywhere.
 *
 * The three ways out of the app are defined here and nowhere else:
 *   * `document.html` - this file, complete: styles inlined, no scripts, no
 *     network. It is what makes an export *reproducible*: the same Markdown and
 *     the same renderer give the same bytes, on a worker or on a laptop.
 *   * `document.html?print=1` - the same file plus a call to `print()` on load.
 *     That is the "PDF" until a real engine lands (block 16 of the plan): the
 *     browser's print-to-PDF renders exactly the page it was given.
 *   * `document.md` - the owner's Markdown, byte for byte, never re-rendered.
 *
 * The HTML in `bodyHtml` is trusted by construction: it comes from
 * `renderStaticMarkdown`, which drops raw HTML from the source. Everything else
 * interpolated here - the title, the URLs, the dates - goes through `escapeHtml`.
 */

import { HIGHLIGHT_THEME_CSS } from './markdown/highlightTheme';
import { EXPORT_CSS } from './markdown/exportTheme';
import { escapeHtml } from './markdown/toc';
import type { StaticHeading } from './markdown/renderStatic';

export interface StandaloneDocument {
  readonly title: string;
  /** Absolute URL of the public page; also the canonical address of the file. */
  readonly url: string;
  /** Absolute URL of the Markdown source, linked from the header and footer. */
  readonly markdownUrl: string;
  readonly description: string;
  /** Human-readable timestamp, already formatted (see `formatTimestamp`). */
  readonly updatedLabel: string;
  readonly revision: number;
  readonly bodyHtml: string;
  readonly headings: readonly StaticHeading[];
}

function tableOfContents(headings: readonly StaticHeading[]): string {
  const visible = headings.filter((heading) => heading.level <= 3);
  if (visible.length < 2) return '';

  const min = Math.min(...visible.map((heading) => heading.level));
  const items = visible
    .map(
      (heading) =>
        `<li style="margin-left:${(heading.level - min) * 14}px">` +
        `<a href="#${heading.id}">${escapeHtml(heading.text)}</a></li>`,
    )
    .join('');

  return (
    `<nav aria-label="Contents" style="max-width:820px;margin:24px auto 0;padding:0 24px">` +
    `<p style="margin:0;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#59636e">Contents</p>` +
    `<ul style="margin:8px 0 0;padding-left:18px;font-size:13px;line-height:1.7">${items}</ul></nav>`
  );
}

export function buildStandaloneHtml(
  document: StandaloneDocument,
  options: { print?: boolean } = {},
): string {
  const printable = options.print === true;
  const printer = printable
    ? '<script>addEventListener("load",()=>setTimeout(()=>print(),400))</script>'
    : '';

  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${escapeHtml(document.title)}</title>` +
    `<meta name="description" content="${escapeHtml(document.description)}">` +
    `<link rel="canonical" href="${escapeHtml(document.url)}">` +
    `<link rel="alternate" type="text/markdown" href="${escapeHtml(document.markdownUrl)}">` +
    '<meta name="generator" content="Mdverse">' +
    `<style>${EXPORT_CSS}${HIGHLIGHT_THEME_CSS}` +
    'header{max-width:820px;margin:0 auto;padding:32px 24px 0}' +
    'header h1{margin:0;border:0;font-size:1.9em}' +
    'header p{margin:.4em 0 0;font-size:12px;color:#59636e}' +
    'footer{max-width:820px;margin:0 auto;padding:8px 24px 40px;font-size:12px;color:#59636e}' +
    '</style></head><body>' +
    `<header><h1>${escapeHtml(document.title)}</h1>` +
    `<p>Updated ${escapeHtml(document.updatedLabel)} · revision ${document.revision} · ` +
    `<a href="${escapeHtml(document.url)}">published page</a> · ` +
    `<a href="${escapeHtml(document.markdownUrl)}">Markdown source</a></p></header>` +
    tableOfContents(document.headings) +
    `<article>${document.bodyHtml}</article>` +
    `<footer>Exported from <a href="${escapeHtml(document.url)}">${escapeHtml(document.url)}</a> with ` +
    `Mdverse. The Markdown is the source of truth; this file is a rendering of it.</footer>` +
    printer +
    '</body></html>'
  );
}
