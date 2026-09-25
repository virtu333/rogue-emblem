// ceremonyContent — pure copy, timing and state for the ceremony layer.
//
// Everything a ceremony shows (words, epithets, act titles, the boss bar's
// numbers) is derived here from game data and settings, with no DOM and no
// Phaser, so the rules are unit-testable and the renderers stay thin.
// Presentation only: nothing here reads or writes game state beyond the
// plain values callers pass in.

import regions from '../../data/regions.json';
import framing from './ceremonyPortraitFraming.json';
import { sentenceTitle } from '../engine/DeedTitles.js';

// ── Acts ─────────────────────────────────────────────────────────────────

const ROMAN = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

export function romanNumeral(value) {
  let n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0 || n > 39) return '';
  let out = '';
  for (const [size, glyph] of ROMAN) {
    while (n >= size) {
      out += glyph;
      n -= size;
    }
  }
  return out;
}

/** "Act II", "Final Act", "Beyond the Acts" — title case; renderers uppercase. */
export function actLabel(actId) {
  const match = /^act(\d+)$/.exec(String(actId || ''));
  if (match) return `Act ${romanNumeral(Number(match[1]))}`;
  if (actId === 'finalBoss') return 'Final Act';
  if (actId === 'secretAct') return 'Beyond the Acts';
  return '';
}

/** Region name from data/regions.json (Act I is the Border Marches). */
export function actRegion(actId) {
  return regions[actId] || '';
}

// Grade keys mirror src/art/AtmosphereFX.js ATMOSPHERE_GRADES (parity is
// unit-tested so the names on the act card can never drift from the grade).
export const ACT_GRADE_KEYS = Object.freeze({
  act1: 'act1',
  act2: 'act2',
  act3: 'act3',
  act4: 'act4',
  finalBoss: 'deep',
  secretAct: 'deep',
});
export const GRADE_NAMES = Object.freeze({
  act1: 'Ember Dusk',
  act2: 'Iron Rain',
  act3: 'Bleached Rite',
  act4: 'Ashfall',
  deep: 'The Deep',
});

export function actGradeName(actId) {
  return GRADE_NAMES[ACT_GRADE_KEYS[actId]] || '';
}

/** ACT n (· Eclipse phase) · region (Cinzel) · grade name. */
export function actCardContent(actId, { phase = '' } = {}) {
  const act = actLabel(actId);
  return {
    kicker: act && phase ? `${act} · ${phase}` : act,
    title: actRegion(actId),
    grade: actGradeName(actId),
  };
}

// ── Bosses ───────────────────────────────────────────────────────────────

/** Boss definition by name across every act (bosses are uniquely named). */
export function findBossDefinition(enemiesData, name) {
  if (typeof name !== 'string' || !name) return null;
  for (const list of Object.values(enemiesData?.bosses || {})) {
    if (!Array.isArray(list)) continue;
    const def = list.find((entry) => entry?.name === name);
    if (def) return def;
  }
  return null;
}

export function bossEpithet(enemiesData, name) {
  const epithet = findBossDefinition(enemiesData, name)?.epithet;
  return typeof epithet === 'string' && epithet.trim() ? epithet.trim() : '';
}

/** The Entity has no words: no name card, no name on the bar. */
export function isWordlessBoss(unit, enemiesData = null) {
  if (unit?.isEntity) return true;
  return findBossDefinition(enemiesData, unit?.name)?.isEntity === true;
}

export const WORDLESS_MARK = '· · ·';

export function bossCardContent({ unit, enemiesData, actId }) {
  if (!unit) return null;
  if (isWordlessBoss(unit, enemiesData)) {
    return { kind: 'entity', kicker: '', name: WORDLESS_MARK, epithet: '' };
  }
  const act = actLabel(actId);
  const className = typeof unit.className === 'string' ? unit.className : '';
  return {
    kind: 'boss',
    kicker: [act, className].filter(Boolean).join(' · '),
    name: String(unit.name || ''),
    epithet: bossEpithet(enemiesData, unit.name),
  };
}

/** Boss-bar status: enraged, or the turn it is about to enrage. */
export function bossPressureStatus({ turn, threshold, enraged }) {
  const t = Number.isFinite(threshold) ? Math.trunc(threshold) : null;
  if (enraged) return t ? `Enraged · Turn ${t}` : 'Enraged';
  if (!t || !Number.isFinite(turn)) return '';
  if (turn >= t) return 'Enrages this enemy phase';
  if (turn + 1 === t) return `Enrages on turn ${t}`;
  return '';
}

