// Deeds & Epithets — award rates over seeded full runs (headless battles).
// Usage: node sim/deeds.js [--seeds N] [--seed-start S] [--difficulty normal|hard|lunatic]
//                          [--invincibility] [--csv]
//
// Runs the real run loop (RunSimulationDriver + ScriptedAgent). HeadlessBattle
// records deeds at the same outcome sites as BattleScene and commits them at
// each victory, so the tallies here are what a scripted army would earn.
// Reports, per deed: the share of runs where any unit earned it, the mean
// number of units earning it per run, and the median battle it first landed.

import { loadGameData } from '../tests/testData.js';
import { installSeed, restoreMathRandom } from './lib/SeededRNG.js';
import { RunSimulationDriver } from '../tests/sim/RunSimulationDriver.js';
import { earnedDeeds, promotionOath, unitEpithet } from '../src/engine/DeedSystem.js';

function parse(argv) {
  const opts = { seeds: 30, seedStart: 1, difficulty: 'normal', invincibility: false, csv: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seeds') opts.seeds = Number(argv[++i]);
    else if (a === '--seed-start') opts.seedStart = Number(argv[++i]);
    else if (a === '--difficulty') opts.difficulty = argv[++i];
    else if (a === '--invincibility') opts.invincibility = true;
    else if (a === '--csv') opts.csv = true;
  }
  return opts;
}

// The shared driver's invincibility shim drops the killer when it forwards a
// removal; deeds need it (kills, bosses, terrain), so this sim forwards it.
class DeedSimDriver extends RunSimulationDriver {
  _enableInvincibilityIfConfigured(driver) {
    if (!this.options.invincibility) return;
    const battle = driver.battle;
    const originalRemove = battle._removeUnit.bind(battle);
    battle._removeUnit = (unit, options) => {
      if (unit?.faction === 'player') {
        unit.currentHP = Math.max(1, unit.currentHP || 1);
        return;
      }
      originalRemove(unit, options);
    };
    this._patchPlayerHP(driver);
  }
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

async function main() {
  const opts = parse(process.argv.slice(2));
  const gameData = loadGameData();
  const ids = gameData.deeds.deeds.map((d) => d.id);
  const perDeed = new Map(ids.map((id) => [id, { runs: 0, units: 0, firstBattle: [] }]));
  const summary = {
    runs: 0,
    victories: 0,
    battles: 0,
    deeds: 0,
    titledUnits: 0,
    units: 0,
    oathReady: 0,
  };
  // The simulator's own console chatter is not part of the report.
  const quiet = { log: console.log, warn: console.warn, info: console.info };
  for (let seed = opts.seedStart; seed < opts.seedStart + opts.seeds; seed++) {
    installSeed(seed);
    console.log = console.warn = console.info = () => {};
    let driver;
    let result;
    try {
      driver = new DeedSimDriver(gameData, {
        runOptions: { runSeed: seed, difficultyId: opts.difficulty, autoSelectBlessing: false },
        invincibility: opts.invincibility,
      });
      result = await driver.run();
    } finally {
      Object.assign(console, quiet);
      restoreMathRandom();
    }
    const rm = driver.runManager;
    const units = [...rm.roster, ...rm.fallenUnits];
    summary.runs++;
    if (result.result === 'victory') summary.victories++;
    summary.battles += rm.completedBattles || 0;
    summary.units += units.length;
    const seen = new Set();
    for (const unit of units) {
      const earned = earnedDeeds(unit);
      summary.deeds += earned.length;
      if (unitEpithet(unit)) summary.titledUnits++;
      if (unit.tier !== 'promoted' && promotionOath(unit, gameData.deeds, gameData.skills))
        summary.oathReady++;
      for (const entry of earned) {
        const row = perDeed.get(entry.id);
        if (!row) continue;
        row.units++;
        if (!seen.has(entry.id)) {
          seen.add(entry.id);
          row.runs++;
        }
        if (Number.isFinite(entry.awardedAt?.battle)) row.firstBattle.push(entry.awardedAt.battle);
      }
    }
  }
  const n = Math.max(1, summary.runs);
  const rows = ids.map((id) => {
    const r = perDeed.get(id);
    return {
      deed: id,
      runsPct: Math.round((100 * r.runs) / n),
      unitsPerRun: (r.units / n).toFixed(2),
      medianBattle: median(r.firstBattle) ?? '-',
    };
  });
  if (opts.csv) {
    console.log('deed,runsPct,unitsPerRun,medianBattle');
    for (const r of rows) console.log(`${r.deed},${r.runsPct},${r.unitsPerRun},${r.medianBattle}`);
    return;
  }
  console.log(
    `Deeds sim — ${summary.runs} runs (${opts.difficulty}${opts.invincibility ? ', invincible' : ''}), ` +
      `seeds ${opts.seedStart}-${opts.seedStart + opts.seeds - 1}`,
  );
  console.log(
    `victories ${summary.victories}/${summary.runs} · mean battles won ${(summary.battles / n).toFixed(1)} · ` +
      `deeds/run ${(summary.deeds / n).toFixed(2)} · titled units/run ${(summary.titledUnits / n).toFixed(2)} ` +
      `of ${(summary.units / n).toFixed(1)} · base units with an Oath waiting ${(summary.oathReady / n).toFixed(2)}`,
  );
  console.log('');
  console.log('deed               runs%  units/run  median battle');
  for (const r of rows)
    console.log(
      `${r.deed.padEnd(18)} ${String(r.runsPct).padStart(5)}  ${r.unitsPerRun.padStart(9)}  ${String(r.medianBattle).padStart(13)}`,
    );
}

main();
