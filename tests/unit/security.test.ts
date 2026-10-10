import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  API_RATE_LIMITS,
  apiRateLimitedResponse,
  enforceApiRateLimit,
} from '../../src/lib/auth/rate-limit';
import {
  CSP_STATIC_DIRECTIVES,
  SECURITY_HEADERS,
  appendDeploymentCsp,
  applySecurityHeaders,
  cspDeploymentDirectives,
  cspOrigins,
} from '../../src/lib/security/headers';

/**
 * The directives Astro accepts in `security.csp.directives`. `script-src` and
 * `style-src` are excluded by its schema: Astro owns those and appends the
 * hashes of what it rendered. Duplicating the list here means a directive that
 * only *looks* right fails the unit test instead of the build.
 */
const ASTRO_ALLOWED_DIRECTIVES = [
  'base-uri',
  'child-src',
  'connect-src',
  'default-src',
  'fenced-frame-src',
  'font-src',
  'form-action',
  'frame-ancestors',
  'frame-src',
  'img-src',
  'manifest-src',
  'media-src',
  'object-src',
  'referrer',
  'report-to',
  'report-uri',
  'require-trusted-types-for',
  'sandbox',
  'trusted-types',
  'upgrade-insecure-requests',
  'worker-src',
];

const SUPABASE_URL = 'https://gqueddbraorgmcbcdpmb.supabase.co';

describe('cspOrigins', () => {
  it('splits a project URL into the https and websocket origins', () => {
    expect(cspOrigins(SUPABASE_URL)).toEqual({
      https: SUPABASE_URL,
      wss: 'wss://gqueddbraorgmcbcdpmb.supabase.co',
    });
  });

  it('keeps only the origin, dropping any path or trailing slash', () => {
    expect(cspOrigins(`${SUPABASE_URL}/rest/v1/`).https).toBe(SUPABASE_URL);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', '   '],
    ['not a URL', 'not-a-url'],
    ['plain http', 'http://localhost:54321'],
    ['a non-URL scheme', 'javascript:alert(1)'],
  ])('refuses %s so the policy never carries a broken source', (_label, value) => {
    expect(cspOrigins(value as string | null | undefined)).toEqual({ https: null, wss: null });
  });
});

describe('CSP_STATIC_DIRECTIVES', () => {
  const directives = [...CSP_STATIC_DIRECTIVES];

  it('emits only directives the Astro schema accepts', () => {
    for (const directive of directives) {
      const name = directive.split(' ')[0];
      expect(ASTRO_ALLOWED_DIRECTIVES, directive).toContain(name);
    }
  });

  it('never emits the source directives Astro owns, or its schema rejects', () => {
    for (const directive of directives) {
      expect(directive.startsWith('script-src')).toBe(false);
      expect(directive.startsWith('style-src')).toBe(false);
    }
  });

  it('denies the controls that only a policy can express', () => {
    expect(directives).toContain("frame-ancestors 'none'");
    expect(directives).toContain("form-action 'self'");
    expect(directives).toContain("base-uri 'self'");
    expect(directives).toContain("object-src 'none'");
  });

  it('needs the Turnstile iframe and keeps workers available', () => {
    expect(directives).toContain('frame-src https://challenges.cloudflare.com');
    expect(directives).toContain("worker-src 'self' blob:");
  });

  it('leaves the deployment directives to the middleware', () => {
    // Inside one policy the first occurrence of a directive wins, so a directive
    // emitted in both places would make the appended copy a silent no-op.
    const staticNames = directives.map((directive) => directive.split(' ')[0]);
    const deploymentNames = cspDeploymentDirectives(SUPABASE_URL).map((d) => d.split(' ')[0]);
    for (const name of deploymentNames) expect(staticNames).not.toContain(name);
  });
});

