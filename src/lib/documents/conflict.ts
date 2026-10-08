import type { DocumentAccess } from './types';

/**
 * What the editor does when the server holds a newer revision than the text on
 * screen. Only the owner is asked: an invited editor never overwrites the
 * owner's version, so their copy quietly follows the newer one instead.
 */
export type ConflictPolicy = 'ask' | 'follow-server';

export function conflictPolicy(access: DocumentAccess): ConflictPolicy {
  return access === 'owner' ? 'ask' : 'follow-server';
}
