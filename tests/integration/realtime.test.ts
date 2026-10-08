/**
 * Realtime against the real project.
 *
 *   pnpm test:db
 *
 * Phase 4's live collaboration is not something a unit test can prove: it depends
 * on the project having Realtime enabled, on `public.documents` being part of the
 * `supabase_realtime` publication, and on Realtime re-checking the subscriber's
 * SELECT policy. So this suite opens two real channels - the owner and a
 * collaborator - and waits for what the browser would wait for:
 *
 *   1. presence: each side sees the other, with the name it announced;
 *   2. `postgres_changes`: a save made by one client arrives at the other;
 *   3. `broadcast`: an ephemeral cursor message arrives (and is not stored).
 *
 * Before those, the first test only proves that the project streams at all, and
 * retries while the server has no listener for the table yet. Right after
 * `public.documents` joins the publication - or after the project has sat idle -
 * a subscription that arrived before the listener existed never fires, and
 * joining again is what fixes it: the sharing migration was applied and this
 * suite then waited 25s for an event that could not arrive yet. Paying that cost
 * once, in one named test, keeps the assertions below deterministic.
 *
 * Node 22+ ships a global `WebSocket`, which is what `@supabase/realtime-js` uses
 * here, so no extra dependency is involved.
 *
 * Without usable keys in `.env` the whole suite is skipped, never failed.
 */

import { randomUUID } from 'node:crypto';

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDocument,
  deleteDocument,
  inviteCollaborator,
  removeCollaborator,
  saveDocument,
} from '../../src/lib/documents/repository';
import type { Database } from '../../src/lib/supabase/database.types';
import { createAccount, createProjectAdmin, deleteAccounts, readLiveEnv } from './live';
import type { LiveEnv } from './live';

const env = readLiveEnv();

const CHANNEL_TIMEOUT_MS = 25_000;

/** Wraps `subscribe()` in a promise so the test can wait for a usable channel. */
function subscribe(channel: RealtimeChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('subscribe timed out')), CHANNEL_TIMEOUT_MS);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        reject(new Error(`subscribe failed: ${status}`));
      }
    });
  });
}

