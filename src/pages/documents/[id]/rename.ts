import type { APIRoute } from 'astro';

import { readRevision } from '@/lib/api/http';
import { isDocumentId } from '@/lib/documents/ids';
import { dashboardFeedbackUrl, documentFailureCode } from '@/lib/documents/messages';
import { renameDocument } from '@/lib/documents/repository';

export const POST: APIRoute = async (context) => {
  const { user, supabase } = context.locals;
  if (!user || !supabase) return context.redirect('/login?next=/dashboard');

  const id = context.params.id ?? '';
  if (!isDocumentId(id)) {
    return context.redirect(dashboardFeedbackUrl({ error: 'not_found' }), 303);
  }

  const form = await context.request.formData();
  const title = String(form.get('title') ?? '').trim();
  const revision = readRevision(Number.parseInt(String(form.get('revision') ?? ''), 10));

  if (title.length === 0 || revision === null) {
    return context.redirect(dashboardFeedbackUrl({ error: 'rename_failed' }), 303);
  }

  const result = await renameDocument(supabase, user.id, id, title, revision);

  return result.ok
    ? context.redirect(dashboardFeedbackUrl({ renamed: true }), 303)
    : context.redirect(
        dashboardFeedbackUrl({ error: documentFailureCode(result, 'rename_failed') }),
        303,
      );
};
