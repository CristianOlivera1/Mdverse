// doc:{uuid} is a public Realtime topic guarded only by uuid secrecy; never broadcast document text.
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../supabase/database.types';
import { getBrowserSupabaseClient } from '../supabase/client';
import { CURSOR_TTL_MS, peersFromState } from './presence';
import type { Peer, PresencePayload } from './presence';

export type CollabStatus = 'connecting' | 'online' | 'offline';

export interface CollabIdentity {
  readonly userId: string;
  readonly name: string;
}

export interface RemoteSave {
  readonly documentId: string;
  readonly revision: number;
  readonly editorId: string | null;
}

export interface RemoteCursor {
  readonly userId: string;
  readonly from: number;
  readonly to: number;
  readonly at: number;
}

export interface CollabHandlers {
  onPeers?(peers: Peer[]): void;
  onStatus?(status: CollabStatus): void;
  onRemoteSave?(save: RemoteSave): void;
  onCursors?(cursors: RemoteCursor[]): void;
}

export interface CollabSession {
  readonly documentId: string | null;
  setDocument(id: string | null): void;
  announceSave(save: { documentId: string; revision: number }): void;
  setCursor(from: number, to: number): void;
  peers(): Peer[];
  close(): void;
}

const CURSOR_THROTTLE_MS = 60;
const HEARTBEAT_MS = 15_000;
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const SWEEP_MS = 1_000;

