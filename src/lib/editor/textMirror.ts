// Layout mirror for a textarea.
//
// A textarea cannot report where a character range physically sits, so the
// geometry is measured on a hidden block that reproduces the textarea's text
// layout. The block must be a pixel-perfect twin of the textarea, including its
// usable content width: a textarea reserves room for the vertical scrollbar,
// but a plain block does not. Measuring against the border-box width makes the
// mirror 10px too wide, which changes word wrapping and lands every range below
// a wrap point on the wrong row.

/** CSS that changes text metrics or wrapping. */
const MIRROR_PROPS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontStretch',
  'letterSpacing',
  'wordSpacing',
  'textIndent',
  'textTransform',
  'lineHeight',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'tabSize',
  'whiteSpace',
  'overflowWrap',
  'wordBreak',
] as const;

function px(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Builds the hidden mirror but does not mount it. Call `mountTextMirror` to get
 * a mirror that is already positioned and scrolled like the textarea; use this
 * one only when the caller needs to fill the mirror before mounting.
 */
export function createTextMirror(textarea: HTMLTextAreaElement): HTMLDivElement {
  const style = getComputedStyle(textarea);
  const rect = textarea.getBoundingClientRect();
  const borderLeft = px(style.borderLeftWidth);
  const borderTop = px(style.borderTopWidth);
  const borderX = borderLeft + px(style.borderRightWidth);
  const borderY = borderTop + px(style.borderBottomWidth);

  const mirror = document.createElement('div');
  mirror.setAttribute('aria-hidden', 'true');
  mirror.style.position = 'fixed';
  // The mirror has no border of its own, so shift it past the textarea's.
  mirror.style.top = `${rect.top + borderTop}px`;
  mirror.style.left = `${rect.left + borderLeft}px`;
  mirror.style.height = `${Math.max(
    0,
    rect.height - borderY - px(style.paddingTop) - px(style.paddingBottom),
  )}px`;
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.overflow = 'hidden';
  mirror.style.zIndex = '-9999';
  for (const prop of MIRROR_PROPS) mirror.style[prop] = style[prop];

  // The textarea's own content box excludes its border and scrollbar. Match
  // that width exactly (content-box) so the text wraps in the same places.
  const scrollbar = Math.max(0, textarea.offsetWidth - textarea.clientWidth - borderX);
  const contentWidth = Math.max(
    0,
    rect.width - borderX - scrollbar - px(style.paddingLeft) - px(style.paddingRight),
  );
  mirror.style.boxSizing = 'content-box';
  mirror.style.width = `${contentWidth}px`;

  return mirror;
}

/**
 * Mounts a textarea mirror on the body at the textarea's viewport position and
 * scroll offset. `content` is filled before the scroll is synced, so callers
 * can pass the text (or a fragment with a caret marker) they want to measure.
 * The caller owns it and must remove it after measuring.
 */
export function mountTextMirror(
  textarea: HTMLTextAreaElement,
  content?: Node | string,
): HTMLDivElement {
  const mirror = createTextMirror(textarea);
  if (content !== undefined) mirror.append(content);
  document.body.append(mirror);
  mirror.scrollTop = textarea.scrollTop;
  mirror.scrollLeft = textarea.scrollLeft;
  return mirror;
}