// ── Battle outcomes ──────────────────────────────────────────────────────

export const OBJECTIVE_WORDS = Object.freeze({
  rout: 'ROUTED',
  seize: 'SEIZED',
  escape: 'ESCAPED',
  defend: 'DEFENDED',
});

export function objectiveWord(objective) {
  return OBJECTIVE_WORDS[objective] || 'VICTORY';
}

export function victoryContent({
  objective,
  turn,
  par,
  rating,
  shadowGain = null,
  shadowRelief = 0,
}) {
  const parts = [];
  if (Number.isFinite(turn) && turn > 0) parts.push(`Turn ${Math.trunc(turn)}`);
  if (Number.isFinite(par)) parts.push(`Par ${Math.trunc(par)}`);
  if (typeof rating === 'string' && rating) parts.push(`Rank ${rating}`);
  // The Eclipse: what this victory does to the sun.
  if (Number.isFinite(shadowGain))
    parts.push(shadowGain > 0 ? `Shadow +${Math.trunc(shadowGain)}` : 'Sun held');
  if (Number.isFinite(shadowGain) && shadowRelief > 0)
    parts.push(`Sun flares −${Math.trunc(shadowRelief)}`);
  return { word: objectiveWord(objective), sub: parts.join(' · ') };
}

export function defeatContent({ commanderName } = {}) {
  return {
    word: 'DEFEAT',
    sub: commanderName ? `${commanderName} has fallen` : 'The line is broken',
  };
}

export function felledContent({ objective, remaining = 0 }) {
  let sub = '';
  if (objective === 'seize') sub = 'Seize the throne with a Lord';
  else if (objective === 'escape') sub = 'Make for the exit';
  else if (objective === 'rout' && remaining > 0)
    sub = `${remaining} ${remaining === 1 ? 'foe remains' : 'foes remain'}`;
  return { word: 'FOE VANQUISHED', sub };
}

/** Whether a boss death should get its own band (not when victory follows). */
export function shouldShowFelled({ objective, remaining = 0, reviving = 0 }) {
  if (objective === 'seize') return true;
  if (objective === 'rout') return remaining > 0 || reviving > 0;
  return true;
}

export function fallenContent({ name, className, epithet = null }) {
  // A titled commander is named in full: "Edric, Who Held the Bridge, has fallen".
  if (name && typeof epithet?.text === 'string' && epithet.text.trim())
    return { word: 'FALLEN', sub: `${sentenceTitle(name, epithet)} has fallen` };
  return { word: 'FALLEN', sub: [name, className].filter(Boolean).join(' · ') };
}

/** Sera's offer beneath the FALLEN band (generic copy without her). */
export function fateOfferContent({ seraPresent, remaining }) {
  const left = Math.max(0, Math.trunc(Number(remaining) || 0));
  return {
    speaker: seraPresent ? 'Sera' : '',
    line: seraPresent
      ? left === 1
        ? 'Not this thread. I can pull it back — once more.'
        : 'Not this thread. I can still pull it back.'
      : 'A vision fractures. Another path is still within reach.',
    rewindLabel: `Rewind · ${left} left`,
    acceptLabel: 'Accept fate',
  };
}

export function phaseContent({ phase, turn, place = '' }) {
  return {
    tone: phase === 'player' ? 'player' : 'enemy',
    kicker: Number.isFinite(turn) ? `Turn ${Math.trunc(turn)}` : '',
    word: phase === 'player' ? 'PLAYER PHASE' : 'ENEMY PHASE',
    sub: place || '',
  };
}

export function cutInContent({ label, unitName, weaponName, isArt = false, epithet = '' }) {
  const word = isArt ? String(label || '').toUpperCase() : 'CRITICAL';
  const content = {
    word,
    small: [unitName, weaponName].filter(Boolean).join(' · ').toUpperCase(),
  };
  // A titled unit's epithet rides under the word (Deeds & Epithets).
  if (typeof epithet === 'string' && epithet.trim()) content.epithet = epithet.trim();
  return content;
}

// ── Battle notices ───────────────────────────────────────────────────────

/**
 * Tone for a battle notice from the colour its caller passed (the canvas
 * banner API took a palette colour): gains read verdigris, losses crimson,
 * misses ash, everything else the gold thread.
 */
