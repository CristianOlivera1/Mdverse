/**
 * GitHub-compatible heading ids.
 * Ported from the original `slug()` in `visor-markdown.html` so that
 * in-document links (`#my-heading`) keep resolving.
 */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}
