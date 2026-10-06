/**
 * The document repository against the real project.
 *
 *   pnpm test:db
 *
 * Row level security, the `revision` trigger and the history trigger are Postgres
 * behaviour, so the honest way to test them is to reach the live project with real
 * identities — exactly the path the app takes through PostgREST. Two throwaway
 * accounts are created (confirmed, never emailed) and deleted in `afterAll`.
 *
 * Without usable keys in `.env` the whole suite is skipped, never failed.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  listVersions,
  renameDocument,
  restoreVersion,
  saveDocument,
} from '../../src/lib/documents/repository';
import type { Database } from '../../src/lib/supabase/database.types';

interface Env {
  readonly url: string;
  readonly anonKey: string;
  readonly secretKey: string;
}

function readEnv(): Env | null {
  let raw: string;
  try {
    raw = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
  } catch {
    return null;
  }

  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at < 0) continue;
    values[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }

  const url = values.PUBLIC_SUPABASE_URL ?? '';
  const anonKey = values.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
  const secretKey = values.SUPABASE_SECRET_KEY ?? '';
  const usable = [url, anonKey, secretKey].every(
    (value) => value.length > 0 && !/YOUR_|^x\.x\.x$/i.test(value),
  );

  return usable ? { url, anonKey, secretKey } : null;
}

const env = readEnv();

describe.skipIf(!env)('document repository (live project)', () => {
  const config = env as Env;
  const runId = randomUUID().slice(0, 8);
  const password = `mdverse-it-${randomUUID().slice(0, 12)}`;

  let admin: SupabaseClient<Database>;
  let owner: SupabaseClient<Database>;
  let stranger: SupabaseClient<Database>;
  let ownerId = '';
  let strangerId = '';
  const userIds: string[] = [];

  /** Set by the create test; the rest of the suite works on this document. */
  let documentId = '';
  let slug = '';
  let revision = 1;

  async function signUp(index: number): Promise<{ client: SupabaseClient<Database>; id: string }> {
    const email = `mdverse-it-${runId}-${index}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;

    const id = data.user?.id;
    if (!id) throw new Error('the admin API created no user');
    userIds.push(id);

    const client = createClient<Database>(config.url, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;

    return { client, id };
  }

  beforeAll(async () => {
    admin = createClient<Database>(config.url, config.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const first = await signUp(1);
    const second = await signUp(2);
    owner = first.client;
    ownerId = first.id;
    stranger = second.client;
    strangerId = second.id;
  });

  afterAll(async () => {
    // Always clean up: the project belongs to the user, not to this suite.
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  it('creates a document owned by the caller, with a slug from its title', async () => {
    const created = await createDocument(owner, ownerId, { title: 'Integration notes' });

    documentId = created.id;
    slug = created.slug;
    revision = created.revision;

    expect(created.role).toBe('owner');
    expect(created.slug).toBe('integration-notes');
    expect(created.revision).toBe(1);
    expect(created.content).toBe('');
  });

  it('lists it for the owner and hides it from a stranger', async () => {
    const mine = await listDocuments(owner, ownerId);
    expect(mine.map((entry) => entry.id)).toContain(documentId);

    const theirs = await listDocuments(stranger, strangerId);
    expect(theirs.map((entry) => entry.id)).not.toContain(documentId);
    expect(await getDocument(stranger, strangerId, documentId)).toBeNull();
  });

  it('saves content and bumps the revision', async () => {
    const result = await saveDocument(owner, ownerId, {
      id: documentId,
      content: '# First draft\n',
      revision,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision).toBe(revision + 1);
    revision = result.revision;
  });

  it('rejects a stale writer instead of overwriting newer text', async () => {
    const stale = await saveDocument(owner, ownerId, {
      id: documentId,
      content: 'from a tab that never saw the first save',
      revision: 1,
    });

    expect(stale).toEqual({ ok: false, reason: 'conflict', revision });
    expect((await getDocument(owner, ownerId, documentId))?.content).toBe('# First draft\n');
  });

  it('renames without touching the slug', async () => {
    const result = await renameDocument(owner, ownerId, documentId, 'Renamed notes', revision);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    revision = result.revision;

    const document = await getDocument(owner, ownerId, documentId);
    expect(document?.title).toBe('Renamed notes');
    expect(document?.slug).toBe(slug);
  });

  it('keeps a snapshot of the replaced revision', async () => {
    const versions = await listVersions(owner, documentId);
    expect(versions.length).toBeGreaterThan(0);
    expect(versions[0]?.revision).toBeLessThan(revision);
  });

  it('restores a snapshot as a new revision on top', async () => {
    const versions = await listVersions(owner, documentId);
    const oldest = versions[versions.length - 1];
    expect(oldest).toBeDefined();
    if (!oldest) return;

    const result = await restoreVersion(owner, ownerId, {
      documentId,
      versionId: oldest.id,
      revision,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision).toBe(revision + 1);
    revision = result.revision;

    const document = await getDocument(owner, ownerId, documentId);
    expect(document?.content).toBe(oldest.content);
  });

  it('answers a non-collaborator with not-found, never with a hint that it exists', async () => {
    const result = await saveDocument(stranger, strangerId, {
      id: documentId,
      content: 'not mine',
      revision,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('missing');
  });

  it('lets nobody but the owner delete it', async () => {
    expect(await deleteDocument(stranger, documentId)).not.toBe('ok');
    expect(await getDocument(owner, ownerId, documentId)).not.toBeNull();

    expect(await deleteDocument(owner, documentId)).toBe('ok');
    expect(await getDocument(owner, ownerId, documentId)).toBeNull();
  });
});
