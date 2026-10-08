export type ImageUploadResult =
  | { ok: true; url: string; filename: string }
  | { ok: false; reason: 'too_large' | 'wrong_type' | 'no_auth' | 'forbidden' | 'upload_failed' };

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/avif',
]);

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

export function validateImageFile(file: File): ImageUploadResult | null {
  if (!ALLOWED_TYPES.has(file.type)) return { ok: false, reason: 'wrong_type' };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, reason: 'too_large' };
  return null; // valid
}

async function sanitizeSvg(file: File): Promise<File | null> {
  try {
    const { default: DOMPurify } = await import('dompurify');
    const source = await file.text();
    const clean = DOMPurify.sanitize(source, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['script', 'foreignObject', 'use'],
    });
    if (!clean.trim()) return null;
    return new File([clean], file.name || 'image.svg', { type: 'image/svg+xml' });
  } catch {
    return null;
  }
}

export async function uploadImage(
  file: File,
  documentId: string,
): Promise<ImageUploadResult> {
  const validation = validateImageFile(file);
  if (validation) return validation;

  const upload = file.type === 'image/svg+xml' ? await sanitizeSvg(file) : file;
  if (!upload) return { ok: false, reason: 'wrong_type' };

  const ext = EXT[file.type] ?? 'bin';
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const body = new FormData();
  body.append('file', upload, filename);
  body.append('documentId', documentId);

  try {
    const response = await fetch('/api/images/upload', { method: 'POST', body });
    if (response.status === 401) return { ok: false, reason: 'no_auth' };

    if (response.status === 413) return { ok: false, reason: 'too_large' };
    if (response.status === 415) return { ok: false, reason: 'wrong_type' };
    if (response.status === 403) return { ok: false, reason: 'forbidden' };
    if (!response.ok) return { ok: false, reason: 'upload_failed' };

    const data = (await response.json()) as { url?: string };
    if (!data.url) return { ok: false, reason: 'upload_failed' };

    return { ok: true, url: data.url, filename: file.name || filename };
  } catch {
    return { ok: false, reason: 'upload_failed' };
  }
}

export function imageUploadErrorText(
  reason: 'too_large' | 'wrong_type' | 'no_auth' | 'forbidden' | 'upload_failed',
): string {
  switch (reason) {
    case 'too_large':
      return 'Image too large - max 3 MB';
    case 'wrong_type':
      return 'Unsupported format - use JPEG, PNG, GIF, WebP, SVG or AVIF';
    case 'no_auth':
      return 'Sign in to upload images';
    case 'forbidden':
      return 'No permission to upload to this document';
    case 'upload_failed':
      return 'Upload failed - try again';
    default:
      return 'Upload failed';
  }
}
