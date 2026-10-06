export interface TocHeading {
  readonly id: string;
  readonly text: string;
  readonly level: number;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      default:
        return '&quot;';
    }
  });
}

export function collectHeadings(root: ParentNode, selector = 'h1, h2, h3, h4'): TocHeading[] {
  return [...root.querySelectorAll<HTMLElement>(selector)].map((element) => ({
    id: element.id,
    text: element.textContent ?? '',
    level: Number(element.tagName[1]),
  }));
}

/** Table-of-contents markup, indented by heading level. */
export function buildTocHtml(headings: TocHeading[]): string {
  if (!headings.length) {
    return '<p class="px-3 py-2 text-xs text-neutral-600">This document has no headings.</p>';
  }
  const min = Math.min(...headings.map((heading) => heading.level));
  return headings
    .map(
      (heading) =>
        `<a href="#${heading.id}" data-id="${heading.id}" title="${escapeHtml(heading.text)}"` +
        ` style="padding-left:${12 + (heading.level - min) * 14}px">${escapeHtml(heading.text)}</a>`,
    )
    .join('');
}
