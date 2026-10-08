/**
 * Supabase database types.
 *
 * ⚠️ This file is **generated** - do not edit it by hand.
 *
 * Until the Supabase CLI can reach the project (`SUPABASE_PROJECT_REF` +
 * `SUPABASE_ACCESS_TOKEN` in `.env`), it holds a hand-written placeholder for the
 * tables created in phases 2–4 (`public.profiles`, `public.documents`, …) and for
 * the phase 4 functions (`invite_collaborator`, `resolve_share_token`,
 * `claim_share_link`), so the app typechecks without the generator. Once the
 * project is linked, regenerate it after every migration:
 *
 *   pnpm db:types
 *
 * Everything the app needs from this file is re-exported through
 * `src/lib/supabase/types.ts` (e.g. `Document`, `DocumentVersion`) so call sites
 * never depend on the generated shape directly.
 *
 * Column notes worth keeping when the file is regenerated:
 *  - `documents.search` is a generated `tsvector`; it is intentionally absent
 *    here (it cannot be written and nothing in the app reads it).
 *  - `document_versions.id` is a bigint identity, so it arrives as a number over
 *    the Data API.
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
      documents: {
        Row: {
          id: string;
          owner_id: string;
          title: string;
          /** Assigned once on insert; a rename never changes it. */
          slug: string;
          content: string;
          visibility: Database['public']['Enums']['document_visibility'];
          last_edited_by: string | null;
          /** Optimistic concurrency token: the client sends what it read. */
          revision: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          title?: string;
          /** Omit to let `documents_set_slug` derive it from the title. */
          slug?: string;
          content?: string;
          visibility?: Database['public']['Enums']['document_visibility'];
          last_edited_by?: string | null;
          revision?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          title?: string;
          slug?: string;
          content?: string;
          visibility?: Database['public']['Enums']['document_visibility'];
          last_edited_by?: string | null;
          revision?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'documents_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      document_collaborators: {
        Row: {
          document_id: string;
          user_id: string;
          role: Database['public']['Enums']['collaborator_role'];
          invited_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          document_id: string;
          user_id: string;
          role?: Database['public']['Enums']['collaborator_role'];
          invited_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          document_id?: string;
          user_id?: string;
          role?: Database['public']['Enums']['collaborator_role'];
          invited_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'document_collaborators_document_id_fkey';
            columns: ['document_id'];
            isOneToOne: false;
            referencedRelation: 'documents';
            referencedColumns: ['id'];
          },
        ];
      };
      document_invitations: {
        Row: {
          id: string;
          document_id: string;
          email: string;
          role: Database['public']['Enums']['collaborator_role'];
          token: string;
          invited_by: string;
          accepted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          email: string;
          role?: Database['public']['Enums']['collaborator_role'];
          token?: string;
          invited_by: string;
          accepted_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          document_id?: string;
          email?: string;
          role?: Database['public']['Enums']['collaborator_role'];
          token?: string;
          invited_by?: string;
          accepted_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      document_versions: {
        Row: {
          id: number;
          document_id: string;
          /** Revision that this snapshot replaced. */
          revision: number;
          content: string;
          title: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          document_id: string;
          revision: number;
          content: string;
          title: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          document_id?: string;
          revision?: number;
          content?: string;
          title?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'document_versions_document_id_fkey';
            columns: ['document_id'];
            isOneToOne: false;
            referencedRelation: 'documents';
            referencedColumns: ['id'];
          },
        ];
      };
      comments: {
        Row: {
          id: string;
          document_id: string;
          author_id: string;
          parent_id: string | null;
          body: string;
          anchor: Json | null;
          resolved: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          author_id: string;
          parent_id?: string | null;
          body: string;
          anchor?: Json | null;
          resolved?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          document_id?: string;
          author_id?: string;
          parent_id?: string | null;
          body?: string;
          anchor?: Json | null;
          resolved?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      share_links: {
        Row: {
          id: string;
          document_id: string;
          /** Secret: only reachable by an owner/admin. */
          token: string;
          role: Database['public']['Enums']['collaborator_role'];
          expires_at: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          token?: string;
          role?: Database['public']['Enums']['collaborator_role'];
          expires_at?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          document_id?: string;
          token?: string;
          role?: Database['public']['Enums']['collaborator_role'];
          expires_at?: string | null;
          created_by?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      invite_collaborator: {
        Args: {
          p_document_id: string;
          p_email: string;
          p_role?: Database['public']['Enums']['collaborator_role'];
        };
        /** `owner` | `collaborator` | `invited`. */
        Returns: string;
      };
      resolve_share_token: {
        Args: { p_token: string };
        Returns: {
          document_id: string;
          slug: string;
          title: string;
          content: string;
          revision: number;
          link_role: Database['public']['Enums']['collaborator_role'];
        }[];
      };
      claim_share_link: {
        Args: { p_token: string };
        Returns: {
          document_id: string;
          slug: string;
          granted_role: Database['public']['Enums']['collaborator_role'];
          is_owner: boolean;
        }[];
      };
    };
    Enums: {
      collaborator_role: 'reader' | 'editor' | 'admin';
      document_visibility: 'private' | 'unlisted' | 'public';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
