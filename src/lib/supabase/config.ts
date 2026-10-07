import { safeRedirectPath } from '../auth/redirect';

export interface SupabaseConfig {
  readonly url: string;
  readonly publishableKey: string;
}

const PLACEHOLDERS = [
  'YOUR_PROJECT_REF',
  'YOUR_PUBLISHABLE_KEY',
  'YOUR_SECRET_KEY',
  'TU_CLAVE',
  'TU_PROJECT_REF',
  'xxx',
  'x.x.x',
];

function isUsableValue(value: string): boolean {
  if (value.length === 0) return false;
  const upper = value.toUpperCase();
  return !PLACEHOLDERS.some((placeholder) => upper.includes(placeholder.toUpperCase()));
}

function isUsableUrl(value: string): boolean {
  if (!/^https?:\/\/[^\s/]+/i.test(value)) return false;
  return isUsableValue(value);
}

export function normalizeSupabaseConfig(input: {
  url?: string | null;
  publishableKey?: string | null;
}): SupabaseConfig | null {
  const url = (input.url ?? '').trim().replace(/\/+$/, '');
  const publishableKey = (input.publishableKey ?? '').trim();

  if (!isUsableUrl(url) || !isUsableValue(publishableKey)) return null;

  return { url, publishableKey };
}

export function buildAuthCallbackUrl(siteUrl: string, next?: string | null): string {
  const base = siteUrl.trim().replace(/\/+$/, '');
  const target = safeRedirectPath(next, '/dashboard');
  return `${base}/auth/callback?next=${encodeURIComponent(target)}`;
}

export const SUPABASE_SETUP_HINT = [
  'Supabase is not configured yet.',
  'Copy .env.example to .env and fill in PUBLIC_SUPABASE_URL and',
  'PUBLIC_SUPABASE_PUBLISHABLE_KEY from your project (Settings → API).',
  'See PLAN_VISOR_MARKDOWN_PRODUCCION.md (blocks 9 and 10).',
].join(' ');
