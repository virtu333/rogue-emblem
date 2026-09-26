// Guidance — how much the game coaches (pure, no Phaser, no RNG).
//
// Setting "Guidance": Auto | Full | Light | Off.
//   Full   coaching notes while you play (a fragile unit moved into reach, a healer
//          with a hurt ally, your first turn) plus the first-use explanations.
//   Light  first-use explanations only (recruits, the commander's fall, convoy…).
//   Off    no field notes (the practice tutorial stays available).
//   Auto   Full for a save slot that has not finished a run yet, Light after.
// Every note shows at most once per save slot (HintManager ids) and never blocks
// input. Legacy "hints: false" maps to Off.

import { CONSUMABLE_MAX, INVENTORY_MAX } from '../utils/constants.js';

export const GUIDANCE_LEVELS = Object.freeze(['full', 'light', 'off']);
export const GUIDANCE_PREFERENCES = Object.freeze(['auto', ...GUIDANCE_LEVELS]);

export const GUIDANCE_LABELS = Object.freeze({ full: 'Full', light: 'Light', off: 'Off' });

/** A slot counts as a veteran's once it has finished (won or lost) a run. */
export function isVeteranMeta(meta) {
  const completed = Number(meta?.runsCompleted);
  return Number.isFinite(completed) && completed >= 1;
}

/** Effective level for a stored preference. */
export function resolveGuidance(preference, { veteran = false } = {}) {
  if (GUIDANCE_LEVELS.includes(preference)) return preference;
  return veteran ? 'light' : 'full';
}

/** tier: 'coach' shows on Full only; 'essential' on Full and Light. */
export function guidanceAllows(level, tier) {
  if (level === 'off') return false;
  if (level === 'light') return tier === 'essential';
  return level === 'full';
}

export const GUIDANCE_NOTES = Object.freeze({
  guide_first_turn: { tier: 'coach' },
  guide_fragile_in_reach: { tier: 'coach' },
  guide_healer_heals: { tier: 'coach' },
  guide_no_attack: { tier: 'coach' },
  guide_commander_low_hp: { tier: 'essential' },
  guide_recruit_on_map: { tier: 'essential' },
  guide_convoy: { tier: 'essential' },
});

export function noteTier(id) {
  return GUIDANCE_NOTES[id]?.tier || 'essential';
}

/** Units that can use a staff (healers). */
export function canUseStaff(unit) {
  return (unit?.proficiencies || []).some((p) => p?.type === 'Staff');
}

/**
 * Units that fold quickly when struck: healers and anything thin (low DEF on a
 * small HP pool). Sera is both. Purely a teaching heuristic, not a combat rule.
 */
export function isFragileUnit(unit) {
  if (!unit || unit.faction !== 'player') return false;
  if (canUseStaff(unit)) return true;
  const def = Number(unit.stats?.DEF);
  const hp = Number(unit.stats?.HP);
  return Number.isFinite(def) && Number.isFinite(hp) && def <= 4 && hp <= 22;
}

const enemies = (n) => `${n} ${n === 1 ? 'enemy' : 'enemies'}`;

/** "Garrick (Cavalier)" / "Garrick" / "The green unit": who the recruit note names. */
function recruitWho(npc) {
  if (!npc?.name) return 'The green unit';
  return npc.className ? `${npc.name} (${npc.className})` : npc.name;
}

/** Copy for each note. `touch` picks the tap / key wording. */
export function guidanceText(id, context = {}) {
  const { unit, commander, count = 0, touch = true, npc } = context;
  const name = unit?.name || 'This unit';
  const lord = commander?.name || 'Your commander';
  switch (id) {
    case 'guide_first_turn':
      return touch
        ? 'Tap a unit with a blue ring to see where it can move. While you choose a tile, a red eye marks each enemy that could reach it next turn.'
        : 'Click a unit with a blue ring to see where it can move. Point at a tile: a red eye marks each enemy that could reach it next turn.';
    case 'guide_fragile_in_reach':
      return `${name} would be in reach of ${enemies(count)} and can't take many hits. ${
        touch ? 'Tap Back' : 'Press Esc or right-click'
      } to choose a safer tile.`;
    case 'guide_healer_heals':
      return `${name} heals with a staff: move next to a hurt ally and choose Heal. Early on, keep ${name} out of reach and heal ${lord}.`;
    case 'guide_no_attack':
      return `No enemy is in reach of ${name} here, so Attack is greyed out. ${
        touch ? 'Tap Back' : 'Press Esc or right-click'
      } to try a closer tile, or Wait.`;
    case 'guide_commander_low_hp':
      return `${lord} is badly hurt. If ${lord} falls, the run ends. Pull back, heal with a staff, or use a Vulnerary from Item.`;
    case 'guide_recruit_on_map':
      return `${recruitWho(npc)} under the gold banner can join you. Move a Lord next to them and choose Talk before enemies reach them.`;
    case 'guide_convoy':
      return `Convoy is your army’s shared storage between battles. Units fight only with what they carry (${INVENTORY_MAX} weapons, ${CONSUMABLE_MAX} items). Store puts a carried item away; Withdraw hands it to the chosen unit.`;
    default:
      return '';
  }
}

/** Short reason on a greyed Attack row when nobody is in reach: "No target in range 1–2". */
export function noTargetReason(range) {
  return range ? `No target in range ${range}` : 'No target in range';
}

/** "1–2" / "1" from the unit's usable combat weapons, or null. */
export function reachText(weapons = [], parse) {
  let min = Infinity;
  let max = 0;
  for (const weapon of weapons) {
    const range = parse ? parse(weapon?.range) : null;
    if (!range) continue;
    min = Math.min(min, range.min);
    max = Math.max(max, range.max);
  }
  if (!Number.isFinite(min) || max <= 0) return null;
  return min === max ? `${max}` : `${min}–${max}`;
}
