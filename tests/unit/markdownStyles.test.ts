import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The badge-row bug was pure CSS: the DOM was already a single paragraph, and
 * Tailwind's preflight (`img,svg,video,…{display:block}`) is what split that row
 * into one image per line. The stylesheet is the only place that can express the
 * fix, so the rule is asserted here instead of through the DOM.
 */
const css = readFileSync(
  fileURLToPath(new URL('../../src/styles/markdown.css', import.meta.url)),
  'utf8',
);

/** The declarations of the first rule whose selector matches `selector`. */
function declarations(selector: RegExp): string {
  return selector.exec(css)?.[1] ?? '';
}

describe('markdown.css image rules', () => {
  it('lets images flow inline again, undoing the preflight block', () => {
    const rule = declarations(/\.prose img \{([^}]*)\}/);
    expect(rule).toContain('display: inline-block');
    // Typography's 2em top/bottom margin is for a lone screenshot; a badge row
    // would be pushed apart by it.
    expect(rule).toContain('margin-top: 0');
    expect(rule).toContain('margin-bottom: 0');
  });

  it('keeps the block and the spacing for an image alone in its paragraph', () => {
    const rule = declarations(/\.prose p > img:only-child[^{]*\{([^}]*)\}/);
    expect(rule).toContain('display: block');
    expect(rule).toContain('margin-top: 1.5em');
  });

  it('covers a lone linked image and a lone <picture>, both common in READMEs', () => {
    expect(declarations(/\.prose p > a:only-child > img[^{]*\{([^}]*)\}/)).toContain(
      'display: block',
    );
    expect(declarations(/\.prose p > picture:only-child[^{]*\{([^}]*)\}/)).toContain(
      'display: block',
    );
    // Inside `picture` the wrapper owns the space.
    expect(declarations(/\.prose picture > img \{([^}]*)\}/)).toContain('margin-top: 0');
  });
});
