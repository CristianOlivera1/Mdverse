import { Marked } from 'marked';
import type { MarkedExtension, Token, Tokens, TokenizerAndRendererExtension } from 'marked';
import markedFootnote from 'marked-footnote';

import { escapeHtml } from './toc';

interface MarkToken extends Tokens.Generic {
  type: 'kdMark';
  tokens: Token[];
}

interface MathToken extends Tokens.Generic {
  type: 'kdMath' | 'kdMathBlock';
  tex: string;
  display: boolean;
}

const MARK_RULE: TokenizerAndRendererExtension = {
  name: 'kdMark',
  level: 'inline',
  start(src) {
    return src.indexOf('==');
  },
  tokenizer(src) {
    const match = /^==(?=[^=\s])([\s\S]*?[^=\s])==(?!=)/.exec(src);
    if (!match) return undefined;
    return {
      type: 'kdMark',
      raw: match[0],
      tokens: this.lexer.inlineTokens(match[1]),
    } satisfies MarkToken;
  },
  renderer(token) {
    const { tokens } = token as MarkToken;
    return `<mark>${this.parser.parseInline(tokens)}</mark>`;
  },
};

export function mathPlaceholder(tex: string, display: boolean): string {
  return (
    `<span class="kd-math" data-tex="${escapeHtml(tex)}"` +
    `${display ? ' data-display="true"' : ''}></span>`
  );
}

const MATH_BLOCK_RULE: TokenizerAndRendererExtension = {
  name: 'kdMathBlock',
  level: 'block',
  start(src) {
    return src.indexOf('$$');
  },
  tokenizer(src) {
    const match = /^\$\$(?:[ \t]*\r?\n)?([\s\S]+?)(?:\r?\n)?\$\$[ \t]*(?:\n+|$)/.exec(src);
    if (!match) return undefined;
    const tex = match[1].trim();
    if (!tex) return undefined;
    return { type: 'kdMathBlock', raw: match[0], tex, display: true } satisfies MathToken;
  },
  renderer(token) {
    const { tex, display } = token as MathToken;
    return mathPlaceholder(tex, display);
  },
};

const MATH_INLINE_RULE: TokenizerAndRendererExtension = {
  name: 'kdMath',
  level: 'inline',
  start(src) {
    return src.indexOf('$');
  },
  tokenizer(src) {
    const match = /^\$(?![\s$])((?:\\.|[^\\$\n])*?[^\s\\$])\$(?![\d$])/.exec(src);
    if (!match) return undefined;
    return { type: 'kdMath', raw: match[0], tex: match[1], display: false } satisfies MathToken;
  },
  renderer(token) {
    const { tex, display } = token as MathToken;
    return mathPlaceholder(tex, display);
  },
};

function mathExtension(): MarkedExtension {
  return { extensions: [MATH_BLOCK_RULE, MATH_INLINE_RULE] };
}

function baseExtensions(): MarkedExtension[] {
  return [
    { extensions: [MARK_RULE] },
    markedFootnote({ footnoteDivider: true }),
  ];
}

let withMath: Marked | null = null;
let withoutMath: Marked | null = null;

export function markdownParser(math: boolean): Marked {
  const cached = math ? withMath : withoutMath;
  if (cached) return cached;

  const parser = new Marked().use(...baseExtensions());
  if (math) parser.use(mathExtension());

  if (math) withMath = parser;
  else withoutMath = parser;
  return parser;
}
