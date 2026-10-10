import * as React from 'react';
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from 'react-email';

export const theme = {
  bodyBg: '#000000',
  containerBg: '#0a0a0a',
  border: '#262626',
  heading: '#ffffff',
  bodyText: '#a3a3a3',
  strong: '#e5e5e5',
  muted: '#737373',
  buttonBg: '#ffffff',
  buttonText: '#000000',
  monoBg: '#000000',
  fontStack:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  monoStack: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;

export const DEFAULT_SITE_URL = 'https://mdverse.dev';

interface EmailShellProps {
  preview: string;
  siteUrl?: string;
  footerNote: string;
  children: React.ReactNode;
}

export function EmailShell({ preview, siteUrl = DEFAULT_SITE_URL, footerNote, children }: EmailShellProps) {
  return (
    <Html lang="en">
      <Head />
      <Body style={body}>
        <Preview>{preview}</Preview>
        <Container style={container}>
          <Section style={header}>
            <Text style={brandRow}>
              <span style={logoTile}>M</span>
              {` `}
              <span style={wordmark}>Mdverse</span>
            </Text>
          </Section>

          <Hr style={divider} />

          {children}

          <Hr style={divider} />

          <Section style={footer}>
            <Text style={footerText}>
              <Link href={siteUrl} style={footerLink}>
                Mdverse
              </Link>
              {' - '}
              {footerNote}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/* ─── Building blocks ────────────────────────────────────────────────────── */

export function EmailHeading({ children }: { children: React.ReactNode }) {
  return (
    <Heading as="h1" style={h1}>
      {children}
    </Heading>
  );
}

export function EmailParagraph({ children }: { children: React.ReactNode }) {
  return <Text style={paragraph}>{children}</Text>;
}

export function EmailButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Section style={ctaSection}>
      <Button href={href} style={button}>
        {children}
      </Button>
    </Section>
  );
}

export function MonoUrlBlock({ label, url }: { label: string; url: string }) {
  return (
    <Section style={contentSection}>
      <Text style={small}>{label}</Text>
      <Text style={mono}>{url}</Text>
    </Section>
  );
}

export function MutedInfo({ children }: { children: React.ReactNode }) {
  return (
    <Section style={contentSection}>
      <Text style={infoText}>{children}</Text>
    </Section>
  );
}

export function ContentSection({ children }: { children: React.ReactNode }) {
  return <Section style={contentSection}>{children}</Section>;
}

/* ─── Styles (inline style objects only - email-client safe) ─────────────── */

const body: React.CSSProperties = {
  backgroundColor: theme.bodyBg,
  fontFamily: theme.fontStack,
  margin: '0',
  padding: '40px 0',
};

const container: React.CSSProperties = {
  backgroundColor: theme.containerBg,
  border: `1px solid ${theme.border}`,
  borderRadius: '12px',
  margin: '0 auto',
  maxWidth: '540px',
  overflow: 'hidden',
  padding: '0',
};

const header: React.CSSProperties = {
  padding: '24px 32px',
};

const brandRow: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '28px',
  margin: '0',
};

const logoTile: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '6px',
  color: '#000000',
  display: 'inline-block',
  fontSize: '15px',
  fontWeight: '700',
  height: '28px',
  lineHeight: '28px',
  marginRight: '10px',
  textAlign: 'center',
  verticalAlign: 'middle',
  width: '28px',
};

const wordmark: React.CSSProperties = {
  color: theme.strong,
  fontSize: '15px',
  fontWeight: '600',
  letterSpacing: '-0.2px',
  verticalAlign: 'middle',
};

const divider: React.CSSProperties = {
  borderColor: theme.border,
  borderStyle: 'solid',
  margin: '0',
  width: '100%',
};

export const contentSection: React.CSSProperties = {
  padding: '28px 32px 0',
};

const ctaSection: React.CSSProperties = {
  padding: '24px 32px',
  textAlign: 'center',
};

const h1: React.CSSProperties = {
  color: theme.heading,
  fontSize: '20px',
  fontWeight: '600',
  letterSpacing: '-0.3px',
  lineHeight: '1.35',
  margin: '0 0 16px',
  padding: '0',
};

const paragraph: React.CSSProperties = {
  color: theme.bodyText,
  fontSize: '14px',
  lineHeight: '1.7',
  margin: '0 0 14px',
};

const button: React.CSSProperties = {
  backgroundColor: theme.buttonBg,
  borderRadius: '8px',
  boxSizing: 'border-box',
  color: theme.buttonText,
  display: 'block',
  fontSize: '14px',
  fontWeight: '600',
  padding: '13px 32px',
  textAlign: 'center',
  textDecoration: 'none',
};

const small: React.CSSProperties = {
  color: theme.muted,
  fontSize: '13px',
  margin: '0 0 8px',
};

const mono: React.CSSProperties = {
  backgroundColor: theme.monoBg,
  border: `1px solid ${theme.border}`,
  borderRadius: '8px',
  color: theme.bodyText,
  fontFamily: theme.monoStack,
  fontSize: '12px',
  lineHeight: '1.5',
  margin: '0 0 24px',
  overflowWrap: 'break-word',
  padding: '10px 14px',
  wordBreak: 'break-all',
};

const infoText: React.CSSProperties = {
  color: theme.muted,
  fontSize: '13px',
  lineHeight: '1.6',
  margin: '0 0 24px',
};

const footer: React.CSSProperties = {
  padding: '20px 32px 24px',
};

const footerText: React.CSSProperties = {
  color: theme.muted,
  fontSize: '13px',
  lineHeight: '1.6',
  margin: '0',
};

const footerLink: React.CSSProperties = {
  color: theme.strong,
  fontSize: '13px',
  textDecoration: 'none',
};

export const sharedStrong: React.CSSProperties = {
  color: theme.strong,
};
