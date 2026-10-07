/**
 * `POST /documents/:id/share/invitation` — cancels a pending invitation.
 *
 * Kept apart from the collaborator endpoint because it acts on a row that has no
 * account behind it yet: an invitation is addressed, not someone's id.
 */

import type { APIRoute } from 'astro';

import { isDocumentId, isUuid } from '@/lib/documents/ids';
import { sharePageUrl } from '@/lib/documents/messages';
import { revokeInvitation } from '@/lib/documents/repository';

export const POST: APIRoute = async (context) => {
  const { user, supabase } = context.locals;
  const documentId = context.params.id ?? '';

  if (!user || !supabase) return context.redirect('/login?next=/dashboard');
  if (!isDocumentId(documentId)) return context.redirect('/dashboard?error=not_found');

  const form = await context.request.formData();
  const invitationId = String(form.get('invitation') ?? '');

  if (!isUuid(invitationId)) {
    return context.redirect(sharePageUrl(documentId, { error: 'remove_failed' }), 303);
  }

  const result = await revokeInvitation(supabase, invitationId);

  return context.redirect(
    sharePageUrl(
      documentId,
      result.ok
        ? { removed: true }
        : { error: result.reason === 'forbidden' ? 'forbidden' : 'remove_failed' },
    ),
    303,
  );
};
