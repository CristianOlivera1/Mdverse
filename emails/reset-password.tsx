import * as React from 'react';
import { Section, Text } from 'react-email';
import {
  ContentSection,
  EmailButton,
  EmailHeading,
  EmailParagraph,
  EmailShell,
  MonoUrlBlock,
  sharedStrong,
  theme,
} from './_shared';

export interface ResetPasswordEmailProps {
  resetUrl: string;
  username?: string | null;
  siteUrl?: string;
}

export default function ResetPasswordEmail({
  resetUrl,
  username,
  siteUrl = 'https://mdverse.pages.dev',
}: ResetPasswordEmailProps) {
  const greeting = username ? `Hi ${username},` : 'Hi there,';

  return (
    <EmailShell
      preview="Reset your Mdverse password - link expires in 1 hour."
      siteUrl={siteUrl}
      footerNote="Collaborative markdown editor"
    >
      <ContentSection>
        <EmailHeading>Reset your password</EmailHeading>
        <EmailParagraph>{greeting}</EmailParagraph>
        <EmailParagraph>
          We received a request to reset the password for your Mdverse account. Click the
          button below to choose a new password.
        </EmailParagraph>
        <EmailParagraph>
          This link expires in <strong style={sharedStrong}>1 hour</strong>. If you did not
          request a password reset, you can safely ignore this email - your password will not
          change.
        </EmailParagraph>
      </ContentSection>

      <EmailButton href={resetUrl}>Reset password</EmailButton>

      <MonoUrlBlock label="Or copy and paste this URL into your browser:" url={resetUrl} />

      <Section style={noteSection}>
        <Text style={noteText}>
          If you did not request this, please contact us immediately. Someone may have access
          to your email account.
        </Text>
      </Section>
    </EmailShell>
  );
}

ResetPasswordEmail.PreviewProps = {
  resetUrl: 'https://mdverse.pages.dev/auth/callback?token_hash=abc123&type=recovery',
  username: 'john_doe',
  siteUrl: 'https://mdverse.pages.dev',
} satisfies ResetPasswordEmailProps;

/* Quiet neutral note — replaces the old amber warning box, no emoji. */

const noteSection: React.CSSProperties = {
  border: `1px solid ${theme.border}`,
  borderRadius: '8px',
  margin: '0 32px 28px',
  padding: '12px 16px',
};

const noteText: React.CSSProperties = {
  color: theme.muted,
  fontSize: '13px',
  lineHeight: '1.6',
  margin: '0',
};
