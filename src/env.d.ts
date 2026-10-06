/// <reference types="astro/client" />

import type { SupabaseClient, User } from '@supabase/supabase-js';

import type { Database } from './lib/supabase/database.types';
import type { Profile } from './lib/supabase/types';

declare global {
  namespace App {
    /**
     * Request-scoped auth state, filled by `src/middleware.ts` before any page
     * renders. `supabase` is `null` while the project is not configured, and
     * `user`/`profile` are `null` for anonymous visitors.
     */
    interface Locals {
      supabase: SupabaseClient<Database> | null;
      user: User | null;
      profile: Profile | null;
    }
  }
}
