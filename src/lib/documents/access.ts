import type { CollaboratorRole, DocumentVisibility } from '../supabase/types';
import type { DocumentAccess } from './types';

export interface AccessInput {
  readonly ownerId: string;
  readonly viewerId: string;
  readonly collaboratorRole?: CollaboratorRole | null;

  readonly visibility?: DocumentVisibility;
  readonly linkRole?: CollaboratorRole | null;
}

export function documentAccess({
  ownerId,
  viewerId,
  collaboratorRole,
  visibility,
  linkRole,
}: AccessInput): DocumentAccess {
  if (ownerId === viewerId) return 'owner';
  if (collaboratorRole) return collaboratorRole;
  if (visibility === 'unlisted' || visibility === 'public') {
    return linkRole === 'editor' ? 'editor' : 'reader';
  }
  return 'reader';
}

export function canEditDocument(access: DocumentAccess): boolean {
  return access === 'owner' || access === 'editor' || access === 'admin';
}

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
