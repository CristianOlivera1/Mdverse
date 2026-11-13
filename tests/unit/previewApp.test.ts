// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { initPreviewApp } from '../../src/lib/app/previewApp';
import { PREF_KEYS } from '../../src/lib/editor/prefs';

describe('preview theme toggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `
      <div id="preview-root" data-theme="dark">
        <div id="preview-scroll"><article id="preview-content" class="prose prose-invert"></article></div>
      </div>
      <span id="preview-status"></span>
      <button id="preview-share"></button>
      <button id="preview-theme-toggle" data-next-theme="light"></button>
    `;
  });

  it('switches between light and dark and remembers the selection', () => {
    initPreviewApp();

    const root = document.getElementById('preview-root');
    const content = document.getElementById('preview-content');
    const toggle = document.getElementById('preview-theme-toggle');
    expect(root?.getAttribute('data-theme')).toBe('dark');
    expect(content?.classList.contains('prose-invert')).toBe(true);

    toggle?.click();
    expect(root?.getAttribute('data-theme')).toBe('light');
    expect(document.body.dataset.previewTheme).toBe('light');
    expect(content?.classList.contains('prose-invert')).toBe(false);
    expect(toggle?.getAttribute('aria-label')).toBe('Switch to dark mode');
    expect(localStorage.getItem(PREF_KEYS.previewTheme)).toBe('light');

    toggle?.click();
    expect(root?.getAttribute('data-theme')).toBe('dark');
    expect(content?.classList.contains('prose-invert')).toBe(true);
    expect(localStorage.getItem(PREF_KEYS.previewTheme)).toBe('dark');
  });

  it('restores light mode from its saved preference', () => {
    localStorage.setItem(PREF_KEYS.previewTheme, 'light');

    initPreviewApp();

    expect(document.body.dataset.previewTheme).toBe('light');
    expect(document.getElementById('preview-root')?.getAttribute('data-theme')).toBe('light');
    expect(document.getElementById('preview-content')?.classList.contains('prose-invert')).toBe(
      false,
    );
  });
});