/** Resolves with the first event that satisfies `accept`, or rejects on timeout. */
function waitForEvent<T>(
  label: string,
  register: (deliver: (value: T) => void) => void,
  accept: (value: T) => boolean,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} did not arrive within ${CHANNEL_TIMEOUT_MS}ms`)),
      CHANNEL_TIMEOUT_MS,
    );
    register((value) => {
      if (!accept(value)) return;
      clearTimeout(timer);
      resolve(value);
    });
  });
}

describe.skipIf(!env)('realtime (live project)', () => {
  const config = env as LiveEnv;
  const runId = randomUUID().slice(0, 8);
  const password = `mdverse-rt-${randomUUID().slice(0, 12)}`;

  let admin: SupabaseClient<Database>;
  let owner: SupabaseClient<Database>;
  let collaborator: SupabaseClient<Database>;
  const userIds: string[] = [];

  let ownerId = '';
  let collaboratorId = '';
  let documentId = '';
  let revision = 1;

  let ownerChannel: RealtimeChannel;
  let collaboratorChannel: RealtimeChannel;

  beforeAll(async () => {
    admin = createProjectAdmin(config);

    const first = await createAccount(config, admin, {
      email: `mdverse-rt-${runId}-1@example.com`,
      password,
    });
    owner = first.client;
    ownerId = first.id;
    userIds.push(first.id);

    const second = await createAccount(config, admin, {
      email: `mdverse-rt-${runId}-2@example.com`,
      password,
    });
    collaborator = second.client;
    collaboratorId = second.id;
    userIds.push(second.id);

    const created = await createDocument(owner, ownerId, { title: 'Live notes' });
    documentId = created.id;
    revision = created.revision;

    const invited = await inviteCollaborator(owner, {
      documentId,
      email: second.email,
      role: 'editor',
    });
    if (!invited.ok) throw new Error(`the collaborator could not be added: ${invited.reason}`);

    const channel = (client: SupabaseClient<Database>, userId: string) =>
      client.channel(`doc:${documentId}`, {
        config: {
          presence: { key: userId },
          broadcast: { self: false },
        },
      });

    ownerChannel = channel(owner, ownerId);
    collaboratorChannel = channel(collaborator, collaboratorId);
  });

  afterAll(async () => {
    await Promise.allSettled([
      owner?.removeChannel(ownerChannel),
      collaborator?.removeChannel(collaboratorChannel),
    ]);
    owner?.realtime.disconnect();
    collaborator?.realtime.disconnect();

    if (documentId) await deleteDocument(owner, documentId);
    if (documentId && collaboratorId) {
      await removeCollaborator(owner, { documentId, userId: collaboratorId });
    }
    await deleteAccounts(admin, userIds);
  });

  it('streams a change at all (waking the table up)', { timeout: 120_000 }, async () => {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const channel = collaborator.channel(`doc:${documentId}:warmup-${attempt}`);

      const arrived = waitForEvent<number>(
        'postgres_changes (warm-up)',
        (deliver) => {
          channel.on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'documents',
              filter: `id=eq.${documentId}`,
            },
            (payload) => deliver(Number((payload.new as { revision?: unknown }).revision)),
          );
        },
        (next) => Number.isFinite(next) && next > revision,
      );

      await subscribe(channel);

      const saved = await saveDocument(owner, ownerId, {
        id: documentId,
        content: `# Warming the stream (attempt ${attempt})\n`,
        revision,
      });
      if (!saved.ok) throw new Error(`the owner could not save: ${saved.reason}`);

      try {
        // `revision` has to keep the pre-save value until the event has been
        // judged: the predicate reads it, and the event carries the revision
        // the save produced.
        await arrived;
        revision = saved.revision;
        await collaborator.removeChannel(channel);
        return;
      } catch (error) {
        lastError = error;
        revision = saved.revision;
        await collaborator.removeChannel(channel);
      }
    }

    throw lastError;
  });

  it('shows each client the other one, by the name it announced', async () => {
    const seenByOwner = waitForEvent<string[]>(
      'presence',
      (deliver) => {
        ownerChannel.on('presence', { event: 'sync' }, () => {
          deliver(
            Object.values(ownerChannel.presenceState())
              .flat()
              .map((entry) => (entry as { userId?: string }).userId ?? ''),
          );
        });
      },
      (ids) => ids.includes(collaboratorId),
    );

    await subscribe(ownerChannel);
    await ownerChannel.track({ userId: ownerId, name: 'Owner Account', at: Date.now() });

    await subscribe(collaboratorChannel);
    await collaboratorChannel.track({
      userId: collaboratorId,
      name: 'Collaborator Account',
      at: Date.now(),
    });

    await expect(seenByOwner).resolves.toContain(collaboratorId);
  });

  it('streams a save made by one client to the other', async () => {
    // A `postgres_changes` handler has to be attached *before* `subscribe()`:
    // realtime refuses to add one to a channel that has already joined. So this
    // test opens its own channel rather than reusing the presence one - the topic
    // is arbitrary, because the row is authorized with the subscriber's token,
    // not with the topic name.
    const watcher = collaborator.channel(`doc:${documentId}:watch`);

    const arrived = waitForEvent<number>(
      'postgres_changes',
      (deliver) => {
        watcher.on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'documents', filter: `id=eq.${documentId}` },
          (payload) => deliver(Number((payload.new as { revision?: unknown }).revision)),
        );
      },
      (next) => Number.isFinite(next) && next > revision,
    );

    await subscribe(watcher);

    try {
      const saved = await saveDocument(owner, ownerId, {
        id: documentId,
        content: '# Changed while somebody was watching\n',
        revision,
      });
      expect(saved.ok).toBe(true);

      const received = await arrived;
      if (saved.ok) expect(received).toBe(saved.revision);
      if (saved.ok) revision = saved.revision;
    } finally {
      await collaborator.removeChannel(watcher);
    }
  });

  it('delivers an ephemeral cursor message and stores nothing', async () => {
    const cursor = waitForEvent<{ userId: string; from: number; to: number }>(
      'broadcast',
      (deliver) => {
        collaboratorChannel.on('broadcast', { event: 'cursor' }, ({ payload }) => {
          deliver(payload as { userId: string; from: number; to: number });
        });
      },
      (payload) => payload.userId === ownerId,
    );

    await ownerChannel.send({
      type: 'broadcast',
      event: 'cursor',
      payload: { userId: ownerId, from: 4, to: 9, at: Date.now() },
    });

    const payload = await cursor;
    expect(payload.from).toBe(4);
    expect(payload.to).toBe(9);
  });

  it('keeps a stranger out of the document channel', async () => {
    // A third account with no collaborator row: Realtime must not stream the row.
    const stranger = await createAccount(config, admin, {
      email: `mdverse-rt-${runId}-3@example.com`,
      password,
    });
    userIds.push(stranger.id);

    let leaked = false;
    const strangerChannel = stranger.client.channel(`doc:${documentId}`, {
      config: { presence: { key: stranger.id }, broadcast: { self: false } },
    });
    strangerChannel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'documents', filter: `id=eq.${documentId}` },
      () => {
        leaked = true;
      },
    );

    await subscribe(strangerChannel);

    const saved = await saveDocument(owner, ownerId, {
      id: documentId,
      content: '# Should never reach a stranger\n',
      revision,
    });
    if (saved.ok) revision = saved.revision;

    // Give the stream a moment it would need if it were going to leak.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(leaked).toBe(false);

    await stranger.client.removeChannel(strangerChannel);
    stranger.client.realtime.disconnect();
  });
});
