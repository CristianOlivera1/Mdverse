/**
 * Icon guard.
 *
 * `astro-icon` only ships the icons listed in `src/lib/ui/iconNames.ts`, which
 * `astro.config.mjs` spreads into the plugin's `include` map. Anything left out
 * is dropped *silently*: no build error, no lint error, no type error. With
 * `output: 'server'` the failed lookup aborts the render of the page it is on,
 * and the response is a `200 OK` with an empty body — a blank window that looks
 * like a broken app rather than a missing icon.
 *
 * That is why this file exists: it turns both halves of the contract — the name
 * is declared, and the declared collection is installed — into failures with a
 * file name attached.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ICONIFY_ICONS } from '../../src/lib/ui/iconNames';

const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url));
const ICONIFY_DIR = fileURLToPath(new URL('../../node_modules/@iconify-json', import.meta.url));

/** Literal `name="set:icon"` attributes, the only form we can resolve statically. */
const ICON_ATTRIBUTE = /\bname="([a-z0-9-]+):([a-z0-9-]+)"/g;

const declaredIcons = new Set(
  Object.entries(ICONIFY_ICONS).flatMap(([set, names]) => names.map((name) => `${set}:${name}`)),
);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

function sourceIconsIn(dir: string): string[] {
  const found: string[] = [];
  for (const file of walk(dir)) {
    if (!file.endsWith('.astro') && !file.endsWith('.ts')) continue;
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(ICON_ATTRIBUTE)) {
      found.push(`${relative(SRC_DIR, file)}: ${match[1]}:${match[2]}`);
    }
  }
  return found;
}

describe('icon names', () => {
  it('uses only icons declared in iconNames.ts', () => {
    const undeclared = sourceIconsIn(SRC_DIR).filter(
      (usage) => !declaredIcons.has(usage.slice(usage.indexOf(': ') + 2)),
    );

    expect(undeclared).toEqual([]);
  });

  it('declares only icons its collection actually provides', () => {
    const unavailable: string[] = [];

    for (const [set, names] of Object.entries(ICONIFY_ICONS)) {
      const collection = join(ICONIFY_DIR, set, 'icons.json');
      if (!existsSync(collection)) {
        unavailable.push(`${set}: install @iconify-json/${set}`);
        continue;
      }

      const { icons = {}, aliases = {} } = JSON.parse(readFileSync(collection, 'utf8')) as {
        icons?: Record<string, unknown>;
        aliases?: Record<string, unknown>;
      };
      const available = new Set([...Object.keys(icons), ...Object.keys(aliases)]);

      for (const name of names) {
        if (!available.has(name)) unavailable.push(`${set}:${name}`);
      }
    }

    expect(unavailable).toEqual([]);
  });
});
