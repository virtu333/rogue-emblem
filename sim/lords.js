// sim/lords.js — how many lords a run collects, measured on real route maps.
//
// Walks real runs with RunManager (the game's node maps, recruit-node units, boss recruit
// drafts and the Power of Friendship arrival) without playing the battles: every battle is
// won, nobody falls, every lord offered is taken. So it is an UPPER BOUND on lords, set by
// the route the player picks. Route policies:
//   random   any legal next node
//   recruits the path with the most recruit nodes (a player who cannot see who they hold)
//   near     a lord on a next-step node is taken, else as `recruits` (only the next row shows)
//   lords    the path with the most lord recruit nodes, as the route map previews them today
// Rules (`--rules`): `current`, or `diminish` (the outside review's proposal: Hero's Call
// +5%/tier and the chance x1 / x0.75 / x0.45 / x0.25 at 2-3 / 4 / 5 / 6 lords), or either
// half alone: `hc5` (Hero's Call +5%/tier only), `diminishOnly` (the multiplier only).
//
//   node sim/lords.js [--seeds 2000] [--difficulty hard] [--rules current,diminish]
//                     [--policies random,lords] [--csv]
import { RunManager } from '../src/engine/RunManager.js';
import { resolveRecruitNodeSpawnClass } from '../src/engine/RecruitNodeSystem.js';
import { prepareBossRecruit, resolveBossRecruit } from '../src/engine/PendingBossRecruit.js';
import { prepareThirdLord, resolveThirdLordArrival } from '../src/engine/PendingThirdLord.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import { loadGameData } from '../tests/testData.js';
import { skipOwedEarnedPick } from '../tests/sim/RunPolicies.js';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SEEDS = Math.max(1, Number(arg('seeds', 2000)));
const DIFFICULTY = arg('difficulty', 'hard');
const CSV = args.includes('--csv');

const gameData = loadGameData();
const HERO_TIER = { current: 0.08, diminish: 0.05, hc5: 0.05, diminishOnly: 0.08 };
const DIMINISHES = new Set(['diminish', 'diminishOnly']);

const lordCount = (rm) => rm.roster.filter((u) => u.isLord).length;

/**
 * The flat rules take the run's lord odds record (engine/LordRecruitChance.js) away, as a save
 * from before v2 has none; Hero's Call's bonus is set in the run's meta effects.
 */
function applyRules(rm, rules) {
  if (!DIMINISHES.has(rules)) rm.lordRecruitOdds = null;
}

function nodeHoldsLord(rm, node) {
  if (node.type !== 'recruit' || !node.recruitPreview) return false;
  return Boolean(
    resolveRecruitNodeSpawnClass({
      preview: node.recruitPreview,
      gameData,
      ...rm.getRecruitBattleContext(node),
    })?.isLord,
  );
}

/** Best-path value from a node to the boss, over the act's edges (memoised per step). */
function bestPath(rm, start, score) {
  const byId = new Map(rm.nodeMap.nodes.map((n) => [n.id, n]));
  const memo = new Map();
  const walk = (id) => {
    if (memo.has(id)) return memo.get(id);
    const node = byId.get(id);
    let best = 0;
    for (const next of node?.edges || []) best = Math.max(best, walk(next));
    const value = best + (node && !node.completed ? score(node) : 0);
    memo.set(id, value);
    return value;
  };
  return walk(start.id);
}

function chooseNode(rm, available, policy, rng) {
  const pickMax = (score) => {
    let best = -Infinity;
    let picks = [];
    for (const n of available) {
      const v = score(n);
      if (v > best + 1e-9) {
        best = v;
        picks = [n];
      } else if (Math.abs(v - best) <= 1e-9) picks.push(n);
    }
    return picks[Math.floor(rng() * picks.length)];
  };
  if (policy === 'random') return available[Math.floor(rng() * available.length)];
  const isRecruit = (n) => (n.type === 'recruit' ? 1 : 0);
  if (policy === 'recruits') return pickMax((n) => bestPath(rm, n, isRecruit));
  if (policy === 'near') {
    const lordHere = available.filter((n) => nodeHoldsLord(rm, n));
    if (lordHere.length) return lordHere[Math.floor(rng() * lordHere.length)];
    return pickMax((n) => bestPath(rm, n, isRecruit));
  }
  // lords: every recruit card on the map shows who it holds.
  const lordFlags = new Map(rm.nodeMap.nodes.map((n) => [n.id, nodeHoldsLord(rm, n)]));
  return pickMax(
    (n) =>
      bestPath(rm, n, (m) => (lordFlags.get(m.id) ? 1 : 0)) + 0.01 * bestPath(rm, n, isRecruit),
  );
}

