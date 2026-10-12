// sim/lib/DescentTrials.js — what makes two sim:descent records the same trial (sim/descent.js).
//
// A record is one run's Act V on one arm. Two records are the two arms of one trial only when
// every field that defines the experiment matches, not just the seed: cohorts that share seeds
// (Nightfall at half meta and at endgame meta both start at seed 200001) are different trials.
// Pure: no game data, no RNG.

/**
 * The fields of an experiment cell, with the value a record written before the field existed
 * reads as. `fork` and `agent` are what every older record was played with (the sim's only agent,
 * its default fork); `ruleset` and `stones` are unknown there, so they read as `unrecorded`.
 */
export const CELL_DEFAULTS = Object.freeze({
  meta: 'none',
  fork: 'keyed',
  agent: 'claiming',
  stones: 'unrecorded',
  ruleset: 'unrecorded',
});

/** The Revival Stones table as one stable string (sorted kinds), `unrecorded` when absent. */
export function stonesKey(stones) {
  if (!stones || typeof stones !== 'object') return CELL_DEFAULTS.stones;
  return Object.keys(stones)
    .sort()
    .map((kind) => `${kind}=${stones[kind]}`)
    .join(',');
}

/** The cell an Act V record belongs to: rung, Home Base preset, fork, agent, stones, ruleset. */
export function trialCell(record) {
  return {
    difficulty: record.difficulty,
    meta: record.meta ?? CELL_DEFAULTS.meta,
    fork: record.fork ?? CELL_DEFAULTS.fork,
    agent: record.agent ?? CELL_DEFAULTS.agent,
    stones: stonesKey(record.stones),
    ruleset: record.ruleset ?? CELL_DEFAULTS.ruleset,
  };
}

const CELL_ORDER = ['difficulty', 'meta', 'fork', 'agent', 'stones', 'ruleset'];

/** A cell as a map key. */
export function cellKey(record) {
  const cell = trialCell(record);
  return JSON.stringify(CELL_ORDER.map((field) => cell[field]));
}

/** A trial as a map key: its cell and its seed (the arm is not part of it). */
export function trialKey(record) {
  return `${cellKey(record)}#${record.seed}`;
}

/**
 * The capture an Act V record was replayed from. A capture plays Acts I-IV only, so the fork and
 * the stones (Act V's) are not part of it; its ruleset is the capture's checkout, which a replay
 * under newer data does not share by design.
 */
export function captureCellKey(record) {
  const cell = trialCell(record);
  return JSON.stringify([cell.difficulty, cell.meta, cell.agent]);
}

/** Captures keyed by trial; two captures of one run (by rung, preset, agent and seed) throw. */
export function indexCaptures(captures) {
  const byKey = new Map();
  const dupes = [];
  for (const c of captures) {
    const key = `${captureCellKey(c)}#${c.seed}`;
    if (byKey.has(key)) dupes.push(key);
    else byKey.set(key, c);
  }
  if (dupes.length)
    throw new Error(
      `sim:descent: ${dupes.length} duplicate capture(s) (same rung, meta, agent and seed), ` +
        `e.g. ${dupes.slice(0, 3).join('; ')}. Pass each capture file once.`,
    );
  return byKey;
}

/**
 * The Act V records grouped by cell and paired by trial. `armOrder[0]` is the baseline every
 * other arm is compared with (`legacy`). Returns the cells in input order, each
 * `{ key, cell, arms, pairable, trials, complete, unpaired }`:
 * - `arms`: the arms with at least one record in the cell, in `armOrder`;
 * - `pairable`: the cell holds the baseline and at least one other arm;
 * - `trials`: every trial, `{ seed, byArm: { [arm]: record } }`;
 * - `complete`: the trials with a record on every one of `arms` (what every table reads);
 * - `unpaired`: `{ [arm]: n }`, the records with no partner: those of a trial missing another
 *   arm, and every record of a cell that is not pairable (a legacy arm recorded under one stone
 *   count and the Descent under another are two such cells, never one pair).
 * Two records with the same trial and arm never overwrite each other: they throw.
 */
export function pairTrials(records, armOrder) {
  const cells = new Map();
  const dupes = [];
  for (const r of records) {
    const key = cellKey(r);
    if (!cells.has(key)) cells.set(key, { key, cell: trialCell(r), trials: new Map() });
    const { trials } = cells.get(key);
    if (!trials.has(r.seed)) trials.set(r.seed, { seed: r.seed, byArm: {} });
    const trial = trials.get(r.seed);
    if (trial.byArm[r.arm]) dupes.push(`${trialKey(r)} arm ${r.arm}`);
    else trial.byArm[r.arm] = r;
  }
  if (dupes.length)
    throw new Error(
      `sim:descent: ${dupes.length} duplicate trial identit${dupes.length === 1 ? 'y' : 'ies'} ` +
        `(same cell, seed and arm), e.g. ${dupes.slice(0, 3).join('; ')}. ` +
        'A trial is played once per arm; pass each record file once.',
    );
  return [...cells.values()].map(({ key, cell, trials }) => {
    const list = [...trials.values()];
    const present = new Set(list.flatMap((t) => Object.keys(t.byArm)));
    const arms = [
      ...armOrder.filter((a) => present.has(a)),
      ...[...present].filter((a) => !armOrder.includes(a)),
    ];
    const pairable = arms.includes(armOrder[0]) && arms.some((a) => a !== armOrder[0]);
    const complete = list.filter((t) => arms.every((a) => t.byArm[a]));
    const unpaired = Object.fromEntries(arms.map((a) => [a, 0]));
    for (const t of list)
      if (!pairable || !arms.every((a) => t.byArm[a]))
        for (const a of Object.keys(t.byArm)) unpaired[a]++;
    return { key, cell, arms, pairable, trials: list, complete, unpaired };
  });
}
