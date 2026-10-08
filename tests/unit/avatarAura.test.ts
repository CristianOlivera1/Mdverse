import { describe, expect, it } from 'vitest';

import { auraLetterIndex, avatarAura, AVATAR_AURA_FAMILIES } from '../../src/lib/auth/avatarAura';

function baseHue(css: string): number {
  const match = css.match(/hsl\((-?\d+)/);
  if (!match) throw new Error(`no hsl hue in: ${css.slice(0, 80)}`);
  return Number(match[1]);
}

describe('auraLetterIndex', () => {
  it('maps initials A-Z case-insensitively and folds diacritics', () => {
    expect(auraLetterIndex('Ana')).toBe(0);
    expect(auraLetterIndex('cristian')).toBe(2);
    expect(auraLetterIndex('Zoé')).toBe(25);
    expect(auraLetterIndex('Álvaro')).toBe(0);
    expect(auraLetterIndex('  Bruno  ')).toBe(1);
  });

  it('falls back for non-letters and empties', () => {
    expect(auraLetterIndex('7up')).toBe(-1);
    expect(auraLetterIndex('_bot')).toBe(-1);
    expect(auraLetterIndex('')).toBe(-1);
    expect(auraLetterIndex(null)).toBe(-1);
  });
});

describe('avatarAura families', () => {
  it('exposes 26 letter families', () => {
    expect(AVATAR_AURA_FAMILIES).toHaveLength(26);
  });

  it('gives every initial its own hue family', () => {
    const hues = new Set(
      ['Ana', 'Bruno', 'Cristian', 'Dora', 'Elena'].map(
        (name) => baseHue(avatarAura(`seed-${name}`, name, 'sm').baseLayer),
      ),
    );
    expect(hues.size).toBe(5);
  });

  it('varies users who share an initial', () => {
    const ana = avatarAura('user-1', 'Ana', 'sm');
    const andres = avatarAura('user-2', 'Andrés', 'sm');
    expect(baseHue(ana.baseLayer)).toBe(baseHue(andres.baseLayer));
    expect(ana.softVeil === andres.softVeil && ana.baseLayer === andres.baseLayer).toBe(false);
  });

  it('is deterministic per seed', () => {
    expect(avatarAura('user-1', 'Ana', 'sm')).toEqual(avatarAura('user-1', 'Ana', 'sm'));
  });
});
