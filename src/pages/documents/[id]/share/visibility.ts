/**
 * `POST /documents/:id/share/visibility` — private, unlisted or public.
 *
 * A separate endpoint from the autosave on purpose: the update policy lets an
 * editor write the text, but changing *who can reach* the document requires
 * manage rights, and this route exists so that rule has one obvious home.
 */

import type { APIRoute } from 'astro';

import { isDocumentId } from '@/lib/documents/ids';
import { sharePageUrl } from '@/lib/documents/messages';
import { setVisibility } from '@/lib/documents/repository';
import { isVisibility } from '@/lib/documents/sharing';

export const POST: APIRoute = async (context) => {
  const { user, supabase } = context.locals;
  const documentId = context.params.id ?? '';

  if (!user || !supabase) return context.redirect('/login?next=/dashboard');
  if (!isDocumentId(documentId)) return context.redirect('/dashboard?error=not_found');

  const form = await context.request.formData();
  const visibility = form.get('visibility');

  if (!isVisibility(visibility)) {
    return context.redirect(sharePageUrl(documentId, { error: 'visibility_failed' }), 303);
  }

  const result = await setVisibility(supabase, { documentId, visibility });

  return context.redirect(
    sharePageUrl(
      documentId,
      result.ok
        ? { visibilityUpdated: true }
        : { error: result.reason === 'forbidden' ? 'forbidden' : 'visibility_failed' },
    ),
    303,
  );
};
