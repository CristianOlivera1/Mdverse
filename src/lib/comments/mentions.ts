export interface MentionCandidate {
  readonly userId: string;
  readonly name: string;
  readonly username: string;
}

const USERNAME_PATTERN = /(^|[\s(])@([a-z0-9_]{3,30})/g;

export function extractMentionUsernames(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/(^|[\s(])@([a-z0-9_]{3,30})/g)) {
    found.add(match[2].toLowerCase());
  }
  return [...found];
}

export async function fetchMentionCandidates(documentId: string): Promise<MentionCandidate[]> {
  try {
    const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/mentions`);
    if (!response.ok) return [];
    const data = (await response.json()) as { people?: MentionCandidate[] };
    return Array.isArray(data.people) ? data.people : [];
  } catch {
    return [];
  }
}

export function renderCommentBody(body: string, usernames: ReadonlySet<string>): DocumentFragment {
  const fragment = document.createDocumentFragment();
  let cursor = 0;

  for (const match of body.matchAll(USERNAME_PATTERN)) {
    const [full, prefix, handle] = match;
    const start = match.index ?? 0;

    if (prefix) {
      fragment.append(document.createTextNode(body.slice(cursor, start + prefix.length)));
    }
    const matched = usernames.has(handle.toLowerCase());
    if (matched) {
      const chip = document.createElement('span');
      chip.textContent = `@${handle}`;
      chip.className = 'rounded bg-[#1e293b] px-1 py-px font-medium text-[#93c5fd]';
      fragment.append(chip);
    } else {
      fragment.append(document.createTextNode(full.slice(prefix.length)));
    }
    cursor = start + full.length;
  }

  if (cursor < body.length) fragment.append(document.createTextNode(body.slice(cursor)));
  return fragment;
}
