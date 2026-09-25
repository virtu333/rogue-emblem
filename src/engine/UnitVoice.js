// UnitVoice.js — Pure helpers: what a unit says when it levels up, promotes,
// or falls. Lines live in dialogue.json `unitVoice` (see
// docs/lore-style-guide.md, "Unit voices").
//
// A recruit speaks through layers: its CLASS (the trade), its TRAITS (the
// profile), a TEMPERAMENT derived per run from its name, and reactions to
// what just happened (a big stat jump, a milestone level, a new skill).
// Lords speak only in their own personal lines.
//
// Selection is a pure function of (run seed, unit, level): it never touches
// the battle RNG, the narrative log or the save. Rewinds, resumes and replays
// therefore show the same line for the same level. Within one category a
// unit walks its pool with a fixed stride, so a line does not repeat for
// that unit until the pool is exhausted. Anything malformed yields null —
// a missing line never blocks a ceremony.

import { XP_STAT_NAMES } from '../utils/constants.js';

/** Temperament ids in their fixed hashing order (never reorder: it would
 *  reshuffle every recruit's personality across saves in progress). */
export const TEMPERAMENT_IDS = Object.freeze([
  'earnest',
  'wry',
  'grim',
  'proud',
  'nervous',
  'devout',
  'mercenary',
  'dreamer',
]);

/** Tokens a unitVoice line may use. Contract tests validate data against this. */
export const VOICE_TOKENS = Object.freeze(['{leader}', '{name}', '{skill}']);

export const VOICE_LINE_BUDGET = 90;

