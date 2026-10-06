/**
 * The Iconify icons this app ships.
 *
 * Icons come from [Iconify](https://iconify.design) through `astro-icon`: the
 * collections are npm packages (`@iconify-json/*`), so icons are inlined as SVG
 * at build time — no Iconify CDN, no client JavaScript, and nothing to fetch at
 * runtime.
 *
 * This file is the single source of truth:
 *  - `astro.config.mjs` reads it to build the `icon({ include })` filter. With
 *    `output: 'server'` the filter is required: without it astro-icon bundles
 *    *every* icon of every installed set into the server bundle.
 *  - `components/ui/Icon.astro` types its `name` prop from the union below, so a
 *    typo or an omitted entry fails `astro check` instead of rendering an empty
 *    box in production.
 *
 * Names are Iconify ids *without* the set prefix, exactly as they appear on
 * https://icon-sets.iconify.design (e.g. `lucide/bold` → `'bold'`).
 */
export const ICONIFY_ICONS = {
  lucide: [
    'arrow-left',
    'arrow-up-down',
    'bold',
    'braces',
    'case-sensitive',
    'chevron-down',
    'chevron-up',
    'clock',
    'code',
    'code-xml',
    'copy',
    'download',
    'eraser',
    'external-link',
    'eye',
    'eye-off',
    'file-code',
    'file-plus',
    'file-text',
    'heading',
    'history',
    'italic',
    'key-round',
    'link',
    'list',
    'list-checks',
    'list-ordered',
    'list-tree',
    'lock',
    'log-in',
    'log-out',
    'mail',
    'mail-check',
    'minus',
    'panel-left-close',
    'pencil-line',
    'plus',
    'printer',
    'quote',
    'redo-2',
    'rotate-ccw',
    'search',
    'settings',
    'shield-check',
    'sliders-horizontal',
    'strikethrough',
    'table',
    'trash',
    'triangle-alert',
    'type',
    'undo-2',
    'upload',
    'users',
    'workflow',
    'x',
    'zoom-in',
  ],
  'simple-icons': ['github', 'google'],
} as const;

type IconifyIcons = typeof ICONIFY_ICONS;

export type IconSet = keyof IconifyIcons;

export type IconName = {
  [Set in IconSet]: `${Set}:${IconifyIcons[Set][number]}`;
}[IconSet];
