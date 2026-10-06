/**
 * Small helpers shared by the JSON endpoints under `src/pages/api/`.
 *
 * Two rules worth stating once:
 *  - Every response is `private, no-store`. These endpoints read and write a
 *    specific account's data, so no cache — browser or Cloudflare — may reuse it.
 *  - A failure is a short machine code, never a database message. The browser
 *    maps codes to copy (`src/lib/documents/messages.ts`), so a Postgres detail
 *    or a provider string can never end up rendered.
 */

import type { APIContext } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../supabase/database.types';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: PRIVATE_HEADERS });
}

export function jsonError(status: number, code: string, detail?: string): Response {
  return jsonResponse(detail ? { error: code, detail } : { error: code }, status);
}

/** Reads a JSON object body, or `null` when it is missing/not an object. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export interface ApiSession {
  readonly supabase: SupabaseClient<Database>;
  readonly userId: string;
}

/**
 * The account behind the request. `locals` is filled by the middleware from
 * verified cookies, so a non-null result means the token was already validated
 * against the auth server.
 */
export function apiSession(context: APIContext | { locals: App.Locals }): ApiSession | null {
  const { supabase, user } = context.locals;
  if (!supabase || !user) return null;
  return { supabase, userId: user.id };
}

export function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function readRevision(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}
