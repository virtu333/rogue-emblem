// choiceContent — what the "choose one" screens say, computed without the DOM.
//
// The draft screens (boss recruit, lord arrival, mercenary board, battle
// rewards, blessings, difficulty) compare their options side by side. This
// module turns units, rewards, blessings and difficulty modes into plain
// content: stats against the other candidates (the best of the draft marked),
// growth hints, weapon ranks, trait and skill lines, a quiet "your army lacks"
// cue computed from the roster, a reward's "for whom", a blessing's boon and
// cost. Presentation only: it never mutates a unit, a reward or the run, never
// reads Math.random, and every engine helper it calls is a read.
import { getUnitTraits } from '../engine/TraitSystem.js';
import { getDisplayLevel, canEquip } from '../engine/UnitManager.js';
import { getStaticCombatStats, getStaffMaxUses } from '../engine/Combat.js';
import { rewardWeaponEligible } from '../engine/LootRewardCommands.js';

/** Stats compared on a candidate card, in reading order (HP sits in the identity). */
export const CHOICE_STATS = Object.freeze(['STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK']);
const GROWTH_KEYS = Object.freeze(['HP', ...CHOICE_STATS]);

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export function unitMov(unit) {
  return num(unit?.mov ?? unit?.stats?.MOV);
}

/**
 * The unit's fastest-growing stats (ties keep reading order): the top `count`
 * among growths of at least `min`%. Units without growths (legacy or enemy
 * data) show none rather than guessing.
 */
export function growthHints(unit, { count = 2, min = 40 } = {}) {
  const growths = unit?.growths;
  if (!growths || typeof growths !== 'object') return [];
  return GROWTH_KEYS.map((stat, i) => ({ stat, value: num(growths[stat]), i }))
    .filter((g) => g.value >= min)
    .sort((a, b) => b.value - a.value || a.i - b.i)
    .slice(0, count)
    .map((g) => g.stat);
}

/**
 * Stat rows for a set of units shown together. `best` marks the strict
 * leader of a stat across the draft (never when there is one candidate or
 * the top value is shared by all); `ratio` is the bar length against the
 * draft's highest value (at least 10, so small numbers stay small bars).
 */
export function candidateStatBoard(units) {
  const list = Array.isArray(units) ? units : [];
  const scale = {};
  const top = {};
  const topCount = {};
  for (const stat of ['HP', ...CHOICE_STATS]) {
    const values = list.map((u) => num(u?.stats?.[stat]));
    const max = values.length ? Math.max(...values) : 0;
    scale[stat] = Math.max(10, max);
    top[stat] = max;
    topCount[stat] = values.filter((v) => v === max).length;
  }
  const comparable = list.length > 1;
  return list.map((unit) => {
    const grows = new Set(growthHints(unit));
    const row = (stat) => {
      const value = num(unit?.stats?.[stat]);
      return {
        stat,
        value,
        ratio: Math.max(0, Math.min(1, value / scale[stat])),
        best: comparable && value === top[stat] && topCount[stat] < list.length && value > 0,
        grows: grows.has(stat),
      };
    };
    const maxHp = num(unit?.stats?.HP);
    const current = unit?.currentHP == null ? maxHp : num(unit.currentHP);
    return {
      hp: { ...row('HP'), current, max: maxHp, fill: maxHp > 0 ? current / maxHp : 0 },
      stats: CHOICE_STATS.map(row),
      mov: unitMov(unit),
    };
  });
}

/** Weapon ranks as marks: [{ type, rank: 'P' | 'M', label }]. */
export function weaponMarks(unit) {
  const out = [];
  for (const p of Array.isArray(unit?.proficiencies) ? unit.proficiencies : []) {
    if (!p?.type) continue;
    const master = p.rank === 'Mast';
    out.push({
      type: p.type,
      rank: master ? 'M' : 'P',
      label: `${p.type} ${master ? 'Master' : 'Proficient'}`,
    });
  }
  return out;
}

/**
 * Trait and skill lines: [{ kind, id, name, text }]. Traits come through
 * TraitSystem's own lookup so trait text changes flow in untouched.
 */
export function unitLines(unit, gameData = {}) {
  const lines = [];
  for (const trait of getUnitTraits(unit, gameData.traits)) {
    lines.push({
      kind: trait.rarity === 'legendary' ? 'legend' : 'trait',
      id: trait.id,
      name: trait.name || trait.id,
      text: trait.description || '',
    });
  }
  const seen = new Set();
  for (const id of Array.isArray(unit?.skills) ? unit.skills : []) {
    if (typeof id !== 'string' || !id.trim() || seen.has(id)) continue;
    seen.add(id);
    const skill = gameData.skills?.find?.((s) => s.id === id);
    lines.push({
      kind: 'skill',
      id,
      name: skill?.name || id,
      text: skill?.description || '',
    });
  }
  return lines;
}

