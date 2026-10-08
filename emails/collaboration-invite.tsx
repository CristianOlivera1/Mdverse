import * as React from 'react';
import { Section, Text } from 'react-email';
import {
  ContentSection,
  DEFAULT_SITE_URL,
  EmailButton,
  EmailHeading,
  EmailParagraph,
  EmailShell,
  MutedInfo,
  sharedStrong,
  theme,
} from './_shared';

export interface CollaborationInviteEmailProps {
  /** Name or email of the person being invited */
  inviteeName?: string | null;
  /** Name/title of the document being shared */
  documentTitle: string;
  /** Display name of the person who sent the invite */
  inviterName: string;
  /** Role being granted: 'editor' | 'reader' */
  role: 'editor' | 'reader';
  /** Direct link to the document or signup page */
  inviteUrl: string;
  siteUrl?: string;
}

const ROLE_LABELS: Record<'editor' | 'reader', string> = {
  editor: 'Can edit',
  reader: 'Can view',
};

const ROLE_DESCRIPTIONS: Record<'editor' | 'reader', string> = {
  editor: 'edit text and contribute to the document',
  reader: 'read the document and its revision history',
};

export default function CollaborationInviteEmail({
  inviteeName,
  documentTitle,
  inviterName,
  role,
  inviteUrl,
  siteUrl = DEFAULT_SITE_URL,
}: CollaborationInviteEmailProps) {
  const greeting = inviteeName ? `Hi ${inviteeName},` : 'Hi there,';
  const roleLabel = ROLE_LABELS[role];
  const roleDesc = ROLE_DESCRIPTIONS[role];

  return (
    <EmailShell
      preview={`${inviterName} invited you to collaborate on "${documentTitle}" in Mdverse.`}
      siteUrl={siteUrl}
      footerNote="You received this because someone shared a document with you."
    >
      <ContentSection>
        <EmailHeading>You have been invited to collaborate</EmailHeading>
        <EmailParagraph>{greeting}</EmailParagraph>
        <EmailParagraph>
          <strong style={sharedStrong}>{inviterName}</strong> has invited you to {roleDesc} on
          the following document:
        </EmailParagraph>
      </ContentSection>

      <Section style={cardSection}>
        <Text style={cardTitle}>{documentTitle}</Text>
        <Text style={rolePill}>{roleLabel}</Text>
      </Section>

      <EmailButton href={inviteUrl}>Open document</EmailButton>

      <MutedInfo>
        If you do not have an account yet, you will be asked to create one first. Your access
        will be waiting once you sign up with this email address.
      </MutedInfo>
    </EmailShell>
  );
}

CollaborationInviteEmail.PreviewProps = {
  inviteeName: 'Maria',
  documentTitle: 'Q4 Product Roadmap',
  inviterName: 'Carlos',
  role: 'editor',
  inviteUrl: `${DEFAULT_SITE_URL}/dashboard`,
  siteUrl: DEFAULT_SITE_URL,
} satisfies CollaborationInviteEmailProps;

/* Document card + quiet bordered role pill (neutral text/border, no color). */

const cardSection: React.CSSProperties = {
  backgroundColor: theme.bodyBg,
  border: `1px solid ${theme.border}`,
  borderRadius: '8px',
  margin: '0 32px 4px',
  padding: '16px 20px',
};

const cardTitle: React.CSSProperties = {
  color: theme.strong,
  fontSize: '15px',
  fontWeight: '600',
  lineHeight: '1.4',
  margin: '0 0 8px',
};

const rolePill: React.CSSProperties = {
  border: `1px solid ${theme.border}`,
  borderRadius: '999px',
  color: theme.bodyText,
  display: 'inline-block',
  fontSize: '12px',
  fontWeight: '500',
  margin: '0',
  padding: '3px 12px',
};
