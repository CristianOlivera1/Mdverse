import type { APIRoute } from 'astro';

import { dashboardFeedbackUrl } from '@/lib/documents/messages';
import { isUuid } from '@/lib/documents/ids';
import { createDocument } from '@/lib/documents/repository';

export const POST: APIRoute = async (context) => {
  const { user, supabase } = context.locals;
  if (!user || !supabase) return context.redirect('/login?next=/dashboard');

  const form = await context.request.formData();
  const title = String(form.get('title') ?? '').trim();
  // The dashboard form offers the account's collections; anything else falls
  // back to the database, which files the document in the default collection.
  const requestedCollection = String(form.get('collectionId') ?? '').trim();

  try {
    const document = await createDocument(supabase, user.id, {
      title: title.length > 0 ? title : undefined,
      content: '',
      collectionId: isUuid(requestedCollection) ? requestedCollection : undefined,
    });
    return context.redirect(`/?doc=${encodeURIComponent(document.id)}`, 303);
  } catch (error) {
    console.warn('[documents] create failed:', error);
    return context.redirect(dashboardFeedbackUrl({ error: 'create_failed' }), 303);
  }
};