describe('cspDeploymentDirectives', () => {
  it('allows Supabase over https and websockets only where it is used', () => {
    expect(cspDeploymentDirectives(SUPABASE_URL)).toEqual([
      `connect-src 'self' ${SUPABASE_URL} wss://gqueddbraorgmcbcdpmb.supabase.co https://api.github.com`,
      `img-src 'self' data: blob: ${SUPABASE_URL}`,
    ]);
  });

  it('falls back to same-origin when Supabase is not configured', () => {
    expect(cspDeploymentDirectives(undefined)).toEqual([
      "connect-src 'self' https://api.github.com",
      "img-src 'self' data: blob:",
    ]);
  });

  it('never leaks the string "undefined" into the policy', () => {
    for (const directive of cspDeploymentDirectives('http://insecure.example')) {
      expect(directive).not.toContain('undefined');
    }
  });
});

describe('appendDeploymentCsp', () => {
  /** A policy shaped like the one Astro renders: hashed sources, then ours. */
  const astroPolicy =
    "default-src 'self'; script-src 'self' 'sha256-abc123'; style-src 'self' 'unsafe-inline';";

  it('appends the deployment directives and keeps the hashes Astro wrote', () => {
    const headers = new Headers({ 'content-security-policy': astroPolicy });
    appendDeploymentCsp(headers, SUPABASE_URL);
    const policy = headers.get('content-security-policy') ?? '';
    expect(policy.startsWith(astroPolicy)).toBe(true);
    expect(policy).toContain("'sha256-abc123'");
    expect(policy).toContain(`connect-src 'self' ${SUPABASE_URL} wss://gqueddbraorgmcbcdpmb.supabase.co https://api.github.com;`);
    expect(policy).toContain(`img-src 'self' data: blob: ${SUPABASE_URL};`);
  });

  it('is idempotent, so a directive is never emitted twice', () => {
    const headers = new Headers({ 'content-security-policy': astroPolicy });
    appendDeploymentCsp(headers, SUPABASE_URL);
    const once = headers.get('content-security-policy');
    appendDeploymentCsp(headers, SUPABASE_URL);
    expect(headers.get('content-security-policy')).toBe(once);
  });

  it('leaves a policy that already declares the directive untouched', () => {
    const own = `default-src 'self'; connect-src 'self' https://api.example;`;
    const headers = new Headers({ 'content-security-policy': own });
    appendDeploymentCsp(headers, SUPABASE_URL);
    expect(headers.get('content-security-policy')).toBe(
      `${own} img-src 'self' data: blob: ${SUPABASE_URL};`,
    );
  });

  it('does nothing when the response has no policy to complete', () => {
    const headers = new Headers({ 'content-type': 'application/json' });
    appendDeploymentCsp(headers, SUPABASE_URL);
    expect(headers.get('content-security-policy')).toBeNull();
  });
});

describe('SECURITY_HEADERS', () => {
  it('blocks MIME sniffing, framing and referrer leakage', () => {
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });

  it('pins HTTPS for a year without preloading the domain', () => {
    expect(SECURITY_HEADERS['Strict-Transport-Security']).toBe(
      'max-age=31536000; includeSubDomains',
    );
  });

  it('does not carry a CSP: Astro writes that one with its hashes', () => {
    expect(Object.keys(SECURITY_HEADERS)).not.toContain('Content-Security-Policy');
  });
});

describe('applySecurityHeaders', () => {
  it('sets every static header without dropping what the response already had', () => {
    const headers = new Headers({ 'Cache-Control': 'public, s-maxage=300' });
    applySecurityHeaders(headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(headers.get(name)).toBe(value);
    }
    expect(headers.get('Cache-Control')).toBe('public, s-maxage=300');
  });
});

