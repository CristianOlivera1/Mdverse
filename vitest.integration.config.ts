import { defineConfig } from 'vitest/config';

/**
 * Integration tests: these reach the real Supabase project in `.env`, create
 * throwaway accounts and delete them afterwards.
 *
 *   pnpm test:db
 *
 * Kept out of the default `pnpm test` run on purpose - the unit suite stays
 * hermetic and fast, and a machine with no network never reports a false failure.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // One file at a time: these tests create and delete real accounts.
    fileParallelism: false,
  },
});
