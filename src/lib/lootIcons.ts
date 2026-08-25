/**
 * A shape and colour per kind of loot container.
 *
 * The wiki's interactive map has bespoke art for each one, which is theirs and
 * not ours to ship. Twenty-seven hand-drawn glyphs would also be unreadable at
 * the five pixels these get on screen, so containers are grouped into eight
 * categories that stay apart by shape *and* colour — either alone is too little
 * at this size, and colour alone fails for anyone who cannot separate the reds
 * from the greens.
 */

export type LootShape = 'bag' | 'crate' | 'body' | 'safe' | 'medical' | 'tech' | 'cache' | 'weapon';

export interface LootLook {
  shape: LootShape;
  colour: string;
  /** What the legend calls this group. */
  group: string;
}

const LOOKS: Record<LootShape, { colour: string; group: string }> = {
  bag:     { colour: '#c9a227', group: 'Bags and drawers' },
  crate:   { colour: '#a1703b', group: 'Crates' },
  body:    { colour: '#d05252', group: 'Bodies' },
  safe:    { colour: '#e0c04a', group: 'Safes and cash' },
  medical: { colour: '#e8e8e8', group: 'Medical' },
  tech:    { colour: '#5aa9e6', group: 'Tech and tools' },
  cache:   { colour: '#8d6748', group: 'Buried caches' },
  weapon:  { colour: '#6bab5b', group: 'Weapons and ammo' },
};

/** Matched on the name because that is the only thing the data gives us. */
function shapeFor(name: string): LootShape {
  const value = name.toLowerCase();

  if (value.includes('body') || value.includes('scav')) return 'body';
  if (value.includes('safe') || value.includes('cash') || value.includes('fund')) return 'safe';
  if (value.includes('med')) return 'medical';
  if (value.includes('weapon') || value.includes('ammo') || value.includes('grenade')) return 'weapon';
  if (value.includes('cache') || value.includes('barrel')) return 'cache';
  if (value.includes('pc ') || value.includes('toolbox') || value.includes('technical')) return 'tech';
  if (value.includes('crate') || value.includes('box')) return 'crate';
  return 'bag';
}

export function lootLook(name: string): LootLook {
  const shape = shapeFor(name);
  return { shape, ...LOOKS[shape] };
}

/** Every group, for the map legend. */
export function lootGroups(): LootLook[] {
  return (Object.keys(LOOKS) as LootShape[]).map((shape) => ({ shape, ...LOOKS[shape] }));
}
