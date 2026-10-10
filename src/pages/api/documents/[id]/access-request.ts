import type { APIRoute } from 'astro';

import { apiSession, jsonError, jsonResponse, readJsonObject } from '@/lib/api/http';
import {
  describeAccessRequestOutcome,
  normalizeAccessMessage,
} from '@/lib/documents/accessRequests';
import { isDocumentId } from '@/lib/documents/ids';
import { requestDocumentAccess } from '@/lib/documents/repository';
import { getSiteUrl } from '@/lib/supabase/env';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const session = apiSession(context);
  if (!session) return jsonError(401, 'unauthenticated');

  const id = context.params.id ?? '';
  if (!isDocumentId(id)) return jsonError(400, 'invalid_id');

  const body = await readJsonObject(context.request);
  const message = normalizeAccessMessage(body?.message);

  const { supabase } = session;
  const { user, profile } = context.locals;

  try {
    const result = await requestDocumentAccess(supabase, { documentId: id, message });

    if (!result.ok) {
      // A failed call is a server problem; it must not read as the visitor's fault.
      return jsonError(result.reason === 'forbidden' ? 403 : 500, 'request_failed');
    }

    const { outcome, ownerEmail, ownerName, documentTitle } = result.value;

    if (outcome === 'requested' && ownerEmail) {
      const requesterName =
        profile?.display_name || profile?.username || user?.email?.split('@')[0] || 'Someone';
      const siteUrl = getSiteUrl();

      try {
    
        const { sendAccessRequestEmail } = await import('@/lib/email/sender');
        const sent = await sendAccessRequestEmail({
          to: ownerEmail,
          ownerName,
          requesterName,
          requesterEmail: user?.email ?? null,
          documentTitle,
          message,
          reviewUrl: `${siteUrl}/?doc=${encodeURIComponent(id)}&collaborate=1`,
          siteUrl,
        });
        if (!sent.ok) console.warn('[email] access request not delivered:', sent.error);
      } catch (error) {
        // The request is already durable; a broken email stack must not undo it.
        const detail = error instanceof Error ? error.message : String(error);
        console.warn('[email] access request could not be sent:', detail);
      }
    } else if (outcome === 'requested') {
    
      console.error(
        '[email] access request: owner email came back empty, skipping send for document',
        id,
      );
    }

    const notice = describeAccessRequestOutcome(outcome);
    return jsonResponse(
      { ok: notice.tone !== 'error', outcome, notice },
      outcome === 'not_found' ? 404 : 200,
    );
  } catch (error) {
    console.warn('[documents] access request failed:', error);
    return jsonError(500, 'request_failed');
  }
};
