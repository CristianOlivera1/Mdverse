import type { APIRoute } from 'astro';

import { apiSession, jsonError, jsonResponse, keepAlive, readJsonObject } from '@/lib/api/http';
import { isDocumentId } from '@/lib/documents/ids';
import { colorForAuthor, initialsFor } from '@/lib/comments/api';
import { loadDocumentMembers } from '@/lib/comments/members';
import { extractMentionUsernames } from '@/lib/comments/mentions';
import { getSiteUrl } from '@/lib/supabase/env';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

export const GET: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');
  const { supabase } = session;

  const documentId = context.url.searchParams.get('documentId') ?? '';
  if (!isDocumentId(documentId)) return jsonError(400, 'invalid_document_id');

  const { data, error } = await supabase
    .from('comments')
    .select('id, document_id, author_id, parent_id, body, anchor, resolved, created_at, updated_at')
    .eq('document_id', documentId)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('[comments] fetch error:', error.message);
    return jsonError(502, 'fetch_failed');
  }

  const rows = data ?? [];

  const authorIds = [...new Set(rows.map((r) => r.author_id))];
  const profileMap = new Map<string, string>();

  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', authorIds);

    for (const p of profiles ?? []) {
      profileMap.set(p.id, p.display_name);
    }
  }

  const comments = rows.map((row) => {
    const name = profileMap.get(row.author_id) ?? row.author_id.slice(0, 8);
    return {
      id: row.id,
      documentId: row.document_id,
      authorId: row.author_id,
      authorName: name,
      authorInitials: initialsFor(name),
      authorColor: colorForAuthor(row.author_id),
      parentId: row.parent_id ?? null,
      body: row.body,
      anchor: row.anchor ?? null,
      resolved: row.resolved,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

  return jsonResponse(comments);
};

export const POST: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');
  const { supabase, userId } = session;

  const body = await readJsonObject(context.request);
  if (!body) return jsonError(400, 'invalid_json');

  const { documentId, body: text, anchor, parentId } = body as {
    documentId?: unknown;
    body?: unknown;
    anchor?: unknown;
    parentId?: unknown;
  };

  if (typeof documentId !== 'string' || !isDocumentId(documentId)) {
    return jsonError(400, 'invalid_document_id');
  }
  if (typeof text !== 'string' || !text.trim() || text.length > 4000) {
    return jsonError(400, 'invalid_body');
  }
  if (parentId !== undefined && parentId !== null && typeof parentId !== 'string') {
    return jsonError(400, 'invalid_parent_id');
  }

  // Validate anchor shape if present
  if (anchor !== undefined && anchor !== null) {
    const a = anchor as Record<string, unknown>;
    if (typeof a.from !== 'number' || typeof a.to !== 'number' || typeof a.quote !== 'string') {
      return jsonError(400, 'invalid_anchor');
    }
    if (a.from < 0 || a.to < a.from || (a.quote as string).length > 200) {
      return jsonError(400, 'anchor_out_of_range');
    }
  }

  const { data, error } = await supabase
    .from('comments')
    .insert({
      document_id: documentId,
      author_id: userId,
      parent_id: typeof parentId === 'string' ? parentId : null,
      body: text.trim(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      anchor: (anchor ?? null) as any,
      resolved: false,
    })
    .select('id, document_id, author_id, parent_id, body, anchor, resolved, created_at, updated_at')
    .single();

  if (error) {
    console.warn('[comments] insert error:', error.message);
    return jsonError(502, 'insert_failed');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle();

  const name = profile?.display_name ?? userId.slice(0, 8);

  let mentions: string[] = [];
  const usernames = extractMentionUsernames(data.body);

  if (usernames.length > 0) {
    try {
      const admin = createAdminSupabaseClient();
      const members = await loadDocumentMembers(admin ?? supabase, documentId);
      if (members) {
        const byUsername = new Map(members.members.map((member) => [member.username.toLowerCase(), member]));
        const targets = usernames
          .map((username) => byUsername.get(username))
          .filter((member): member is (typeof members.members)[number] =>
            Boolean(member) && member!.userId !== userId,
          );
        mentions = targets.map((member) => member.userId);

        if (mentions.length > 0) {
          await supabase.from('comments').update({ mentions }).eq('id', data.id);
          if (admin) {
            keepAlive(
              context,
              notifyMentions({
                admin,
                targets,
                authorName: name,
                documentTitle: members.title,
                body: data.body,
                documentId,
              }),
            );
          }
        }
      }
    } catch (mentionError) {
      console.warn('[comments] mentions skipped:', mentionError);
    }
  }

  return jsonResponse({
    id: data.id,
    documentId: data.document_id,
    authorId: data.author_id,
    authorName: name,
    authorInitials: initialsFor(name),
    authorColor: colorForAuthor(data.author_id),
    parentId: data.parent_id ?? null,
    body: data.body,
    anchor: data.anchor ?? null,
    resolved: data.resolved,
    mentions,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  });
};

interface MentionNotification {
  admin: NonNullable<ReturnType<typeof createAdminSupabaseClient>>;
  targets: readonly { userId: string; name: string }[];
  authorName: string;
  documentTitle: string;
  body: string;
  documentId: string;
}

async function notifyMentions(input: MentionNotification): Promise<void> {
  const { sendCommentMentionEmail } = await import('@/lib/email/sender');
  const siteUrl = getSiteUrl();
  const documentUrl = `${siteUrl.replace(/\/$/, '')}/?doc=${encodeURIComponent(input.documentId)}`;
  const commentExcerpt = input.body.length > 400 ? `${input.body.slice(0, 400)}…` : input.body;

  await Promise.all(
    input.targets.map(async (target) => {
      try {
        const { data: account } = await input.admin.auth.admin.getUserById(target.userId);
        const email = account?.user?.email;
        if (!email) return;
        await sendCommentMentionEmail({
          to: email,
          recipientName: target.name,
          authorName: input.authorName,
          documentTitle: input.documentTitle,
          commentExcerpt,
          documentUrl,
          siteUrl,
        });
      } catch (error) {
        console.warn('[comments] mention email failed:', error);
      }
    }),
  );
}
