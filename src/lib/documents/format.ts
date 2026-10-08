/**
 * `6 Oct 2026, 15:22 UTC` - or an empty string when the value is not a date.
 *
 * Rendered on the server, so the zone is pinned to UTC and shown; a date that
 * silently means "wherever the worker runs" would be worse than an explicit one.
 */
export function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date);
}

export function describeSize(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Strips leading `#{1,6}` and truncates with an ellipsis. */
export function firstLine(text: string, max = 72): string {
  const line = text
    .split('\n')
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0);

  if (!line) return '';
  const plain = line.replace(/^#{1,6}\s*/, '');
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}
