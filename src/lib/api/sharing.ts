/** One feedback response for form posts (redirect) and the editor dialog (JSON). */

import type { APIContext } from 'astro';

import type { DocumentErrorCode, ShareFeedback } from '../documents/messages';
import { shareFeedbackParams, shareNotice, sharePageUrl } from '../documents/messages';
import { jsonResponse, readJsonObject } from './http';

export interface ShareInput {
  get(name: string): unknown;
}

export async function readShareInput(request: Request): Promise<ShareInput | null> {
  const contentType = request.headers.get('Content-Type') ?? '';

  if (contentType.includes('application/json')) {
    const body = await readJsonObject(request);
    return body ? { get: (name) => body[name] } : null;
  }

  try {
    const form = await request.formData();
    return { get: (name) => form.get(name) };
  } catch {
    return null;
  }
}

export function wantsJson(request: Request): boolean {
  const accept = request.headers.get('Accept') ?? '';
  return accept.includes('application/json');
}

export interface ShareActionFeedback extends ShareFeedback {
  error?: DocumentErrorCode;
}

export function shareFeedbackResponse(
  context: Pick<APIContext, 'redirect' | 'request'>,
  documentId: string,
  feedback: ShareActionFeedback,
): Response {
  const params = Object.fromEntries(shareFeedbackParams(feedback));

  if (wantsJson(context.request)) {
    const notice = shareNotice(params);
    return jsonResponse({ ok: notice?.tone !== 'error', notice });
  }

  return context.redirect(sharePageUrl(documentId, feedback), 303);
}
