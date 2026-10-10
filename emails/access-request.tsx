import * as React from 'react';
import { Section, Text} from 'react-email';
import {
  ContentSection,
  DEFAULT_SITE_URL,
  EmailButton,
  EmailHeading,
  EmailParagraph,
  EmailShell,
  sharedStrong,
  theme,
} from './_shared';

export interface AccessRequestEmailProps {
  ownerName?: string | null;
  requesterName: string;
  requesterEmail?: string | null;
  documentTitle: string;
  message?: string | null;
  reviewUrl: string;
  siteUrl?: string;
}

export default function AccessRequestEmail({
  ownerName,
  requesterName,
  requesterEmail,
  documentTitle,
  message,
  reviewUrl,
  siteUrl = DEFAULT_SITE_URL,
}: AccessRequestEmailProps) {
  const greeting = ownerName ? `Hi ${ownerName},` : 'Hi there,';
  const who = requesterEmail
    ? `${requesterName} (${requesterEmail})`
    : requesterName;

  return (

    <EmailShell
      preview={`${requesterName} is asking for access to "${documentTitle}" in Mdverse.`}
      siteUrl={siteUrl}
      footerNote="You received this because somebody asked for access to a document you own."
    >
      <ContentSection>
        <EmailHeading>Somebody is asking for access</EmailHeading>

        <EmailParagraph>{greeting}</EmailParagraph>

        <EmailParagraph>
          <strong style={sharedStrong}>{who}</strong> opened a link to a
          document you own and does not have access to yet. They are asking
          you to let them in:
        </EmailParagraph>
      </ContentSection>

      <Section style={cardSection}>
        <Text style={cardTitle}>{documentTitle}</Text>
        {message ? <Text style={noteQuote}>“{message}”</Text> : null}
      </Section>

      <EmailButton href={reviewUrl}>Review the request</EmailButton>

    </EmailShell>
  );
}

AccessRequestEmail.PreviewProps = {
  ownerName: 'Daniel',
  requesterName: 'Maria',
  requesterEmail: 'maria@example.com',
  documentTitle: 'Q4 Product Roadmap',
  message: 'I am the new contractor on this project.',
  reviewUrl: `${DEFAULT_SITE_URL}/?doc=00000000-0000-0000-0000-000000000000&collaborate=1`,
  siteUrl: DEFAULT_SITE_URL,
} satisfies AccessRequestEmailProps;

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
  margin: '0',
};

const noteQuote: React.CSSProperties = {
  borderLeft: `2px solid ${theme.border}`,
  color: theme.bodyText,
  fontSize: '13px',
  fontStyle: 'italic',
  lineHeight: '1.6',
  margin: '12px 0 0',
  paddingLeft: '12px',
};