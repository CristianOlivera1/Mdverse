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
    checkOrigin: true,

    csp: {
      directives: [...CSP_STATIC_DIRECTIVES],
      scriptDirective: {
        resources: [
          "'self'",
          'https://challenges.cloudflare.com',
          { resource: "'none'", kind: 'attribute' },
        ],
      },
      styleDirective: {
        resources: [
          "'self'",
          "'unsafe-inline'",
          { resource: "'unsafe-inline'", kind: 'attribute' },
        ],
      },
    },
  },
});
