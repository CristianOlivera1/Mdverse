/**
 * Sharing against the real project.
 *
 *   pnpm test:db
 *
 * Everything phase 4 adds that Postgres decides is exercised here with real
 * accounts and the real Data API: inviting by address (with and without an
 * account), changing a role, revoking, the visibility guard that keeps an editor
 * from publishing somebody else's draft, and the two link functions.
 *
 * Requires `supabase/migrations/20261006140000_sharing.sql` to have been applied;
 * without it the function calls answer `PGRST202` and the suite says so instead of
 * pretending the feature works.
 *
 * Without usable keys in `.env` the whole suite is skipped, never failed.
 */

import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  claimShareLink,
  createDocument,
  createShareLink,
  deleteDocument,
  getDocument,
  inviteCollaborator,
  listCollaborators,
  listInvitations,
  listShareLinks,
  removeCollaborator,
  resolveShareToken,
  revokeInvitation,
  revokeShareLink,
  saveDocument,
  setCollaboratorRole,
  setVisibility,
} from '../../src/lib/documents/repository';
import type { Database } from '../../src/lib/supabase/database.types';
import {
  createAccount,
  createAnonymousClient,
  createProjectAdmin,
  deleteAccounts,
  readLiveEnv,
} from './live';
import type { LiveEnv } from './live';

const env = readLiveEnv();

