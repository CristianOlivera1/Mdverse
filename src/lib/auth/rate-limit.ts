export const HONEYPOT_FIELD = 'website';

export const TURNSTILE_FIELD = 'cf-turnstile-response';

export type AuthRouteKind =
  | 'signin'
  | 'signup'
  | 'resend'
  | 'forgot'
  | 'update'
  | 'oauth'
  | 'callback';

export interface RateLimitConfig {
  readonly capacity: number;
  readonly windowSeconds: number;
}

export const AUTH_RATE_LIMITS: Record<AuthRouteKind, RateLimitConfig> = {
  signin: { capacity: 10, windowSeconds: 600 },
  signup: { capacity: 5, windowSeconds: 3600 },
  resend: { capacity: 5, windowSeconds: 3600 },
  forgot: { capacity: 5, windowSeconds: 3600 },
  update: { capacity: 10, windowSeconds: 600 },
  oauth: { capacity: 30, windowSeconds: 600 },
  callback: { capacity: 30, windowSeconds: 600 },
};

export const EMAIL_RESEND_COOLDOWN_SECONDS = 60;

export interface BucketState {
  count: number;
  windowStartMs: number;
}

export type BucketStore = Map<string, BucketState>;

export interface RateLimitVerdict {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
  readonly remaining: number;
}

export function checkRateLimit(
  store: BucketStore,
  key: string,
  config: RateLimitConfig,
  nowMs: number,
): RateLimitVerdict {
  const windowMs = config.windowSeconds * 1000;
  const entry = store.get(key);

  if (!entry || nowMs - entry.windowStartMs >= windowMs) {
    store.set(key, { count: 1, windowStartMs: nowMs });
    return { allowed: true, retryAfterSeconds: 0, remaining: config.capacity - 1 };
  }

  if (entry.count >= config.capacity) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((entry.windowStartMs + windowMs - nowMs) / 1000),
    );
    return { allowed: false, retryAfterSeconds, remaining: 0 };
  }

  entry.count += 1;
  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: config.capacity - entry.count,
  };
}

export type CooldownStore = Map<string, number>;

export interface CooldownVerdict {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export function checkEmailCooldown(
  store: CooldownStore,
  key: string,
  cooldownSeconds: number,
  nowMs: number,
): CooldownVerdict {
  const lastSentMs = store.get(key);
  if (lastSentMs !== undefined && nowMs - lastSentMs < cooldownSeconds * 1000) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((lastSentMs + cooldownSeconds * 1000 - nowMs) / 1000),
      ),
    };
  }
  store.set(key, nowMs);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function isHoneypotFilled(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function hashForLog(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function clientIpFromHeaders(headers: Headers): string | null {
  const cfIp = headers.get('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return null;
}

export function bucketKey(route: string, parts: readonly string[]): string {
  return `${route}:${parts.map(hashForLog).join(':')}`;
}

export type ApiRouteKind = 'docx' | 'upload' | 'public-export';

export const API_RATE_LIMITS: Record<ApiRouteKind, RateLimitConfig> = {
  docx: { capacity: 20, windowSeconds: 600 },
  upload: { capacity: 30, windowSeconds: 600 },
  'public-export': { capacity: 60, windowSeconds: 600 },
};

const apiStores: Record<ApiRouteKind, BucketStore> = {
  docx: new Map(),
  upload: new Map(),
  'public-export': new Map(),
};

const attemptStores: Record<AuthRouteKind, BucketStore> = {
  signin: new Map(),
  signup: new Map(),
  resend: new Map(),
  forgot: new Map(),
  update: new Map(),
  oauth: new Map(),
  callback: new Map(),
};

const emailCooldownStore: CooldownStore = new Map();

export interface AuthAttempt {
  readonly route: AuthRouteKind;
  readonly key: string;
}

export function authAttemptFor(
  route: AuthRouteKind,
  request: Request,
  identifier: string | null,
): AuthAttempt {
  const ip = clientIpFromHeaders(request.headers) ?? 'unknown';
  const parts = identifier ? [ip, identifier] : [ip];
  return { route, key: bucketKey(route, parts) };
}

export function enforceAuthRateLimit(
  attempt: AuthAttempt,
  nowMs: number = Date.now(),
): RateLimitVerdict {
  return checkRateLimit(attemptStores[attempt.route], attempt.key, AUTH_RATE_LIMITS[attempt.route], nowMs);
}

export function enforceEmailCooldown(
  email: string,
  nowMs: number = Date.now(),
): CooldownVerdict {
  return checkEmailCooldown(emailCooldownStore, hashForLog(email), EMAIL_RESEND_COOLDOWN_SECONDS, nowMs);
}

export function logRateLimited(
  route: AuthRouteKind | ApiRouteKind,
  key: string,
  retryAfterSeconds: number,
): void {
  console.warn(
    `[auth] rate_limited route=${route} key=${key} retry_after=${retryAfterSeconds}s`,
  );
}

export function apiAttemptKey(
  kind: ApiRouteKind,
  request: Request,
  identifier?: string | null,
): string {
  const ip = clientIpFromHeaders(request.headers) ?? 'unknown';
  return bucketKey(kind, identifier ? [ip, identifier] : [ip]);
}

export function enforceApiRateLimit(
  kind: ApiRouteKind,
  request: Request,
  identifier?: string | null,
  nowMs: number = Date.now(),
): RateLimitVerdict {
  const key = apiAttemptKey(kind, request, identifier);
  const verdict = checkRateLimit(apiStores[kind], key, API_RATE_LIMITS[kind], nowMs);
  if (!verdict.allowed) logRateLimited(kind, key, verdict.retryAfterSeconds);
  return verdict;
}

export function apiRateLimitedResponse(
  verdict: RateLimitVerdict,
  contentType: string = 'application/json; charset=utf-8',
  body: string = JSON.stringify({ error: 'rate_limited' }),
): Response {
  return new Response(body, {
    status: 429,
    headers: {
      'Content-Type': contentType,
      'Retry-After': String(Math.max(1, Math.ceil(verdict.retryAfterSeconds))),
      'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
    },
  });
}

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function shouldEnforceTurnstile(secret: string | null | undefined): boolean {
  return typeof secret === 'string' && secret.trim().length > 0;
}

export interface TurnstileResult {
  readonly ok: boolean;
  readonly skipped: boolean;
}

export async function verifyTurnstile(token: string, secret: string): Promise<TurnstileResult> {
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
    });
    if (!response.ok) return { ok: false, skipped: false };
    const payload = (await response.json()) as { success?: boolean };
    return { ok: payload.success === true, skipped: false };
  } catch {
    return { ok: false, skipped: false };
  }
}

export async function maybeVerifyTurnstile(
  formValue: unknown,
  secret: string | null | undefined,
): Promise<TurnstileResult> {
  if (!shouldEnforceTurnstile(secret)) return { ok: true, skipped: true };
  if (typeof formValue !== 'string' || formValue.length === 0) {
    return { ok: false, skipped: false };
  }
  return verifyTurnstile(formValue, (secret as string).trim());
}

export function rateLimitedRedirect(url: string, retryAfterSeconds: number): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: url,
      'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))),
      'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
    },
  });
}
