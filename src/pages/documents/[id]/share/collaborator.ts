/**
 * `POST /documents/:id/share/collaborator` — changes or removes one person's role.
 *
 * Two intents in one endpoint because they act on the same target and share the
 * same validation; the outcome still reaches the page as a distinct code. Both
 * paths are owner-only in SQL: a filtered-out write comes back as zero rows, which
 * is reported as `forbidden`, never as "it worked".
 */

import type { APIRoute } from 'astro';

import { isDocumentId, isUuid } from '@/lib/documents/ids';
import { sharePageUrl } from '@/lib/documents/messages';
import { removeCollaborator, setCollaboratorRole } from '@/lib/documents/repository';
import { isInviteRole } from '@/lib/documents/sharing';

export const POST: APIRoute = async (context) => {
  const { user, supabase } = context.locals;
  const documentId = context.params.id ?? '';

  if (!user || !supabase) return context.redirect('/login?next=/dashboard');
  if (!isDocumentId(documentId)) return context.redirect('/dashboard?error=not_found');

  const form = await context.request.formData();
  const action = String(form.get('action') ?? '');
  const collaborator = String(form.get('user') ?? '');

  if (!isUuid(collaborator)) {
    return context.redirect(sharePageUrl(documentId, { error: 'role_failed' }), 303);
  }

  // Removing yourself is the one case worth stopping before the database: it is
  // the owner locking themselves out of their own document.
  if (collaborator === user.id) {
    return context.redirect(sharePageUrl(documentId, { error: 'forbidden' }), 303);
  }

  if (action === 'remove') {
    const result = await removeCollaborator(supabase, { documentId, userId: collaborator });
    return context.redirect(
      sharePageUrl(
        documentId,
        result.ok
          ? { removed: true }
          : { error: result.reason === 'forbidden' ? 'forbidden' : 'remove_failed' },
      ),
      303,
    );
  }

  const role = form.get('role');
  if (action !== 'role' || !isInviteRole(role)) {
    return context.redirect(sharePageUrl(documentId, { error: 'role_failed' }), 303);
  }

  const result = await setCollaboratorRole(supabase, { documentId, userId: collaborator, role });
  return context.redirect(
    sharePageUrl(
      documentId,
      result.ok
        ? { roleUpdated: true }
        : { error: result.reason === 'forbidden' ? 'forbidden' : 'role_failed' },
    ),
    303,
  );
};
