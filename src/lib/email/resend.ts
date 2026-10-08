/**
 * Resend client singleton.
 *
 * All email sending goes through this module - never instantiate Resend directly
 * in route handlers. The client is created lazily so missing env vars only blow
 * up at send time, not at import time (matches the Supabase pattern used here).
 */

import { Resend } from 'resend';

import { RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_REPLY_TO } from 'astro:env/server';

let _resend: Resend | null = null;

export function getResendClient(): Resend {
  if (!_resend) {
    _resend = new Resend(RESEND_API_KEY);
  }
  return _resend;
}

export function getFromEmail(): string {
  return RESEND_FROM_EMAIL ?? 'Mdverse <noreply@resend.dev>';
}

export function getReplyToEmail(): string | undefined {
  return RESEND_REPLY_TO || undefined;
}
