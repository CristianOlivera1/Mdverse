export function initRequestAccessPopup(): void {
  const badge = document.getElementById('role-badge') as HTMLButtonElement | null;
  const popup = document.getElementById('request-access-pop') as HTMLElement | null;
  const form = document.getElementById('request-access-form') as HTMLFormElement | null;
  const messageInput = document.getElementById('rap-message') as HTMLTextAreaElement | null;
  const submitBtn = document.getElementById('rap-submit') as HTMLButtonElement | null;
  const submitLabel = document.getElementById('rap-submit-label') as HTMLElement | null;
  const spinner = document.getElementById('rap-spinner') as HTMLElement | null;
  const noticeEl = document.getElementById('rap-notice') as HTMLElement | null;
  const cancelBtn = document.getElementById('rap-cancel') as HTMLButtonElement | null;

  if (!badge || !popup || !form) return;

  let activeDocId: string | null = null;
  let sent = false;
  let closeTimer: number | undefined;

  document.addEventListener('mdverse:active-document', (e) => {
    const detail = (e as CustomEvent<{ id: string; role: string }>).detail;
    activeDocId = detail.id;
    if (!popup.hidden) closePopup();
  });

  document.dispatchEvent(new CustomEvent('mdverse:request-active-document'));

  function positionPopup(): void {
    const badgeRect = badge!.getBoundingClientRect();
    const popWidth = popup!.offsetWidth || 320;
    const margin = 8;

    let top = badgeRect.bottom + margin;
    let left = badgeRect.right - popWidth;

    const vw = window.innerWidth;
    if (left < margin) left = margin;
    if (left + popWidth > vw - margin) left = vw - margin - popWidth;

    popup!.style.top = `${top}px`;
    popup!.style.left = `${left}px`;
  }

  function openPopup(): void {
    window.clearTimeout(closeTimer);
    popup!.hidden = false;
    badge!.setAttribute('aria-expanded', 'true');
    positionPopup();
    messageInput?.focus();
  }

  function closePopup(): void {
    window.clearTimeout(closeTimer);
    popup!.hidden = true;
    badge!.setAttribute('aria-expanded', 'false');
  }

  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!popup.hidden) {
      closePopup();
    } else {
      resetForm();
      openPopup();
    }
  });

  cancelBtn?.addEventListener('click', closePopup);

  document.addEventListener('click', (e) => {
    if (!popup.hidden && !popup.contains(e.target as Node) && e.target !== badge) {
      closePopup();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !popup.hidden) closePopup();
  });

  window.addEventListener('resize', () => { if (!popup.hidden) positionPopup(); }, { passive: true });

  function resetForm(): void {
    sent = false;
    window.clearTimeout(closeTimer);
    if (messageInput) {
      messageInput.value = '';
      messageInput.hidden = false;
    }
    const fields = form?.querySelector<HTMLElement>('.rap-actions');
    if (fields) fields.hidden = false;
    setSubmitBusy(false);
    showNotice('', '');
  }

  function setSubmitBusy(busy: boolean): void {
    if (submitBtn) submitBtn.disabled = busy;
    if (submitLabel) submitLabel.textContent = busy ? 'Sending…' : 'Send request';
    if (spinner) spinner.hidden = !busy;
  }

  function showNotice(tone: '' | 'success' | 'error' | 'info', message: string): void {
    if (!noticeEl) return;
    if (!tone) {
      noticeEl.hidden = true;
      noticeEl.removeAttribute('data-tone');
      noticeEl.textContent = '';
      return;
    }
    noticeEl.dataset.tone = tone;
    noticeEl.textContent = message;
    noticeEl.hidden = false;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeDocId) {
      showNotice('error', 'Could not identify the document. Refresh and try again.');
      return;
    }
    if (sent) {
      showNotice('info', 'You already sent a request for this document.');
      return;
    }

    setSubmitBusy(true);
    showNotice('', '');

    try {
      const body: Record<string, string> = {};
      const msg = (messageInput?.value ?? '').trim();
      if (msg) body.message = msg;

      const res = await fetch(`/api/documents/${activeDocId}/access-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as {
        ok: boolean;
        outcome?: string;
        notice?: { tone: string; message: string };
      };

      if (data.ok) {
        sent = true;
        const msg = data.notice?.message ?? 'Your request was sent to the owner.';
        showNotice('success', msg);
        const fields = form.querySelector<HTMLElement>('.rap-actions');
        if (fields) fields.hidden = true;
        if (messageInput) messageInput.hidden = true;
        window.clearTimeout(closeTimer);
        closeTimer = window.setTimeout(closePopup, 3500);
      } else {
        const msg = data.notice?.message ?? 'Something went wrong. Try again later.';
        showNotice('error', msg);
        setSubmitBusy(false);
      }
    } catch {
      showNotice('error', 'Network error. Check your connection and try again.');
      setSubmitBusy(false);
    }
  });
}
