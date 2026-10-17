// sim/ngplus.js — how much an NG+ start changes a run (scratch measurement, Oct 2026).
//
//   node sim/ngplus.js --phase harvest --difficulty hard --trials 12 --out harvest.jsonl
//   node sim/ngplus.js --phase play --difficulty lunatic --trials 40 --from harvest.jsonl \
//        --arms base,loop1,loop5 --out play.jsonl --workers 4
//
// HARVEST plays ordinary runs (claiming player, endgame Home Base) and keeps each run's end
// roster as "Who rides again?" would offer it (NgPlusRun.rideCandidates): the survivors with
// the skills and items they could keep. PLAY builds NG+ Barracks states from those rides
// through the real NgPlusState (applyRidePicks, runStartOf), a greedy player keeping the
// commander lord and two recruits each ride, and plays fresh seeds with each state, paired
// by seed with the ordinary run (`base`).

import { fork } from 'child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { loadGameData } from '../tests/testData.js';
import { installStatefulSeed, restoreStatefulRandom } from './lib/StatefulRNG.js';
import { ClaimingRunDriver } from '../tests/sim/ClaimingRunDriver.js';
import { buildRunMetaEffects } from '../tests/sim/fullrun-runner.js';
import { parseArgs } from './lib/TableFormatter.js';
import { rideCandidates } from '../src/engine/NgPlusRun.js';
import {
  applyRidePicks,
  defaultNgPlusState,
  keptOfKind,
  keptItemsOfKind,
  KEPT_ITEM_CAPS,
  KEPT_SKILL_CAPS,
  keptItemKind,
  runStartOf,
  setBring,
} from '../src/engine/NgPlusState.js';
import { findCommander } from '../src/engine/Commander.js';

const opts = parseArgs({
  phase: 'play',
  difficulty: 'lunatic',
  trials: 10,
  seed: 1,
  workers: 1,
  arms: 'base,loop1,loop5',
  from: '',
  out: '',
  shard: '',
});

const TIER_RANK = { Legend: 6, Epic: 5, Rare: 4, Silver: 3, Steel: 2, Iron: 1 };
// A greedy player's skill wishes, best first; anything else ranks by order.
const SKILL_WISH = [
  'astra',
  'sol',
  'luna',
  'vantage',
  'adept',
  'aether',
  'deadeye',
  'aegis',
  'pavise',
  'miracle',
  'lifetaker',
  'speedtaker',
  'quick_riposte',
  'desperation',
  'wrath',
  'canto',
];

function itemScore(item, gameData) {
  const kind = keptItemKind(item);
  const forge = Number(/\+(\d+)$/.exec(item.name || '')?.[1] || 0);
  const base = gameData.weapons
    .filter((w) => item.name?.includes(w.name))
    .sort((a, b) => b.name.length - a.name.length)[0];
  const tier = TIER_RANK[item.tier || base?.tier] || 0;
  if (kind === 'weapon') return 1000 + tier * 100 + forge * 10 + (item.might || 0);
  if (kind === 'accessory') return 900 + (item.price || 0) / 100;
  return (item.price || 0) / 100;
}

function bestSkill(candidate, record) {
  const owned = new Set(record?.keptSkills || []);
  const free = candidate.skills.filter((id) => !owned.has(id));
  if (!free.length) return null;
  free.sort((a, b) => {
    const ra = SKILL_WISH.indexOf(a);
    const rb = SKILL_WISH.indexOf(b);
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
  });
  for (const id of free) {
    const kind = candidate.skillKinds[id];
    if (keptOfKind(record, kind).length < KEPT_SKILL_CAPS[kind]) return { skillId: id };
  }
  return null;
}

function bestItem(candidate, record, gameData, takenUids) {
  const items = candidate.items
    .filter((i) => !takenUids.has(i.uid) && !(record?.keptItems || []).some((k) => k.uid === i.uid))
    .sort((a, b) => itemScore(b, gameData) - itemScore(a, gameData));
  for (const item of items) {
    const kind = keptItemKind(item);
    if (keptItemsOfKind(record, kind).length < KEPT_ITEM_CAPS[kind]) return { itemUid: item.uid };
  }
  return null;
}

