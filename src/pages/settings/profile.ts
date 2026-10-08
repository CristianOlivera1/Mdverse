import type { APIRoute } from 'astro';

import { profileFeedbackUrl } from '@/lib/auth/messages';
import { isValidDisplayName, isValidUsername } from '@/lib/auth/profile';

const UNIQUE_VIOLATION = '23505';

export const POST: APIRoute = async (context) => {
  const { user, supabase } = context.locals;
  if (!user || !supabase) return context.redirect('/login?next=/settings');

  const form = await context.request.formData();
  const displayName = String(form.get('display_name') ?? '').trim();
  const username = String(form.get('username') ?? '')
    .trim()
    .toLowerCase();

  if (!isValidDisplayName(displayName)) {
    return context.redirect(profileFeedbackUrl({ error: 'invalid_display_name' }));
  }
  if (!isValidUsername(username)) {
    return context.redirect(profileFeedbackUrl({ error: 'invalid_username' }));
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({ display_name: displayName, username })
    .eq('id', user.id)
    .select('id');

  if (error) {
    const code = error.code === UNIQUE_VIOLATION ? 'username_taken' : 'save_failed';
    if (code === 'save_failed') console.warn('[profile] update failed:', error.message);
    return context.redirect(profileFeedbackUrl({ error: code }));
  }

  // No error and no row means RLS filtered the update: report it instead of
  // pretending the profile was saved.
  if (!data || data.length === 0) {
    console.warn('[profile] update matched no rows for user', user.id);
    return context.redirect(profileFeedbackUrl({ error: 'save_failed' }));
  }

  return context.redirect(profileFeedbackUrl({ saved: true }));
};
