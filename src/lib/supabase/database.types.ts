/**
 * Supabase database types.
 *
 * ⚠️ This file is **generated** — do not edit it by hand.
 *
 * Until the Supabase project exists it holds a hand-written placeholder for the
 * tables created in phase 2 (`public.profiles`), so the app typechecks without a
 * live project. Once the project is linked, regenerate it after every migration:
 *
 *   pnpm db:types
 *
 * Everything the app needs from this file is re-exported through
 * `src/lib/supabase/types.ts` (e.g. `Profile`) so call sites never depend on the
 * generated shape directly.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          /** References `auth.users.id`. */
          id: string;
          username: string;
          display_name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          username: string;
          display_name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          display_name?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_id_fkey';
            columns: ['id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
