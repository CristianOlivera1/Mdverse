import { Resend } from 'resend';

import { RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_REPLY_TO } from 'astro:env/server';

let _resend: Resend | null = null;
let warnedMissingKey = false;

export function getResendClient(): Resend {
  if (!_resend) {
    // Fail loud like the reference implementation: a missing key makes EVERY
    // send fail, and the per-send catch below would otherwise bury that fact
    // in one warning per attempt.
    if (!RESEND_API_KEY && !warnedMissingKey) {
      warnedMissingKey = true;
      console.error(
        '[email] RESEND_API_KEY is not set: no email (invites, confirmations, resets) can leave this app. Set it in .env and in the Cloudflare dashboard.',
      );
    }
    _resend = new Resend(RESEND_API_KEY);
  }
  return _resend;
}

let warnedFallbackFrom = false;

export function getFromEmail(): string {
  if (RESEND_FROM_EMAIL) return RESEND_FROM_EMAIL;
  if (!warnedFallbackFrom) {
    warnedFallbackFrom = true;
    console.error(
      '[email] RESEND_FROM_EMAIL is not set, falling back to noreply@resend.dev: Resend delivers those ONLY to the account owner address. Every invite/confirmation to anyone else gets a 403. Verify a domain in Resend and set RESEND_FROM_EMAIL="Name <mail@yourdomain>".',
    );
  }
  return 'Mdverse <noreply@resend.dev>';
}

export function getReplyToEmail(): string | undefined {
  return RESEND_REPLY_TO || undefined;
}
