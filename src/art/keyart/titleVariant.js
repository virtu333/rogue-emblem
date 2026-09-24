// titleVariant.js — which Hollow Sun variant greets the player (pure, dependency-free so
// the pre-Phaser auth screen can use it too).
//
//   dusk     default: totality at dusk.
//   rising   after the player's first victory — the Act I boss has fallen at least once
//            ('beatAct1' is recorded at run end, 'reachedAct2' the moment Act II opens).
//   ashfall  once Hard is unlocked ('beatGame', the same gate DifficultySelectScene uses):
//            the colder, later hour.
// Milestones are per save slot; the title is global, so any slot counts.

export const TITLE_VARIANTS = Object.freeze(['dusk', 'rising', 'ashfall']);
export const HARD_UNLOCK_MILESTONE = 'beatGame';
export const FIRST_VICTORY_MILESTONES = Object.freeze(['beatAct1', 'reachedAct2']);

function toPredicate(milestones) {
  if (typeof milestones === 'function') return (id) => !!milestones(id);
  if (milestones && typeof milestones.has === 'function') return (id) => milestones.has(id);
  if (Array.isArray(milestones)) return (id) => milestones.includes(id);
  return () => false;
}

/**
 * @param {((id: string) => boolean) | Set<string> | string[]} milestones
 * @returns {'dusk'|'rising'|'ashfall'}
 */
export function selectTitleVariant(milestones) {
  const has = toPredicate(milestones);
  if (has(HARD_UNLOCK_MILESTONE)) return 'ashfall';
  if (FIRST_VICTORY_MILESTONES.some((id) => has(id))) return 'rising';
  return 'dusk';
}

/**
 * Milestones recorded in any local save slot, read straight from storage (no engine
 * imports). Malformed or missing slots are ignored.
 * @param {{ getItem(key: string): string | null }} [storage]
 * @param {number} [slots]
 */
export function readSlotMilestones(storage = globalThis.localStorage, slots = 3) {
  const found = new Set();
  for (let i = 1; i <= slots; i++) {
    try {
      const raw = storage?.getItem?.(`emblem_rogue_slot_${i}_meta`);
      if (!raw) continue;
      const saved = JSON.parse(raw);
      if (Array.isArray(saved?.milestones))
        for (const m of saved.milestones) if (typeof m === 'string') found.add(m);
    } catch {
      /* ignore unreadable slots */
    }
  }
  return found;
}
