import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import astro from 'eslint-plugin-astro';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    ignores: [
      'dist/**',
      '.astro/**',
      'node_modules/**',
      // Third-party agent skills and the reference HTML artifact are not app code.
      '.agents/**',
      'visor-markdown.html',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs['flat/recommended'],
  {
    // Node scripts (the RLS checks talk to the project API directly). They run
    // outside the browser and outside Vite, so the host globals have to be
    // declared: the flat config carries no `globals` package.
    files: ['tests/db/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        URL: 'readonly',
      },
    },
  },
]);