describe.skipIf(!env)('sharing (live project)', () => {
  const config = env as LiveEnv;
  const runId = randomUUID().slice(0, 8);
  const password = `mdverse-it-${randomUUID().slice(0, 12)}`;

  let admin: SupabaseClient<Database>;
  let owner: SupabaseClient<Database>;
  let editor: SupabaseClient<Database>;
  let guest: SupabaseClient<Database>;
  let anonymous: SupabaseClient<Database>;
  const userIds: string[] = [];
  const emails: string[] = [];

  let ownerId = '';
  let editorId = '';
  let guestId = '';
  let editorEmail = '';
  let guestEmail = '';
  let documentId = '';
  let revision = 1;
  let linkToken = '';

  async function signUp(index: number): Promise<{ client: SupabaseClient<Database>; id: string }> {
    const account = await createAccount(config, admin, {
      email: `mdverse-share-${runId}-${index}@example.com`,
      password,
    });
    userIds.push(account.id);
    emails.push(account.email);
    return { client: account.client, id: account.id };
  }

  beforeAll(async () => {
    admin = createProjectAdmin(config);

    const first = await signUp(1);
    owner = first.client;
    ownerId = first.id;

    const second = await signUp(2);
    editor = second.client;
    editorId = second.id;
    editorEmail = emails[1];

    const third = await signUp(3);
    guest = third.client;
    guestId = third.id;
    guestEmail = emails[2];

    anonymous = createAnonymousClient(config);

    const created = await createDocument(owner, ownerId, { title: 'Shared notes' });
    documentId = created.id;
    revision = created.revision;
  });

  afterAll(async () => {
    await deleteAccounts(admin, userIds);
  });

  it('invites an address that already has an account by making it a collaborator', async () => {
    const result = await inviteCollaborator(owner, {
      documentId,
      email: editorEmail.toUpperCase(),
      role: 'editor',
    });

    expect(result).toEqual({ ok: true, value: 'collaborator' });

    const collaborators = await listCollaborators(owner, documentId);
    const found = collaborators.find((entry) => entry.userId === editorId);
    expect(found?.role).toBe('editor');
    expect(found?.name).toBeTruthy();
    expect(found?.username).toBeTruthy();
  });

  it('stores a pending invitation when the address has no account yet', async () => {
    const address = `mdverse-not-yet-${runId}@example.com`;
    const result = await inviteCollaborator(owner, { documentId, email: address, role: 'reader' });

    expect(result).toEqual({ ok: true, value: 'invited' });

    const invitations = await listInvitations(owner, documentId);
    const pending = invitations.find((entry) => entry.email === address);
    expect(pending?.role).toBe('reader');
    expect(pending?.acceptedAt).toBeNull();

    // Revoking it removes the row: the address never gets access.
    expect(await revokeInvitation(owner, pending?.id ?? '')).toEqual({ ok: true, value: true });
    expect((await listInvitations(owner, documentId)).map((e) => e.email)).not.toContain(address);
  });

  it('refuses an address that is not an address, and one that is the owner', async () => {
    expect(await inviteCollaborator(owner, { documentId, email: 'nope', role: 'reader' })).toEqual({
      ok: false,
      reason: 'invalid_email',
    });

    const own = emails[0];
    expect(await inviteCollaborator(owner, { documentId, email: own, role: 'editor' })).toEqual({
      ok: true,
      value: 'owner',
    });
  });

  it('refuses to invite anybody from an account that does not manage the document', async () => {
    expect(
      await inviteCollaborator(guest, { documentId, email: guestEmail, role: 'editor' }),
    ).toEqual({ ok: false, reason: 'forbidden' });

    // The owner can. The guest joins as a reader - which is also the interesting
    // case below: reaching a document is not managing it.
    expect(
      await inviteCollaborator(owner, { documentId, email: guestEmail, role: 'reader' }),
    ).toEqual({ ok: true, value: 'collaborator' });

    expect(
      await inviteCollaborator(guest, { documentId, email: guestEmail, role: 'editor' }),
    ).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('lets the invited editor write, and refuses to let them hand out roles', async () => {
    const saved = await saveDocument(editor, editorId, {
      id: documentId,
      content: '# Edited by a collaborator\n',
      revision,
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) revision = saved.revision;

    expect(
      await setCollaboratorRole(editor, { documentId, userId: guestId, role: 'editor' }),
    ).toEqual({ ok: false, reason: 'forbidden' });

    // …and cannot take somebody else's access away either. The guest keeps the row.
    expect(await removeCollaborator(editor, { documentId, userId: guestId })).toEqual({
      ok: false,
      reason: 'forbidden',
    });
    expect((await listCollaborators(owner, documentId)).map((e) => e.userId)).toContain(guestId);
  });

  it('lets the owner change the role and take the access away again', async () => {
    expect(
      await setCollaboratorRole(owner, { documentId, userId: editorId, role: 'reader' }),
    ).toEqual({ ok: true, value: true });

    const asReader = await listCollaborators(owner, documentId);
    expect(asReader.find((entry) => entry.userId === editorId)?.role).toBe('reader');

    const blocked = await saveDocument(editor, editorId, {
      id: documentId,
      content: 'a reader must not write',
      revision,
    });
    expect(blocked.ok).toBe(false);

    expect(await removeCollaborator(owner, { documentId, userId: guestId })).toEqual({
      ok: true,
      value: true,
    });
  });

  it('lets the owner publish, and stops an editor from publishing for them', async () => {
    expect(
      await setCollaboratorRole(owner, { documentId, userId: editorId, role: 'editor' }),
    ).toEqual({ ok: true, value: true });

    // An editor may write the text…
    const saved = await saveDocument(editor, editorId, {
      id: documentId,
      content: '# Still editable\n',
      revision,
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) revision = saved.revision;

    // …but not change who can reach the document.
    const published = await setVisibility(editor, { documentId, visibility: 'public' });
    expect(published).toEqual({ ok: false, reason: 'forbidden' });
    expect((await getDocument(owner, ownerId, documentId))?.visibility).toBe('private');

    // The owner can.
    expect(await setVisibility(owner, { documentId, visibility: 'unlisted' })).toEqual({
      ok: true,
      value: true,
    });
    expect((await getDocument(owner, ownerId, documentId))?.visibility).toBe('unlisted');
  });

  it('creates a link, resolves it, and stops resolving it once revoked', async () => {
    const created = await createShareLink(owner, ownerId, {
      documentId,
      role: 'reader',
      expiresAt: null,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    linkToken = created.value.token;
    expect(linkToken).toMatch(/^[0-9a-f]{48}$/);

    const resolved = await resolveShareToken(anonymous, linkToken);
    expect(resolved?.slug).toBeTruthy();
    expect(resolved?.role).toBe('reader');

    expect(await resolveShareToken(anonymous, 'f'.repeat(48))).toBeNull();

    expect(await revokeShareLink(owner, created.value.id)).toEqual({ ok: true, value: true });
    expect(await resolveShareToken(anonymous, linkToken)).toBeNull();
    expect(await listShareLinks(owner, documentId)).toHaveLength(0);
  });

  it('never resolves an expired link', async () => {
    const expired = await createShareLink(owner, ownerId, {
      documentId,
      role: 'reader',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    expect(expired.ok).toBe(true);
    if (!expired.ok) return;

    expect(await resolveShareToken(anonymous, expired.value.token)).toBeNull();
    await revokeShareLink(owner, expired.value.id);
  });

  it('turns a link into real access for the signed-in visitor, never granting more than it promised', async () => {
    const created = await createShareLink(owner, ownerId, {
      documentId,
      role: 'reader',
      expiresAt: null,
    });
    if (!created.ok) throw new Error('the link was not created');
    linkToken = created.value.token;

    const claimed = await claimShareLink(guest, linkToken);
    expect(claimed?.documentId).toBe(documentId);
    expect(claimed?.role).toBe('reader');
    expect(claimed?.isOwner).toBe(false);

    expect((await listCollaborators(owner, documentId)).map((entry) => entry.userId)).toContain(
      guestId,
    );

    // An anonymous visitor has no account to attach the access to.
    expect(await claimShareLink(anonymous, linkToken)).toBeNull();

    // Claiming twice is idempotent, and never downgrades.
    await setCollaboratorRole(owner, { documentId, userId: guestId, role: 'editor' });
    const again = await claimShareLink(guest, linkToken);
    expect(again?.role).toBe('reader');
    expect(
      (await listCollaborators(owner, documentId)).find((entry) => entry.userId === guestId)?.role,
    ).toBe('editor');

    await revokeShareLink(owner, created.value.id);
  });

  it('keeps the link token itself out of reach of a plain collaborator', async () => {
    const created = await createShareLink(owner, ownerId, {
      documentId,
      role: 'reader',
      expiresAt: null,
    });
    if (!created.ok) throw new Error('the link was not created');

    expect(await listShareLinks(editor, documentId)).toHaveLength(0);
    await revokeShareLink(owner, created.value.id);
  });

  it('lets a collaborator walk away, and takes the access with them', async () => {
    // The delete policy has exactly one unconditional case for a non-manager:
    // removing *themselves*. Losing the row loses the document.
    expect(await removeCollaborator(editor, { documentId, userId: editorId })).toEqual({
      ok: true,
      value: true,
    });
    expect((await listCollaborators(owner, documentId)).map((e) => e.userId)).not.toContain(
      editorId,
    );

    const blocked = await saveDocument(editor, editorId, {
      id: documentId,
      content: '# walked away',
      revision,
    });
    expect(blocked.ok).toBe(false);
  });

  it('cleans up after itself', async () => {
    expect(await deleteDocument(owner, documentId)).toBe('ok');
    expect(await resolveShareToken(anonymous, linkToken)).toBeNull();
  });
});