/** One ride: the commander lord and the two strongest recruits (brought veterans first). */
function ride(state, harvest, gameData) {
  state.pendingRide = structuredClone(harvest.pendingRide);
  const cands = state.pendingRide.candidates;
  const lord =
    cands.find((c) => c.kind === 'lord' && c.name === harvest.commander) ||
    cands.find((c) => c.kind === 'lord');
  const recruits = cands
    .filter((c) => c.kind === 'recruit')
    .sort(
      (a, b) =>
        (b.recordId ? 1 : 0) - (a.recordId ? 1 : 0) ||
        (b.tier === 'promoted') - (a.tier === 'promoted') ||
        b.level - a.level,
    )
    .slice(0, 2);
  const picks = [];
  const taken = new Set();
  for (const c of [lord, ...recruits].filter(Boolean)) {
    const record =
      state.barracks.find((r) => r.id === c.recordId) ||
      (c.kind === 'lord' ? state.barracks.find((r) => r.id === `lord:${c.name}`) : null);
    const pick = { ref: c.ref, ...bestSkill(c, record), ...bestItem(c, record, gameData, taken) };
    if (pick.itemUid) taken.add(pick.itemUid);
    picks.push(pick);
  }
  const res = applyRidePicks(state, picks);
  if (!res.ok) throw new Error(`ride refused: ${res.reason}`);
  state.pendingRide = null;
  return res.added;
}

/**
 * The NG+ start after `loops` rides. Each loop's run "brings" the previous loop's veterans, so
 * the same two recruits stack their keeps (a min-maxing player); a fresh harvest's survivors are
 * relabelled as those veterans by giving them the veterans' record ids. With Barracks Wing the
 * extra brought slots are filled by one-ride veterans from other harvests.
 */
export function buildState(loops, harvests, gameData, { bring = 2 } = {}) {
  const state = defaultNgPlusState();
  let vets = [];
  for (let i = 0; i < loops; i++) {
    const h = structuredClone(harvests[i % harvests.length]);
    const recruitCands = h.pendingRide.candidates
      .filter((c) => c.kind === 'recruit')
      .sort((a, b) => (b.tier === 'promoted') - (a.tier === 'promoted') || b.level - a.level);
    // The kept veterans ride again: lend their record ids to this harvest's two best.
    vets.forEach((id, k) => {
      if (recruitCands[k]) recruitCands[k].recordId = id;
    });
    h.pendingRide.runId = `${h.pendingRide.runId}#${i}`;
    const added = ride(state, h, gameData);
    vets = state.barracks
      .filter((r) => r.kind === 'recruit')
      .sort((a, b) => b.rides - a.rides)
      .slice(0, 2)
      .map((r) => r.id);
    if (process.env.NGDBG)
      console.log(i, added, state.barracks.map((r) => r.id + ':' + r.rides).join(' '));
  }
  const have = () => state.barracks.filter((r) => r.kind === 'recruit').length;
  for (let i = 0; have() < bring && i < harvests.length; i++) {
    const h = structuredClone(harvests[(loops + i) % harvests.length]);
    h.pendingRide.runId = `${h.pendingRide.runId}#x${i}`;
    // Only recruits on these extra rides (the lord already rode).
    h.pendingRide.candidates = h.pendingRide.candidates.filter((c) => c.kind === 'recruit');
    ride(state, h, gameData);
  }
  const ids = state.barracks
    .filter((r) => r.kind === 'recruit')
    .sort((a, b) => b.rides - a.rides)
    .slice(0, bring)
    .map((r) => r.id);
  const set = setBring(state, ids, bring);
  if (!set.ok) throw new Error(`bring refused: ${set.reason}`);
  return runStartOf(state, { bringLimit: bring });
}

const ARM_DEFS = {
  base: null,
  loop1: { loops: 1, bring: 2, vision: 0 },
  loop3: { loops: 3, bring: 3, vision: 2 },
  loop5: { loops: 5, bring: 4, vision: 3 },
  loop10: { loops: 10, bring: 6, vision: 5 },
  // Decomposition: which part of the start does the work.
  loop5_lords: { loops: 5, bring: 4, vision: 3, vets: false },
  loop5_vets: { loops: 5, bring: 4, vision: 3, lords: false },
  loop5_novision: { loops: 5, bring: 4, vision: 0 },
  // Candidate enemy scaling, laid over the rung (every act, Act I's override too).
  loop5_L2: { loops: 5, bring: 4, vision: 3, enemy: { enemyLevelBonus: 2 } },
  loop5_S1: { loops: 5, bring: 4, vision: 3, enemy: { enemyStatBonus: 1 } },
  loop5_L2S1: { loops: 5, bring: 4, vision: 3, enemy: { enemyLevelBonus: 2, enemyStatBonus: 1 } },
  loop5_L3S2: { loops: 5, bring: 4, vision: 3, enemy: { enemyLevelBonus: 3, enemyStatBonus: 2 } },
};

/** Add `enemy` deltas to the run's difficulty levers (and every act override that sets them). */
function layEnemyScaling(rm, enemy) {
  const mods = rm.difficultyModifiers;
  for (const [key, delta] of Object.entries(enemy)) {
    mods[key] = (mods[key] || 0) + delta;
    for (const over of Object.values(mods.actOverrides || {}))
      if (over && key in over) over[key] += delta;
  }
}

