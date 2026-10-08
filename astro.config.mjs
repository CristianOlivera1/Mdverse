// @ts-check
import { defineConfig, envField } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import icon from 'astro-icon';

import { ICONIFY_ICONS } from './src/lib/ui/iconNames';

// `ICONIFY_ICONS` is the single source of truth for which icons ship.
const iconInclude = Object.fromEntries(
  Object.entries(ICONIFY_ICONS).map(([set, names]) => [set, [...names]]),
);

// https://astro.build/config
export default defineConfig({
  // Public base URL, used for canonical links and sitemaps.
  site: 'https://mdverse.pages.dev',

  // On-demand rendering: required for auth cookies, server actions and API routes.
  // See PLAN_VISOR_MARKDOWN_PRODUCCION.md (blocks 1.4, 3 and 10).
  output: 'server',

  // Deployment target: Cloudflare Pages/Workers.
  adapter: cloudflare(),

  integrations: [
    // Icons: Iconify collections installed as npm packages, inlined as SVG at
    // build time (no CDN, no client JS). The `include` filter is required with
    // `output: 'server'` - without it every icon of every installed set would be
    // bundled into the server output. The list lives in one place:
    // `src/lib/ui/iconNames.ts`, and it is spread here verbatim so that adding a
    // set to the list is enough to have it bundled.
    //
    // This must never drift from the list: an icon that is filtered out here is
    // dropped silently, and with `output: 'server'` the failed lookup aborts the
    // render of the whole page - the visitor gets `200 OK` with an empty body,
    // which no type check, lint or build reports. `tests/unit/icons.test.ts`
    // guards both halves of that contract.
    icon({ include: iconInclude }),
  ],

  // Tailwind CSS v4 is compiled at build time (the CDN is intentionally not used).
  vite: {
    plugins: [tailwindcss()],
    // Dev-only: keep the React email chain out of Vite's SSR prebundle
    // (`deps_ssr`). The optimizer cannot resolve `react` there and the first
    // hit on any route that statically imports `@/lib/email/sender` 500s at
    // import time, before handler code runs ("Try adding it to
    // optimizeDeps.exclude"). Excluding it forces native ESM loading, so
    // `render()` works in `astro dev`. Dev-only option - the Cloudflare
    // production bundle is unaffected. The routes additionally import the
    // sender lazily, so even a broken email stack degrades to a counted
    // failure instead of a 500.
    optimizeDeps: { exclude: ['react', 'react-dom'] },
  },

  env: {
    schema: {
      // Client-safe values: only `PUBLIC_` variables reach the browser.
      PUBLIC_SITE_URL: envField.string({
        context: 'client',
        access: 'public',
        default: 'http://localhost:4321',
      }),
      PUBLIC_SUPABASE_URL: envField.string({ context: 'client', access: 'public', optional: true }),
      PUBLIC_SUPABASE_PUBLISHABLE_KEY: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),

      // Server-only secret. Never exposed to the browser.
      SUPABASE_SECRET_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),

      // ── Resend (transactional email) ────────────────────────────────────
      // Get your key at https://resend.com/api-keys
      RESEND_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Full "Name <email@domain.com>" sender string - must match a verified Resend domain.
      RESEND_FROM_EMAIL: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Reply-to address (optional).
      RESEND_REPLY_TO: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
});
