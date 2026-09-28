// NarrativeDirector.js — Pure helpers: pick run-aware dialogue variants.
//
// dialogue.json values may be a plain entry array (base form) or an object
// { base: [...entries], variants: [{ when: {...}, entries: [...] }] }.
// The first variant whose `when` conditions all pass wins (top-down order);
// otherwise base. Conditions are evaluated against a context snapshot built
// from meta story flags + run state. Anything malformed — unknown condition
// keys, bad shapes, missing meta — fails toward base/skip, never throws:
// story delivery must never block a scene transition.
//
// A variant may carry a `pool` of single-line entries instead of `entries`:
// one line plays, picked by the save's run count (pickPoolEntry) so a pool is
// walked without repeats. A pool entry may have its own `when`; it plays only
// when that holds, and such contextual lines take every other run while any
// apply. The variant is skipped when no entry in its pool applies.
//
// Line text may use the {lastFoe} token, which resolves to the boss that
// ended the previous run. It is substituted here, before adaptDialogueEntries
// (DialogueCast), which only handles {commander} and passes other text through.

import { unitDisplayName, unitEpithet } from './DeedTitles.js';

const LAST_FOE_TOKEN = '{lastFoe}';
const LAST_FOE_FALLBACK = 'the enemy';
// {epithet}: the commander named with the title the march gave them ("Edric,
// Who Held the Bridge"); plain {commander} name when they have none. Gate
// such lines on `commanderHasEpithet` so they only play once there is one.
const EPITHET_TOKEN = '{epithet}';

/** Condition keys understood by evaluateWhen. Contract tests validate
 *  dialogue.json against this set so a typo in data fails CI, not gameplay. */
export const KNOWN_WHEN_KEYS = new Set([
  'commander',
  'difficulty',
  'minRunsCompleted',
  'lastRunResult',
  'lastRunDefeatedByKnown',
  'lastRunAct',
  'currentDefeatWasBoss',
  'bossSlainBefore',
  'bossKilledYouBefore',
  'firstClear',
  'commanderHasEpithet',
  'partner',
]);

/**
 * Snapshot the narrative state needed for variant selection. Every source is
 * optional: tutorial/standalone battles have no meta, headless tests may pass
 * nothing at all — defaults select base entries.
 * @param {{ meta?: object|null, runManager?: object|null, bossName?: string|null }} sources
 */
export function buildNarrativeContext({ meta = null, runManager = null, bossName = null } = {}) {
  let commander = null;
  let partner = null;
  try {
    const pair = runManager?.getStartingLordNames?.();
    if (Array.isArray(pair)) {
      if (typeof pair[0] === 'string') commander = pair[0];
      if (typeof pair[1] === 'string') partner = pair[1];
    }
  } catch (_) {
    /* keep null commander */
  }
  let commanderTitled = null;
  try {
    const roster = Array.isArray(runManager?.roster) ? runManager.roster : [];
    const lead = roster.find((u) => u?.isCommander) || roster.find((u) => u?.name === commander);
    if (lead && unitEpithet(lead)) commanderTitled = unitDisplayName(lead, { epithet: true });
  } catch (_) {
    /* no title */
  }
  const flags = typeof meta?.getStoryFlags === 'function' ? meta.getStoryFlags() : null;
  const lastRun = flags?.lastRun && typeof flags.lastRun === 'object' ? flags.lastRun : null;
  let runsStarted = 0;
  try {
    const started = meta?.getRunsStarted?.() ?? meta?.runsStarted;
    if (typeof started === 'number' && Number.isFinite(started)) runsStarted = started;
  } catch (_) {
    /* first run */
  }
  const resolvedBossName = typeof bossName === 'string' && bossName.trim() ? bossName.trim() : null;
  return {
    commander,
    commanderTitled,
    partner,
    difficulty: runManager?.difficultyId || 'normal',
    runsStarted,
    runsCompleted:
      typeof meta?.runsCompleted === 'number' && Number.isFinite(meta.runsCompleted)
        ? meta.runsCompleted
        : 0,
    lastRunResult:
      lastRun?.result === 'victory' || lastRun?.result === 'defeat' ? lastRun.result : 'none',
    lastRunAct: typeof lastRun?.act === 'string' ? lastRun.act : null,
    currentDefeatWasBoss: runManager?.defeatContext?.wasBoss === true,
    lastRunDefeatedBy: typeof lastRun?.defeatedBy === 'string' ? lastRun.defeatedBy : null,
    bossName: resolvedBossName,
    bossSlainCount: resolvedBossName ? (meta?.getBossSlainCount?.(resolvedBossName) ?? 0) : 0,
    bossKilledYouCount: resolvedBossName ? (meta?.getDefeatedByCount?.(resolvedBossName) ?? 0) : 0,
    firstClear: runManager?.endRunRewards?.firstClear === true,
    linesPlayed: Array.isArray(flags?.linesPlayed) ? [...flags.linesPlayed] : [],
  };
}

