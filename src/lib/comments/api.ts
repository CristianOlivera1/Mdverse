export interface CommentAnchor {
  readonly from: number;
  readonly to: number;
  readonly quote: string;
}

export interface Comment {
  readonly id: string;
  readonly documentId: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly authorInitials: string;
  readonly authorColor: string;
  readonly parentId: string | null;
  readonly body: string;
  readonly anchor: CommentAnchor | null;
  readonly resolved: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly pending?: boolean;
  readonly failed?: boolean;
}

export interface CommentThread {
  root: Comment;
  replies: Comment[];
}

export async function fetchComments(documentId: string): Promise<Comment[]> {
  const response = await fetch(`/api/comments?documentId=${encodeURIComponent(documentId)}`);
  if (!response.ok) return [];
  return (await response.json()) as Comment[];
}

export interface CreateCommentInput {
  documentId: string;
  body: string;
  anchor?: CommentAnchor;
  parentId?: string;
}

export async function createComment(
  input: CreateCommentInput,
): Promise<{ ok: true; comment: Comment } | { ok: false; error: string }> {
  const response = await fetch('/api/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error ?? 'Failed to post comment' };
  }

  const comment = (await response.json()) as Comment;
  return { ok: true, comment };
}


export async function resolveComment(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetch(`/api/comments/${id}/resolve`, { method: 'POST' });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error ?? 'Failed to resolve comment' };
  }
  return { ok: true };
}


export async function deleteComment(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetch(`/api/comments/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error ?? 'Failed to delete comment' };
  }
  return { ok: true };
}

export function groupIntoThreads(comments: Comment[]): CommentThread[] {
  const roots = comments.filter((c) => c.parentId === null && !c.resolved);
  const byParent = new Map<string, Comment[]>();

  for (const comment of comments) {
    if (comment.parentId) {
      const list = byParent.get(comment.parentId) ?? [];
      list.push(comment);
      byParent.set(comment.parentId, list);
    }
  }

  return roots.map((root) => ({
    root,
    replies: byParent.get(root.id) ?? [],
  }));
}

export function threadsInRange(
  threads: CommentThread[],
  from: number,
  to: number,
): CommentThread[] {
  return threads.filter((thread) => {
    const a = thread.root.anchor;
    if (!a) return false;
    return a.from <= to && a.to >= from;
  });
}

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#0ea5e9', '#3b82f6',
];

export function colorForAuthor(authorId: string): string {
  let hash = 0;
  for (let i = 0; i < authorId.length; i++) {
    hash = (hash * 31 + authorId.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
