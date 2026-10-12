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
// apply. The variant is skipped when no entry in its pool applies. A pool entry
// may be an `exchange` (a short list of entries: a boss's line and the
// commander's answer) instead of one `line`; it is picked, remembered and played
// as one, so an answer always follows the line it answers.
//
// Line text may use the {lastFoe} token, which resolves to the boss that
// ended the previous run. It is substituted here, before adaptDialogueEntries
// (DialogueCast), which only handles {commander} and passes other text through.

import { unitDisplayName, unitEpithet } from './DeedTitles.js';
import { riteBand, riteConfigOf, sanitizeRite } from './Rite.js';
import { descentRouteIdFor, isDescentMap, isGateBossNode } from './Descent.js';
import { isPrologueRun } from './ScriptedBattle.js';
import { everFallenUnits } from './LaidToRest.js';
import { lineHash, narrativeLineKey } from '../utils/lineKey.js';

export { narrativeLineKey };

const LAST_FOE_TOKEN = '{lastFoe}';
const LAST_FOE_FALLBACK = 'the enemy';
// {epithet}: the commander named with the title the march gave them ("Edric,
// Who Held the Bridge"); plain {commander} name when they have none. Gate
// such lines on `commanderHasEpithet` so they only play once there is one.
const EPITHET_TOKEN = '{epithet}';
// {fallen}: the latest unit lost this run (gate on fallenThisRun). {lastFallenLord}: a lord
// lost on the last finished run (gate on lastRunLordFell).
const FALLEN_TOKEN = '{fallen}';
const LAST_FALLEN_LORD_TOKEN = '{lastFallenLord}';
const FALLEN_FALLBACK = 'them';

/** Condition keys understood by evaluateWhen. Contract tests validate
 *  dialogue.json against this set so a typo in data fails CI, not gameplay. */
export const KNOWN_WHEN_KEYS = new Set([
  'commander',
  'difficulty',
  'minRunsCompleted',
  'maxRunsStarted',
  'lastRunResult',
  'lastRunDefeatedByKnown',
  'lastRunAct',
  'currentDefeatWasBoss',
  'bossSlainBefore',
  'bossKilledYouBefore',
  // This save has fought the boss to an end before: slain it or fallen to it.
  'bossMetBefore',
  'firstClear',
  'commanderHasEpithet',
  'partner',
  // The prologue on this save: 'none' | 'complete' | 'skipped' (a prologue still in
  // progress reads as 'none'; a real run cannot start while it runs). A value may be
  // one state or a list of states (any of them).
  'prologue',
  // Act V (act-v-descent §9.7): the boss's role on the Descent's route ('gate' | 'finale' |
  // 'none', from battleParams.bossRole) and the Rite's tier ('broken' | 'spoken' | 'answered' |
  // 'none': the battle's tier at entry, else the run's; engine/Rite.js). One value or a list.
  'bossRole',
  'riteBand',
  // The road goes through Act IV, so the Emperor is dead when the army meets what is past him
  // (Dusk, Nightfall, Black Sun; never First Light).
  'roadThroughEmperor',
  // Where the road ends: 'lieutenant' | 'entity' | 'emperor' (a run saved before the ladder).
  // One value or a list of them.
  'finale',
  // The run's road goes down the Descent (Act V's authored route, engine/Descent.js): its final
  // act is the Descent's map, or, before the run reaches it, will be built as one (the config is
  // on and names a route for the rung). False on today's two-node final act (the Descent off,
  // or a save already in Act V before it), and on a road with no final act.
  'descent',
  // The Lieutenant's gate on this run's Descent has been won (Nightfall, Black Sun): the glass
  // broke and the door below is open.
  'glassBroken',
  // Run history (docs: dialogue gotchas in CLAUDE.md). Defeats in a row on this save; on
  // the run-end screen the run just lost counts. A number: at least that many.
  'minLossStreak',
  // A unit has fallen (or been laid to rest) on this run; {fallen} names the latest.
  'fallenThisRun',
  // A lord fell on the save's last finished run; {lastFallenLord} names one. Meant for
  // run start: on the run-end screen the last run is the one just ended.
  'lastRunLordFell',
  // This run's difficulty differs from the last finished run's (none: false). Run start.
  'rungChanged',
  // The furthest act this save has ever cleared (beatAct1..3 milestones): at least N.
  'minBestActCleared',
  // The boss of this scene has been slain at least N times on this save.
  'minBossSlain',
]);

/** True when `value` (one value or a list) admits `actual`. */
function matchesOneOf(value, actual) {
  return Array.isArray(value) ? value.includes(actual) : value === actual;
}

/**
 * Snapshot the narrative state needed for variant selection. Every source is
 * optional: tutorial/standalone battles have no meta, headless tests may pass
 * nothing at all — defaults select base entries.
 * @param {{ meta?: object|null, runManager?: object|null, bossName?: string|null,
 *   battleParams?: object|null, gameData?: object|null }} sources `battleParams`: the battle
 *   being fought (its bossRole and the Rite's tier at its entry); `gameData` (else the run's
 *   own) names the finale's boss.
 */