/**
 * Evaluate one variant's `when` object against the context. All conditions
 * AND together. Unknown keys or any evaluation error fail the variant
 * (forward compatible: data written for a newer vocabulary degrades to base).
 */
export function evaluateWhen(when, ctx) {
  if (!when || typeof when !== 'object' || Array.isArray(when)) return false;
  if (!ctx || typeof ctx !== 'object') return false;
  try {
    for (const [key, value] of Object.entries(when)) {
      switch (key) {
        case 'commander':
          if (ctx.commander !== value) return false;
          break;
        case 'difficulty':
          if (ctx.difficulty !== value) return false;
          break;
        case 'minRunsCompleted':
          if (typeof value !== 'number' || !(ctx.runsCompleted >= value)) return false;
          break;
        case 'lastRunResult':
          if (ctx.lastRunResult !== value) return false;
          break;
        case 'lastRunDefeatedByKnown':
          if (Boolean(ctx.lastRunDefeatedBy) !== value) return false;
          break;
        case 'lastRunAct':
          if (ctx.lastRunAct !== value) return false;
          break;
        case 'currentDefeatWasBoss':
          if (ctx.currentDefeatWasBoss !== value) return false;
          break;
        case 'bossSlainBefore':
          if (ctx.bossSlainCount > 0 !== value) return false;
          break;
        case 'bossKilledYouBefore':
          if (ctx.bossKilledYouCount > 0 !== value) return false;
          break;
        case 'firstClear':
          if (ctx.firstClear !== value) return false;
          break;
        case 'commanderHasEpithet':
          if (Boolean(ctx.commanderTitled) !== value) return false;
          break;
        case 'partner':
          if (ctx.partner !== value) return false;
          break;
        default:
          return false; // unknown condition key: variant never matches
      }
    }
    return true;
  } catch (_) {
    return false;
  }
}

/** Substitute {lastFoe} and {epithet} in entry lines. Returns a new array;
 *  untouched entries pass through by reference (mirrors adaptDialogueEntries). */
function applyNarrativeTokens(entries, ctx) {
  const foe = ctx?.lastRunDefeatedBy || LAST_FOE_FALLBACK;
  // No title: fall back to the {commander} token (DialogueCast resolves it).
  const titled = ctx?.commanderTitled || ctx?.commander || '{commander}';
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.line !== 'string') return entry;
    if (!entry.line.includes(LAST_FOE_TOKEN) && !entry.line.includes(EPITHET_TOKEN)) return entry;
    const line = entry.line.split(LAST_FOE_TOKEN).join(foe).split(EPITHET_TOKEN).join(titled);
    return { ...entry, line };
  });
}

/** A stable 32-bit hash (FNV-1a) for ordering pool lines. */
function lineHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** The key a pool line is remembered by once played (MetaProgressionManager.linesPlayed). */
export function narrativeLineKey(line) {
  return `l${lineHash(String(line)).toString(36)}`;
}

/**
 * The line of `lines` played longest ago on this save (never played first), ties
 * broken by a fixed shuffled order. So a set walks every line before any repeats,
 * however the set changes from run to run (a partner, a loss, the difficulty).
 */
