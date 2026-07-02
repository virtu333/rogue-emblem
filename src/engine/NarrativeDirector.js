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
// Line text may use the {lastFoe} token, which resolves to the boss that
// ended the previous run. It is substituted here, before adaptDialogueEntries
// (DialogueCast), which only handles {commander} and passes other text through.

const LAST_FOE_TOKEN = '{lastFoe}';
const LAST_FOE_FALLBACK = 'the enemy';

/** Condition keys understood by evaluateWhen. Contract tests validate
 *  dialogue.json against this set so a typo in data fails CI, not gameplay. */
export const KNOWN_WHEN_KEYS = new Set([
  'commander',
  'difficulty',
  'minRunsCompleted',
  'lastRunResult',
  'lastRunDefeatedByKnown',
  'bossSlainBefore',
  'bossKilledYouBefore',
  'firstClear',
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
  const flags = typeof meta?.getStoryFlags === 'function' ? meta.getStoryFlags() : null;
  const lastRun = flags?.lastRun && typeof flags.lastRun === 'object' ? flags.lastRun : null;
  const resolvedBossName = typeof bossName === 'string' && bossName.trim() ? bossName.trim() : null;
  return {
    commander,
    partner,
    difficulty: runManager?.difficultyId || 'normal',
    runsCompleted:
      typeof meta?.runsCompleted === 'number' && Number.isFinite(meta.runsCompleted)
        ? meta.runsCompleted
        : 0,
    lastRunResult:
      lastRun?.result === 'victory' || lastRun?.result === 'defeat' ? lastRun.result : 'none',
    lastRunDefeatedBy: typeof lastRun?.defeatedBy === 'string' ? lastRun.defeatedBy : null,
    bossName: resolvedBossName,
    bossSlainCount: resolvedBossName ? (meta?.getBossSlainCount?.(resolvedBossName) ?? 0) : 0,
    bossKilledYouCount: resolvedBossName ? (meta?.getDefeatedByCount?.(resolvedBossName) ?? 0) : 0,
    firstClear: runManager?.endRunRewards?.firstClear === true,
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
        case 'bossSlainBefore':
          if (ctx.bossSlainCount > 0 !== value) return false;
          break;
        case 'bossKilledYouBefore':
          if (ctx.bossKilledYouCount > 0 !== value) return false;
          break;
        case 'firstClear':
          if (ctx.firstClear !== value) return false;
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

/** Substitute {lastFoe} in entry lines. Returns a new array; untouched
 *  entries pass through by reference (mirrors adaptDialogueEntries). */
function applyNarrativeTokens(entries, ctx) {
  const foe = ctx?.lastRunDefeatedBy || LAST_FOE_FALLBACK;
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.line !== 'string') return entry;
    if (!entry.line.includes(LAST_FOE_TOKEN)) return entry;
    return { ...entry, line: entry.line.split(LAST_FOE_TOKEN).join(foe) };
  });
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
      if (!Array.isArray(variant.entries) || variant.entries.length === 0) continue;
      if (evaluateWhen(variant.when, ctx)) return applyNarrativeTokens(variant.entries, ctx);
    }
    if (Array.isArray(sectionValue.base)) return applyNarrativeTokens(sectionValue.base, ctx);
    return null;
  } catch (_) {
    return null;
  }
}
