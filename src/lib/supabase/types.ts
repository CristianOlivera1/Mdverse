/**
 * App-facing aliases over the generated types.
 *
 * Call sites import from here instead of `database.types.ts`, so regenerating the
 * schema only ever touches this file.
 */

import type { Database } from './database.types';

export type Profile = Database['public']['Tables']['profiles']['Row'];
export type ProfileInsert = Database['public']['Tables']['profiles']['Insert'];
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];
