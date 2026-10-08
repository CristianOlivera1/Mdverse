import * as React from 'react';
import type { ReactElement } from 'react';
import { render } from 'react-email';

import AccessRequestEmail from '../../../emails/access-request';
import CollaborationInviteEmail from '../../../emails/collaboration-invite';
import CommentMentionEmail from '../../../emails/comment-mention';
import ConfirmEmail from '../../../emails/confirm-email';
import ResetPasswordEmail from '../../../emails/reset-password';
import { getFromEmail, getReplyToEmail, getResendClient } from './resend';

type SendResult = { ok: true; id: string } | { ok: false; error: string };

interface EmailJob {
  tag: string;
  to: string;
  subject: string;
  element: ReactElement;
}

async function sendEmail(job: EmailJob): Promise<SendResult> {
  try {
    const resend = getResendClient();
    const replyTo = getReplyToEmail();

    const [html, text] = await Promise.all([
      render(job.element),
      render(job.element, { plainText: true }),
    ]);

    const { data, error } = await resend.emails.send({
      from: getFromEmail(),
      to: [job.to],
      ...(replyTo ? { replyTo } : {}),
      subject: job.subject,
      html,
      text,
    });

    if (error) {
      console.warn(`[email] ${job.tag} rejected by Resend:`, error.message);
      return { ok: false, error: error.message };
    }

    console.info(`[email] ${job.tag} accepted by Resend:`, data?.id ?? '(no id)');
    return { ok: true, id: data?.id ?? '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[email] ${job.tag} could not be rendered or sent:`, message);
    return { ok: false, error: message };
  }
}

export interface SendInviteOptions {
  to: string;
  inviteeName?: string | null;
  documentTitle: string;
  inviterName: string;
  role: 'editor' | 'reader';
  inviteUrl: string;
  siteUrl?: string;
}

export async function sendCollaborationInvite(options: SendInviteOptions): Promise<SendResult> {
  return sendEmail({
    tag: 'collaboration invite',
    to: options.to,
    subject: `${options.inviterName} invited you to collaborate on "${options.documentTitle}"`,
    element: React.createElement(CollaborationInviteEmail, {
      inviteeName: options.inviteeName,
      documentTitle: options.documentTitle,
      inviterName: options.inviterName,
      role: options.role,
      inviteUrl: options.inviteUrl,
      siteUrl: options.siteUrl,
    }),
  });
}

export interface SendAccessRequestOptions {
  to: string;
  ownerName?: string | null;
  requesterName: string;
  requesterEmail?: string | null;
  documentTitle: string;
  message?: string | null;
  reviewUrl: string;
  siteUrl?: string;
}

export async function sendAccessRequestEmail(
  options: SendAccessRequestOptions,
): Promise<SendResult> {
  return sendEmail({
    tag: 'access request',
    to: options.to,
    subject: `${options.requesterName} is asking for access to "${options.documentTitle}"`,
    element: React.createElement(AccessRequestEmail, {
      ownerName: options.ownerName,
      requesterName: options.requesterName,
      requesterEmail: options.requesterEmail,
      documentTitle: options.documentTitle,
      message: options.message,
      reviewUrl: options.reviewUrl,
      siteUrl: options.siteUrl,
    }),
  });
}

export interface SendCommentMentionOptions {
  to: string;
  recipientName?: string | null;
  authorName: string;
  documentTitle: string;
  commentExcerpt: string;
  documentUrl: string;
  siteUrl?: string;
}

export async function sendCommentMentionEmail(
  options: SendCommentMentionOptions,
): Promise<SendResult> {
  return sendEmail({
    tag: 'comment mention',
    to: options.to,
    subject: `${options.authorName} mentioned you in "${options.documentTitle}"`,
    element: React.createElement(CommentMentionEmail, {
      recipientName: options.recipientName,
      authorName: options.authorName,
      documentTitle: options.documentTitle,
      commentExcerpt: options.commentExcerpt,
      documentUrl: options.documentUrl,
      siteUrl: options.siteUrl,
    }),
  });
}

export interface SendConfirmEmailOptions {
  to: string;
  confirmUrl: string;
  username?: string | null;
  siteUrl?: string;
}

export async function sendConfirmEmail(options: SendConfirmEmailOptions): Promise<SendResult> {
  return sendEmail({
    tag: 'confirm email',
    to: options.to,
    subject: 'Confirm your email address - Mdverse',
    element: React.createElement(ConfirmEmail, {
      confirmUrl: options.confirmUrl,
      username: options.username,
      siteUrl: options.siteUrl,
    }),
  });
}

export interface SendResetPasswordOptions {
  to: string;
  resetUrl: string;
  username?: string | null;
  siteUrl?: string;
}

export async function sendResetPasswordEmail(
  options: SendResetPasswordOptions,
): Promise<SendResult> {
  return sendEmail({
    tag: 'password reset',
    to: options.to,
    subject: 'Reset your Mdverse password',
    element: React.createElement(ResetPasswordEmail, {
      resetUrl: options.resetUrl,
      username: options.username,
      siteUrl: options.siteUrl,
    }),
  });
}
