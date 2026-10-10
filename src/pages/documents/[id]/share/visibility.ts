import type { APIRoute } from 'astro';

import { readShareInput, shareFeedbackResponse } from '@/lib/api/sharing';
import { isDocumentId } from '@/lib/documents/ids';
import { setVisibility } from '@/lib/documents/repository';
import { isGeneralAccess, isInviteRole, visibilityFor } from '@/lib/documents/sharing';

export const POST: APIRoute = async (context) => {
  const { user, supabase } = context.locals;
  const documentId = context.params.id ?? '';

  if (!user || !supabase) return context.redirect('/login?next=/dashboard');
  if (!isDocumentId(documentId)) return context.redirect('/dashboard?error=not_found');

  const input = await readShareInput(context.request);
  if (!input) return shareFeedbackResponse({ error: 'visibility_failed' });

  const access = input.get('access');
  if (!isGeneralAccess(access)) {
    return shareFeedbackResponse({ error: 'visibility_failed' });
  }

  const publishedRaw = input.get('published');
  const published =
    publishedRaw === true ||
    publishedRaw === 1 ||
    publishedRaw === '1' ||
    publishedRaw === 'true' ||
    publishedRaw === 'on';

  // The link role travels with the reach: absent keeps whatever is stored, so a
  // form that only changes the reach never rewrites the role by accident.
  const requestedRole = input.get('linkRole');
  const linkRole =
    requestedRole === null || requestedRole === undefined || requestedRole === ''
      ? undefined
      : requestedRole;
  if (linkRole !== undefined && !isInviteRole(linkRole)) {
    return shareFeedbackResponse({ error: 'visibility_failed' });
  }

  const result = await setVisibility(supabase, {
    documentId,
    visibility: visibilityFor(access, published),
    ...(linkRole ? { linkRole } : {}),
  });

  return shareFeedbackResponse(
    result.ok
      ? { visibilityUpdated: true }
      : { error: result.reason === 'forbidden' ? 'forbidden' : 'visibility_failed' },
  );
};
