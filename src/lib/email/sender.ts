/**
 * Email sending helpers — all outbound Resend calls live here.
 *
 * Auth-related emails (confirmation, reset) are sent by Supabase unless
 * overridden via SMTP. The collaboration invite is fully ours: we create
 * the database row AND send the email in the same request.
 *
 * Pattern: never throw — return `{ ok: boolean; error?: string }` so callers
 * keep their own error-handling strategy (same contract as the Resend SDK itself).
 */

import * as React from 'react';
import { render } from 'react-email';

import CollaborationInviteEmail from '../../../emails/collaboration-invite';
import ConfirmEmail from '../../../emails/confirm-email';
import ResetPasswordEmail from '../../../emails/reset-password';
import { getFromEmail, getReplyToEmail, getResendClient } from './resend';

type SendResult = { ok: true; id: string } | { ok: false; error: string };

/* ── Collaboration invite ─────────────────────────────────────────────────── */

export interface SendInviteOptions {
  to: string;
  inviteeName?: string | null;
  documentTitle: string;
  inviterName: string;
  role: 'editor' | 'reader';
  /** URL to send the invitee to — /dashboard or a share-link URL */
  inviteUrl: string;
}

export async function sendCollaborationInvite(options: SendInviteOptions): Promise<SendResult> {
  const resend = getResendClient();
  const replyTo = getReplyToEmail();

  const html = await render(
    React.createElement(CollaborationInviteEmail, {
      inviteeName: options.inviteeName,
      documentTitle: options.documentTitle,
      inviterName: options.inviterName,
      role: options.role,
      inviteUrl: options.inviteUrl,
    }),
  );

  const { data, error } = await resend.emails.send(
    {
      from: getFromEmail(),
      to: [options.to],
      ...(replyTo ? { replyTo } : {}),
      subject: `${options.inviterName} invited you to collaborate on "${options.documentTitle}"`,
      html,
    },
    { idempotencyKey: `collab-invite/${options.to}/${options.documentTitle}` },
  );

  if (error) {
    console.warn('[email] collaboration invite failed:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data!.id };
}

/* ── Email confirmation ───────────────────────────────────────────────────── */

export interface SendConfirmEmailOptions {
  to: string;
  confirmUrl: string;
  username?: string | null;
}

export async function sendConfirmEmail(options: SendConfirmEmailOptions): Promise<SendResult> {
  const resend = getResendClient();
  const replyTo = getReplyToEmail();

  const html = await render(
    React.createElement(ConfirmEmail, {
      confirmUrl: options.confirmUrl,
      username: options.username,
    }),
  );

  const { data, error } = await resend.emails.send(
    {
      from: getFromEmail(),
      to: [options.to],
      ...(replyTo ? { replyTo } : {}),
      subject: 'Confirm your email address — Mdverse',
      html,
    },
    { idempotencyKey: `confirm-email/${options.to}` },
  );

  if (error) {
    console.warn('[email] confirm email failed:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data!.id };
}

/* ── Password reset ───────────────────────────────────────────────────────── */

export interface SendResetPasswordOptions {
  to: string;
  resetUrl: string;
  username?: string | null;
}

export async function sendResetPasswordEmail(options: SendResetPasswordOptions): Promise<SendResult> {
  const resend = getResendClient();
  const replyTo = getReplyToEmail();

  const html = await render(
    React.createElement(ResetPasswordEmail, {
      resetUrl: options.resetUrl,
      username: options.username,
    }),
  );

  const { data, error } = await resend.emails.send(
    {
      from: getFromEmail(),
      to: [options.to],
      ...(replyTo ? { replyTo } : {}),
      subject: 'Reset your Mdverse password',
      html,
    },
    { idempotencyKey: `reset-password/${options.to}` },
  );

  if (error) {
    console.warn('[email] reset password email failed:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data!.id };
}
