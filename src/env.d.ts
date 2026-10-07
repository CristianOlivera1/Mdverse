/// <reference types="astro/client" />

import type { SupabaseClient, User } from '@supabase/supabase-js';

import type { Database } from './lib/supabase/database.types';
import type { Profile } from './lib/supabase/types';

declare global {
  namespace App {
    interface Locals {
      supabase: SupabaseClient<Database> | null;
      user: User | null;
      profile: Profile | null;
    }
  }
}