export function buildNarrativeContext({
  meta = null,
  runManager = null,
  bossName = null,
  battleParams = null,
  gameData = null,
} = {}) {
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
  let fallenName = null;
  try {
    const fallen = everFallenUnits(runManager).filter((u) => typeof u?.name === 'string' && u.name);
    if (fallen.length) fallenName = fallen[fallen.length - 1].name;
  } catch (_) {
    /* nobody lost */
  }
  const difficulty = runManager?.difficultyId || 'normal';
  const lastRunLordsFell = Array.isArray(lastRun?.lordsFell)
    ? lastRun.lordsFell.filter((name) => typeof name === 'string' && name)
    : [];
  return {
    commander,
    commanderTitled,
    partner,
    difficulty,
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
    prologue: prologueStateOf(meta),
    bossRole: ['gate', 'finale'].includes(battleParams?.bossRole) ? battleParams.bossRole : 'none',
    riteBand: riteBandOf(runManager, battleParams),
    roadThroughEmperor: roadIncludesAct4(runManager),
    finale: finaleOf(runManager, gameData ?? runManager?.gameData),
    descent: descentRoadOf(runManager, gameData ?? runManager?.gameData),
    glassBroken: glassBrokenOf(runManager),
    lossStreak: Math.max(0, Math.floor(Number(flags?.lossStreak) || 0)),
    fallenName,
    lastRunLordsFell,
    rungChanged:
      Boolean(lastRun) &&
      typeof lastRun.difficultyId === 'string' &&
      lastRun.difficultyId !== difficulty,
    bestActCleared: bestActClearedOf(meta),
  };
}

/** The furthest act this save has cleared, from its milestones (0 when none or no meta). */
function bestActClearedOf(meta) {
  try {
    const has = (id) => meta?.hasMilestone?.(id) === true;
    if (has('beatAct3') || has('beatGame')) return 3;
    if (has('beatAct2')) return 2;
    if (has('beatAct1')) return 1;
  } catch (_) {
    /* no milestones */
  }
  return 0;
}

/** True when the run's current act map is the Descent's authored route. */
function onDescent(runManager) {
  try {
    return isDescentMap(runManager?.nodeMap);
  } catch {
    return false;
  }
}

/**
 * True when the run's road goes down the Descent: it stands on the Descent's map, or it has not
 * reached its final act yet and RunManager._buildActNodeMap will build that act as the Descent
 * (a standard run whose acts include `finalBoss`, the config on with a route for the rung). A
 * run already in its final act on today's two-node map is not on it, whatever the config says.
 */
export function descentRoadOf(runManager, gameData) {
  try {
    if (onDescent(runManager)) return true;
    if (!runManager || isPrologueRun(runManager)) return false;
    const acts = runManager.actSequence;
    if (!Array.isArray(acts) || !acts.includes('finalBoss')) return false;
    if (runManager.currentAct === 'finalBoss') return false;
    return descentRouteIdFor(gameData?.descent, runManager.difficultyId) !== null;
  } catch {
    return false;
  }
}

/**
 * True when this run's Descent holds a won gate: the Lieutenant fought at the door (Nightfall,
 * Black Sun) has fallen, so the glass is broken. Never on a route without a gate, and never
 * before the gate's victory is committed (its node is completed in `completeBattle`).
 */
export function glassBrokenOf(runManager) {
  try {
    if (!onDescent(runManager)) return false;
    const nodes = Array.isArray(runManager.nodeMap.nodes) ? runManager.nodeMap.nodes : [];
    return nodes.some((node) => node?.completed === true && isGateBossNode(runManager, node));
  } catch {
    return false;
  }
}

/** The Rite's tier as a `when` value: the battle's at entry, else the run's, else 'none'. */
function riteBandOf(runManager, battleParams) {
  try {
    if (typeof battleParams?.riteBand === 'string' && battleParams.riteBand)
      return battleParams.riteBand;
    const rite = sanitizeRite(runManager?.rite);
    return rite ? riteBand(rite.words, riteConfigOf(runManager)) || 'none' : 'none';
  } catch {
    return 'none';
  }
}

