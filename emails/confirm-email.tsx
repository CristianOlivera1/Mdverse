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

export interface ConfirmEmailProps {
  confirmUrl: string;
  username?: string | null;
  siteUrl?: string;
}

export default function ConfirmEmail({ confirmUrl, username, siteUrl = 'https://mdverse.pages.dev' }: ConfirmEmailProps) {
  const greeting = username ? `Hi ${username},` : 'Hi there,';

  return (
    <Html lang="en">
      <Head />
      <Preview>Confirm your email address to finish signing in to Mdverse.</Preview>
      <Body style={body}>
        <Container style={container}>
          {/* Header */}
          <Section style={headerSection}>
            <Heading style={logo}>Mdverse</Heading>
          </Section>

          <Hr style={divider} />

          {/* Body */}
          <Section style={contentSection}>
            <Heading as="h1" style={h1}>
              Confirm your email address
            </Heading>
            <Text style={paragraph}>{greeting}</Text>
            <Text style={paragraph}>
              Thanks for signing up! Click the button below to confirm your email address and
              activate your account.
            </Text>
            <Text style={paragraph}>
              This link expires in <strong>24 hours</strong>. If you did not sign up for Mdverse,
              you can safely ignore this email.
            </Text>
          </Section>

          {/* CTA */}
          <Section style={ctaSection}>
            <Button href={confirmUrl} style={button}>
              Confirm email address
            </Button>
          </Section>

          {/* Fallback URL */}
          <Section style={contentSection}>
            <Text style={small}>
              Or copy and paste this URL into your browser:
            </Text>
            <Text style={mono}>{confirmUrl}</Text>
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
                <Text style={footerText}>Collaborative markdown editor</Text>
              </Column>
            </Row>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

ConfirmEmail.PreviewProps = {
  confirmUrl: 'https://mdverse.pages.dev/auth/callback?token_hash=abc123&type=signup',
  username: 'john_doe',
  siteUrl: 'https://mdverse.pages.dev',
} satisfies ConfirmEmailProps;

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
  padding: '0',
  overflow: 'hidden',
};

const headerSection: React.CSSProperties = {
  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
  padding: '32px 40px',
  textAlign: 'center',
};

const logo: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '28px',
  fontWeight: '700',
  letterSpacing: '-0.5px',
  margin: '0',
  padding: '0',
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

const button: React.CSSProperties = {
  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
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

const small: React.CSSProperties = {
  color: '#64748b',
  fontSize: '13px',
  margin: '0 0 8px',
};

const mono: React.CSSProperties = {
  backgroundColor: '#0f1117',
  border: '1px solid #2d3148',
  borderRadius: '6px',
  color: '#94a3b8',
  fontFamily: "'Courier New', Courier, monospace",
  fontSize: '12px',
  lineHeight: '1.5',
  margin: '0 0 24px',
  overflowWrap: 'break-word',
  padding: '10px 14px',
  wordBreak: 'break-all',
};

const footer: React.CSSProperties = {
  padding: '20px 40px 28px',
};

const footerLink: React.CSSProperties = {
  color: '#6366f1',
  fontSize: '13px',
  textDecoration: 'none',
};

const footerText: React.CSSProperties = {
  color: '#475569',
  fontSize: '13px',
  margin: '0',
};