/** Stable 32-bit FNV-1a. */
export function voiceHash(text) {
  let h = 2166136261 >>> 0;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  // Final avalanche so short keys that differ in one character spread out.
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

function lines(pool) {
  return Array.isArray(pool) ? pool.filter((l) => typeof l === 'string' && l.trim()) : [];
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * The index-th line of a pool walked from a per-unit start with a stride
 * coprime to its length: consecutive indexes never repeat within `length`.
 */
export function strideLine(pool, key, index) {
  const list = lines(pool);
  if (!list.length) return null;
  const n = list.length;
  const h = voiceHash(key);
  let step = n > 1 ? 1 + (h % (n - 1 || 1)) : 1;
  while (n > 1 && gcd(step, n) !== 1) step = (step % (n - 1)) + 1;
  const start = voiceHash(`${key}:start`) % n;
  const i = Math.max(0, Math.trunc(Number(index) || 0));
  return list[(start + i * step) % n];
}

/** Resolve the voice's class entry, falling back to the base class. */
function classVoice(voice, className, classes) {
  const own = voice?.classes?.[className];
  if (own) return own;
  const base = Array.isArray(classes)
    ? classes.find((c) => c?.name === className)?.promotesFrom
    : null;
  return typeof base === 'string' ? voice?.classes?.[base] || null : null;
}

/** The unit's per-run temperament id (or null when the data has none). */
export function temperamentFor(unit, { voice = null, seed = 0 } = {}) {
  const available = TEMPERAMENT_IDS.filter((id) => voice?.temperaments?.[id]);
  if (!available.length || !unit?.name) return null;
  return available[voiceHash(`${seed >>> 0}|temperament|${unit.name}`) % available.length];
}

export function temperamentLabel(id, voice) {
  const label = voice?.temperaments?.[id]?.label;
  return typeof label === 'string' && label.trim() ? label : null;
}

function lordVoice(unit, voice) {
  if (!unit?.isLord || typeof unit.name !== 'string') return null;
  return voice?.lords?.[unit.name] || null;
}

/** Substitute tokens; null if a token cannot be resolved (caller filters first). */
export function fillVoiceTokens(line, { name = null, leader = null, skill = null } = {}) {
  if (typeof line !== 'string') return null;
  const values = { '{leader}': leader, '{name}': name, '{skill}': skill };
  let out = line;
  for (const [token, value] of Object.entries(values)) {
    if (!out.includes(token)) continue;
    if (typeof value !== 'string' || !value.trim()) return null;
    out = out.split(token).join(value);
  }
  return out;
}

/**
 * Lines may name another lord ("Voss says it's luck"). Such a line only plays
 * when that lord marches in this army; with no roster known, it never plays.
 */
export function namesAbsentLord(line, { name = null, lordNames = [], present = null } = {}) {
  for (const lord of lordNames) {
    if (lord === name || !new RegExp(`\\b${lord}\\b`).test(line)) continue;
    if (!present || !present.has(lord)) return true;
  }
  return false;
}

function usable(pool, tokens) {
  return lines(pool).filter(
    (l) => fillVoiceTokens(l, tokens) !== null && !namesAbsentLord(l, tokens),
  );
}

function voiceTokens(unit, voice, { leader = null, present = null } = {}, skill = null) {
  return {
    name: unit.name,
    leader,
    skill,
    lordNames: Object.keys(voice?.lords || {}),
    present: present instanceof Set ? present : null,
  };
}

/** Numeric level for strides: 20+N continues past 20. */
function levelIndex(content) {
  const text = String(content?.levelTo ?? '');
  const ext = /^20\+(\d+)$/.exec(text);
  if (ext) return 20 + Number(ext[1]);
  return Number(text) || 0;
}

function milestoneKey(content) {
  const text = String(content?.levelTo ?? '');
  if (text === '10' || text === '20') return text;
  if (text === '20+1') return 'extended';
  return null;
}

/** The stat worth reacting to: the largest gain of 2+, or null. */
export function spotlightStat(content) {
  let best = null;
  for (const row of content?.rows || []) {
    if (!XP_STAT_NAMES.includes(row?.stat)) continue;
    if ((row.gain || 0) >= 2 && (!best || row.gain > best.gain)) best = row;
  }
  return best?.stat || null;
}

/** Weighted pick of a non-empty category. */
function pickCategory(categories, key) {
  const live = categories.filter((c) => c.pool.length && c.weight > 0);
  if (!live.length) return null;
  const total = live.reduce((sum, c) => sum + c.weight, 0);
  let roll = voiceHash(key) % total;
  for (const c of live) {
    if (roll < c.weight) return c;
    roll -= c.weight;
  }
  return live[live.length - 1];
}

/**
 * The line a unit says at a level-up.
 * @param {object} unit - name, className, isLord, traits
 * @param {object} content - levelUpContent(): kind, rows, levelTo, skills
 * @param {{ voice?: object, classes?: object[], seed?: number, leader?: string|null }} ctx
 * @returns {{ line: string, source: string } | null}
 */
export function levelUpLine(unit, content, ctx = {}) {
  try {
    const { voice = null, classes = null, seed = 0 } = ctx;
    if (!voice || !unit?.name || !content) return null;
    const kind = ['perfect', 'blank'].includes(content.kind) ? content.kind : 'normal';
    const level = levelIndex(content);
    const unitKey = `${seed >>> 0}|${unit.name}`;
    const levelKey = `${unitKey}|lv${level}`;
    const skill = Array.isArray(content.skills) ? content.skills.find(Boolean) || null : null;
    const tokens = voiceTokens(unit, voice, ctx, skill);
    const pickFrom = (source, pool) => {
      const list = usable(pool, tokens);
      if (!list.length) return null;
      const line = fillVoiceTokens(strideLine(list, `${unitKey}|${source}`, level), tokens);
      return line ? { line, source } : null;
    };
    const milestone = milestoneKey(content);

    // Lords are characters, not recruits: their own lines or silence.
    const lord = lordVoice(unit, voice);
    if (unit.isLord && !lord) return null;
    if (lord) {
      const lu = lord.levelUp || {};
      if (milestone) {
        const hit = pickFrom(`lord:m${milestone}`, lu.milestones?.[milestone]);
        if (hit) return hit;
      }
      return pickFrom(`lord:${kind}`, lu[kind]) || pickFrom('lord:normal', lu.normal);
    }

    if (milestone) {
      const hit = pickFrom(`milestone:${milestone}`, voice.milestones?.[milestone]);
      if (hit) return hit;
    }
    const cls = classVoice(voice, unit.className, classes);
    const temperament = temperamentFor(unit, { voice, seed });
    const temper = temperament ? voice.temperaments[temperament] : null;
    if (skill && voice.skills && voiceHash(`${levelKey}|skill`) % 2 === 0) {
      const hit = pickFrom('skill', voice.skills);
      if (hit) return hit;
    }
    // One merged pool per unit and kind, walked with a no-repeat stride: a
    // recruit does not repeat itself across a class career. Pool sizes set
    // the mix (class trade, temperament, traits).
    const merged = (layers) => {
      const source = new Map();
      for (const [id, pool] of layers)
        for (const line of usable(pool, tokens)) if (!source.has(line)) source.set(line, id);
      return source;
    };
    const walk = (source, key) => {
      const line = strideLine([...source.keys()], `${unitKey}|${key}`, level);
      const filled = line ? fillVoiceTokens(line, tokens) : null;
      return filled ? { line: filled, source: source.get(line) } : null;
    };
    if (kind !== 'normal') {
      const hit = walk(
        merged([
          [`class:${kind}`, cls?.levelUp?.[kind]],
          [`temper:${kind}`, temper?.levelUp?.[kind]],
        ]),
        kind,
      );
      if (hit) return hit;
    }
    // A big jump in one stat is worth remarking on, often but not always.
    const stat = spotlightStat(content);
    if (stat && voiceHash(`${levelKey}|stat`) % 5 < 2) {
      const hit = pickFrom(`stat:${stat}`, voice.stats?.[stat]);
      if (hit) return hit;
    }
    // Rare: a soldier half-remembers a thread Sera already walked.
    if (level >= 3 && voiceHash(`${levelKey}|dejaVu`) % 24 === 0) {
      const hit = pickFrom('dejaVu', voice.dejaVu);
      if (hit) return hit;
    }
    return walk(
      merged([
        ['class', cls?.levelUp?.normal],
        ['temper', temper?.levelUp?.normal],
        ...(Array.isArray(unit.traits) ? unit.traits : []).map((id) => [
          'trait',
          voice.traits?.[id],
        ]),
      ]),
      'normal',
    );
  } catch {
    return null;
  }
}

/** Italic caption under the perfect / lean banner (narrator voice). */
export function levelBeatLine(unit, content, ctx = {}) {
  try {
    const kind = content?.kind;
    const pool = ctx.voice?.beats?.[kind];
    if (!['perfect', 'blank'].includes(kind) || !lines(pool).length) return null;
    return strideLine(
      pool,
      `${(ctx.seed || 0) >>> 0}|${unit?.name}|beat:${kind}`,
      levelIndex(content),
    );
  } catch {
    return null;
  }
}

/** A line for the promotion rite, spoken on becoming `toClass`. */
export function promotionLine(unit, toClass, ctx = {}) {
  try {
    const { voice = null, seed = 0 } = ctx;
    if (!voice || !unit?.name) return null;
    const tokens = voiceTokens(unit, voice, ctx);
    const pool = usable(lordVoice(unit, voice)?.promotion || voice.classes?.[toClass]?.promotion, tokens); // prettier-ignore
    if (!pool.length) return null;
    return fillVoiceTokens(strideLine(pool, `${seed >>> 0}|${unit.name}|promote:${toClass}`, 0), tokens); // prettier-ignore
  } catch {
    return null;
  }
}

/** Last words of a fallen recruit (lords have their own farewell pools). */
export function fallenLine(unit, ctx = {}) {
  try {
    const { voice = null, classes = null, seed = 0 } = ctx;
    if (!voice || !unit?.name || unit.isLord) return null;
    const tokens = voiceTokens(unit, voice, ctx);
    const temperament = temperamentFor(unit, { voice, seed });
    const chosen = pickCategory(
      [
        { id: 'class', weight: 1, pool: usable(classVoice(voice, unit.className, classes)?.fallen, tokens) }, // prettier-ignore
        {
          id: 'temper',
          weight: 1,
          pool: usable(voice.temperaments?.[temperament]?.fallen, tokens),
        },
      ],
      `${seed >>> 0}|${unit.name}|fallen`,
    );
    if (!chosen) return null;
    return fillVoiceTokens(strideLine(chosen.pool, `${seed >>> 0}|${unit.name}|fallen:${chosen.id}`, 0), tokens); // prettier-ignore
  } catch {
    return null;
  }
}

/**
 * Voice context from a scene's run (presentation callers). `units` adds the
 * battle's living player units to the run roster for presence checks.
 */
export function voiceContext({ gameData = null, runManager = null, units = null } = {}) {
  let leader = null;
  try {
    const pair = runManager?.getStartingLordNames?.();
    if (Array.isArray(pair) && typeof pair[0] === 'string') leader = pair[0];
  } catch {
    leader = null;
  }
  const seed = Number(runManager?.runSeed);
  const present = new Set();
  for (const list of [runManager?.roster, units])
    if (Array.isArray(list))
      for (const u of list) if (typeof u?.name === 'string') present.add(u.name);
  return {
    voice: gameData?.dialogue?.unitVoice || null,
    classes: gameData?.classes || null,
    seed: Number.isFinite(seed) ? seed >>> 0 : 0,
    leader,
    present: present.size ? present : null,
  };
}
