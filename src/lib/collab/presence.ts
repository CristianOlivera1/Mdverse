import { avatarToneIndex, initials } from '../auth/profile';

export const PEER_COLORS = [
  '#60a5fa',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#a78bfa',
  '#22d3ee',
] as const;

export const PRESENCE_STALE_MS = 45_000;

export const CURSOR_TTL_MS = 6_000;

export interface PresencePayload {
  readonly userId: string;
  readonly name: string;
  readonly at?: number;
}

export interface Peer {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly color: string;
  readonly at: number;
}

export function peerColor(userId: string): string {
  return PEER_COLORS[avatarToneIndex(userId, PEER_COLORS.length)] ?? PEER_COLORS[0];
}

export function toPeer(payload: PresencePayload, fallbackAt = Date.now()): Peer | null {
  const id = typeof payload?.userId === 'string' ? payload.userId : '';
  if (!id) return null;

  const name =
    typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : 'Guest';

  return {
    id,
    name,
    initials: initials(name),
    color: peerColor(id),
    at: typeof payload.at === 'number' ? payload.at : fallbackAt,
  };
}

export function peersFromState(
  state: Record<string, PresencePayload[]> | null | undefined,
  now = Date.now(),
  staleMs = PRESENCE_STALE_MS,
): Peer[] {
  if (!state) return [];

  const byId = new Map<string, Peer>();
  for (const payloads of Object.values(state)) {
    if (!Array.isArray(payloads)) continue;
    for (const payload of payloads) {
      const peer = toPeer(payload, now);
      if (!peer) continue;
      const known = byId.get(peer.id);
      if (!known || peer.at >= known.at) byId.set(peer.id, peer);
    }
  }

  return [...byId.values()]
    .filter((peer) => now - peer.at <= staleMs)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function describePeers(peers: readonly Peer[], selfId: string): string {
  const others = peers.filter((peer) => peer.id !== selfId);
  if (others.length === 0) return 'Only you here';

  const names = others.map((peer) => peer.name);
  if (names.length === 1) return `You and ${names[0]}`;
  if (names.length === 2) return `You, ${names[0]} and ${names[1]}`;
  return `You, ${names[0]} and ${names.length - 1} more`;
}