function runOnce(seed, { policy, rules, tier, friendship }) {
  const prev = Math.random;
  Math.random = createSeededRng((seed * 2654435761) >>> 0);
  const rng = createSeededRng((seed * 40503 + 17) >>> 0);
  try {
    const meta = { lordRecruitChanceBonus: tier * HERO_TIER[rules] };
    if (friendship) meta.thirdLordMode = 'random';
    const rm = new RunManager(gameData, meta);
    rm.startRun({ runSeed: seed, difficultyId: DIFFICULTY, eclipseEnabled: false });
    applyRules(rm, rules);
    const byAct = {};
    const sources = { node: 0, boss: 0, friendship: 0 };
    let dancer = false;
    for (let step = 0; step < 200; step++) {
      if (rm.isRunComplete() || rm.currentAct === 'finalBoss') break;
      const available = rm.getAvailableNodes();
      if (!available?.length) break;
      const node = chooseNode(rm, available, policy, rng);
      if (['battle', 'boss', 'recruit'].includes(node.type)) {
        const merged = [...rm.roster];
        if (node.type === 'recruit') {
          const got = rm.getRecruitNodeUnit(node);
          if (got?.unit) {
            merged.push(got.unit);
            if (got.isLord) sources.node++;
            if (got.unit.className === 'Dancer') dancer = true;
          }
        }
        rm.completeBattle(merged, node.id, 0, { turnCount: 5, turnPar: 8 });
        if (node.type === 'boss') {
          const cands = prepareBossRecruit(rm, gameData) || [];
          const lord = cands.find((c) => c.isLord);
          const dancerCand = cands.find((c) => c.unit?.className === 'Dancer');
          const pick = lord || dancerCand;
          if (lord) sources.boss++;
          if (!lord && dancerCand) dancer = true;
          resolveBossRecruit(rm, pick ? pick.unit : null);
        }
        if (rm.shouldTriggerThirdLord()) {
          const offer = prepareThirdLord(rm, gameData);
          const unit = offer?.candidates?.[0];
          resolveThirdLordArrival(rm, unit || null);
          if (unit) sources.friendship++;
        }
      } else {
        rm.markNodeComplete(node.id);
      }
      skipOwedEarnedPick(rm);
      if (rm.isActComplete()) {
        byAct[rm.currentAct] = lordCount(rm);
        if (rm.isRunComplete()) break;
        rm.advanceAct();
      }
    }
    return { byAct, sources, dancer };
  } finally {
    Math.random = prev;
  }
}

const profiles = [];
for (const rules of arg('rules', 'current,hc5,diminishOnly,diminish').split(','))
  for (const friendship of [false, true])
    for (const tier of [0, 3])
      for (const policy of arg('policies', 'random,recruits,near,lords').split(','))
        profiles.push({ rules, friendship, tier, policy });

const ACTS = ['act1', 'act2', 'act3', 'act4'];
const rows = [];
for (const p of profiles) {
  const results = [];
  for (let s = 1; s <= SEEDS; s++) results.push(runOnce(s, p));
  const at = (act, n) => results.filter((r) => (r.byAct[act] ?? 0) >= n).length / results.length;
  const mean = (act) => results.reduce((t, r) => t + (r.byAct[act] ?? 0), 0) / results.length;
  rows.push({
    ...p,
    meanAct1: mean('act1'),
    meanAct3: mean('act3'),
    meanAct4: mean('act4'),
    act1_4plus: at('act1', 4),
    act3_5plus: at('act3', 5),
    act3_6plus: at('act3', 6),
    act3_7: at('act3', 7),
    act4_7: at('act4', 7),
    dancer: results.filter((r) => r.dancer).length / results.length,
    lordsAndDancerAct3:
      results.filter((r) => r.dancer && (r.byAct.act3 ?? 0) >= 7).length / results.length,
  });
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
if (CSV) {
  console.log(Object.keys(rows[0]).join(','));
  for (const r of rows) console.log(Object.values(r).join(','));
} else {
  console.log(
    `difficulty ${DIFFICULTY}, ${SEEDS} seeds per profile (lords at end of act; ${ACTS.join('/')})`,
  );
  console.log(
    'rules    PoF HC policy   | mean A1  A3  A4 | 4+@A1  5+@A3  6+@A3  7@A3  7@A4 | dancer 7L+D@A3',
  );
  for (const r of rows) {
    console.log(
      [
        r.rules.padEnd(8),
        (r.friendship ? 'yes' : 'no').padEnd(3),
        String(r.tier).padEnd(2),
        r.policy.padEnd(8),
        '|',
        r.meanAct1.toFixed(2),
        r.meanAct3.toFixed(2),
        r.meanAct4.toFixed(2),
        '|',
        pct(r.act1_4plus).padStart(6),
        pct(r.act3_5plus).padStart(6),
        pct(r.act3_6plus).padStart(6),
        pct(r.act3_7).padStart(6),
        pct(r.act4_7).padStart(6),
        '|',
        pct(r.dancer).padStart(6),
        pct(r.lordsAndDancerAct3).padStart(6),
      ].join(' '),
    );
  }
}
