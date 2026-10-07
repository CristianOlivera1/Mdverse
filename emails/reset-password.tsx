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
    <Html lang="en">
      <Head />
      <Preview>Reset your Mdverse password — link expires in 1 hour.</Preview>
      <Body style={body}>
        <Container style={container}>
          {/* Header */}
          <Section style={headerSection}>
            <Heading style={logoText}>Mdverse</Heading>
          </Section>

          <Hr style={divider} />

          {/* Body */}
          <Section style={contentSection}>
            <Heading as="h1" style={h1}>
              Reset your password
            </Heading>
            <Text style={paragraph}>{greeting}</Text>
            <Text style={paragraph}>
              We received a request to reset the password for your Mdverse account. Click the
              button below to choose a new password.
            </Text>
            <Text style={paragraph}>
              This link expires in <strong>1 hour</strong>. If you did not request a password
              reset, you can safely ignore this email — your password will not change.
            </Text>
          </Section>

          {/* CTA */}
          <Section style={ctaSection}>
            <Button href={resetUrl} style={button}>
              Reset password
            </Button>
          </Section>

          {/* Fallback */}
          <Section style={contentSection}>
            <Text style={small}>Or copy and paste this URL into your browser:</Text>
            <Text style={mono}>{resetUrl}</Text>
          </Section>

          {/* Security note */}
          <Section style={warningSection}>
            <Text style={warningText}>
              🔒 If you did not request this, please contact us immediately. Someone may have
              access to your email account.
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
                <Text style={footerText}>Collaborative markdown editor</Text>
              </Column>
            </Row>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

ResetPasswordEmail.PreviewProps = {
  resetUrl: 'https://mdverse.pages.dev/auth/callback?token_hash=abc123&type=recovery',
  username: 'john_doe',
  siteUrl: 'https://mdverse.pages.dev',
} satisfies ResetPasswordEmailProps;

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
  background: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
  padding: '32px 40px',
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
  background: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
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

const warningSection: React.CSSProperties = {
  backgroundColor: '#1e1a0e',
  borderLeft: '3px solid #f59e0b',
  borderLeftStyle: 'solid',
  margin: '0 40px 24px',
  padding: '14px 18px',
};

const warningText: React.CSSProperties = {
  color: '#fbbf24',
  fontSize: '13px',
  lineHeight: '1.5',
  margin: '0',
};

const footer: React.CSSProperties = {
  padding: '20px 40px 28px',
};

const footerLink: React.CSSProperties = {
  color: '#f59e0b',
  fontSize: '13px',
  textDecoration: 'none',
};

const footerText: React.CSSProperties = {
  color: '#475569',
  fontSize: '13px',
  margin: '0',
};
