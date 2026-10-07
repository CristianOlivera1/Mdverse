import * as React from 'react';
import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Text,
  Heading,
  Hr,
  Button,
  Link,
  Row,
  Column,
} from 'react-email';

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
  siteUrl = 'https://mdverse.pages.dev',
}: CollaborationInviteEmailProps) {
  const greeting = inviteeName ? `Hi ${inviteeName},` : 'Hi there,';
  const roleLabel = ROLE_LABELS[role];
  const roleDesc = ROLE_DESCRIPTIONS[role];

  return (
    <Html lang="en">
      <Head />
      <Preview>
        {inviterName} invited you to collaborate on "{documentTitle}" in Mdverse.
      </Preview>
      <Body style={body}>
        <Container style={container}>
          {/* Header */}
          <Section style={headerSection}>
            <Heading style={logoText}>Mdverse</Heading>
            <Text style={headerSubtitle}>Collaborative markdown editor</Text>
          </Section>

          <Hr style={divider} />

          {/* Body */}
          <Section style={contentSection}>
            <Heading as="h1" style={h1}>
              You have been invited to collaborate
            </Heading>
            <Text style={paragraph}>{greeting}</Text>
            <Text style={paragraph}>
              <strong style={highlight}>{inviterName}</strong> has invited you to{' '}
              {roleDesc} on the following document:
            </Text>
          </Section>

          {/* Document card */}
          <Section style={cardSection}>
            <Row>
              <Column>
                <Text style={documentIcon}>📄</Text>
              </Column>
              <Column>
                <Text style={documentTitle_style}>{documentTitle}</Text>
                <Text style={roleBadge}>{roleLabel}</Text>
              </Column>
            </Row>
          </Section>

          {/* CTA */}
          <Section style={ctaSection}>
            <Button href={inviteUrl} style={button}>
              Open document
            </Button>
          </Section>

          {/* Info */}
          <Section style={contentSection}>
            <Text style={infoText}>
              If you do not have an account yet, you will be asked to create one first. Your
              access will be waiting once you sign up with this email address.
            </Text>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footer}>
            <Row>
              <Column align="left">
                <Link href={siteUrl} style={footerLink}>
                  Mdverse
                </Link>
              </Column>
              <Column align="right">
                <Text style={footerText}>You received this because someone shared a document with you.</Text>
              </Column>
            </Row>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

CollaborationInviteEmail.PreviewProps = {
  inviteeName: 'Maria',
  documentTitle: 'Q4 Product Roadmap',
  inviterName: 'Carlos',
  role: 'editor',
  inviteUrl: 'https://mdverse.pages.dev/dashboard',
  siteUrl: 'https://mdverse.pages.dev',
} satisfies CollaborationInviteEmailProps;

/* ─── Styles ─────────────────────────────────────────────────────────────── */

const body: React.CSSProperties = {
  backgroundColor: '#0f1117',
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  margin: '0',
  padding: '40px 0',
};

const container: React.CSSProperties = {
  backgroundColor: '#1a1d27',
  border: '1px solid #2d3148',
  borderRadius: '16px',
  margin: '0 auto',
  maxWidth: '520px',
  overflow: 'hidden',
  padding: '0',
};

const headerSection: React.CSSProperties = {
  background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)',
  padding: '28px 40px',
  textAlign: 'center',
};

const logoText: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '28px',
  fontWeight: '700',
  letterSpacing: '-0.5px',
  margin: '0',
  padding: '0',
};

const headerSubtitle: React.CSSProperties = {
  color: 'rgba(255, 255, 255, 0.75)',
  fontSize: '13px',
  margin: '4px 0 0',
};

const divider: React.CSSProperties = {
  borderColor: '#2d3148',
  borderStyle: 'solid',
  margin: '0',
  width: '100%',
};

const contentSection: React.CSSProperties = {
  padding: '32px 40px 0',
};

const ctaSection: React.CSSProperties = {
  padding: '24px 40px',
  textAlign: 'center',
};

const h1: React.CSSProperties = {
  color: '#f1f5f9',
  fontSize: '22px',
  fontWeight: '600',
  letterSpacing: '-0.3px',
  lineHeight: '1.3',
  margin: '0 0 20px',
  padding: '0',
};

const paragraph: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: '15px',
  lineHeight: '1.65',
  margin: '0 0 16px',
};

const highlight: React.CSSProperties = {
  color: '#f1f5f9',
};

const cardSection: React.CSSProperties = {
  backgroundColor: '#0f1117',
  border: '1px solid #2d3148',
  borderRadius: '12px',
  margin: '16px 40px 8px',
  padding: '20px 24px',
};

const documentIcon: React.CSSProperties = {
  fontSize: '28px',
  margin: '0 16px 0 0',
  padding: '0',
};

const documentTitle_style: React.CSSProperties = {
  color: '#f1f5f9',
  fontSize: '16px',
  fontWeight: '600',
  lineHeight: '1.3',
  margin: '0 0 6px',
};

const roleBadge: React.CSSProperties = {
  backgroundColor: '#1e2a3b',
  border: '1px solid #0ea5e9',
  borderRadius: '6px',
  color: '#38bdf8',
  display: 'inline-block',
  fontSize: '12px',
  fontWeight: '500',
  margin: '0',
  padding: '3px 10px',
};

const button: React.CSSProperties = {
  background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)',
  borderRadius: '10px',
  boxSizing: 'border-box',
  color: '#ffffff',
  display: 'block',
  fontSize: '15px',
  fontWeight: '600',
  padding: '14px 32px',
  textAlign: 'center',
  textDecoration: 'none',
};

const infoText: React.CSSProperties = {
  color: '#64748b',
  fontSize: '13px',
  lineHeight: '1.6',
  margin: '0 0 28px',
};

const footer: React.CSSProperties = {
  padding: '20px 40px 28px',
};

const footerLink: React.CSSProperties = {
  color: '#0ea5e9',
  fontSize: '13px',
  textDecoration: 'none',
};

const footerText: React.CSSProperties = {
  color: '#475569',
  fontSize: '12px',
  margin: '0',
};
