/**
 * Syntax-highlighting theme.
 * Kept as a string so the same CSS can be reused by the in-app renderer and by
 * the standalone HTML/PDF export (single source of truth).
 */
export const HIGHLIGHT_THEME_CSS =
  '.hljs{color:#e5e5e5}.hljs-comment,.hljs-quote{color:#6b7280;font-style:italic}' +
  '.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-doctag{color:#c792ea}' +
  '.hljs-string,.hljs-regexp,.hljs-addition{color:#a5d6a7}' +
  '.hljs-number,.hljs-symbol,.hljs-bullet{color:#f78c6c}' +
  '.hljs-title,.hljs-section{color:#82aaff}' +
  '.hljs-built_in,.hljs-type,.hljs-title.class_{color:#ffcb6b}' +
  '.hljs-attr,.hljs-attribute,.hljs-variable,.hljs-template-variable,.hljs-property{color:#89ddff}' +
  '.hljs-name,.hljs-tag,.hljs-selector-id,.hljs-selector-class,.hljs-deletion{color:#f07178}' +
  '.hljs-meta{color:#7f8ea3}.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:700}';
