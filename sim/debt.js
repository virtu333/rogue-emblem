// sim/debt.js — what a Debt price should be (docs/specs/blessings-v3.md §3.1).
//
// A blessing priced in Debt replaces a percentage battle-gold cut. The two act on the same
// number: each victory's battle gold (RunManager.completeBattle `finalGold`, after its
// multipliers). A cut of X loses X of it in every battle; a Debt of D takes the rung's
// garnish (a half; a quarter on First Light) of it from the first battle until D is paid.
// This finds, per rung, the Debt whose cost equals each cut's, with gold weighted by when it
// is earned (late gold is worth less: runs end with gold unspent).
//
// Each victory's finalGold comes from invincible full runs (RunSimulationDriver): a probe Debt
// of 1e12 with garnish 1 takes all of it, the amount is read off and paid straight back, so
// the purse and every choice the agent makes are unchanged. The invincible agent is slow,
// so the Eclipse turns more nodes into elite fights late in its runs than a player sees:
// late gold reads high, which the act-weighted scenarios discount.
//
//   node sim/debt.js [--seeds 40] [--difficulty normal|dusk|hard|lunatic|all]
import { loadGameData } from '../tests/testData.js';
import { installSeed, restoreMathRandom } from './lib/SeededRNG.js';
import { RunSimulationDriver } from '../tests/sim/RunSimulationDriver.js';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SEEDS = Math.max(1, Number(arg('seeds', 40)));
const WHICH = arg('difficulty', 'all');
const RUNGS = WHICH === 'all' ? ['normal', 'dusk', 'hard', 'lunatic'] : [WHICH];

const ACT_INDEX = { act1: 0, act2: 1, act3: 2, act4: 3, finalBoss: 4 };
const ACT_WEIGHTS = [1, 0.7, 0.45, 0.3, 0.3];
// What one gold earned in battle t (1-based) of act index a is worth.
const SCENARIOS = {
  'All gold equal': () => 1,
  'Mild: -3% a battle': (t) => 0.97 ** (t - 1),
  'Steep: -7% a battle': (t) => 0.93 ** (t - 1),
  'By act: 1/.7/.45/.3': (t, a) => ACT_WEIGHTS[a],
};
const CUTS = [0.05, 0.1, 0.15, 0.2, 0.3];

async function battleGold(gameData, difficulty) {
  const runs = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    installSeed(seed);
    const driver = new RunSimulationDriver(gameData, {
      runOptions: { runSeed: seed, difficultyId: difficulty, autoSelectBlessing: false },
      invincibility: true,
      maxNodes: 300,
    });
    driver.init();
    const rm = driver.runManager;
    const complete = rm.completeBattle.bind(rm);
    const seq = [];
    rm.completeBattle = (survivors, nodeId, goldEarned, opts) => {
      const act = ACT_INDEX[rm.currentAct] ?? 4;
      const real = (rm.burdens || []).find((b) => b.id === 'debt') || null;
      rm.burdens = [
        ...(rm.burdens || []).filter((b) => b.id !== 'debt'),
        { id: 'debt', owed: 1e12, garnish: 1 },
      ];
      const result = complete(survivors, nodeId, goldEarned, opts);
      const probe = (rm.burdens || []).find((b) => b.id === 'debt');
      const gold = probe ? 1e12 - probe.owed : 0;
      rm.burdens = [...(rm.burdens || []).filter((b) => b.id !== 'debt'), ...(real ? [real] : [])];
      rm.gold += gold;
      seq.push({ gold, act });
      return result;
    };
    await driver.run();
    restoreMathRandom();
    runs.push(seq);
  }
  return runs;
}

function equivalents(runs, garnish) {
  const mean = (f) => runs.reduce((s, q) => s + f(q), 0) / runs.length;
  const debtCost = (D, w) =>
    mean((q) => {
      let left = D;
      let cost = 0;
      q.forEach((x, i) => {
        if (left <= 0) return;
        const pay = Math.min(Math.floor(x.gold * garnish), left);
        left -= pay;
        cost += pay * w(i + 1, x.act);
      });
      return cost;
    });
  const cutCost = (X, w) => mean((q) => q.reduce((s, x, i) => s + X * x.gold * w(i + 1, x.act), 0));
  const battlesToPay = (D) => {
    const counts = runs
      .map((q) => {
        let left = D;
        let k = 0;
        for (const x of q) {
          if (left <= 0) break;
          left -= Math.floor(x.gold * garnish);
          k++;
        }
        return left > 0 ? Infinity : k;
      })
      .sort((a, b) => a - b);
    return counts[counts.length >> 1];
  };
  const table = {};
  for (const [name, w] of Object.entries(SCENARIOS)) {
    const ceiling = debtCost(1e12, w);
    table[name] = CUTS.map((X) => {
      const target = cutCost(X, w);
      // A cut larger than the garnish can cost more than any Debt (First Light's -30%).
      if (target > ceiling) return { cut: X, debt: null, battles: null };
      let lo = 0;
      let hi = 1e6;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (debtCost(mid, w) < target) lo = mid;
        else hi = mid;
      }
      return { cut: X, debt: Math.round(lo / 50) * 50, battles: battlesToPay(lo) };
    });
  }
  return table;
}

const gameData = loadGameData();
for (const rung of RUNGS) {
  const def = gameData.difficulty?.modes?.[rung] || gameData.difficulty?.[rung] || {};
  const burden = gameData.events?.burdens?.debt || {};
  const garnish = burden.onRung?.[rung]?.garnish ?? burden.garnish ?? 0.5;
  const runs = await battleGold(gameData, rung);
  const battles = runs.reduce((s, q) => s + q.length, 0) / runs.length;
  const act1 =
    runs.reduce((s, q) => s + q.filter((x) => x.act === 0).reduce((a, x) => a + x.gold, 0), 0) /
    runs.length;
  const total = runs.reduce((s, q) => s + q.reduce((a, x) => a + x.gold, 0), 0) / runs.length;
  console.log(
    `\n${def.label || rung} (Debt garnish ${garnish}): ${runs.length} runs, ${battles.toFixed(1)} battles,` +
      ` battle gold ${Math.round(act1)} in Act 1, ${Math.round(total)} in the run`,
  );
  console.log('Debt with the same cost as a cut (battles to pay it off, median):');
  console.log('scenario'.padEnd(24) + CUTS.map((x) => `-${x * 100}%`.padStart(14)).join(''));
  for (const [name, cells] of Object.entries(equivalents(runs, garnish)))
    console.log(
      name.padEnd(24) +
        cells
          .map((c) => (c.debt == null ? 'n/a' : `${c.debt} (${c.battles})`).padStart(14))
          .join(''),
    );
}
