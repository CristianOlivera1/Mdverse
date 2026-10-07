export interface CaretGeometry {
  readonly text: string;
  readonly offset: number;
  readonly charWidth: number;
  readonly lineHeight: number;
  readonly paddingX: number;
  readonly paddingY: number;
  readonly scrollTop: number;
  readonly scrollLeft: number;
  readonly tabWidth?: number;
}

export interface CaretBox {
  readonly x: number;
  readonly y: number;
}

export interface SelectionBox extends CaretBox {
  readonly width: number;
  readonly height: number;
}

export function clampOffset(text: string, offset: number): number {
  if (!Number.isFinite(offset) || offset <= 0) return 0;
  return Math.min(Math.floor(offset), text.length);
}

export function lineColumnAt(text: string, offset: number): { line: number; column: number } {
  const target = clampOffset(text, offset);
  const before = text.slice(0, target);
  const lastBreak = before.lastIndexOf('\n');
  return { line: before.split('\n').length, column: target - lastBreak - 1 };
}

export function visualColumn(lineText: string, column: number, tabWidth = 4): number {
  const width = Math.max(1, Math.floor(tabWidth));
  let visual = 0;

  for (const char of Array.from(lineText.slice(0, column))) {
    visual += char === '\t' ? width - (visual % width) : 1;
  }

  return visual;
}

function lineStartAt(text: string, offset: number): { start: number; text: string; index: number } {
  const target = clampOffset(text, offset);
  const before = text.slice(0, target);
  const lastBreak = before.lastIndexOf('\n');
  const start = lastBreak + 1;
  const nextBreak = text.indexOf('\n', start);
  const end = nextBreak === -1 ? text.length : nextBreak;

  return { start, text: text.slice(start, end), index: target - start };
}

export function caretBox(geometry: CaretGeometry): CaretBox {
  const tabWidth = geometry.tabWidth ?? 4;
  const line = lineStartAt(geometry.text, geometry.offset);
  const column = visualColumn(line.text, line.index, tabWidth);

  return {
    x: geometry.paddingX + column * geometry.charWidth - geometry.scrollLeft,
    y:
      geometry.paddingY +
      (lineColumnAt(geometry.text, geometry.offset).line - 1) * geometry.lineHeight -
      geometry.scrollTop,
  };
}

export function selectionBox(geometry: CaretGeometry & { to: number }): SelectionBox | null {
  const tabWidth = geometry.tabWidth ?? 4;
  const from = clampOffset(geometry.text, geometry.offset);
  const to = clampOffset(geometry.text, geometry.to);
  if (from === to) return null;

  const start = lineStartAt(geometry.text, Math.min(from, to));
  const end = lineStartAt(geometry.text, Math.max(from, to));
  if (start.start !== end.start) return null;

  const startColumn = visualColumn(start.text, start.index, tabWidth);
  const endColumn = visualColumn(end.text, end.index, tabWidth);

  return {
    x: geometry.paddingX + startColumn * geometry.charWidth - geometry.scrollLeft,
    y:
      geometry.paddingY +
      (lineColumnAt(geometry.text, from).line - 1) * geometry.lineHeight -
      geometry.scrollTop,
    width: Math.max(2, (endColumn - startColumn) * geometry.charWidth),
    height: geometry.lineHeight,
  };
}

export function caretIsVisible(
  box: CaretBox,
  viewport: { readonly width: number; readonly height: number },
  lineHeight: number,
): boolean {
  return (
    box.y + lineHeight >= 0 && box.y <= viewport.height && box.x >= -8 && box.x <= viewport.width
  );
}
