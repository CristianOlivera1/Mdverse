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

export function keepAlive(context: { locals: App.Locals }, job: Promise<unknown>): void {
  const cf = context.locals.cfContext as { waitUntil?: (promise: Promise<unknown>) => void } | undefined;
  if (typeof cf?.waitUntil === 'function') cf.waitUntil(job);
  else void job;
}