/** The save's prologue as a `when` value: 'complete' | 'skipped' | 'none'. */
function prologueStateOf(meta) {
  try {
    const state = meta?.getPrologueState?.() ?? meta?.prologue?.state;
    return state === 'complete' || state === 'skipped' ? state : 'none';
  } catch (_) {
    return 'none';
  }
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
        case 'maxRunsStarted':
          // The run being played counts (runs are counted as they start): 1 = the first.
          if (typeof value !== 'number' || !(ctx.runsStarted <= value)) return false;
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
        case 'bossMetBefore':
          if (ctx.bossSlainCount + ctx.bossKilledYouCount > 0 !== value) return false;
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
        case 'prologue':
          if (!matchesOneOf(value, ctx.prologue ?? 'none')) return false;
          break;
        case 'bossRole':
          if (!matchesOneOf(value, ctx.bossRole ?? 'none')) return false;
          break;
        case 'riteBand':
          if (!matchesOneOf(value, ctx.riteBand ?? 'none')) return false;
          break;
        case 'roadThroughEmperor':
          if ((ctx.roadThroughEmperor === true) !== value) return false;
          break;
        case 'finale':
          if (!matchesOneOf(value, ctx.finale ?? null)) return false;
          break;
        case 'descent':
          if ((ctx.descent === true) !== value) return false;
          break;
        case 'glassBroken':
          if ((ctx.glassBroken === true) !== value) return false;
          break;
        case 'minLossStreak':
          if (typeof value !== 'number' || !((ctx.lossStreak ?? 0) >= value)) return false;
          break;
        case 'fallenThisRun':
          if (Boolean(ctx.fallenName) !== value) return false;
          break;
        case 'lastRunLordFell':
          if ((Array.isArray(ctx.lastRunLordsFell) && ctx.lastRunLordsFell.length > 0) !== value)
            return false;
          break;
        case 'rungChanged':
          if ((ctx.rungChanged === true) !== value) return false;
          break;
        case 'minBestActCleared':
          if (typeof value !== 'number' || !((ctx.bestActCleared ?? 0) >= value)) return false;
          break;
        case 'minBossSlain':
          if (typeof value !== 'number' || !((ctx.bossSlainCount ?? 0) >= value)) return false;
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
  const fallen = ctx?.fallenName || FALLEN_FALLBACK;
  const lords = Array.isArray(ctx?.lastRunLordsFell) ? ctx.lastRunLordsFell : [];
  const lastLord = lords[lords.length - 1] || FALLEN_FALLBACK;
  const tokens = [
    [LAST_FOE_TOKEN, foe],
    [EPITHET_TOKEN, titled],
    [FALLEN_TOKEN, fallen],
    [LAST_FALLEN_LORD_TOKEN, lastLord],
  ];
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.line !== 'string') return entry;
    if (!tokens.some(([token]) => entry.line.includes(token))) return entry;
    let line = entry.line;
    for (const [token, value] of tokens) line = line.split(token).join(value);
    return { ...entry, line };
  });
}

/** A pool exchange: a non-empty list of entries that each have a line. */
function isExchange(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((e) => e && typeof e === 'object' && typeof e.line === 'string')
  );
}

/** A playable pool entry: one line, or an exchange. */
function isPoolItem(e) {
  return Boolean(
    e && typeof e === 'object' && (typeof e.line === 'string' || isExchange(e.exchange)),
  );
}

/** The text a pool entry is ordered and remembered by: its line, or every line of its exchange. */
function poolItemText(e) {
  return typeof e.line === 'string' ? e.line : e.exchange.map((x) => x.line).join('\n');
}

/**
 * The line of `lines` played longest ago on this save (never played first), ties
 * broken by a fixed shuffled order. So a set walks every line before any repeats,
 * however the set changes from run to run (a partner, a loss, the difficulty).
 */
function leastRecent(lines, played) {
  const order = lines
    .map((entry) => ({ entry, text: poolItemText(entry) }))
    .sort(
      (a, b) =>
        lineHash(a.text) - lineHash(b.text) || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0),
    );
  let best = null;
  let bestAt = Infinity;
  for (const { entry, text } of order) {
    const at = played.lastIndexOf(narrativeLineKey(text));
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
  const valid = pool.filter(isPoolItem);
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
  return { ...entry, lineKey: narrativeLineKey(poolItemText(picked)) };
}

/** The entries a picked pool entry plays: itself, or its exchange with the key on its first line. */
function poolEntryLines(entry) {
  if (!Array.isArray(entry.exchange)) return [entry];
  return entry.exchange.map((line, i) => (i === 0 ? { ...line, lineKey: entry.lineKey } : line));
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
        if (entry) return applyNarrativeTokens(poolEntryLines(entry), ctx);
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

/** True when the run's own act list includes Act IV: the Emperor stands on this road. */
export function roadIncludesAct4(runManager) {
  return Array.isArray(runManager?.actSequence) && runManager.actSequence.includes('act4');
}

/**
 * Where the run's road ends, read from its own act list like `victoryEndingKey`:
 * 'lieutenant' | 'entity' | 'emperor', or null without a run, or when the road goes on to
 * the final act and the catalog that names its boss is not at hand (unknown, never guessed).
 */
export function finaleOf(runManager, gameData) {
  const acts = runManager?.actSequence;
  if (!Array.isArray(acts) || acts.length === 0) return null;
  if (acts.at(-1) === 'finalBoss' && !Array.isArray(gameData?.enemies?.bosses?.finalBoss))
    return null;
  return {
    victory_lieutenant: 'lieutenant',
    victory_emperor: 'emperor',
    victory_entity: 'entity',
  }[victoryEndingKey(runManager, gameData)];
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
