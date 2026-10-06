/**
 * Server-side Supabase client.
 *
 * Create **one per request** (never reuse it across requests) and read the
 * session early — before the response is generated — otherwise a token refresh
 * finishes too late for the updated cookies to be written.
 *
 * `setAll` forwards the library's cache headers through `onResponseHeaders`;
 * responses that set auth cookies must not be cached by Cloudflare.
 */

import type { AstroCookies } from 'astro';
import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { SetAllCookies } from '@supabase/ssr';
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