/**
 * Deeds hook: the unit's earned epithet, once the Deeds display helper
 * lands. Until then a unit may carry `epithet` (string or { name }).
 */
export function choiceEpithet(unit) {
  const e = unit?.epithet;
  if (typeof e === 'string') return e.trim();
  if (e && typeof e.name === 'string') return e.name.trim();
  return '';
}

// ── Roster needs ─────────────────────────────────────────────────────────

/**
 * Army roles a unit covers. Order is the priority a gap is named in: a
 * healer before a flier before a caster, and so on.
 */
export const ROSTER_ROLES = Object.freeze([
  { id: 'healer', lacks: 'a healer', test: (u) => hasWeapon(u, 'Staff') },
  { id: 'flier', lacks: 'a flier', test: (u) => u?.moveType === 'Flying' },
  { id: 'magic', lacks: 'a mage', test: (u) => hasWeapon(u, 'Tome') || hasWeapon(u, 'Light') },
  { id: 'archer', lacks: 'an archer', test: (u) => hasWeapon(u, 'Bow') },
  { id: 'cavalry', lacks: 'cavalry', test: (u) => u?.moveType === 'Cavalry' },
  { id: 'armor', lacks: 'armor', test: (u) => u?.moveType === 'Armored' },
  {
    id: 'dancer',
    lacks: 'a dancer',
    test: (u) => Array.isArray(u?.skills) && u.skills.includes('dance'),
  },
]);

function hasWeapon(unit, type) {
  return Array.isArray(unit?.proficiencies) && unit.proficiencies.some((p) => p?.type === type);
}

export function unitRoles(unit) {
  return ROSTER_ROLES.filter((role) => role.test(unit)).map((role) => role.id);
}

/** Role ids nobody in the (living) roster covers. */
export function rosterGaps(roster) {
  const units = (Array.isArray(roster) ? roster : []).filter(Boolean);
  return ROSTER_ROLES.filter((role) => !units.some((u) => role.test(u))).map((r) => r.id);
}

/**
 * The quiet cue for one candidate: the highest-priority gap it would fill,
 * or null. Never ranks candidates against each other, never says "pick".
 */
export function candidateCue(unit, roster) {
  if (!unit) return null;
  const gaps = new Set(rosterGaps(roster));
  const role = ROSTER_ROLES.find((r) => gaps.has(r.id) && r.test(unit));
  return role ? { role: role.id, text: `Your army lacks ${role.lacks}` } : null;
}

/** Everything a candidate card shows, for a set of candidates side by side. */
export function candidateCards(units, { roster = [], gameData = {}, temperamentOf = null } = {}) {
  const list = Array.isArray(units) ? units : [];
  const board = candidateStatBoard(list);
  const classes = gameData.classes || [];
  return list.map((unit, i) => {
    const cls = classes.find?.((c) => c?.name === unit?.className);
    let level = unit?.level;
    try {
      level = getDisplayLevel(unit);
    } catch {
      /* legacy units */
    }
    let temperament;
    try {
      temperament = typeof temperamentOf === 'function' ? temperamentOf(unit) || null : null;
    } catch {
      temperament = null;
    }
    return {
      name: String(unit?.name || ''),
      temperament,
      className: unit?.className || '',
      level,
      role: cls?.role || '',
      moveType: unit?.moveType || cls?.moveType || '',
      tier: unit?.tier || cls?.tier || 'base',
      isLord: Boolean(unit?.isLord),
      epithet: choiceEpithet(unit),
      board: board[i],
      weapons: weaponMarks(unit),
      lines: unitLines(unit, gameData),
      cue: candidateCue(unit, roster),
    };
  });
}

// ── Rewards ──────────────────────────────────────────────────────────────

function attackOf(unit, weapon) {
  try {
    return getStaticCombatStats(unit, weapon).atk;
  } catch {
    return null;
  }
}

/**
 * "For whom" for a reward: { who, detail, tone } lines a card can show.
 * Weapons name the wielder who gains the most attack (and how many can
 * wield it); staves name the healer with the most uses; forge stones count
 * the weapons that can take them. Reads only.
 */
