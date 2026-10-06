// @ts-check
import { defineConfig, envField } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import icon from 'astro-icon';

import { ICONIFY_ICONS } from './src/lib/ui/iconNames';

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
    // `output: 'server'` — without it every icon of every installed set would be
    // bundled into the server output. The list lives in one place:
    // `src/lib/ui/iconNames.ts`.
    icon({
      include: {
        lucide: [...ICONIFY_ICONS.lucide],
        'simple-icons': [...ICONIFY_ICONS['simple-icons']],
      },
    }),
  ],

  // Tailwind CSS v4 is compiled at build time (the CDN is intentionally not used).
  vite: {
    plugins: [tailwindcss()],
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
    },
  },
});
