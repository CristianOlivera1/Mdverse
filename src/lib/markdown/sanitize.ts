import DOMPurify from 'dompurify';

/**
 * Sanitize rendered Markdown before it is inserted into the DOM.
 * The Markdown pipeline is the main XSS surface of the app, so every
 * HTML string goes through DOMPurify (see block 14.2 of the plan).
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