function leastRecent(lines, played) {
  const order = [...lines].sort(
    (a, b) => lineHash(String(a.line)) - lineHash(String(b.line)) || (a.line < b.line ? -1 : 1),
  );
  let best = null;
  let bestAt = Infinity;
  for (const entry of order) {
    const at = played.lastIndexOf(narrativeLineKey(entry.line));
    if (at < bestAt) {
      best = entry;
      bestAt = at;
    }
  }
  return best;
}

/**
 * Pick one line from a variant's pool for this run. Pure: the pick depends only on
 * the pool, ctx.runsStarted and the lines this save has played (ctx.linesPlayed),
 * never on RNG. Lines with a `when` that holds (a loss, Lunatic, a partner) take
 * the even runs while any apply, the general lines the odd ones; within the set,
 * the line played longest ago plays. The caller records what it shows
 * (entry.lineKey → MetaProgressionManager.recordLinesPlayed).
 * @returns {object|null} the entry, without its `when`; null when none applies
 */
export function pickPoolEntry(pool, ctx) {
  if (!Array.isArray(pool)) return null;
  const valid = pool.filter((e) => e && typeof e === 'object' && typeof e.line === 'string');
  const contextual = valid.filter((e) => e.when && evaluateWhen(e.when, ctx));
  const general = valid.filter((e) => !e.when);
  const run = Number.isFinite(ctx?.runsStarted) ? Math.max(0, Math.floor(ctx.runsStarted)) : 0;
  const played = Array.isArray(ctx?.linesPlayed) ? ctx.linesPlayed : [];
  let picked = null;
  if (contextual.length && (run % 2 === 0 || !general.length))
    picked = leastRecent(contextual, played);
  else if (general.length) picked = leastRecent(general, played);
  if (!picked) return null;
  const { when: _when, ...entry } = picked;
  return { ...entry, lineKey: narrativeLineKey(picked.line) };
}

/**
 * Resolve a dialogue.json section value to a concrete entry array.
 * @param {Array|{base?: Array, variants?: Array<{when: object, entries: Array}>}} sectionValue
 * @param {object} ctx - from buildNarrativeContext
 * @returns {Array|null} entries to show, or null to skip (same as missing key)
 */
export function selectDialogueEntries(sectionValue, ctx) {
  try {
    if (Array.isArray(sectionValue)) return applyNarrativeTokens(sectionValue, ctx);
    if (!sectionValue || typeof sectionValue !== 'object') return null;
    const variants = Array.isArray(sectionValue.variants) ? sectionValue.variants : [];
    for (const variant of variants) {
      if (!variant || typeof variant !== 'object') continue;
      if (Array.isArray(variant.pool)) {
        if (!evaluateWhen(variant.when, ctx)) continue;
        const entry = pickPoolEntry(variant.pool, ctx);
        if (entry) return applyNarrativeTokens([entry], ctx);
        continue;
      }
      if (!Array.isArray(variant.entries) || variant.entries.length === 0) continue;
      if (evaluateWhen(variant.when, ctx)) return applyNarrativeTokens(variant.entries, ctx);
    }
    if (Array.isArray(sectionValue.base)) return applyNarrativeTokens(sectionValue.base, ctx);
    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Which ending a won run earned, by where its road ended (the run's own act list),
 * never by difficulty id: a Hard run saved before the ladder still ends at the
 * Emperor, while Nightfall now goes on to the Entity.
 * @returns {'victory_lieutenant'|'victory_emperor'|'victory_entity'}
 */
export function victoryEndingKey(runManager, gameData) {
  const acts = Array.isArray(runManager?.actSequence) ? runManager.actSequence : [];
  const last = acts.at(-1);
  if (last === 'act4') return 'victory_emperor';
  if (last === 'finalBoss') {
    const id = runManager?.difficultyId || 'normal';
    const bosses = gameData?.enemies?.bosses?.finalBoss || [];
    const faced = bosses.find(
      (b) => !Array.isArray(b?.difficultyFilter) || b.difficultyFilter.includes(id),
    );
    if (faced?.isEntity) return 'victory_entity';
  }
  return 'victory_lieutenant';
}