async function playOne(gameData, { rung, seed, arm, harvests }) {
  const rng = installStatefulSeed(seed);
  try {
    const metaEffects = buildRunMetaEffects({ metaPreset: 'endgame' }, gameData);
    const def = ARM_DEFS[arm];
    let ngPlus = null;
    if (def) {
      ngPlus = buildState(def.loops, harvests, gameData, { bring: def.bring });
      if (def.vets === false) ngPlus.veterans = [];
      if (def.lords === false) ngPlus.lordKits = [];
      metaEffects.visionChargesBonus = (metaEffects.visionChargesBonus || 0) + def.vision;
    }
    const driver = new ClaimingRunDriver(gameData, {
      rng,
      metaEffects,
      runOptions: { runSeed: seed, difficultyId: rung, autoSelectBlessing: false, ngPlus },
    });
    driver.init();
    if (def?.enemy) layEnemyScaling(driver.runManager, def.enemy);
    const result = await driver.run();
    const rm = driver.runManager;
    const out = {
      seed,
      rung,
      arm,
      result: result.result,
      actIndex: result.actIndex,
      act: result.act,
      completedBattles: result.completedBattles,
      battles: result.metrics.battles,
      totalTurns: result.metrics.totalTurns,
      unitsLost: result.metrics.unitsLost,
      startRoster: def ? 2 + (ngPlus?.veterans?.length || 0) : 2,
      rosterSize: result.rosterSize,
    };
    // Battles per act and turns, from the trace.
    const byAct = {};
    out.firstCommanderKO = null;
    for (const t of result.trace || []) {
      if (!t.act || t.turns == null) continue;
      const a = (byAct[t.act] ||= { battles: 0, turns: 0, rewinds: 0, cko: 0, deaths: 0 });
      a.battles++;
      a.turns += t.turns || 0;
      a.rewinds += t.rewinds || 0;
      a.cko += t.commanderKOs || 0;
      a.deaths += t.unitDeaths || 0;
      if (t.commanderKOs && !out.firstCommanderKO) out.firstCommanderKO = t.act;
    }
    out.byAct = byAct;
    if (opts.phase === 'harvest') {
      out.commander = findCommander(rm.roster || [])?.name || 'Edric';
      out.pendingRide = {
        runId: `h-${rung}-${seed}`,
        difficultyId: rung,
        endedAt: 1,
        candidates: rideCandidates(rm),
        picked: [],
      };
    }
    return out;
  } finally {
    restoreStatefulRandom();
  }
}

function jobs() {
  const arms = opts.phase === 'harvest' ? ['base'] : String(opts.arms).split(',');
  const list = [];
  for (let i = 0; i < Number(opts.trials); i++)
    for (const arm of arms) list.push({ rung: opts.difficulty, seed: Number(opts.seed) + i, arm });
  return list;
}

function readJsonl(files) {
  const rows = [];
  for (const f of String(files).split(',').filter(Boolean))
    for (const line of readFileSync(f, 'utf-8').split('\n'))
      if (line.trim()) rows.push(JSON.parse(line));
  return rows;
}

async function playShard(shard, outFile) {
  const [k, n] = String(shard).split('/').map(Number);
  const gameData = loadGameData();
  const harvests = opts.from
    ? readJsonl(opts.from)
        .filter((h) => h.pendingRide?.candidates?.some((c) => c.kind === 'recruit'))
        .sort((a, b) => b.actIndex - a.actIndex || b.completedBattles - a.completedBattles)
    : [];
  const list = jobs().filter((_, i) => i % n === k);
  for (const job of list) {
    let row;
    try {
      row = await playOne(gameData, { ...job, harvests });
    } catch (error) {
      row = { ...job, harvests: undefined, error: String(error?.stack || error) };
    }
    appendFileSync(outFile, `${JSON.stringify(row)}\n`);
  }
}

async function main() {
  if (opts.shard) return playShard(opts.shard, opts.out);
  const workers = Math.max(1, Number(opts.workers) || 1);
  const out = opts.out || 'ngplus.jsonl';
  const files = [];
  const self = fileURLToPath(import.meta.url);
  const passArgs = process.argv
    .slice(2)
    .filter(
      (a, i, all) =>
        !['--workers', '--out'].includes(a) && !['--workers', '--out'].includes(all[i - 1]),
    );
  await Promise.all(
    Array.from({ length: workers }, (_, k) => {
      const file = `${out}.${k}`;
      writeFileSync(file, '');
      files.push(file);
      return new Promise((resolve, reject) => {
        const child = fork(self, [...passArgs, '--shard', `${k}/${workers}`, '--out', file], {
          stdio: 'inherit',
        });
        child.on('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`worker ${k} exit ${code}`)),
        );
      });
    }),
  );
  writeFileSync(out, files.map((f) => readFileSync(f, 'utf-8')).join(''));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
