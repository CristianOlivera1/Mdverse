import type { APIRoute } from 'astro';

import { getSiteUrl } from '@/lib/supabase/env';

export const prerender = false;

const DISALLOWED = [
  '/dashboard',
  '/documents/',
  '/settings',
  '/api/',
  '/auth/',
  '/s/',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
];

export const GET: APIRoute = () => {
  const body = [
    'User-agent: *',
    'Allow: /',
    ...DISALLOWED.map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${getSiteUrl()}/sitemap.xml`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600',
    },
  });
};
