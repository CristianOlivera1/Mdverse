import {
  ContentSection,
  EmailButton,
  EmailHeading,
  EmailParagraph,
  EmailShell,
  MonoUrlBlock,
  sharedStrong,
} from './_shared';

export interface ConfirmEmailProps {
  confirmUrl: string;
  username?: string | null;
  siteUrl?: string;
}

export default function ConfirmEmail({ confirmUrl, username, siteUrl = 'https://mdverse.pages.dev' }: ConfirmEmailProps) {
  const greeting = username ? `Hi ${username},` : 'Hi there,';

  return (
    <EmailShell
      preview="Confirm your email address to finish signing in to Mdverse."
      siteUrl={siteUrl}
      footerNote="Collaborative markdown editor"
    >
      <ContentSection>
        <EmailHeading>Confirm your email address</EmailHeading>
        <EmailParagraph>{greeting}</EmailParagraph>
        <EmailParagraph>
          Thanks for signing up! Click the button below to confirm your email address and
          activate your account.
        </EmailParagraph>
        <EmailParagraph>
          This link expires in <strong style={sharedStrong}>24 hours</strong>. If you did not
          sign up for Mdverse, you can safely ignore this email.
        </EmailParagraph>
      </ContentSection>

      <EmailButton href={confirmUrl}>Confirm email address</EmailButton>

      <MonoUrlBlock label="Or copy and paste this URL into your browser:" url={confirmUrl} />
    </EmailShell>
  );
}

ConfirmEmail.PreviewProps = {
  confirmUrl: 'https://mdverse.pages.dev/auth/callback?token_hash=abc123&type=signup',
  username: 'john_doe',
  siteUrl: 'https://mdverse.pages.dev',
} satisfies ConfirmEmailProps;
