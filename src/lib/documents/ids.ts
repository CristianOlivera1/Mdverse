const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** DB slugify output: never contains whitespace, slashes, or quotes. */
const SLUG_REJECTED = /[\s/?#%&"'<>\\]/;

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
