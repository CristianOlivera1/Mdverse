import { imageUploadErrorText, uploadImage } from '../editor/imageUpload';

let activeDocumentId = '';

function toast(msg: string, tone: 'info' | 'error' = 'info'): void {
  document.dispatchEvent(new CustomEvent('mdverse:toast', { detail: { msg, tone } }));
}

function activeTextarea(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>('[data-pane]:not([style*="none"]) [data-r="textarea"]');
}

function insertAtCursor(textarea: HTMLTextAreaElement, text: string): string {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);

  const needsNewline = before.length > 0 && !before.endsWith('\n');
  const insert = (needsNewline ? '\n\n' : '') + text + '\n';

  textarea.focus();
  const ok = document.execCommand('insertText', false, insert);
  if (!ok) {
    textarea.value = before + insert + after;
    textarea.setSelectionRange(start + insert.length, start + insert.length);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return insert;
}

function replaceOccurrence(
  textarea: HTMLTextAreaElement,
  find: string,
  replacement: string,
): boolean {
  const index = textarea.value.lastIndexOf(find);
  if (index < 0 || !find) return false;

  textarea.focus();
  textarea.setSelectionRange(index, index + find.length);
  const ok = document.execCommand('insertText', false, replacement);
  if (!ok) {
    const value = textarea.value;
    const next = value.slice(0, index) + replacement + value.slice(index + find.length);
    const caret = index + replacement.length;
    textarea.value = next;
    textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return true;
}

async function handleFile(file: File, textarea: HTMLTextAreaElement): Promise<void> {
  if (!file.type.startsWith('image/')) return;
  if (!activeDocumentId) {
    toast('Save your document first to upload images');
    return;
  }

  const placeholder = `![Uploading ${file.name}…]()`;
  const inserted = insertAtCursor(textarea, placeholder);

  const result = await uploadImage(file, activeDocumentId);

  if (result.ok) {
    const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    replaceOccurrence(textarea, placeholder, `![${alt}](${result.url})`);
    toast('Image uploaded');
  } else {
    if (!replaceOccurrence(textarea, inserted, '')) replaceOccurrence(textarea, placeholder, '');
    toast(imageUploadErrorText(result.reason), 'error');
  }
}

export function initImageUpload(): void {
  document.addEventListener('mdverse:active-document', (e) => {
    const detail = (e as CustomEvent<{ id: string }>).detail;
    activeDocumentId = detail?.id ?? '';
  });

  document.dispatchEvent(new CustomEvent('mdverse:request-active-document'));

  document.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer?.items ?? []].some((item) => item.kind === 'file' && item.type.startsWith('image/'))) return;
    e.preventDefault();
    const ta = (e.target as HTMLElement).closest<HTMLTextAreaElement>('[data-r="textarea"]');
    if (ta) ta.classList.add('ring-2', 'ring-indigo-500/60', 'ring-inset');
  }, { passive: false });

  document.addEventListener('dragleave', (e) => {
    const ta = (e.target as HTMLElement).closest<HTMLTextAreaElement>('[data-r="textarea"]');
    ta?.classList.remove('ring-2', 'ring-indigo-500/60', 'ring-inset');
  });

  document.addEventListener('drop', (e) => {
    const ta = (e.target as HTMLElement).closest<HTMLTextAreaElement>('[data-r="textarea"]');
    if (!ta) return;
    ta.classList.remove('ring-2', 'ring-indigo-500/60', 'ring-inset');

    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;
    e.preventDefault();

    for (const file of files.slice(0, 5)) {
      void handleFile(file, ta);
    }
  }, { passive: false });

  document.addEventListener('paste', (e) => {
    const ta = (e.target as HTMLElement).closest<HTMLTextAreaElement>('[data-r="textarea"]');
    if (!ta) return;

    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;
    e.preventDefault(); // Don't paste the raw data URI

    for (const file of files.slice(0, 3)) {
      void handleFile(file, ta);
    }
  });

  const fileInput = document.getElementById('image-file-input') as HTMLInputElement | null;

  document.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-command="insert-image"]');
    if (!btn) return;
    fileInput?.click();
  });

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const ta = activeTextarea();
    if (ta) void handleFile(file, ta);
    fileInput.value = '';
  });

}
