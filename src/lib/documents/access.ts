import type { CollaboratorRole } from '../supabase/types';
import type { DocumentAccess } from './types';

/** Row shape needed to decide access: who owns it, and who is asking. */
export interface AccessInput {
  readonly ownerId: string;
  readonly viewerId: string;
  /** Role from `document_collaborators`, when the viewer is one. */
  readonly collaboratorRole?: CollaboratorRole | null;
}

export function documentAccess({
  ownerId,
  viewerId,
  collaboratorRole,
}: AccessInput): DocumentAccess {
  if (ownerId === viewerId) return 'owner';
  return collaboratorRole ?? 'reader';
}

/** May change the text (owner, editor or admin). */
export function canEditDocument(access: DocumentAccess): boolean {
  return access === 'owner' || access === 'editor' || access === 'admin';
}

/** May hand out access, manage people and delete (owner or admin). */
export function canManageDocument(access: DocumentAccess): boolean {
  return access === 'owner' || access === 'admin';
}

export function describeAccess(access: DocumentAccess): string {
  switch (access) {
    case 'owner':
      return 'Owner';
    case 'admin':
      return 'Can manage';
    case 'editor':
      return 'Can edit';
    case 'reader':
      return 'Can view';
  }
}
