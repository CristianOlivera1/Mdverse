import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/**
 * Only the languages we ship are registered, so `highlight.js` stays
 * tree-shaken instead of pulling the whole bundle (see block 13 of the plan).
 */
const LANGUAGES = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  go,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  php,
  python,
  ruby,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};

const ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  py: 'python',
  rs: 'rust',
  cs: 'csharp',
  md: 'markdown',
  node: 'javascript',
};

/** Languages shown in the export/documentation. */
export const SUPPORTED_LANGUAGES = Object.keys(LANGUAGES);

let registered = false;

function ensureRegistered(): void {
  if (registered) return;
  for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language);
  registered = true;
}

export function resolveLanguage(language: string): string {
  const key = language.toLowerCase();
  return ALIASES[key] ?? key;
}

export function isSupported(language: string): boolean {
  ensureRegistered();
  return Boolean(hljs.getLanguage(resolveLanguage(language)));
}

const cache = new Map<string, string>();
const CACHE_LIMIT = 200;

/** Highlight a snippet, or return `null` when the language is not supported. */
export function highlightCode(code: string, language: string): string | null {
  ensureRegistered();
  const resolved = resolveLanguage(language);
  if (!hljs.getLanguage(resolved)) return null;

  const key = `${resolved}\0${code}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const value = hljs.highlight(code, { language: resolved, ignoreIllegals: true }).value;
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, value);
  return value;
}
