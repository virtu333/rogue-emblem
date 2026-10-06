// Burdens.js — run-long penalties an event can leave (docs/specs/event-nodes.md §7).
//
// A burden is a plain record on `run.burdens` (an array, saved with the run) with its own
// end condition; it disappears when spent. Phase 1 has two:
//   ill_omen  { id, battles, extraShadow }   each of the next `battles` victories gathers
//                                            `extraShadow` more shadow (First Light: 2 battles)
//   debt      { id, owed, garnish }          each victory, `garnish` (a half; First Light a
//                                            quarter) of the battle's gold goes to the lender
//                                            until `owed` is paid
// The numbers live in data/events.json `burdens`; `onRung` holds the exact-rung overrides
// (a burden is gentler on First Light only). They are resolved ONCE, when the burden is
// taken, and stored on the record, so a later data change never moves a burden in flight.
//
// A burden never stacks with itself: taking Debt twice adds to `owed`; taking Ill Omen
// again refreshes `battles` (and keeps the larger `extraShadow`).
//
// Settlement happens at exactly one place, the battle's victory commit
// (RunManager.completeBattle -> burdenEffectsOnVictory), and nowhere mid-battle, so
// Vision rewind, suspend/resume and "Continue from Map" (which restore the run's entry
// state, and never run a victory commit) leave burdens exactly as they were at entry.
// `burdenEffectsOnVictory` is pure: it returns the next list and the settlement record;
// the caller assigns them.
//
// Pure: no Phaser, no DOM, no randomness.

export const BURDEN_IDS = Object.freeze(['ill_omen', 'debt']);

const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const int = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

/** The burden definition table of a catalog (data/events.json `burdens`), or {}. */
export function burdenDefs(catalog) {
  return isPlain(catalog?.burdens) ? catalog.burdens : {};
}

/** A burden's data for a rung: the base entry with its `onRung[rung]` overrides on top. */
export function burdenDefFor(catalog, id, difficultyId) {
  const def = burdenDefs(catalog)[id];
  if (!isPlain(def)) return null;
  const { onRung, ...base } = def;
  return { ...base, ...(isPlain(onRung?.[difficultyId]) ? onRung[difficultyId] : {}) };
}

/**
 * The burdens of a save, sanitized: known ids only, whole non-negative numbers, spent
 * burdens dropped, one record per id.
 */
export function normalizeBurdens(raw) {
  const out = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!isPlain(entry) || out.some((b) => b.id === entry.id)) continue;
    if (entry.id === 'ill_omen') {
      const battles = Math.max(0, int(entry.battles));
      if (battles > 0)
        out.push({ id: 'ill_omen', battles, extraShadow: Math.max(0, int(entry.extraShadow, 1)) });
    } else if (entry.id === 'debt') {
      const owed = Math.max(0, int(entry.owed));
      const garnish = Number(entry.garnish);
      if (owed > 0)
        out.push({
          id: 'debt',
          owed,
          garnish: Number.isFinite(garnish) && garnish > 0 && garnish <= 1 ? garnish : 0.5,
        });
    }
  }
  return out;
}

/** The run's burden record for an id, or null. */
export function burdenOf(run, id) {
  return (run?.burdens || []).find((burden) => burden?.id === id) || null;
}

/**
 * Take a burden: resolve its numbers for the run's rung and merge into the list (no
 * stacking). `params` may override: ill_omen { battles, extraShadow }, debt { owed }
 * (a number, already resolved by the caller).
 * @returns {{ ok: boolean, reason?: string, burden?: object }}
 */
export function addBurden(run, id, params = {}, catalog = null) {
  if (!BURDEN_IDS.includes(id)) return { ok: false, reason: `Unknown burden "${id}".` };
  const def = burdenDefFor(catalog || run?.gameData?.events, id, run?.difficultyId);
  if (!def) return { ok: false, reason: `No definition for burden "${id}".` };
  const list = normalizeBurdens(run?.burdens);
  const existing = list.find((burden) => burden.id === id);
  let next;
  if (id === 'ill_omen') {
    const battles = Math.max(1, int(params.battles ?? def.battles, 1));
    const extraShadow = Math.max(0, int(params.extraShadow ?? def.extraShadow, 1));
    next = {
      id,
      battles,
      extraShadow: existing ? Math.max(existing.extraShadow, extraShadow) : extraShadow,
    };
  } else {
    const owed = Math.max(1, int(params.owed ?? def.owed, 1));
    const garnish = Number(params.garnish ?? def.garnish);
    next = {
      id,
      owed: (existing?.owed || 0) + owed,
      garnish: Number.isFinite(garnish) && garnish > 0 && garnish <= 1 ? garnish : 0.5,
    };
  }
  run.burdens = existing
    ? list.map((burden) => (burden.id === id ? next : burden))
    : [...list, next];
  return { ok: true, burden: structuredClone(next) };
}

