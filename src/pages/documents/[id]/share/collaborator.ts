/**
 * Owner-only role change/remove: SQL filters non-owners, zero rows => `forbidden`.
 */

import type { APIRoute } from 'astro';

import { readShareInput, shareFeedbackResponse } from '@/lib/api/sharing';
import { isDocumentId, isUuid } from '@/lib/documents/ids';
import { removeCollaborator, setCollaboratorRole } from '@/lib/documents/repository';
import { isInviteRole } from '@/lib/documents/sharing';

export const POST: APIRoute = async (context) => {
  const { user, supabase } = context.locals;
  const documentId = context.params.id ?? '';

  if (!user || !supabase) return context.redirect('/login?next=/dashboard');
  if (!isDocumentId(documentId)) return context.redirect('/dashboard?error=not_found');

  const input = await readShareInput(context.request);
  if (!input) return shareFeedbackResponse({ error: 'role_failed' });

  const action = String(input.get('action') ?? '');
  const collaborator = String(input.get('user') ?? '');

  if (!isUuid(collaborator)) {
    return shareFeedbackResponse({ error: 'role_failed' });
  }

  // Block self-removal: owner would lock themselves out.
  if (collaborator === user.id) {
    return shareFeedbackResponse({ error: 'forbidden' });
  }

  if (action === 'remove') {
    const result = await removeCollaborator(supabase, { documentId, userId: collaborator });
    return shareFeedbackResponse(
      result.ok
        ? { removed: true }
        : { error: result.reason === 'forbidden' ? 'forbidden' : 'remove_failed' },
    );
  }

  const role = input.get('role');
  if (action !== 'role' || !isInviteRole(role)) {
    return shareFeedbackResponse({ error: 'role_failed' });
  }

  const result = await setCollaboratorRole(supabase, { documentId, userId: collaborator, role });
  return shareFeedbackResponse(
    result.ok
      ? { roleUpdated: true }
      : { error: result.reason === 'forbidden' ? 'forbidden' : 'role_failed' },
  );
};
