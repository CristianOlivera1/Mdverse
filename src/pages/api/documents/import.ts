/**
 * `POST /api/documents/import` - moves the drafts this browser kept in
 * `localStorage` into the account.
 *
 * The drafts only exist in the browser, so the dashboard reads them and sends
 * them here; parsing and the size caps live in `src/lib/documents/drafts.ts`.
 * Failed drafts are counted instead of aborting the batch: importing nine of ten
 * drafts is better than importing none.
 */

import type { APIRoute } from 'astro';

import { apiSession, jsonError, jsonResponse, readJsonObject } from '@/lib/api/http';
import { parseDraftList } from '@/lib/documents/drafts';
import { importDrafts } from '@/lib/documents/repository';

export const POST: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');

  const body = await readJsonObject(context.request);
  const drafts = parseDraftList(body?.drafts);
  if (drafts.length === 0) return jsonError(400, 'empty_import');

  const { supabase, userId } = session;

  try {
    const result = await importDrafts(supabase, userId, drafts);
    return jsonResponse({ created: result.created.length, failed: result.failed });
  } catch (error) {
    console.warn('[documents] import failed:', error);
    return jsonError(500, 'import_failed');
  }
};
