export type AvatarAuraSize = 'sm' | 'md' | 'lg';

export interface AuraFamily {
  base: string;
  colors: [string, string, string];
}

export const AVATAR_AURA_FAMILIES: AuraFamily[] = [
  { base: '#fff7ed', colors: ['#fb923c', '#f43f5e', '#c026d3'] },
  { base: '#ecfeff', colors: ['#38bdf8', '#2563eb', '#22d3ee'] },
  { base: '#faf5ff', colors: ['#a855f7', '#ec4899', '#6366f1'] },
  { base: '#ecfdf5', colors: ['#2dd4bf', '#10b981', '#a3e635'] },
];

export function hashAvatarKey(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export interface AvatarAura {
  baseLayer: string;
  softVeil: string;
  veilA: string;
  veilB: string;
  blur: number;
}

export function avatarAura(
  seed: string | null | undefined,
  name: string | null | undefined,
  size: AvatarAuraSize = 'md',
): AvatarAura {
  const key = seed ?? name ?? '';
  const h = hashAvatarKey(key);
  const family = AVATAR_AURA_FAMILIES[h % AVATAR_AURA_FAMILIES.length] ?? AVATAR_AURA_FAMILIES[0]!;
  const ci = Math.floor(h / 4) % 3;
  const c1 = family.colors[ci]!;
  const c2 = family.colors[(ci + 1) % 3]!;
  const c3 = family.colors[(ci + 2) % 3]!;

  const angBase = h % 360;
  const ang1 = (Math.floor(h / 7) + 120) % 360;
  const ang2 = (Math.floor(h / 49) + 240) % 360;

  const blur = size === 'sm' ? 4 + (h % 3) : size === 'md' ? 6 + (h % 3) : 10 + (h % 5);

  const mid = 55 + (h % 15);
  const midB = 52 + (Math.floor(h / 13) % 15);
  const s1 = 5 + (h % 10);
  const s2 = s1 + 40 + (Math.floor(h / 3) % 9);
  const topMode = h % 2 === 0 ? 'screen' : 'overlay';

  return {
    baseLayer: `background: linear-gradient(${angBase}deg, ${family.base} 0%, #ffffff 100%); mix-blend-mode: normal; filter: blur(${blur}px);`,
    softVeil: `background: linear-gradient(${ang1}deg, ${c1} 0%, ${c2} ${mid}%, transparent 100%); mix-blend-mode: multiply; filter: blur(${blur}px);`,
    veilA: `background: linear-gradient(${ang1}deg, transparent ${s1}%, ${c1} ${s2}%, transparent 98%); mix-blend-mode: multiply; filter: blur(${blur}px);`,
    veilB: `background: linear-gradient(${ang2}deg, ${c2} 0%, ${c3} ${midB}%, transparent 100%); mix-blend-mode: ${topMode}; filter: blur(${blur}px);`,
    blur,
  };
}
