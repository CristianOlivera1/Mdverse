import type { APIRoute } from 'astro';

import { readRevision } from '@/lib/api/http';
import { isDocumentId } from '@/lib/documents/ids';
import { documentFailureCode, documentHistoryUrl } from '@/lib/documents/messages';
import { restoreVersion } from '@/lib/documents/repository';

export const POST: APIRoute = async (context) => {
  const { user, supabase } = context.locals;
  if (!user || !supabase) return context.redirect('/login?next=/dashboard');

  const documentId = context.params.id ?? '';
  if (!isDocumentId(documentId)) return context.redirect('/dashboard?error=not_found');

  const form = await context.request.formData();
  const versionId = Number.parseInt(String(form.get('version') ?? ''), 10);
  const revision = readRevision(Number.parseInt(String(form.get('revision') ?? ''), 10));

  if (!Number.isSafeInteger(versionId) || versionId <= 0 || revision === null) {
    return context.redirect(documentHistoryUrl(documentId, { error: 'restore_failed' }), 303);
  }

  const result = await restoreVersion(supabase, user.id, { documentId, versionId, revision });

  return result.ok
    ? context.redirect(documentHistoryUrl(documentId, { restored: true }), 303)
    : context.redirect(
        documentHistoryUrl(documentId, {
          error: documentFailureCode(result, 'restore_failed'),
        }),
        303,
      );
};
