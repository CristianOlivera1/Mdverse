export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()',
  'X-DNS-Prefetch-Control': 'off',
};

export const CSP_STATIC_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "font-src 'self' data:",
  "media-src 'self'",
  "manifest-src 'self'",
  'frame-src https://challenges.cloudflare.com',
  "worker-src 'self' blob:",
  'upgrade-insecure-requests',
] as const;

export interface CspOrigins {
  readonly https: string | null;
  readonly wss: string | null;
}

export function cspOrigins(supabaseUrl: string | null | undefined): CspOrigins {
  if (typeof supabaseUrl !== 'string') return { https: null, wss: null };
  const trimmed = supabaseUrl.trim();
  if (!trimmed) return { https: null, wss: null };
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return { https: null, wss: null };
    return { https: url.origin, wss: `wss://${url.host}` };
  } catch {
    return { https: null, wss: null };
  }
}

export function cspDeploymentDirectives(supabaseUrl: string | null | undefined): string[] {
  const { https, wss } = cspOrigins(supabaseUrl);
  const connect = ["'self'", https, wss, 'https://api.github.com'].filter(Boolean).join(' ');
  const images = ["'self'", 'data:', 'blob:', https].filter(Boolean).join(' ');
  return [`connect-src ${connect}`, `img-src ${images}`];
}

function hasDirective(policy: string, directive: string): boolean {
  const name = directive.split(' ')[0];
  return new RegExp(`(^|;)\\s*${name}\\s`).test(policy);
}

export function appendDeploymentCsp(
  headers: Headers,
  supabaseUrl: string | null | undefined,
): void {
  const existing = headers.get('content-security-policy');
  if (!existing) return;

  const missing = cspDeploymentDirectives(supabaseUrl).filter(
    (directive) => !hasDirective(existing, directive),
  );
  if (missing.length === 0) return;

  headers.set(
    'content-security-policy',
    `${existing.trim()} ${missing.map((directive) => `${directive};`).join(' ')}`,
  );
}

export function applySecurityHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
}
