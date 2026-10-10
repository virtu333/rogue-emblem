// BlessingReport.js — the numbers `npm run sim:blessings` reports from ClaimingRunDriver
// results (sim/blessings.js; docs/sim-reports/blessings-v3-balance.md). Pure: no I/O, no
// randomness.
//
// Outcomes (each run is played in casual-commander mode, so every run reaches its end):
//   koBattle%     share of the run's battles in which the commander was KO'd at least once (the
//                 run would have ended there)
//   ko/battle     commander KOs per battle (how badly those battles went: a KO'd commander is
//                 restored and can fall again)
//   deaths/battle other units' falls per battle (real: they join the fallen)
//   winsBeforeKO  battles won before the first battle with a commander KO (all of them when none)
//   stall%        share of battles still unwon at the turn cap (30): completed as won, counted here
//   gold          gold held at the run's end
//
// Comparisons are within the runs that were OFFERED the card: took it against offered it and took
// something else. The sims' start pick and earned pick are keyed by the run seed alone (independent
// of how the run goes), so this is a randomized comparison; across rungs the per-rung differences
// are pooled with weights nA·nB/(nA+nB). Intervals are 95% normal intervals on a Welch standard
// error. With ~65 cards and 6 outcomes, about 5% of nominal flags are expected by chance: the
// report marks |z| ≥ 3.66 (Bonferroni, 0.05 over about 400 comparisons) separately.

export const OUTCOMES = Object.freeze([
  { key: 'koBattleRate', label: 'koBattle%', scale: 100, better: 'lower' },
  { key: 'koPerBattle', label: 'ko/battle', scale: 1, better: 'lower' },
  { key: 'deathsPerBattle', label: 'deaths/battle', scale: 1, better: 'lower' },
  { key: 'winsBeforeKO', label: 'winsBeforeKO', scale: 1, better: 'higher' },
  { key: 'stallRate', label: 'stall%', scale: 100, better: 'lower' },
  { key: 'gold', label: 'gold', scale: 1, better: 'higher' },
]);

export const Z95 = 1.96;
export const Z_FAMILY = 3.66;
export const MIN_TAKEN_FOR_FLAG = 10;

/**
 * How each card's own mechanic is detected (ClaimingRunDriver `exercise`), or why it cannot be:
 * any card not listed is passive (always on while held), and counts as exercised when held in at
 * least one battle.
 */
export const DETECTED = Object.freeze({
  unbroken_banner: 'a unit held at 1 HP',
  ember_lantern: 'the first kill healed',
  cutpurses_luck: 'a Steal made while held',
  thiefs_lantern: 'a Steal the speed waiver decided',
  saints_reserve: 'a staff heal while held',
  saints_reliquary: 'a staff heal while held',
  second_dawn: 'an act-start charge or a rewind while held',
  darkened_dawn: 'an act-start charge or a rewind while held',
  watchers_grace: "a rewind on the boss map's own charge",
  open_roll: 'a second candidate offered at a recruit node',
  crest_of_the_road: 'a recruit joined while held',
  nomad_pact: 'a recruit joined while held',
  gamblers_toss: 'a battle-gold toss',
  lottery_loot: "a next act's card offered",
  dawn_tithe: 'Dawn Tithe gold paid',
  hollow_sun_favor: 'a gold loot card taken',
  hollow_hourglass: 'a battle with reinforcements',
  lantern_of_the_road: 'a fog battle',
  seers_eye: 'a fog battle',
  patient_dawn: 'a battle with par',
  frugal_smith: 'a free shop forge',
  smiths_covenant: 'a free shop forge',
  pilgrim_coin: 'a visit to its extra shop',
  tithe_box: 'tithe gold paid at a church',
  kingmakers_oath: 'a free church promotion, or a Master Seal refused',
  twin_chapel: 'a second vow made',
  mercenary_ledger: 'an arena bout at the halved fee',
  field_medic: 'a Vulnerary used between battles',
  quartermaster_cache: 'an Elixir used between battles',
  late_bloom: 'an act advance while held',
  chronicle: 'an act advance while held',
  coin_of_fate: 'an act advance while held',
});

