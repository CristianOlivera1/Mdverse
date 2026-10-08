/** Separate from autosave: editors can write text, but only managers change reach. */

import type { APIRoute } from 'astro';

import { readShareInput, shareFeedbackResponse } from '@/lib/api/sharing';
import { isDocumentId } from '@/lib/documents/ids';
import { setVisibility } from '@/lib/documents/repository';
import { isVisibility } from '@/lib/documents/sharing';

export const POST: APIRoute = async (context) => {
  const { user, supabase } = context.locals;
  const documentId = context.params.id ?? '';

  if (!user || !supabase) return context.redirect('/login?next=/dashboard');
  if (!isDocumentId(documentId)) return context.redirect('/dashboard?error=not_found');

  const input = await readShareInput(context.request);
  if (!input) return shareFeedbackResponse({ error: 'visibility_failed' });

  const visibility = input.get('visibility');
  if (!isVisibility(visibility)) {
    return shareFeedbackResponse({ error: 'visibility_failed' });
  }

  const result = await setVisibility(supabase, { documentId, visibility });

  return shareFeedbackResponse(
    result.ok
      ? { visibilityUpdated: true }
      : { error: result.reason === 'forbidden' ? 'forbidden' : 'visibility_failed' },
  );
};