export function rewardForWhom(choice, run) {
  const roster = Array.isArray(run?.roster) ? run.roster : [];
  const item = choice?.item;
  if (!choice || choice.type === 'skip')
    return { who: 'Your vault', detail: 'Gold now, no reward', tone: 'gold' };
  if (choice.type === 'gold') {
    const xp = num(choice.xpAmount);
    return {
      who: xp ? 'Whole army' : 'Your vault',
      detail: xp ? `+${xp} XP to every unit` : 'Added to your vault',
      tone: 'gold',
    };
  }
  if (!item) return null;
  if (choice.type === 'accessory' || item.type === 'Accessory')
    return { who: 'Any unit', detail: 'Equip now or keep in the pool', tone: 'muted' };
  if (item.type === 'Scroll' || item.teachesWeaponArtId)
    return { who: 'Team scrolls', detail: 'Teach it from the roster', tone: 'muted' };
  if (item.type === 'Whetstone' || choice.type === 'forge') {
    const count = roster.reduce(
      (n, u) =>
        n +
        (u?.inventory || []).filter((w) => {
          try {
            return rewardWeaponEligible(item, w);
          } catch {
            return false;
          }
        }).length,
      0,
    );
    return count
      ? {
          who: `${count} weapon${count === 1 ? '' : 's'} can take it`,
          detail: 'Upgrade a carried weapon',
          tone: 'good',
        }
      : { who: 'No weapon can take it', detail: 'Nothing carried qualifies', tone: 'bad' };
  }
  if (item.type === 'Consumable') {
    if (item.effect === 'statBoost') {
      const stat = item.stat || '';
      const grower = roster
        .filter((u) => u?.growths)
        .sort((a, b) => num(b.growths?.[stat]) - num(a.growths?.[stat]))[0];
      return {
        who: 'Any unit · permanent',
        detail: stat
          ? `${stat} +${num(item.value) || 1}${grower ? ` · ${grower.name} grows it best` : ''}`
          : '',
        tone: 'good',
      };
    }
    return { who: 'Any unit', detail: 'Carried or sent to the convoy', tone: 'muted' };
  }
  // Weapons and staves: who can wield it, and who gains the most.
  const wielders = roster.filter((u) => {
    try {
      return Array.isArray(u?.proficiencies) && canEquip(u, item);
    } catch {
      return false;
    }
  });
  if (!wielders.length)
    return {
      who: 'No one can wield it',
      detail: `Needs ${item.type || 'a weapon'} rank${item.rankRequired === 'Mast' ? ': Master' : ''}`,
      tone: 'bad',
    };
  const count = `${wielders.length} can wield`;
  if (item.type === 'Staff') {
    const best = wielders
      .map((u) => ({
        u,
        uses: (() => {
          try {
            return getStaffMaxUses(item, u);
          } catch {
            return 0;
          }
        })(),
      })) // prettier-ignore
      .sort((a, b) => b.uses - a.uses)[0];
    return {
      who: `For ${best.u.name}`,
      detail: `${best.uses} use${best.uses === 1 ? '' : 's'} per map · ${count}`,
      tone: 'good',
      unit: best.u.name,
    };
  }
  let best = null;
  for (const u of wielders) {
    const next = attackOf(u, item);
    const now = u.weapon ? attackOf(u, u.weapon) : 0;
    if (next == null) continue;
    const delta = next - (now ?? 0);
    // The biggest gain; on a tie, the hardest hitter.
    if (!best || delta > best.delta || (delta === best.delta && next > best.next))
      best = { u, next, now: now ?? 0, delta };
  }
  if (!best) return { who: count, detail: '', tone: 'muted' };
  return {
    who: `For ${best.u.name}`,
    detail: `Atk ${best.now} → ${best.next} · ${count}`,
    tone: best.delta > 0 ? 'good' : best.delta < 0 ? 'bad' : 'muted',
    unit: best.u.name,
    delta: best.delta,
  };
}

// ── Blessings and difficulty ─────────────────────────────────────────────

export const TIER_NUMERALS = Object.freeze(['', 'I', 'II', 'III', 'IV', 'V']);

/** A blessing as a tarot card: tier numeral, boon, cost (or none), lore. */
export function blessingCardContent(blessing) {
  if (!blessing) return null;
  const tier = Math.max(0, Math.min(5, Math.trunc(num(blessing.tier))));
  const cost =
    typeof blessing.rolledCost?.label === 'string' && blessing.rolledCost.label.trim()
      ? blessing.rolledCost.label.trim()
      : '';
  return {
    id: blessing.id || null,
    name: String(blessing.name || ''),
    tier,
    numeral: TIER_NUMERALS[tier] || String(tier || ''),
    boon: String(blessing.description || ''),
    cost,
    lore: typeof blessing.lore === 'string' ? blessing.lore : '',
  };
}

// Presentation copy for the banners (unknown modes simply show none).
export const DIFFICULTY_TAGLINES = Object.freeze({
  normal: 'The road as it was walked',
  hard: 'The empire answers in kind',
  lunatic: 'Every thread drawn taut',
});

// Summary lines that pay the player back (the rest make the run harder).
const REWARD_LINE = /meta currency|Extended leveling/i;

/** A difficulty mode's banner: what grows harder, what pays back. */
export function difficultyBannerContent(mode, index = 0) {
  const summary = Array.isArray(mode?.summary) ? mode.summary : [];
  return {
    id: mode?.id || '',
    name: String(mode?.label || mode?.name || ''),
    rank: index + 1,
    tagline: DIFFICULTY_TAGLINES[mode?.id] || '',
    harder: summary.filter((line) => !REWARD_LINE.test(line)),
    rewards: summary.filter((line) => REWARD_LINE.test(line)),
    locked: Boolean(mode?.locked),
    lockReason: mode?.lockReason || '',
  };
}
