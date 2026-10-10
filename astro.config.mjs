// @ts-check
import { defineConfig, envField } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import icon from 'astro-icon';

import { CSP_STATIC_DIRECTIVES } from './src/lib/security/headers';
import { ICONIFY_ICONS } from './src/lib/ui/iconNames';

const iconInclude = Object.fromEntries(
  Object.entries(ICONIFY_ICONS).map(([set, names]) => [set, [...names]]),
);

// https://astro.build/config
export default defineConfig({
  site: 'https://mdverse.dev',

  output: 'server',

  adapter: cloudflare(),

  integrations: [
    icon({ include: iconInclude }),
  ],

  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: { exclude: ['react', 'react-dom'] },
  },

  env: {
    schema: {
      PUBLIC_SITE_URL: envField.string({
        context: 'client',
        access: 'public',
        default: 'http://localhost:4321',
      }),
      PUBLIC_GITHUB_OWNER: envField.string({
        context: 'client',
        access: 'public',
        default: 'CristianOlivera1',
      }),
      PUBLIC_GITHUB_REPO: envField.string({
        context: 'client',
        access: 'public',
        default: 'Mdverse',
      }),
      PUBLIC_SUPABASE_URL: envField.string({ context: 'client', access: 'public', optional: true }),
      PUBLIC_SUPABASE_PUBLISHABLE_KEY: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),

      SUPABASE_SECRET_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),

      PUBLIC_TURNSTILE_SITE_KEY: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),
      TURNSTILE_SECRET_KEY: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      PUBLIC_TWITTER_SITE: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),

      RESEND_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      RESEND_FROM_EMAIL: envField.string({ context: 'server', access: 'secret', optional: true }),
      RESEND_REPLY_TO: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },

  security: {
    // Keep Astro's same-origin check for form POSTs (the default). Every form in
    // the app is same-origin by construction, so this is pure defense in depth.
    checkOrigin: true,

    // Astro hashes the scripts and styles it emits and then writes the CSP header
    // on on-demand routes (`<meta>` on prerendered ones). The policy lives here
    // rather than in middleware on purpose: only Astro knows the hashes of what
    // it actually rendered. The origin-dependent directives come from
    // `src/lib/security/headers.ts` so they can be unit-tested.
    csp: {
      // Only the directives that do not depend on the deployment. The Supabase
      // origins are appended per request by `src/middleware.ts`, because
      // `PUBLIC_SUPABASE_URL` is injected at runtime, not at build time.
      directives: [...CSP_STATIC_DIRECTIVES],
      scriptDirective: {
        resources: [
          // Bundled modules are same-origin; Turnstile is the only third party.
          "'self'",
          'https://challenges.cloudflare.com',
          // Inline event handlers are denied outright: the app has none, and
          // `script-src-attr 'none'` says so instead of leaving it implicit.
          { resource: "'none'", kind: 'attribute' },
        ],
      },
      styleDirective: {
        resources: [
          // Mermaid and KaTeX build their SVG with inline `style` attributes, so
          // a hash-only `style-src` would blank every diagram. Scripts stay
          // strict; styles keep `'unsafe-inline'` (supplying a hash would
          // disable it, per the CSP spec precedence rules).
          "'self'",
          "'unsafe-inline'",
          { resource: "'unsafe-inline'", kind: 'attribute' },
        ],
      },
    },
  },
});
