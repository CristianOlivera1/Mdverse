/**
 * `POST /documents` — the dashboard's "New document" button.
 *
 * A plain form, not fetch: the answer is a redirect straight into the editor with
 * the new document open. `/documents/*` is behind the auth guard (see
 * `src/lib/auth/routes.ts`), and `astro.config.mjs` keeps the built-in
 * same-origin check, so a cross-site form post cannot reach this handler.
 */

import type { APIRoute } from 'astro';

import { dashboardFeedbackUrl } from '@/lib/documents/messages';
import { createDocument } from '@/lib/documents/repository';

export const POST: APIRoute = async (context) => {
  const { user, supabase } = context.locals;
  if (!user || !supabase) return context.redirect('/login?next=/dashboard');

  const form = await context.request.formData();
  const title = String(form.get('title') ?? '').trim();

  try {
    const document = await createDocument(supabase, user.id, {
      title: title.length > 0 ? title : undefined,
      content: '',
    });
    return context.redirect(`/?doc=${encodeURIComponent(document.id)}`, 303);
  } catch (error) {
    console.warn('[documents] create failed:', error);
    return context.redirect(dashboardFeedbackUrl({ error: 'create_failed' }), 303);
  }
};
