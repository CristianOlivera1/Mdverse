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