export function openCollab(
  identity: CollabIdentity,
  handlers: CollabHandlers = {},
): CollabSession | null {
  let client: SupabaseClient<Database>;
  try {
    client = getBrowserSupabaseClient();
  } catch {
    return null;
  }

  let channel: RealtimeChannel | null = null;
  let documentId: string | null = null;
  let status: CollabStatus = 'connecting';
  let peers: Peer[] = [];
  let backoff = BACKOFF_START_MS;
  let closing = false;
  let heartbeat = 0;
  let sweepTimer = 0;
  let reconnectTimer = 0;
  let lastCursorSentAt = 0;
  let cursorTimer = 0;
  let pendingCursor: { from: number; to: number } | null = null;

  const cursors = new Map<string, RemoteCursor>();

  function setStatus(next: CollabStatus): void {
    if (status === next) return;
    status = next;
    handlers.onStatus?.(next);
  }

  function emitPeers(): void {
    peers = peersFromState((channel?.presenceState() ?? {}) as Record<string, PresencePayload[]>);
    handlers.onPeers?.(peers);
  }

  function emitCursors(): void {
    handlers.onCursors?.([...cursors.values()]);
  }

  function track(): void {
    void channel?.track({ userId: identity.userId, name: identity.name, at: Date.now() });
  }

  function flushCursor(): void {
    cursorTimer = 0;
    if (!pendingCursor) return;

    const { from, to } = pendingCursor;
    pendingCursor = null;
    lastCursorSentAt = Date.now();

    if (!channel || status !== 'online') return;
    void channel.send({
      type: 'broadcast',
      event: 'cursor',
      payload: { userId: identity.userId, from, to, at: Date.now() },
    });
  }

  function scheduleReconnect(): void {
    if (closing || reconnectTimer) return;

    const delay = backoff;
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);

    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = 0;
      if (closing || !documentId) return;
      channel?.subscribe();
    }, delay);
  }

  function teardown(): void {
    window.clearInterval(heartbeat);
    window.clearInterval(sweepTimer);
    heartbeat = 0;
    if (channel) {
      void client.removeChannel(channel);
      channel = null;
    }
    cursors.clear();
    emitPeers();
  }

  function join(id: string): void {
    teardown();
    setStatus('connecting');

    const next = client
      .channel(`doc:${id}`, {
        config: {
          presence: { key: identity.userId },
          broadcast: { self: false },
        },
      })
      .on('presence', { event: 'sync' }, () => emitPeers())
      .on('presence', { event: 'join' }, () => emitPeers())
      .on('presence', { event: 'leave' }, () => emitPeers())
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'documents', filter: `id=eq.${id}` },
        (payload) => {
          const row = payload.new as { revision?: unknown; last_edited_by?: unknown };
          if (typeof row.revision !== 'number') return;
          handlers.onRemoteSave?.({
            documentId: id,
            revision: row.revision,
            editorId: typeof row.last_edited_by === 'string' ? row.last_edited_by : null,
          });
        },
      )
      .on('broadcast', { event: 'saved' }, ({ payload }) => {
        const data = payload as { revision?: unknown; editorId?: unknown };
        if (typeof data.revision !== 'number') return;
        handlers.onRemoteSave?.({
          documentId: id,
          revision: data.revision,
          editorId: typeof data.editorId === 'string' ? data.editorId : null,
        });
      })
      .on('broadcast', { event: 'cursor' }, ({ payload }) => {
        const data = payload as Partial<RemoteCursor> & { userId?: unknown };
        if (typeof data.userId !== 'string' || data.userId === identity.userId) return;
        if (typeof data.from !== 'number' || typeof data.to !== 'number') return;

        cursors.set(data.userId, {
          userId: data.userId,
          from: data.from,
          to: data.to,
          at: typeof data.at === 'number' ? data.at : Date.now(),
        });
        emitCursors();
      });

    channel = next;

    next.subscribe((state) => {
      if (closing) return;

      switch (state) {
        case 'SUBSCRIBED':
          backoff = BACKOFF_START_MS;
          setStatus('online');
          track();
          window.clearInterval(heartbeat);
          heartbeat = window.setInterval(track, HEARTBEAT_MS);
          break;
        case 'CHANNEL_ERROR':
        case 'TIMED_OUT':
          setStatus('offline');
          scheduleReconnect();
          break;
        case 'CLOSED':
          setStatus('offline');
          break;
        default:
          setStatus('connecting');
      }
    });
  }

  sweepTimer = window.setInterval(() => {
    if (cursors.size === 0) return;

    const now = Date.now();
    let changed = false;
    for (const [userId, cursor] of cursors) {
      if (now - cursor.at > CURSOR_TTL_MS) {
        cursors.delete(userId);
        changed = true;
      }
    }
    if (changed) emitCursors();
  }, SWEEP_MS);

  const onOnline = (): void => {
    if (closing || !documentId) return;
    backoff = BACKOFF_START_MS;
    channel?.subscribe();
  };
  const onOffline = (): void => setStatus('offline');

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  return {
    get documentId() {
      return documentId;
    },

    setDocument(id: string | null): void {
      if (id === documentId) return;
      documentId = id;
      cursors.clear();
      emitCursors();

      if (!id) {
        teardown();
        setStatus('connecting');
        return;
      }

      join(id);
    },

    announceSave(save: { documentId: string; revision: number }): void {
      if (!channel || status !== 'online' || save.documentId !== documentId) return;
      void channel.send({
        type: 'broadcast',
        event: 'saved',
        payload: { revision: save.revision, editorId: identity.userId },
      });
    },

    setCursor(from: number, to: number): void {
      if (!documentId) return;
      pendingCursor = { from, to };

      const elapsed = Date.now() - lastCursorSentAt;
      if (elapsed >= CURSOR_THROTTLE_MS) {
        flushCursor();
        return;
      }
      if (!cursorTimer) {
        cursorTimer = window.setTimeout(flushCursor, CURSOR_THROTTLE_MS - elapsed);
      }
    },

    peers(): Peer[] {
      return peers;
    },

    close(): void {
      closing = true;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(cursorTimer);
      documentId = null;
      const last = channel;
      channel = null;
      window.clearInterval(heartbeat);
      window.clearInterval(sweepTimer);
      if (last) void client.removeChannel(last);
    },
  };
}
