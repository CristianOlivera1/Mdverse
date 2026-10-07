/**
 * Document ids are UUIDs; the editor and the API share one validator.
 *
 * Checking the shape before it reaches PostgREST turns an arbitrary path segment
 * — which would come back as `22P02 invalid input syntax for type uuid`, a server
 * error — into a plain `400 invalid_id`, and keeps the "is this a server
 * document?" question answerable in the browser.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Any Postgres uuid in a path segment: documents and accounts share the shape. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function isDocumentId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Share tokens are 24 random bytes rendered as hex by the database
 * (`encode(gen_random_bytes(24), 'hex')`). Checking the shape here keeps a junk
 * path out of the database and out of the logs.
 */
const SHARE_TOKEN_PATTERN = /^[0-9a-f]{48}$/;

export function isShareToken(value: string): boolean {
  return SHARE_TOKEN_PATTERN.test(value);
}
