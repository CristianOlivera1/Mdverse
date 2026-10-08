/** Cancel a pending invitation (email-addressed row, no account yet). */

import type { APIRoute } from 'astro';

import { readShareInput, shareFeedbackResponse } from '@/lib/api/sharing';
import { isDocumentId, isUuid } from '@/lib/documents/ids';
import { revokeInvitation } from '@/lib/documents/repository';

export const POST: APIRoute = async (context) => {
  const { user, supabase } = context.locals;
  const documentId = context.params.id ?? '';

  if (!user || !supabase) return context.redirect('/login?next=/dashboard');
  if (!isDocumentId(documentId)) return context.redirect('/dashboard?error=not_found');

  const input = await readShareInput(context.request);
  if (!input) return shareFeedbackResponse({ error: 'remove_failed' });

  const invitationId = String(input.get('invitation') ?? '');

  if (!isUuid(invitationId)) {
    return shareFeedbackResponse({ error: 'remove_failed' });
  }

  const result = await revokeInvitation(supabase, invitationId);

  return shareFeedbackResponse(
    result.ok
      ? { removed: true }
      : { error: result.reason === 'forbidden' ? 'forbidden' : 'remove_failed' },
  );
};
