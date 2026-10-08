const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto']);

const RELATIVE_PREFIXES = ['#', '/', './', '../', '?'];

export function safeHref(href: string): string {
  const value = href.trim();
  if (!value) return '';

  const normalised = [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join('');
  if (RELATIVE_PREFIXES.some((prefix) => normalised.startsWith(prefix))) return normalised;

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalised);
  if (!scheme) return normalised;

  return ALLOWED_SCHEMES.has(scheme[1].toLowerCase()) ? normalised : '#';
}
