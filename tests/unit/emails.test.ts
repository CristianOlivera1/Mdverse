import * as React from 'react';
import { render } from 'react-email';
import { describe, expect, it } from 'vitest';

import AccessRequestEmail from '../../emails/access-request';
import CollaborationInviteEmail from '../../emails/collaboration-invite';
import CommentMentionEmail from '../../emails/comment-mention';
import ConfirmEmail from '../../emails/confirm-email';
import ResetPasswordEmail from '../../emails/reset-password';

const CASES: ReadonlyArray<{ name: string; element: React.ReactElement }> = [
  {
    name: 'access-request',
    element: React.createElement(AccessRequestEmail, { ...AccessRequestEmail.PreviewProps }),
  },
  {
    name: 'collaboration-invite',
    element: React.createElement(CollaborationInviteEmail, {
      ...CollaborationInviteEmail.PreviewProps,
    }),
  },
  {
    name: 'comment-mention',
    element: React.createElement(CommentMentionEmail, { ...CommentMentionEmail.PreviewProps }),
  },
  {
    name: 'confirm-email',
    element: React.createElement(ConfirmEmail, { ...ConfirmEmail.PreviewProps }),
  },
  {
    name: 'reset-password',
    element: React.createElement(ResetPasswordEmail, { ...ResetPasswordEmail.PreviewProps }),
  },
];

describe.each(CASES.map((entry) => [entry.name, entry.element] as [string, React.ReactElement]))(
  '%s',
  (_name, element) => {
    it('renders html with the shared logo header and footer', async () => {
      const html = await render(element);
      expect(html).toContain('/images/logo.png');
      expect(html).toContain('©');
      expect(html).not.toContain('undefined');
    });

    it('renders a clean plain-text alternative', async () => {
      const text = await render(element, { plainText: true });
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).not.toContain('undefined');
    });
  },
);