export function noticeTone(color, palette = {}) {
  const c = String(color || '').toLowerCase();
  const is = (key) => palette[key] && c === String(palette[key]).toLowerCase();
  if (is('good') || is('hpHigh')) return 'good';
  if (is('bad') || is('alarm') || is('dangerLine') || is('hpLow')) return 'bad';
  if (is('muted') || is('mutedDim')) return 'muted';
  if (is('info')) return 'info';
  if (is('warn')) return 'warn';
  return 'gold';
}

/** Reinforcement band copy (enemies; bandits race the village). */
export function arrivalContent({ count = 0, bandits = 0 } = {}) {
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  const b = Math.max(0, Math.trunc(Number(bandits) || 0));
  if (!n && !b) return null;
  const parts = [];
  if (n) parts.push(n === 1 ? 'An enemy arrives' : `${n} enemies arrive`);
  if (b)
    parts.push(b === 1 ? 'a bandit makes for the village' : `${b} bandits make for the village`);
  const sub = parts.join(' · ');
  return { word: 'REINFORCEMENTS', sub: sub.charAt(0).toUpperCase() + sub.slice(1) };
}

// ── Run end ──────────────────────────────────────────────────────────────

function foePhrase(foe, wasBoss) {
  if (typeof foe !== 'string' || !foe.trim()) return '';
  const name = foe.trim();
  if (/^the\s/i.test(name)) return name.replace(/^the/i, 'the');
  if (wasBoss) return `the ${name}`;
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
}

/**
 * THE THREAD IS CUT (defeat) or its gold counterpart. `defeatContext` null on
 * a defeat means the run was abandoned, not slain.
 */
export function runEndContent({
  result,
  commander,
  actId,
  turn = null,
  defeatContext = null,
  battlesWon = null,
  eclipse = '',
}) {
  const where = [actRegion(actId), actLabel(actId)].filter(Boolean);
  if (result === 'victory') {
    const meta = [...where];
    if (Number.isFinite(battlesWon) && battlesWon > 0)
      meta.push(`${battlesWon} ${battlesWon === 1 ? 'battle' : 'battles'} won`);
    if (eclipse) meta.push(eclipse);
    return {
      tone: 'holds',
      word: 'THE THREAD HOLDS',
      sub: commander ? `${commander} walked it to the end` : 'The march is complete',
      meta: meta.join(' · '),
    };
  }
  const meta = [...where];
  if (Number.isFinite(turn) && turn > 0) meta.push(`Turn ${Math.trunc(turn)}`);
  if (eclipse) meta.push(eclipse);
  let sub;
  if (!defeatContext) sub = 'The march was abandoned';
  else {
    const foe = foePhrase(defeatContext.defeatedBy, defeatContext.wasBoss === true);
    const who = commander || 'The commander';
    sub = foe ? `${who} fell to ${foe}` : `${who} fell`;
  }
  return { tone: 'cut', word: 'THE THREAD IS CUT', sub, meta: meta.join(' · ') };
}

// ── Portrait framing (cut-in eyes strip) ─────────────────────────────────

const DEFAULT_FRAMING = Object.freeze({ eye: 0.36, cx: 0.52 });

/** Eye line / face centre (fractions of the square portrait) for a rebuilt id. */
export function portraitFraming(portraitId) {
  const entry = framing[portraitId];
  return {
    eye: Number.isFinite(entry?.eye) ? entry.eye : DEFAULT_FRAMING.eye,
    cx: Number.isFinite(entry?.cx) ? entry.cx : DEFAULT_FRAMING.cx,
  };
}

// ── Timing ───────────────────────────────────────────────────────────────

// Reading windows per ceremony. Combat punctuation (cut-ins) keeps the
// combat timing contract in ProcBannerController; everything here is story
// staging and is skippable.
export const CEREMONY_TIMING = Object.freeze({
  bossIntro: { enterMs: 700, holdMs: 3600, exitMs: 350 },
  bossFelled: { enterMs: 400, holdMs: 1800, exitMs: 400 },
  victory: { enterMs: 450, holdMs: 1500, exitMs: 300 },
  defeat: { enterMs: 450, holdMs: 2000, exitMs: 300 },
  phase: { enterMs: 300, holdMs: 800, placeHoldMs: 1800, exitMs: 300 },
  notice: { enterMs: 180, holdMs: 1100, exitMs: 240 },
  arrival: { enterMs: 260, holdMs: 1500, exitMs: 300 },
  act: { enterMs: 1100, holdMs: 2600, exitMs: 450 },
  runEnd: { enterMs: 1200, holdMs: 2800, exitMs: 450 },
  fallen: { enterMs: 600, holdMs: 0, exitMs: 0 },
});

