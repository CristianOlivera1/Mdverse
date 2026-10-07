/**
 * `POST /documents/:id/share/invite` — hands out access by email.
 *
 * One request can carry several addresses (that is how people actually share
 * something: they paste a list). Each address is resolved independently, so one
 * bad entry does not throw away the rest, and the redirect reports the three
 * possible outcomes separately: added, invited, or unusable.
 */

import type { APIRoute } from 'astro';

import { isDocumentId } from '@/lib/documents/ids';
import { sharePageUrl } from '@/lib/documents/messages';
import { inviteCollaborator } from '@/lib/documents/repository';
import { isInviteRole, parseInviteEmails } from '@/lib/documents/sharing';

export const POST: APIRoute = async (context) => {
  const { user, supabase } = context.locals;
  const documentId = context.params.id ?? '';

  if (!user || !supabase) return context.redirect('/login?next=/dashboard');
  if (!isDocumentId(documentId)) return context.redirect('/dashboard?error=not_found');

  const form = await context.request.formData();
  const role = form.get('role');
  const { valid, invalid } = parseInviteEmails(form.get('emails'));

  if (!isInviteRole(role) || valid.length === 0) {
    return context.redirect(sharePageUrl(documentId, { error: 'email_invalid' }), 303);
  }

  let invited = 0;
  let added = 0;
  let yours = 0;
  let failed = 0;

  for (const email of valid) {
    const result = await inviteCollaborator(supabase, { documentId, email, role });
    if (!result.ok) {
      failed += 1;
      continue;
    }
    if (result.value === 'invited') invited += 1;
    else if (result.value === 'collaborator') added += 1;
    else yours += 1;
  }

  // Nothing worked at all: the useful answer is the reason, not "0 invited".
  if (invited === 0 && added === 0 && yours === 0 && failed > 0) {
    return context.redirect(sharePageUrl(documentId, { error: 'invite_failed' }), 303);
  }

  return context.redirect(
    sharePageUrl(documentId, { invited, added, yours, invalid: invalid.length }),
    303,
  );
};
