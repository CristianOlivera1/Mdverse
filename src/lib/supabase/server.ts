import type { AstroCookies } from 'astro';
import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { SetAllCookies } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

import { pickAuthCookieOptions } from './cookies';
import type { Database } from './database.types';
import { readSupabaseConfig } from './env';

/** Minimal request shape, so both pages and endpoints can call this. */
export interface SupabaseServerContext {
  request: Request;
  cookies: AstroCookies;
}

export function createServerSupabaseClient(
  context: SupabaseServerContext,
  onResponseHeaders?: (headers: Record<string, string>) => void,
): SupabaseClient<Database> | null {
  const config = readSupabaseConfig();
  if (!config) return null;

  const setAll: SetAllCookies = (cookiesToSet, responseHeaders) => {
    for (const { name, value, options } of cookiesToSet) {
      context.cookies.set(name, value, pickAuthCookieOptions(options));
    }
    onResponseHeaders?.(responseHeaders);
  };

  return createServerClient<Database>(config.url, config.publishableKey, {
    cookies: {
      getAll: () =>
        parseCookieHeader(context.request.headers.get('Cookie') ?? '').map(({ name, value }) => ({
          name,
          value: value ?? '',
        })),
      setAll,
    },
  });
}

let anonymous: SupabaseClient<Database> | null = null;

/**
 * Client for the pages that are the same for every visitor: the public document
 * page (`/d/:slug`) and the files exported from it.
 *
 * It carries no cookies on purpose. Reading as `anon` is what makes the response
 * cacheable by a CDN and indexable, and it is also the guarantee: a signed-in
 * reader of a *private* document can never turn `/d/:slug` into a page that shows
 * it, because that request never carries their token.
 *
 * Safe to reuse across requests: there is no session to keep or rotate.
 */
export function createAnonymousSupabaseClient(): SupabaseClient<Database> | null {
  const config = readSupabaseConfig();
  if (!config) return null;

  anonymous ??= createClient<Database>(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return anonymous;
}
