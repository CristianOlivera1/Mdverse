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

export interface CommentMentionEmailProps {
  recipientName?: string | null;
  authorName: string;
  documentTitle: string;
  commentExcerpt: string;
  documentUrl: string;
  siteUrl?: string;
}

export default function CommentMentionEmail({
  recipientName,
  authorName,
  documentTitle,
  commentExcerpt,
  documentUrl,
  siteUrl = DEFAULT_SITE_URL,
}: CommentMentionEmailProps) {
  const greeting = recipientName ? `Hi ${recipientName},` : 'Hi there,';

  return (
    <EmailShell
      preview={`${authorName} mentioned you in "${documentTitle}".`}
      siteUrl={siteUrl}
      footerNote="You received this because someone mentioned you in a comment."
    >
      <ContentSection>
        <EmailHeading>You were mentioned in a comment</EmailHeading>
        <EmailParagraph>{greeting}</EmailParagraph>
        <EmailParagraph>
          <strong style={sharedStrong}>{authorName}</strong> mentioned you on the document:
        </EmailParagraph>
      </ContentSection>

      <Section style={cardSection}>
        <Text style={cardTitle}>{documentTitle}</Text>
        <Text style={quote}>{commentExcerpt}</Text>
      </Section>

      <EmailButton href={documentUrl}>Open the comment</EmailButton>

      <MutedInfo>
        Mentions only notify people who can already open the document. If you no longer have
        access, you can ignore this message.
      </MutedInfo>
    </EmailShell>
  );
}

CommentMentionEmail.PreviewProps = {
  recipientName: 'Maria',
  authorName: 'Carlos',
  documentTitle: 'Q4 Product Roadmap',
  commentExcerpt: '@maria can you review the pricing section?',
  documentUrl: `${DEFAULT_SITE_URL}/dashboard`,
  siteUrl: DEFAULT_SITE_URL,
} satisfies CommentMentionEmailProps;

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

const quote: React.CSSProperties = {
  borderLeft: `3px solid ${theme.border}`,
  color: theme.bodyText,
  fontSize: '13px',
  lineHeight: '1.6',
  margin: '0',
  paddingLeft: '12px',
  whiteSpace: 'pre-wrap',
};
