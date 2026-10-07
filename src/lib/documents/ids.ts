const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Any Postgres uuid in a path segment: documents and accounts share the shape. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function isDocumentId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

const SHARE_TOKEN_PATTERN = /^[0-9a-f]{48}$/;

export function isShareToken(value: string): boolean {
  return SHARE_TOKEN_PATTERN.test(value);
}

/**
 * Public addresses: `private.slugify()` in the database lower-cases the title,
 * turns spaces into dashes and drops punctuation, so a real slug never contains
 * whitespace, a slash or a quote. Checking the shape keeps junk out of the query
 * — and out of the logs, which is where a probing request ends up.
 */
const SLUG_REJECTED = /[\s/?#%&"'<>\\]/;

/** Longest slug the database can produce: `left(base, 60) || '-' || suffix`. */
export const MAX_SLUG_LENGTH = 80;

export function isPublicSlug(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_SLUG_LENGTH &&
    value !== '.' &&
    value !== '..' &&
    !SLUG_REJECTED.test(value)
  );
}
