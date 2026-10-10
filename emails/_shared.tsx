import * as React from 'react';
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
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

export function EmailShell({
  preview,
  siteUrl = DEFAULT_SITE_URL,
  footerNote,
  children,
}: EmailShellProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>

      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Link href={siteUrl} style={logoLink}>
              <Img
                src={`${siteUrl}/images/logo.png`}
                width="300"
                height="50"
                alt="Mdverse"
                style={logo}
              />
            </Link>
          </Section>

          {children}

          <Hr style={divider} />

          <Section style={footer}>
            <Row>
              <Column align="left">
                <Link href={siteUrl} style={footerLink}>
                  Website
                </Link>
              </Column>

              <Column align="right">
                <Link
                  href="https://github.com/CristianOlivera1/mdverse"
                  style={footerLink}
                >
                  GitHub
                </Link>
              </Column>
            </Row>

            <Text style={footerText}>
              {footerNote}
            </Text>

            <Text style={copyright}>
              © {new Date().getFullYear()} Mdverse
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

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
  padding: '14px 22px',
};

const divider: React.CSSProperties = {
  borderColor: 'rgba(255, 255, 255, 0.08)',
  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
  margin: '0',
};

const logoLink: React.CSSProperties = {
  display: 'inline-block',
  textDecoration: 'none',
};

const logo: React.CSSProperties = {
  display: 'block',
  width: '170px',
  height: '60px',
  objectFit: 'contain',
};

const footer: React.CSSProperties = {
  padding: '20px 32px 24px',
};

const footerLink: React.CSSProperties = {
  color: theme.bodyText,
  fontSize: '12px',
  textDecoration: 'none',
};

const footerText: React.CSSProperties = {
  color: theme.muted,
  fontSize: '12px',
  lineHeight: '1.6',
  margin: '20px 0 0',
};

const copyright: React.CSSProperties = {
  color: theme.muted,
  fontSize: '11px',
  lineHeight: '1.5',
  margin: '8px 0 0',
  textAlign: 'center',
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

export const sharedStrong: React.CSSProperties = {
  color: theme.strong,
};
