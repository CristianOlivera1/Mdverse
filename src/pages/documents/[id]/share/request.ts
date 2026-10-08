import type { APIRoute } from 'astro';

import { readShareInput, shareFeedbackResponse } from '@/lib/api/sharing';
import { isDocumentId, isUuid } from '@/lib/documents/ids';
import { decideAccessRequest } from '@/lib/documents/repository';
import { isInviteRole } from '@/lib/documents/sharing';
import { getSiteUrl } from '@/lib/supabase/env';

export const POST: APIRoute = async (context) => {
  const { user, supabase, profile } = context.locals;
  const documentId = context.params.id ?? '';

  if (!user || !supabase) return context.redirect('/login?next=/dashboard');
  if (!isDocumentId(documentId)) return context.redirect('/dashboard?error=not_found');

  const input = await readShareInput(context.request);
  if (!input) return shareFeedbackResponse({ error: 'request_failed' });

  const requestId = String(input.get('request') ?? '');
  const action = String(input.get('action') ?? '');

  if (!isUuid(requestId) || (action !== 'approve' && action !== 'deny')) {
    return shareFeedbackResponse({ error: 'request_failed' });
  }

  const approve = action === 'approve';
  const role = input.get('role');

  const result = await decideAccessRequest(supabase, {
    requestId,
    approve,
    ...(approve && isInviteRole(role) ? { role } : {}),
  });

  if (!result.ok) {
    return shareFeedbackResponse({
      error: result.reason === 'forbidden' ? 'forbidden' : 'request_failed',
    });
  }

  if (!approve) return shareFeedbackResponse({ requestDecision: 'denied' });

  const { requesterEmail, requesterName, documentTitle } = result.value;

  if (!requesterEmail) {
    return shareFeedbackResponse({ requestDecision: 'unnotified' });
  }

  const siteUrl = getSiteUrl();
  const inviterName =
    profile?.display_name || profile?.username || user.email?.split('@')[0] || 'Someone';

  try {
    const { sendCollaborationInvite } = await import('@/lib/email/sender');
    const sent = await sendCollaborationInvite({
      to: requesterEmail,
      inviteeName: requesterName,
      documentTitle,
      inviterName,
      role: isInviteRole(role) ? role : 'reader',
      inviteUrl: `${siteUrl}/?doc=${encodeURIComponent(result.value.documentId)}`,
      siteUrl,
    });
    if (!sent.ok) {
      console.warn('[email] access granted but not announced:', sent.error);
      return shareFeedbackResponse({ requestDecision: 'unnotified' });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn('[email] access granted but not announced:', detail);
    return shareFeedbackResponse({ requestDecision: 'unnotified' });
  }

  return shareFeedbackResponse({ requestDecision: 'approved' });
};
