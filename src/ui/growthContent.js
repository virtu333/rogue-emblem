// growthContent — pure copy, numbers and timing for the growth ceremonies
// (promotion rite, level-up card, recruit card, sealed beats).
//
// Everything is derived from game data and plain values: no DOM, no Phaser,
// no randomness (the battle RNG is Math.random during combat — nothing here
// may touch it). Previews project a *copy* of the unit through the real
// promoteUnit, so the rite shows exactly what the engine applies.
import { XP_STAT_NAMES } from '../utils/constants.js';
import { promoteUnit, getClassInnateSkills } from '../engine/UnitManager.js';
import { getClassChangeWeaponGrants } from '../engine/RosterCommands.js';
import { crestSpecForClass } from './classCrests.js';
import { levelBeatLine, levelUpLine, promotionLine } from '../engine/UnitVoice.js';

export const GROWTH_STATS = Object.freeze([...XP_STAT_NAMES, 'MOV']);

const RANK_WORD = Object.freeze({ Prof: 'P', Mast: 'M' });
export const RANK_NAMES = Object.freeze({ Prof: 'Proficient', Mast: 'Master' });

/** Stable 32-bit FNV-1a (line picks; never the battle RNG). */
export function stableHash(text) {
  let h = 2166136261 >>> 0;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

/**
 * A detached copy of the class-relevant state of a unit. structuredClone
 * cannot copy battle units (Phaser graphics hang off them), and promoteUnit
 * only touches these fields.
 */
export function projectUnit(unit) {
  return {
    name: unit.name,
    className: unit.className,
    tier: unit.tier,
    level: unit.level,
    xp: unit.xp,
    faction: unit.faction,
    isLord: unit.isLord,
    moveType: unit.moveType,
    _baseMoveType: unit._baseMoveType,
    mov: unit.mov,
    currentHP: unit.currentHP,
    stats: { ...(unit.stats || {}) },
    growths: unit.growths ? { ...unit.growths } : unit.growths,
    proficiencies: (unit.proficiencies || []).map((p) => ({ ...p })),
    weaponRank: unit.weaponRank,
    skills: [...(unit.skills || [])],
    inventory: [...(unit.inventory || [])],
    weapon: unit.weapon || null,
    accessory: unit.accessory || null,
  };
}

function lordBonuses(unit, cls, gameData) {
  return (
    gameData?.lords?.find((l) => l.name === unit.name)?.promotionBonuses || cls?.promotionBonuses
  );
}

function rankChanges(before, after) {
  const prior = new Map((before || []).map((p) => [p.type, p.rank || 'Prof']));
  return (after || []).map((p) => {
    const from = prior.get(p.type) || null;
    const to = p.rank || 'Prof';
    const change = !from ? 'new' : from !== to ? 'up' : 'same';
    return {
      type: p.type,
      from,
      to,
      change,
      label: from && from !== to ? `${RANK_WORD[from]}→${RANK_WORD[to]}` : RANK_WORD[to] || to,
    };
  });
}

/**
 * What a promotion path does to this unit (preview and rite share it).
 * @returns {null | {
 *   unitName, fromClass, toClass, fromTier, toTier, fromCrest, toCrest,
 *   levelFrom, levelTo,
 *   stats: {stat, before, after, bonus}[],       only stats that change
 *   growths: {stat, bonus, before, after}[],
 *   ranks: {type, from, to, change, label}[],    every weapon of the new class
 *   moveType: {from, to} | null,
 *   skills: {id, name, description}[],           learned on promotion
 *   dropped: string[],                           innates lost to the skill cap
 *   grants: string[],                            starter weapons granted
 *   role: string,
 * }}
 */
export function promotionPathContent(unit, cls, gameData = {}) {
  if (!unit || !cls?.name) return null;
  const bonuses = lordBonuses(unit, cls, gameData);
  if (!bonuses) return null;
  const projected = projectUnit(unit);
  const result = promoteUnit(projected, cls, bonuses, gameData.skills || []);
  const stats = [];
  for (const stat of GROWTH_STATS) {
    const before = Number(unit.stats?.[stat]) || 0;
    const after = Number(projected.stats?.[stat]) || 0;
    if (after !== before) stats.push({ stat, before, after, bonus: after - before });
  }
  const growths = [];
  for (const [stat, bonus] of Object.entries(cls.growthBonuses || {})) {
    if (!bonus) continue;
    const before = Number(unit.growths?.[stat]);
    growths.push({
      stat,
      bonus,
      before: Number.isFinite(before) ? before : null,
      after: Number.isFinite(before) ? before + bonus : null,
    });
  }
  const skillName = (id) => gameData.skills?.find((s) => s.id === id);
  const skills = (result?.learnedSkills || []).map((id) => ({
    id,
    name: skillName(id)?.name || id,
    description: skillName(id)?.description || '',
  }));
  const dropped = (result?.droppedSkills || []).map((id) => skillName(id)?.name || id);
  let grants;
  try {
    const oldTypes = new Set((unit.proficiencies || []).map((p) => p.type));
    grants = getClassChangeWeaponGrants(projected, oldTypes, gameData, true).map((w) => w.name);
  } catch {
    grants = [];
  }
  const fromSpec = crestSpecForClass(unit.className);
  const toSpec = crestSpecForClass(cls.name);
  return {
    unitName: unit.name,
    fromClass: unit.className,
    toClass: cls.name,
    fromTier: fromSpec?.tier || unit.tier || 'base',
    toTier: toSpec?.tier || 'promoted',
    fromCrest: fromSpec ? unit.className : null,
    toCrest: toSpec ? cls.name : null,
    levelFrom: unit.level,
    levelTo: projected.level,
    stats,
    growths,
    ranks: rankChanges(unit.proficiencies, projected.proficiencies),
    moveType:
      projected.moveType && projected.moveType !== unit.moveType
        ? { from: unit.moveType, to: projected.moveType }
        : null,
    skills,
    dropped,
    grants,
    role: cls.role || cls.roleChange || cls.description || '',
  };
}

/** The class a unit would see innates from (for chooser copy without projecting). */
export function classInnateNames(className, skillsData = []) {
  return getClassInnateSkills(className, skillsData).map(
    (id) => skillsData.find((s) => s.id === id)?.name || id,
  );
}

/** One-line summaries for the path chooser (phone-width chips). */
export function statChipText({ stat, bonus }) {
  return `${stat} ${bonus > 0 ? '+' : ''}${bonus}`;
}

export function rankChipText(rank) {
  if (rank.change === 'new') return `${rank.type} · new`;
  if (rank.change === 'up') return `${rank.type} ${rank.label}`;
  return `${rank.type} ${rank.label}`;
}

/** Sealed beats in the rite: weapon rank ups, new weapon types, new skills. */
export function sealedBeats(content) {
  const beats = [];
  for (const rank of content?.ranks || []) {
    if (rank.change === 'same') continue;
    beats.push({
      kind: rank.change === 'new' ? 'weapon' : 'rank',
      title: rank.change === 'new' ? `${rank.type}` : `${rank.type}`,
      detail: rank.change === 'new' ? `New weapon · ${RANK_NAMES[rank.to]}` : `${RANK_NAMES[rank.from]} → ${RANK_NAMES[rank.to]}`,
      weapon: rank.type,
    }); // prettier-ignore
  }
  for (const skill of content?.skills || [])
    beats.push({ kind: 'skill', title: skill.name, detail: 'New skill', skillId: skill.id });
  return beats;
}

// ── Level-up ────────────────────────────────────────────────────────────

/**
 * Rows and the beat for one level-up result (XP already applied; the
 * display stats reconstruct the intermediate values).
 * kind: 'perfect' (every stat grew), 'blank' (one stat or none — the
 * engine's floor), 'normal'.
 */
export function levelUpContent(unit, result, learnedNames = [], voice = null) {
  const stats = result?.displayStats || unit?.stats || {};
  const rows = XP_STAT_NAMES.map((stat) => {
    const gain = Math.max(0, Number(result?.gains?.[stat]) || 0);
    const after = Number(stats[stat]) || 0;
    return { stat, gain, before: after - gain, after };
  });
  const total = rows.reduce((sum, r) => sum + r.gain, 0);
  const grew = rows.filter((r) => r.gain > 0).length;
  const extended = Boolean(result?.isExtended);
  let kind = 'normal';
  if (grew === rows.length) kind = 'perfect';
  else if (!extended && total <= 1) kind = 'blank';
  const newLevel = extended ? `20+${result.extendedLevel}` : String(result?.newLevel ?? '');
  const oldLevel = extended
    ? result.extendedLevel - 1 > 0
      ? `20+${result.extendedLevel - 1}`
      : '20'
    : String((Number(result?.newLevel) || 1) - 1);
  const content = {
    unitName: unit?.name || '',
    className: unit?.className || '',
    levelFrom: oldLevel,
    levelTo: newLevel,
    rows,
    total,
    kind,
    beat: LEVEL_BEATS[kind],
    skills: [...(learnedNames || [])].filter(Boolean),
    quote: null,
  };
  // The unit's own reaction, and a varied caption for the banner
  // (voice = UnitVoice.voiceContext(); pure — never the RNG or the save).
  if (voice?.voice && unit) {
    content.quote = levelUpLine(unit, content, voice)?.line || null;
    const caption = content.beat ? levelBeatLine(unit, content, voice) : null;
    if (caption) content.beat = { ...content.beat, line: caption };
  }
  return content;
}

/** The unit's line at the promotion rite (null without voice data). */
export function promotionQuote(unit, toClass, voice = null) {
  return voice?.voice && unit ? promotionLine(unit, toClass, voice) : null;
}

export const LEVEL_BEATS = Object.freeze({
  perfect: { word: 'A PERFECT LEVEL', line: 'Every thread pulled taut.' },
  blank: { word: 'A LEAN LEVEL', line: 'The thread barely stirred.' },
  normal: null,
});

// ── Recruits ───────────────────────────────────────────────────────────

/**
 * One line of dialogue for a recruit: a lord's own lines, else the class
 * lines (falling back to the base class). Picked by a stable hash of the
 * name so it never touches the RNG or the narrative log. `line` overrides
 * (the Talk flow already chose one).
 */
export function recruitLine(unit, dialogue, classesData = [], line = null) {
  if (typeof line === 'string' && line.trim()) return line.trim();
  const own = dialogue?.lordRecruitLines?.[unit?.name];
  let pool = Array.isArray(own) && own.length ? own : dialogue?.recruitLines?.[unit?.className];
  if (!Array.isArray(pool) || !pool.length) {
    const base = classesData?.find?.((c) => c.name === unit?.className)?.promotesFrom;
    pool = typeof base === 'string' ? dialogue?.recruitLines?.[base] : null;
  }
  if (!Array.isArray(pool) || !pool.length) return '';
  const lines = pool.filter((l) => typeof l === 'string' && l.trim());
  return lines.length ? lines[stableHash(`${unit?.name}:${unit?.className}`) % lines.length] : '';
}

/** The unit's legendary trait (lord traits rolled on arrival), or null. */
export function legendaryTrait(unit, traits) {
  if (!Array.isArray(unit?.traits) || !Array.isArray(traits)) return null;
  for (const id of unit.traits) {
    const trait = traits.find((t) => t?.id === id);
    if (trait?.rarity === 'legendary')
      return { id: trait.id, name: trait.name, description: trait.description || '' };
  }
  return null;
}

export function recruitCardContent(
  unit,
  { dialogue, classes, traits = null, kind = 'recruit', line = null } = {},
) {
  if (!unit) return null;
  const level = unit.extendedLevels > 0 ? `${unit.level}+${unit.extendedLevels}` : unit.level;
  const kicker = kind === 'lord' ? 'A lord arrives' : kind === 'boss' ? 'Sworn to your cause' : 'Joins your army'; // prettier-ignore
  return {
    kind,
    kicker,
    name: String(unit.name || ''),
    className: unit.className || '',
    crest: crestSpecForClass(unit.className) ? unit.className : null,
    meta: [unit.className, Number.isFinite(Number(unit.level)) ? `Lv ${level}` : null]
      .filter(Boolean)
      .join(' · '),
    line: recruitLine(unit, dialogue, classes, line),
    // A legendary lord trait is the arrival's news: it gets its own seal.
    legendary: legendaryTrait(unit, traits),
  };
}

// ── Timing ─────────────────────────────────────────────────────────────

// Normal-speed milestones (ms). Fast scales by 0.55; Instant and reduced
// motion show the end state at once (no waiting on animation, still
// dismissible — gains are information, not decoration).
export const GROWTH_TIMING = Object.freeze({
  rite: { light: 650, burn: 900, name: 350, stat: 150, seal: 260, settle: 300 },
  level: { enter: 150, pip: 65, beat: 260, seal: 200 },
  join: { enter: 650, hold: 3000, exit: 300 },
  sealed: { enter: 220, hold: 1500, exit: 300 },
});

export function growthTiming(kind, { reducedMotion = false, speed = 'normal' } = {}) {
  const base = GROWTH_TIMING[kind] || GROWTH_TIMING.rite;
  const animate = !reducedMotion && speed !== 'instant';
  const k = speed === 'fast' ? 0.55 : 1;
  const out = { animate, k: animate ? k : 0 };
  for (const [key, ms] of Object.entries(base)) {
    // Holds (reading windows) keep their length under reduced motion; Instant halves them.
    if (key === 'hold') out[key] = Math.round(ms * (speed === 'instant' ? 0.5 : 1));
    else out[key] = animate ? Math.round(ms * k) : 0;
  }
  return out;
}

/** Milestones of the rite for a content (ms from open; all 0 when static). */
export function riteSchedule(content, timing) {
  const t = timing;
  const burnAt = t.light;
  const nameAt = burnAt + t.burn;
  const statsAt = nameAt + t.name;
  const statCount = content?.stats?.length || 0;
  const sealsAt = statsAt + statCount * t.stat + (statCount ? t.settle : 0);
  const sealCount = sealedBeats(content).length;
  const done = sealsAt + sealCount * t.seal + t.settle;
  return { burnAt, nameAt, statsAt, sealsAt, done: t.animate ? done : 0 };
}

/** Milestones of a level-up card. Only gained stats take time (speed matters). */
export function levelSchedule(content, timing) {
  const t = timing;
  const gained = content?.rows?.filter((r) => r.gain > 0).length || 0;
  const pipsAt = t.enter;
  const beatAt = pipsAt + gained * t.pip;
  const sealsAt = beatAt + (content?.beat ? t.beat : 0);
  const done = sealsAt + (content?.skills?.length || 0) * t.seal;
  return { pipsAt, beatAt, sealsAt, done: t.animate ? done : 0 };
}