describe('public/_headers', () => {
  const content = readFileSync(fileURLToPath(new URL('../../public/_headers', import.meta.url)), 'utf8');

  /** Headers under the catch-all `/*` rule, the ones every asset receives. */
  function catchAllHeaders(): Map<string, string> {
    const lines = content.split('\n');
    const start = lines.findIndex((line) => line.trim() === '/*');
    expect(start, 'public/_headers must keep a `/*` block').toBeGreaterThan(-1);
    const headers = new Map<string, string>();
    for (const line of lines.slice(start + 1)) {
      if (!line.trim()) continue;
      if (!/^\s/.test(line)) break; // the next rule starts
      const separator = line.indexOf(':');
      headers.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    }
    return headers;
  }

  it('serves the static assets the same header set as the middleware', () => {
    const headers = catchAllHeaders();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(headers.get(name), `public/_headers is missing ${name}`).toBe(value);
    }
    expect(headers.size).toBe(Object.keys(SECURITY_HEADERS).length);
  });

  it('caches hashed bundles immutably, since their names change on every build', () => {
    expect(content).toContain('/_astro/*');
    expect(content).toContain('Cache-Control: public, max-age=31536000, immutable');
  });
});

describe('enforceApiRateLimit', () => {
  const request = (ip: string): Request =>
    new Request('https://mdverse.dev/api/export/docx', {
      method: 'POST',
      headers: { 'cf-connecting-ip': ip },
    });

  it('allows the burst, then refuses with a retry hint', () => {
    const capacity = API_RATE_LIMITS.docx.capacity;
    const ip = '203.0.113.10';
    for (let attempt = 0; attempt < capacity; attempt += 1) {
      expect(enforceApiRateLimit('docx', request(ip), 'user-a').allowed, `attempt ${attempt}`).toBe(
        true,
      );
    }
    const denied = enforceApiRateLimit('docx', request(ip), 'user-a');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('gives each user their own bucket behind one shared IP', () => {
    const capacity = API_RATE_LIMITS.docx.capacity;
    const ip = '203.0.113.20';
    for (let attempt = 0; attempt < capacity; attempt += 1) {
      enforceApiRateLimit('docx', request(ip), 'user-b');
    }
    expect(enforceApiRateLimit('docx', request(ip), 'user-b').allowed).toBe(false);
    expect(enforceApiRateLimit('docx', request(ip), 'user-c').allowed).toBe(true);
  });

  it('never shares a bucket between endpoint kinds', () => {
    const capacity = API_RATE_LIMITS.upload.capacity;
    const ip = '203.0.113.30';
    for (let attempt = 0; attempt < capacity; attempt += 1) {
      enforceApiRateLimit('upload', request(ip), 'user-d');
    }
    expect(enforceApiRateLimit('upload', request(ip), 'user-d').allowed).toBe(false);
    expect(enforceApiRateLimit('docx', request(ip), 'user-d').allowed).toBe(true);
  });

  it('keeps a public export readable for everyone else while one caller is limited', () => {
    const capacity = API_RATE_LIMITS['public-export'].capacity;
    const request_ = (ip: string) => new Request('https://mdverse.dev/d/slug/document.html', { headers: { 'cf-connecting-ip': ip } });
    for (let attempt = 0; attempt < capacity; attempt += 1) {
      enforceApiRateLimit('public-export', request_('198.51.100.7'));
    }
    expect(enforceApiRateLimit('public-export', request_('198.51.100.7')).allowed).toBe(false);
    expect(enforceApiRateLimit('public-export', request_('198.51.100.8')).allowed).toBe(true);
  });
});

describe('apiRateLimitedResponse', () => {
  it('answers 429 with a Retry-After and a private, uncacheable body', () => {
    const response = apiRateLimitedResponse({ allowed: false, retryAfterSeconds: 0.2, remaining: 0 });
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('1');
    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-cache, no-store, must-revalidate, max-age=0',
    );
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
  });

  it('can answer in plain text for an endpoint that has no JSON shape', () => {
    const response = apiRateLimitedResponse(
      { allowed: false, retryAfterSeconds: 30, remaining: 0 },
      'text/plain; charset=utf-8',
      'Too many requests',
    );
    expect(response.headers.get('Retry-After')).toBe('30');
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
  });
});