/** Cards whose mechanic these policies cannot reach (shown instead of an exercise rate). */
export const NOT_REACHED = Object.freeze({
  bloodless_art: 'the battle agent never uses a weapon art',
  scroll_archive: 'its art scrolls are bound, but the battle agent never uses a weapon art',
  omen_reader: 'the route policy does not read the omen marks (the spared recruit nodes still act)',
});

// ── Small statistics ──────────────────────────────────────────────────────

export function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

export function variance(xs) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
}

/** Difference of means (a - b) with a Welch standard error and a 95% interval. */
export function diffStats(a, b) {
  const nA = a.length;
  const nB = b.length;
  const delta = mean(a) - mean(b);
  const se = Math.sqrt(variance(a) / nA + variance(b) / nB);
  return { nA, nB, delta, se, lo: delta - Z95 * se, hi: delta + Z95 * se };
}

/**
 * Pool per-stratum differences (`strata`: [{ a, b }], each a pair of samples): weights
 * nA·nB/(nA+nB); a stratum with fewer than 2 in a group is left out.
 */
export function pooledDiff(strata) {
  let wSum = 0;
  let dSum = 0;
  let vSum = 0;
  let nA = 0;
  let nB = 0;
  for (const { a, b } of strata) {
    if (a.length < 2 || b.length < 2) continue;
    const d = diffStats(a, b);
    if (!Number.isFinite(d.delta) || !Number.isFinite(d.se)) continue;
    const w = (a.length * b.length) / (a.length + b.length);
    wSum += w;
    dSum += w * d.delta;
    vSum += w * w * d.se * d.se;
    nA += a.length;
    nB += b.length;
  }
  if (wSum <= 0) return { nA, nB, delta: NaN, se: NaN, lo: NaN, hi: NaN, z: NaN };
  const delta = dSum / wSum;
  const se = Math.sqrt(vSum) / wSum;
  return { nA, nB, delta, se, lo: delta - Z95 * se, hi: delta + Z95 * se, z: delta / se };
}

/** Wilson 95% interval for k of n. */
export function wilson(k, n) {
  if (!(n > 0)) return { p: NaN, lo: NaN, hi: NaN };
  const p = k / n;
  const z = Z95;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { p, lo: centre - half, hi: centre + half };
}

// ── Outcomes ──────────────────────────────────────────────────────────────

/** Outcomes over a run's battles from `from` on (all of them by default). */
export function outcomesOf(result, from = 0) {
  const log = (result.battleLog || []).slice(from);
  const battles = log.length;
  const koBattles = log.filter((b) => b.commanderKOs > 0).length;
  const firstKO = log.findIndex((b) => b.commanderKOs > 0);
  return {
    battles,
    koBattleRate: battles ? koBattles / battles : NaN,
    koPerBattle: battles ? log.reduce((s, b) => s + b.commanderKOs, 0) / battles : NaN,
    deathsPerBattle: battles ? log.reduce((s, b) => s + b.unitDeaths, 0) / battles : NaN,
    winsBeforeKO: firstKO < 0 ? battles : firstKO,
    stallRate: battles ? log.filter((b) => b.stalled).length / battles : NaN,
    clean: koBattles === 0 ? 1 : 0,
    gold: Number(result.gold) || 0,
    rewinds: log.reduce((s, b) => s + b.rewinds, 0),
    stalls: log.filter((b) => b.stalled).length,
  };
}

// ── Cards ─────────────────────────────────────────────────────────────────

/** The catalog split the way the report reads it. */
export function cardCatalog(gameData) {
  const blessings = gameData.blessings?.blessings || [];
  return {
    start: blessings.filter((b) => !b.earned),
    earned: blessings.filter((b) => b.earned),
    gifts: gameData.blessings?.gifts?.list || [],
    byId: new Map(blessings.map((b) => [b.id, b])),
  };
}

function exerciseText(id, runs, results) {
  if (NOT_REACHED[id]) return { rate: null, text: `not reached: ${NOT_REACHED[id]}` };
  if (!runs.length) return { rate: null, text: '' };
  const detected = Boolean(DETECTED[id]);
  const hits = runs.filter((r) =>
    detected
      ? (results[r].exercise?.[id] || 0) > 0
      : (results[r].battleLog || []).some((b) => (b.held || []).includes(id)),
  ).length;
  return { rate: hits / runs.length, text: detected ? 'detected' : 'passive' };
}

