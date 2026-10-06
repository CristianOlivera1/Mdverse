/**
 * Cookie plumbing between `@supabase/ssr` and Astro's cookie API.
 *
 * Supabase hands us `Partial<SerializeOptions>` from the `cookie` package; Astro
 * only accepts its own (narrower) option set. We copy the fields across
 * explicitly and force secure defaults, so an unexpected option can never leak
 * into the response unnoticed.
 */

import type { AstroCookieSetOptions } from 'astro';
import type { CookieOptions } from '@supabase/ssr';

export function pickAuthCookieOptions(options: CookieOptions = {}): AstroCookieSetOptions {
  const picked: AstroCookieSetOptions = {
    path: options.path ?? '/',
    // CSRF mitigation: auth cookies are never sent on cross-site POSTs.
    sameSite: options.sameSite ?? 'lax',
  };

  if (options.domain !== undefined) picked.domain = options.domain;
  if (options.expires !== undefined) picked.expires = options.expires;
  if (options.maxAge !== undefined) picked.maxAge = options.maxAge;
  if (options.httpOnly !== undefined) picked.httpOnly = options.httpOnly;
  if (options.secure !== undefined) picked.secure = options.secure;

  return picked;
}
