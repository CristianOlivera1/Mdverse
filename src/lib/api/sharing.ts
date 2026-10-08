import type { DocumentErrorCode, ShareFeedback } from '../documents/messages';
import { shareFeedbackParams, shareNotice } from '../documents/messages';
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

export interface ShareActionFeedback extends ShareFeedback {
  error?: DocumentErrorCode;
}

/**
 * The one answer these endpoints give: the dialog reads `notice` and shows it.
 * There is no page to redirect to any more - the collaboration dialog is the
 * only caller, and it always asks for JSON.
 */
export function shareFeedbackResponse(feedback: ShareActionFeedback): Response {
  const params = Object.fromEntries(shareFeedbackParams(feedback));
  const notice = shareNotice(params);
  return jsonResponse({ ok: notice?.tone !== 'error', notice });
}
