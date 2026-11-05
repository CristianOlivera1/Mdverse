// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { createTextMirror } from '../../src/lib/editor/textMirror';

/** jsdom has no layout, so the textarea's box metrics are supplied by hand. */
function fakeBox(
  textarea: HTMLTextAreaElement,
  box: { offsetWidth: number; clientWidth: number; width: number; height: number },
): void {
  Object.defineProperty(textarea, 'offsetWidth', { configurable: true, value: box.offsetWidth });
  Object.defineProperty(textarea, 'clientWidth', { configurable: true, value: box.clientWidth });
  textarea.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width: box.width,
      height: box.height,
      right: box.width,
      bottom: box.height,
      toJSON: () => ({}),
    }) as DOMRect;
}

function mountTextarea(padding: string): HTMLTextAreaElement {
  document.body.innerHTML = `<textarea style="padding: ${padding}; border: 0"></textarea>`;
  return document.querySelector('textarea') as HTMLTextAreaElement;
}

describe('textarea mirror geometry', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('uses the content width, so a scrollbar cannot shift the line wrapping', () => {
    const textarea = mountTextarea('16px');
    // 600px border box, 10px classic scrollbar, 16px padding on each side.
    fakeBox(textarea, { offsetWidth: 600, clientWidth: 590, width: 600, height: 400 });

    const mirror = createTextMirror(textarea);

    expect(mirror.style.boxSizing).toBe('content-box');
    expect(mirror.style.width).toBe('558px');
    // Content-box height plus the 16px padding above and below must equal the
    // textarea's 400px client height, or the scroll offsets stop matching.
    expect(mirror.style.height).toBe('368px');
  });

  it('keeps the full width when the scrollbar is an overlay', () => {
    const textarea = mountTextarea('16px');
    // Overlay scrollbars take no layout space: clientWidth === offsetWidth.
    fakeBox(textarea, { offsetWidth: 600, clientWidth: 600, width: 600, height: 400 });

    const mirror = createTextMirror(textarea);

    expect(mirror.style.width).toBe('568px');
  });
});
