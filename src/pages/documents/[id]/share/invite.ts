import type { APIRoute } from 'astro';

import { readShareInput, shareFeedbackResponse } from '@/lib/api/sharing';
import { isDocumentId } from '@/lib/documents/ids';
import { getDocument, inviteCollaborator } from '@/lib/documents/repository';
import { isInviteRole, parseInviteEmails } from '@/lib/documents/sharing';
import { getSiteUrl } from '@/lib/supabase/env';

export const POST: APIRoute = async (context) => {
  const { user, supabase, profile } = context.locals;
  const documentId = context.params.id ?? '';

  if (!user || !supabase) return context.redirect('/login?next=/dashboard');
  if (!isDocumentId(documentId)) return context.redirect('/dashboard?error=not_found');

  const input = await readShareInput(context.request);
  if (!input) return shareFeedbackResponse({ error: 'invite_failed' });

  const role = input.get('role');
  const { valid, invalid } = parseInviteEmails(input.get('emails'));

  if (!isInviteRole(role) || valid.length === 0) {
    return shareFeedbackResponse({ error: 'email_invalid' });
  }

  let documentTitle = 'a document';
  try {
    const doc = await getDocument(supabase, user.id, documentId);
    if (doc?.title) documentTitle = doc.title;
  } catch {
    // The title is cosmetic; the invite must not hinge on reading it.
  }

  const inviterName =
    profile?.display_name || profile?.username || user.email?.split('@')[0] || 'Someone';

  const siteUrl = getSiteUrl();

  let invited = 0;
  let added = 0;
  let yours = 0;
  let failed = 0;
  let emailsSent = 0;
  let emailsFailed = 0;

  for (const email of valid) {
    const result = await inviteCollaborator(supabase, { documentId, email, role });
    if (!result.ok) {
      failed += 1;
      continue;
    }

    if (result.value === 'owner') {
      yours += 1;
      continue;
    }

    if (result.value === 'invited') invited += 1;
    else added += 1;

    // Awaited, and counted: `sendCollaborationInvite` reports instead of throwing,
    // so a fire-and-forget call used to hide "the message never left" behind
    // "the account was added".
    //
    // Lazy import on purpose: the React email chain (`react` / `react-email` /
    // templates) must never sit in this route's static import graph. In
    // `astro dev` the SSR optimizer fails to prebundle it and the whole route
    // 500s at import time - before any invite row is created. Importing after
    // the DB work lands a broken email stack in `emailsFailed`, never in a 500.
    let sent: { ok: boolean; error?: string };
    try {
      const { sendCollaborationInvite } = await import('@/lib/email/sender');
      sent = await sendCollaborationInvite({
        to: email,
        documentTitle,
        inviterName,
        role,
        // No account yet => signup; existing account => dashboard.
        inviteUrl: result.value === 'invited' ? `${siteUrl}/signup` : `${siteUrl}/dashboard`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[email] collaboration invite could not be sent:', message);
      sent = { ok: false, error: message };
    }

    if (sent.ok) emailsSent += 1;
    else emailsFailed += 1;
  }

  if (invited === 0 && added === 0 && yours === 0 && failed > 0) {
    return shareFeedbackResponse({ error: 'invite_failed' });
  }

  return shareFeedbackResponse({
    invited,
    added,
    yours,
    invalid: invalid.length,
    emailsSent,
    emailsFailed,
  });
};
