// Guidance — how much the game coaches (pure, no Phaser, no RNG).
//
// Setting "Guidance": Auto | Full | Light | Off.
//   Full   coaching notes while you play (a fragile unit moved into reach, a healer
//          with a hurt ally, your first turn) plus the first-use explanations.
//   Light  first-use explanations only (recruits, the commander's fall, convoy, the
//          veteran who should not take the kills…).
//   Off    no field notes (the prologue stays available).
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

// scope: what a note talks about, so it can step aside once that is gone.
//   'tile'  this unit on this tile ("would be in reach here"): gone when the unit
//           moves, acts, is deselected, or the turn moves on.
//   'unit'  this unit ("Sera heals with a staff"): gone when it acts, is
//           deselected, or the turn moves on; moving it is following the advice.
//   none    the battle as a whole: stays until read or dismissed.
export const GUIDANCE_NOTES = Object.freeze({
  guide_first_turn: { tier: 'coach' },
  guide_fragile_in_reach: { tier: 'coach', scope: 'tile' },
  guide_healer_heals: { tier: 'coach', scope: 'unit' },
  guide_no_attack: { tier: 'coach', scope: 'tile' },
  guide_commander_low_hp: { tier: 'essential' },
  guide_recruit_on_map: { tier: 'essential' },
  guide_veteran_kills: { tier: 'essential', scope: 'unit' },
  guide_convoy: { tier: 'essential' },
  guide_zombie_remains: { tier: 'essential' },
  // Act 1 follow-through (docs/specs/prologue-chapter.md §7): what the prologue can only
  // introduce, taught again at the point of use in a real run.
  guide_first_shop: { tier: 'essential' },
  guide_first_church: { tier: 'essential' },
  guide_prepare: { tier: 'essential' },
  guide_objective_changed: { tier: 'essential' },
  guide_specialist_dance: { tier: 'essential', scope: 'unit' },
  guide_specialist_flyer: { tier: 'essential', scope: 'unit' },
  guide_armor: { tier: 'essential' },
});

export function noteTier(id) {
  return GUIDANCE_NOTES[id]?.tier || 'essential';
}

/** 'tile' | 'unit' for a note about one unit's moment, else null. */
export function noteScope(id) {
  return GUIDANCE_NOTES[id]?.scope || null;
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

/** "staves mend the merchant caravan too: move within reach of it" / "... of Garrick". */
function npcHealAdvice(npc) {
  if (npc?.isCaravan) return 'staves mend the merchant caravan too: move within reach of it';
  return `staves mend green units too: move within reach of ${npc?.name || 'the green unit'}`;
}

/**
 * A foe whose armour turns blades (the armor note): an Armored unit (Knights,
 * Generals), or any unit whose DEF stands well above its RES. Teaching heuristic.
 */
export function isArmoredFoe(unit) {
  if (!unit || unit.faction !== 'enemy') return false;
  if (unit.moveType === 'Armored') return true;
  const def = Number(unit.stats?.DEF) || 0;
  const res = Number(unit.stats?.RES) || 0;
  return def >= 9 && def - res >= 6;
}

/** The special job a newly fielded unit is for (the specialist note), or null. */
export function specialistJob(unit) {
  if (!unit || unit.faction !== 'player') return null;
  if ((unit.skills || []).includes('dance')) return 'dance';
  if (unit.moveType === 'Flying') return 'flyer';
  return null;
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
      // Only an NPC ally is hurt (context.npc): staves mend green units too.
      if (npc)
        return `${name} heals with a staff, and ${npcHealAdvice(npc)} and choose Heal. Keep ${name} out of enemy reach.`;
      return `${name} heals with a staff: move next to a hurt ally and choose Heal. Early on, keep ${name} out of reach and heal ${lord}.`;
    case 'guide_no_attack':
      return `No enemy is in reach of ${name} here, so Attack is greyed out. ${
        touch ? 'Tap Back' : 'Press Esc or right-click'
      } to try a closer tile, or Wait.`;
    case 'guide_commander_low_hp':
      return `${lord} is badly hurt. If ${lord} falls, the run ends. Pull back, heal with a staff, or use a Vulnerary from Item.`;
    case 'guide_recruit_on_map':
      return `${recruitWho(npc)} under the gold banner can join you. Move a Lord next to them and choose Talk before enemies reach them.`;
    case 'guide_veteran_kills':
      return `${name} is strong now but barely grows and earns little XP. Weaken enemies with ${name}, then leave the final blow to ${lord} and your recruits: they grow from it.`;
    case 'guide_zombie_remains':
      return 'Fallen undead leave bones. The number counts the enemy phases until they rise again at half HP. Bring a unit within weapon reach and choose Smash to end them for good. Light magic leaves no bones.';
    case 'guide_first_shop':
      return 'A shop: buy and sell here, and Forge makes a weapon stronger for gold. Every shop stocks its own wares; gold also pays for revivals and promotions.';
    case 'guide_first_church':
      return 'A church: Heal all is free, and the fallen revive for gold. Each church takes one vow: a promotion or a blessing, not both.';
    case 'guide_prepare':
      return `${context.hurt?.name || 'A unit'} ended that battle badly hurt. HP carries between battles: staves refill, consumables don't. Roster › Item heals now, or a church or ruins Rest heals everyone.`;
    case 'guide_objective_changed':
      return context.objective === 'seize'
        ? `${context.boss || 'The boss'} has fallen. The objective is the throne now: move a Lord onto it (the SEIZE tile) and choose Seize.`
        : `The objective changed: ${context.goal || 'check the objective line'}.`;
    case 'guide_specialist_dance':
      return `${name} dances: move next to an ally who has already acted and choose Dance. That ally can move and act again this turn.`;
    case 'guide_specialist_flyer':
      return `${name} flies: water, mountains and forest cost one step, so cross where the others can't. Bows strike flyers hard, and terrain gives them no cover.`;
    case 'guide_armor':
      return context.knight
        ? 'Knights shrug off swords. Magic hits RES.'
        : `Armour shrugs off blades: ${context.target?.name || 'this foe'} has DEF ${context.target?.stats?.DEF ?? '?'}, RES ${context.target?.stats?.RES ?? '?'}. Magic hits RES.`;
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

/** Greyed Attack row for a unit carrying no weapon it can wield (Full Guidance). */
export function unarmedReason() {
  return 'Unarmed: no weapon to attack with';
}

/**
 * The distances a unit can strike at, from each usable weapon's {min, max} range:
 * "1", "1–3", or "1, 3–10" when the weapons leave a gap. Null without a range.
 */
export function reachFromRanges(ranges = []) {
  const spans = ranges
    .filter((r) => r && Number.isFinite(r.min) && Number.isFinite(r.max) && r.max >= r.min)
    .map((r) => [Math.max(1, r.min), r.max])
    .filter(([min, max]) => max >= min)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const [min, max] of spans) {
    const last = merged[merged.length - 1];
    if (last && min <= last[1] + 1) last[1] = Math.max(last[1], max);
    else merged.push([min, max]);
  }
  if (!merged.length) return null;
  return merged.map(([min, max]) => (min === max ? `${min}` : `${min}–${max}`)).join(', ');
}

/** "1–2" / "1" from weapons' listed ranges (no skill bonus), or null. */
export function reachText(weapons = [], parse) {
  return reachFromRanges(weapons.map((weapon) => (parse ? parse(weapon?.range) : null)));
}
