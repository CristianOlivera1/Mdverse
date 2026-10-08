import type { APIRoute } from 'astro';

import { readShareInput, shareFeedbackResponse } from '@/lib/api/sharing';
import { isDocumentId, isUuid } from '@/lib/documents/ids';
import { createShareLink, revokeShareLink } from '@/lib/documents/repository';
import { expiryDate, isInviteRole, MAX_LINK_EXPIRY_DAYS } from '@/lib/documents/sharing';

export const POST: APIRoute = async (context) => {
  const { user, supabase } = context.locals;
  const documentId = context.params.id ?? '';

  if (!user || !supabase) return context.redirect('/login?next=/dashboard');
  if (!isDocumentId(documentId)) return context.redirect('/dashboard?error=not_found');

  const input = await readShareInput(context.request);
  if (!input) return shareFeedbackResponse({ error: 'link_failed' });

  const action = String(input.get('action') ?? '');

  if (action === 'revoke') {
    const linkId = String(input.get('link') ?? '');
    if (!isUuid(linkId)) {
      return shareFeedbackResponse({ error: 'link_failed' });
    }

    const result = await revokeShareLink(supabase, linkId);
    return shareFeedbackResponse(result.ok ? { linkRevoked: true } : { error: 'link_failed' });
  }

  const role = input.get('role');
  if (action !== 'create' || !isInviteRole(role)) {
    return shareFeedbackResponse({ error: 'link_failed' });
  }

  const requested = Number.parseInt(String(input.get('expiry') ?? '0'), 10);
  const days = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 0), MAX_LINK_EXPIRY_DAYS)
    : 0;

  const result = await createShareLink(supabase, user.id, {
    documentId,
    role,
    expiresAt: expiryDate(days),
  });

  return shareFeedbackResponse(
    result.ok
      ? { linkCreated: true }
      : { error: result.reason === 'forbidden' ? 'forbidden' : 'link_failed' },
  );
};