function startPick(result) {
  const choice = result.startChoice;
  if (!choice) return { offered: [], taken: null };
  const offered = (choice.offered || []).map((entry) => entry.split(':'));
  return {
    offered: offered.filter(([kind]) => kind === 'blessing').map(([, id]) => id),
    gifts: offered.filter(([kind]) => kind === 'gift').map(([, id]) => id),
    taken: choice.kind === 'blessing' || choice.kind === 'gift' ? choice.id : null,
    kind: choice.kind,
  };
}

function compare(results, groups, rungs, outcomeOf) {
  // groups: { taken: [index], other: [index] } per rung.
  const out = {};
  for (const outcome of OUTCOMES) {
    const strata = rungs.map((rung) => ({
      a: (groups[rung]?.taken || []).map((i) => outcomeOf(i)[outcome.key]).filter(Number.isFinite),
      b: (groups[rung]?.other || []).map((i) => outcomeOf(i)[outcome.key]).filter(Number.isFinite),
    }));
    out[outcome.key] = pooledDiff(strata);
  }
  return out;
}

/**
 * Per start card (shrine blessing), per gift: runs offered, taken, the exercise rate among takers,
 * and the outcome differences (took it − offered it and took something else).
 */
export function startCardRows(results, gameData, { rungs = null } = {}) {
  const catalog = cardCatalog(gameData);
  const rungList = rungs || [...new Set(results.map((r) => r.difficulty))];
  const whole = results.map((r) => outcomesOf(r));
  const rows = [];
  const cards = [
    ...catalog.start.map((b) => ({ id: b.id, name: b.name, kind: `T${b.tier}`, gift: false })),
    ...catalog.gifts.map((g) => ({ id: g.id, name: g.name, kind: 'gift', gift: true })),
  ];
  for (const card of cards) {
    const groups = {};
    const takenRuns = [];
    let offered = 0;
    results.forEach((result, i) => {
      const pick = startPick(result);
      const isOffered = card.gift ? pick.gifts?.includes(card.id) : pick.offered.includes(card.id);
      if (!isOffered) return;
      offered++;
      const took = pick.taken === card.id && pick.kind === (card.gift ? 'gift' : 'blessing');
      const g = (groups[result.difficulty] ||= { taken: [], other: [] });
      (took ? g.taken : g.other).push(i);
      if (took) takenRuns.push(i);
    });
    const ex = card.gift
      ? {
          rate: takenRuns.length
            ? takenRuns.filter((i) => results[i].startGift?.id === card.id).length /
              takenRuns.length
            : null,
          text: 'granted',
        }
      : exerciseText(card.id, takenRuns, results);
    rows.push({
      ...card,
      offered,
      taken: takenRuns.length,
      exercise: ex,
      diffs: compare(results, groups, rungList, (i) => whole[i]),
    });
  }
  return rows;
}

/**
 * Per earned card: the runs that were shown it in a pick (an act boss's pair, an eclipsed elite's
 * card, the sanctum's pair, the Colosseum's card), the runs that took it, how they got it, the
 * exercise rate, and the outcome differences over the battles from the card's first offer on.
 * Event grants (no choice: the card is given) are counted, not compared.
 */
