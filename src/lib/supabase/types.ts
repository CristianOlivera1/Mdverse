/**
 * App-facing aliases over the generated types.
 *
 * Call sites import from here instead of `database.types.ts`, so regenerating the
 * schema only ever touches this file.
 */

import type { Database } from './database.types';

type Tables = Database['public']['Tables'];
type Enums = Database['public']['Enums'];

/* Profiles ----------------------------------------------------------------- */

export type Profile = Tables['profiles']['Row'];
export type ProfileInsert = Tables['profiles']['Insert'];
export type ProfileUpdate = Tables['profiles']['Update'];

/* Documents ---------------------------------------------------------------- */

export type DocumentRow = Tables['documents']['Row'];
export type DocumentInsert = Tables['documents']['Insert'];
export type DocumentUpdate = Tables['documents']['Update'];
export type DocumentVisibility = Enums['document_visibility'];

/* Collaboration ------------------------------------------------------------ */

export type CollaboratorRole = Enums['collaborator_role'];
export type DocumentCollaborator = Tables['document_collaborators']['Row'];
export type DocumentInvitation = Tables['document_invitations']['Row'];

/* History and discussion --------------------------------------------------- */

export type DocumentVersionRow = Tables['document_versions']['Row'];
export type DocumentComment = Tables['comments']['Row'];
export type DocumentShareLink = Tables['share_links']['Row'];

/** What the app needs from a version row, with the id narrowed to a number. */
export type DocumentVersion = Pick<
  DocumentVersionRow,
  'id' | 'document_id' | 'revision' | 'content' | 'title' | 'created_by' | 'created_at'
>;
