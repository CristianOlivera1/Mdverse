/** Invite by email: each address resolves independently; email send never fails the share. */

import type { APIRoute } from 'astro';

import { readShareInput, shareFeedbackResponse } from '@/lib/api/sharing';
import { sendCollaborationInvite } from '@/lib/email/sender';
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
  if (!input) return shareFeedbackResponse(context, documentId, { error: 'invite_failed' });

  const role = input.get('role');
  const { valid, invalid } = parseInviteEmails(input.get('emails'));

  if (!isInviteRole(role) || valid.length === 0) {
    return shareFeedbackResponse(context, documentId, { error: 'email_invalid' });
  }

  let documentTitle = 'a document';
  try {
    const doc = await getDocument(supabase, user.id, documentId);
    if (doc?.title) documentTitle = doc.title;
  } catch {
  }

  const inviterName =
    profile?.display_name || profile?.username || user.email?.split('@')[0] || 'Someone';

  const siteUrl = getSiteUrl();

  let invited = 0;
  let added = 0;
  let yours = 0;
  let failed = 0;

  for (const email of valid) {
    const result = await inviteCollaborator(supabase, { documentId, email, role });
    if (!result.ok) {
      failed += 1;
      continue;
    }

    if (result.value === 'invited') {
      invited += 1;
    } else if (result.value === 'collaborator') {
      added += 1;
    } else {
      yours += 1;
      continue;
    }
    sendCollaborationInvite({
      to: email,
      documentTitle,
      inviterName,
      role,
      // No account yet => signup; existing account => dashboard.
      inviteUrl:
        result.value === 'invited'
          ? `${siteUrl}/signup`
          : `${siteUrl}/dashboard`,
    }).catch((err: unknown) => {
      console.warn('[email] collaboration invite send failed:', err);
    });
  }

  if (invited === 0 && added === 0 && yours === 0 && failed > 0) {
    return shareFeedbackResponse(context, documentId, { error: 'invite_failed' });
  }

  return shareFeedbackResponse(context, documentId, {
    invited,
    added,
    yours,
    invalid: invalid.length,
  });
};