export function earnedCardRows(results, gameData, { rungs = null } = {}) {
  const catalog = cardCatalog(gameData);
  const rungList = rungs || [...new Set(results.map((r) => r.difficulty))];
  const rows = [];
  for (const card of catalog.earned) {
    const groups = {};
    const takenRuns = [];
    const sources = {};
    let granted = 0;
    const firstOffer = new Map();
    results.forEach((result, i) => {
      const offers = (result.offers || []).filter((o) => o.id === card.id);
      const picked = offers.filter((o) => o.source !== 'event');
      if (offers.some((o) => o.source === 'event' && o.taken)) granted++;
      if (!picked.length) return;
      const first = Math.min(...picked.map((o) => o.battleIndex));
      firstOffer.set(i, first);
      const took = picked.some((o) => o.taken);
      for (const o of picked) if (o.taken) sources[o.source] = (sources[o.source] || 0) + 1;
      const g = (groups[result.difficulty] ||= { taken: [], other: [] });
      (took ? g.taken : g.other).push(i);
      if (took) takenRuns.push(i);
    });
    const heldRuns = results
      .map((r, i) => ((r.heldAtEnd || []).includes(card.id) ? i : -1))
      .filter((i) => i >= 0);
    rows.push({
      id: card.id,
      name: card.name,
      kind: card.twist ? 'twisted' : 'earned',
      offeredRuns: firstOffer.size,
      taken: takenRuns.length,
      granted,
      held: heldRuns.length,
      sources,
      exercise: exerciseText(card.id, heldRuns, results),
      diffs: compare(results, groups, rungList, (i) => outcomesOf(results[i], firstOffer.get(i))),
    });
  }
  return rows;
}

/** The claiming policies' coverage: per counter, mean per run and share of runs with any. */
export function claimCoverage(results) {
  const keys = new Set();
  for (const r of results)
    for (const [k, v] of Object.entries(r.claims || {})) if (typeof v === 'number') keys.add(k);
  const rows = [];
  for (const key of [...keys]) {
    const values = results.map((r) => Number(r.claims?.[key]) || 0);
    rows.push({
      claim: key,
      perRun: mean(values),
      runsWithAny: values.filter((v) => v > 0).length / (values.length || 1),
    });
  }
  return rows;
}

/** Baseline outcomes per rung (all runs), for scale. */
export function rungSummary(results) {
  const byRung = {};
  for (const r of results) (byRung[r.difficulty] ||= []).push(outcomesOf(r));
  return Object.entries(byRung).map(([rung, list]) => ({
    rung,
    runs: list.length,
    battles: mean(list.map((o) => o.battles)),
    koBattleRate: mean(list.map((o) => o.koBattleRate)),
    koPerBattle: mean(list.map((o) => o.koPerBattle)),
    deathsPerBattle: mean(list.map((o) => o.deathsPerBattle)),
    winsBeforeKO: mean(list.map((o) => o.winsBeforeKO)),
    stallRate: mean(list.map((o) => o.stallRate)),
    clean: mean(list.map((o) => o.clean)),
    gold: mean(list.map((o) => o.gold)),
    rewinds: mean(list.map((o) => o.rewinds)),
    stalls: mean(list.map((o) => o.stalls)),
  }));
}

/**
 * Flags: a difference whose 95% interval excludes 0 with at least MIN_TAKEN_FOR_FLAG takers
 * ('nominal'), and one past |z| ≥ Z_FAMILY ('family-wise'); plus a detected mechanic that never
 * fired among the takers ('never exercised').
 */
export function flagsFor(row) {
  const flags = [];
  for (const outcome of OUTCOMES) {
    const d = row.diffs?.[outcome.key];
    if (!d || !Number.isFinite(d.z) || row.taken < MIN_TAKEN_FOR_FLAG) continue;
    if (Math.abs(d.z) < Z95) continue;
    const good = outcome.better === 'lower' ? d.delta < 0 : d.delta > 0;
    flags.push({
      outcome: outcome.label,
      direction: good ? 'stronger' : 'weaker',
      level: Math.abs(d.z) >= Z_FAMILY ? 'family-wise' : 'nominal',
      delta: d.delta * outcome.scale,
      lo: d.lo * outcome.scale,
      hi: d.hi * outcome.scale,
      z: d.z,
    });
  }
  if (row.exercise?.text === 'detected' && row.exercise.rate === 0 && row.taken > 0)
    flags.push({ outcome: 'exercise', direction: 'never exercised', level: 'coverage' });
  return flags;
}

/** "−4.2 [−8.1, −0.3]" for a pooled difference, scaled. */
export function fmtDiff(d, scale = 1, digits = 1) {
  if (!d || !Number.isFinite(d.delta)) return 'n/a';
  const f = (x) => (x * scale).toFixed(digits).replace('-', '−');
  return Number.isFinite(d.se) ? `${f(d.delta)} [${f(d.lo)}, ${f(d.hi)}]` : f(d.delta);
}
