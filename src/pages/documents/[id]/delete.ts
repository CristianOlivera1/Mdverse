import type { APIRoute } from 'astro';

import { isDocumentId } from '@/lib/documents/ids';
import { dashboardFeedbackUrl } from '@/lib/documents/messages';
import { deleteDocument } from '@/lib/documents/repository';

export const POST: APIRoute = async (context) => {
  const { user, supabase } = context.locals;
  if (!user || !supabase) return context.redirect('/login?next=/dashboard');

  const id = context.params.id ?? '';
  if (!isDocumentId(id)) {
    return context.redirect(dashboardFeedbackUrl({ error: 'not_found' }), 303);
  }

  const result = await deleteDocument(supabase, id);

  switch (result) {
    case 'ok':
      return context.redirect(dashboardFeedbackUrl({ deleted: true }), 303);
    case 'forbidden':
      return context.redirect(dashboardFeedbackUrl({ error: 'forbidden' }), 303);
    case 'missing':
      return context.redirect(dashboardFeedbackUrl({ error: 'not_found' }), 303);
    default:
      return context.redirect(dashboardFeedbackUrl({ error: 'delete_failed' }), 303);
  }
};
