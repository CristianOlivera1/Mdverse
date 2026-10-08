import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../supabase/database.types';

export interface DocumentMember {
  readonly userId: string;
  readonly name: string;
  readonly username: string;
}

export interface DocumentMembers {
  readonly ownerId: string;
  readonly title: string;
  readonly members: DocumentMember[];
}

export async function loadDocumentMembers(
  db: SupabaseClient<Database>,
  documentId: string,
): Promise<DocumentMembers | null> {
  const { data: document, error } = await db
    .from('documents')
    .select('owner_id, title')
    .eq('id', documentId)
    .maybeSingle();

  if (error) throw error;
  if (!document) return null;

  const { data: collaborators } = await db
    .from('document_collaborators')
    .select('user_id')
    .eq('document_id', documentId);

  const ids = new Set<string>([document.owner_id]);
  for (const row of collaborators ?? []) ids.add(row.user_id);

  const { data: profiles, error: profileError } = await db
    .from('profiles')
    .select('id, display_name, username')
    .in('id', [...ids]);

  if (profileError) throw profileError;

  const members: DocumentMember[] = (profiles ?? [])
    .map((profile) => ({
      userId: profile.id,
      name: profile.display_name,
      username: profile.username,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { ownerId: document.owner_id, title: document.title, members };
}
