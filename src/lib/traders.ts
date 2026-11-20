/**
 * Traders that hand out quests, and how far along each one the player is.
 *
 * The quest data names each quest's trader and any loyalty level it needs
 * ("Jaeger LL3"), but nothing can read the player's trader standing -- so the
 * player tells the app, one dropdown per trader. Ids are BSG's own and have
 * not changed in years; a trader added later simply has no dropdown until it
 * is listed here, and its quests are never filtered.
 */

export interface QuestTrader {
  id: string;
  name: string;
  /** Loyalty levels it has; 1 means it is only ever locked or unlocked. */
  levels: number;
}

export const QUEST_TRADERS: QuestTrader[] = [
  { id: '54cb50c76803fa8b248b4571', name: 'Prapor', levels: 4 },
  { id: '54cb57776803fa99248b456e', name: 'Therapist', levels: 4 },
  { id: '58330581ace78e27b8b10cee', name: 'Skier', levels: 4 },
  { id: '5935c25fb3acc3127c3d8cd9', name: 'Peacekeeper', levels: 4 },
  { id: '5a7c2eca46aef81a7ca2145d', name: 'Mechanic', levels: 4 },
  { id: '5ac3b934156ae10c4430e83c', name: 'Ragman', levels: 4 },
  { id: '5c0647fdd443bc2504c2d371', name: 'Jaeger', levels: 4 },
  { id: '6617beeaa9cfa777ca915b7c', name: 'Ref', levels: 4 },
  // Fence's quests hinge on reputation, not loyalty level, so only whether
  // he gives you work at all is asked.
  { id: '579dc571d53a0658a154fbec', name: 'Fence', levels: 1 },
  { id: '638f541a29ffd1183d187f57', name: 'Lightkeeper', levels: 1 },
  { id: '656f0f98d80a697f855d34b1', name: 'BTR Driver', levels: 1 },
];

/**
 * Trader id -> 0 for locked, else the loyalty level reached. A trader with no
 * entry is "not set" and filters nothing, which is also what everyone starts
 * with, so no quest disappears until the player says so.
 */
export type TraderStanding = Record<string, number>;

/** Keeps only known traders with a sensible level, from whatever was stored. */
export function cleanTraderStanding(raw: unknown): TraderStanding {
  const clean: TraderStanding = {};
  if (!raw || typeof raw !== 'object') return clean;
  for (const trader of QUEST_TRADERS) {
    const value = (raw as Record<string, unknown>)[trader.id];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= trader.levels) {
      clean[trader.id] = value;
    }
  }
  return clean;
}

export function traderName(id: string): string {
  return QUEST_TRADERS.find((t) => t.id === id)?.name ?? 'a trader';
}

/**
 * Why the player's traders rule a quest out, or null when they do not (or
 * when the relevant trader is not set). Checks the quest's own trader first,
 * then every loyalty level it asks for.
 */
export function traderBlock(
  taskId: string,
  index: { trader?: Record<string, string>; traderLevel?: Record<string, { trader: string; level: number }[]> },
  standing: TraderStanding,
): string | null {
  const giver = index.trader?.[taskId];
  if (giver && standing[giver] === 0) return `${traderName(giver)} is locked`;

  for (const need of index.traderLevel?.[taskId] ?? []) {
    const have = standing[need.trader];
    if (have === undefined) continue;
    if (have === 0) return `${traderName(need.trader)} is locked`;
    if (have < need.level) return `Needs ${traderName(need.trader)} LL${need.level} (you have LL${have})`;
  }
  return null;
}
