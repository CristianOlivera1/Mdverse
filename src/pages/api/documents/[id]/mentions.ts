import type { APIRoute } from 'astro';

import { apiSession, jsonError, jsonResponse } from '@/lib/api/http';
import { isDocumentId } from '@/lib/documents/ids';
import { getDocument } from '@/lib/documents/repository';
import { loadDocumentMembers } from '@/lib/comments/members';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');

  const id = context.params.id ?? '';
  if (!isDocumentId(id)) return jsonError(400, 'invalid_id');

  const { supabase, userId } = session;

  const document = await getDocument(supabase, userId, id);
  if (!document) return jsonError(404, 'not_found');

  const db = createAdminSupabaseClient() ?? supabase;

  try {
    const members = await loadDocumentMembers(db, id);
    if (!members) return jsonError(404, 'not_found');

    const people = members.members
      .filter((member) => member.userId !== userId && member.username)
      .map((member) => ({ userId: member.userId, name: member.name, username: member.username }));

    return jsonResponse({ people });
  } catch (error) {
    console.warn('[comments] mention candidates failed:', error);
    return jsonError(502, 'read_failed');
  }
};