/**
 * What a battle victory does to the burdens (pure; nothing is mutated).
 * @param {object} run
 * @param {{ gold?: number, shadowGain?: number }} input - the battle's gold (final, after
 *   its multipliers) and its shadow gain before any burden
 * @returns {{ gold: number, garnished: number, shadowGain: number, extraShadow: number,
 *   burdens: object[], record: object|null }} `gold` is what the army keeps; `burdens` is
 *   the next list (spent ones gone); `record` says what happened for the victory band:
 *   { debt: { paid, remaining, cleared }|null, illOmen: { extraShadow, remaining, ended }|null }
 */
export function burdenEffectsOnVictory(run, { gold = 0, shadowGain = 0 } = {}) {
  const current = normalizeBurdens(run?.burdens);
  const total = Math.max(0, int(gold));
  let kept = total;
  let garnished = 0;
  let extraShadow = 0;
  const next = [];
  const record = { debt: null, illOmen: null };
  for (const burden of current) {
    if (burden.id === 'ill_omen') {
      extraShadow += burden.extraShadow;
      const remaining = burden.battles - 1;
      record.illOmen = { extraShadow: burden.extraShadow, remaining, ended: remaining <= 0 };
      if (remaining > 0) next.push({ ...burden, battles: remaining });
    } else if (burden.id === 'debt') {
      const share = Math.floor(total * burden.garnish);
      const paid = Math.min(share, burden.owed);
      garnished += paid;
      kept -= paid;
      const remaining = burden.owed - paid;
      record.debt = { paid, remaining, cleared: remaining <= 0 };
      if (remaining > 0) next.push({ ...burden, owed: remaining });
    }
  }
  return {
    gold: kept,
    garnished,
    shadowGain: Math.max(0, int(shadowGain)) + extraShadow,
    extraShadow,
    burdens: next,
    record: current.length ? record : null,
  };
}

/**
 * Display model of the run's burdens for the route map's chips and the pause menu:
 * [{ id, label, short, line, detail }]. `short` is the chip's number ("3 left", "450 G"),
 * `detail` the full count ("3 battles left, +1 shadow each", "450 G owed, 50% of ...").
 */
export function describeBurdens(run, catalog = null) {
  const defs = burdenDefs(catalog || run?.gameData?.events);
  return normalizeBurdens(run?.burdens).map((burden) => {
    const def = defs[burden.id] || {};
    const detail =
      burden.id === 'ill_omen'
        ? `${burden.battles} battle${burden.battles === 1 ? '' : 's'} left, +${burden.extraShadow} shadow each`
        : `${burden.owed} G owed, ${Math.round(burden.garnish * 100)}% of each victory's gold`;
    return {
      id: burden.id,
      label: def.label || burden.id,
      short: burden.id === 'ill_omen' ? `${burden.battles} left` : `${burden.owed} G`,
      line: def.line || '',
      detail,
    };
  });
}

/**
 * The victory band's words for a settlement record: ["Debt −120 G", "Ill Omen +1"]
 * (empty when nothing was settled).
 */
export function settlementLines(settlement) {
  const lines = [];
  if (settlement?.debt && settlement.debt.paid > 0)
    lines.push(`Debt −${settlement.debt.paid} G${settlement.debt.cleared ? ' (paid off)' : ''}`);
  else if (settlement?.debt?.cleared) lines.push('Debt paid off');
  if (settlement?.illOmen && settlement.illOmen.extraShadow > 0)
    lines.push(
      `Ill Omen +${settlement.illOmen.extraShadow}${settlement.illOmen.ended ? ' (passed)' : ''}`,
    );
  return lines;
}