/**
 * One policy for every story ceremony:
 *  - reduced motion: the end state appears at once (no slides, drains or
 *    splits) and keeps the full reading window;
 *  - Instant battle speed: the end state appears at once and the reading
 *    window halves (always skippable).
 */
export function ceremonyTiming(kind, { reducedMotion = false, speed = 'normal' } = {}) {
  const base = CEREMONY_TIMING[kind] || CEREMONY_TIMING.victory;
  const instant = speed === 'instant';
  const animate = !reducedMotion && !instant;
  const scale = instant ? 0.5 : 1;
  return {
    animate,
    enterMs: animate ? base.enterMs : 0,
    holdMs: Math.round(base.holdMs * scale),
    placeHoldMs: Math.round((base.placeHoldMs ?? base.holdMs) * scale),
    exitMs: animate ? base.exitMs : 0,
  };
}

// ── Boss bar state machine ───────────────────────────────────────────────
//
// hp:       the value the crimson fill shows.
// lostFrom: where the gold "just lost" chunk starts (>= hp). A 'drain'
//           collapses it onto hp; silent syncs (resume, rewind) never leave
//           a chunk behind.

export function createBossBarState() {
  return {
    visible: false,
    felled: false,
    key: null,
    name: '',
    wordless: false,
    hp: 0,
    max: 1,
    lostFrom: 0,
    enraged: false,
    status: '',
  };
}

function clampHp(value, max) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, n));
}

/**
 * @param {object} state
 * @param {{type:'sync', boss?: {key, name, hp, max, wordless}|null, enraged?, status?,
 *          silent?, concealed?} | {type:'drain'} | {type:'defeated'} | {type:'hide'}} event
 */
export function reduceBossBar(state, event) {
  switch (event?.type) {
    case 'sync': {
      const boss = event.boss;
      if (!boss) {
        if (!state.visible || state.felled) return state;
        return { ...state, visible: false };
      }
      const max = Math.max(1, Math.trunc(Number(boss.max) || 0));
      const same = state.visible && !state.felled && state.key === boss.key;
      let hp = clampHp(boss.hp, max);
      let lostFrom = hp;
      if (same && event.concealed) {
        // Fog hides the boss: hold the last seen reading.
        hp = state.hp;
        lostFrom = state.lostFrom;
      } else if (same && !event.silent && hp < state.hp) {
        lostFrom = Math.max(state.lostFrom, state.hp);
      }
      const next = {
        visible: true,
        felled: false,
        key: boss.key,
        name: String(boss.name || ''),
        wordless: boss.wordless === true,
        hp,
        max,
        lostFrom,
        enraged: event.enraged === true,
        status: typeof event.status === 'string' ? event.status : '',
      };
      for (const key of Object.keys(next)) if (next[key] !== state[key]) return next;
      return state;
    }
    case 'drain':
      if (state.lostFrom === state.hp) return state;
      return { ...state, lostFrom: state.hp };
    case 'defeated':
      if (!state.visible || state.felled) return state;
      return {
        ...state,
        felled: true,
        lostFrom: Math.max(state.lostFrom, state.hp),
        hp: 0,
        enraged: false,
        status: '',
      };
    case 'hide':
      if (!state.visible) return state;
      return { ...state, visible: false };
    default:
      return state;
  }
}

/** Numbers and tone the renderer needs, derived from the state. */
export function bossBarView(state) {
  const max = Math.max(1, state.max);
  const pct = (value) => Math.max(0, Math.min(100, (value / max) * 100));
  return {
    visible: state.visible,
    name: state.wordless ? WORDLESS_MARK : state.name,
    hpText: state.wordless ? '' : `${state.hp} / ${max}`,
    fillPct: pct(state.hp),
    lostPct: pct(Math.max(state.lostFrom, state.hp)),
    tone: state.wordless ? 'unlight' : state.enraged ? 'ember' : 'crimson',
    status: state.status,
    felled: state.felled,
  };
}
