// sim/pacing.js — battle pacing by play style (docs/specs/dusk-pressure.md).
//
// Plays whole runs through the headless harness (RunSimulationDriver + HeadlessBattle,
// real maps, real par with wave bumps, real Eclipse commits) with one battle policy and
// reports turns against par, rating shares, waves that actually arrived, would-be KOs
// and the run's shadow.
//
//   node sim/pacing.js [--difficulty dusk] [--policy turtle|push|scripted] [--seeds 12]
//                      [--seed 1] [--maxActions 2600] [--csv]
//
// Policies:
//   turtle   TacticianAgent as shipped: bait-and-punish, holds the safest tile near the
//            squad and only advances after two turns without contact.
//   push     TacticianAgent that always advances (closes on the nearest foe every turn,
//            still scoring attacks, counters and landing danger the same way).
//   scripted the harness ScriptedAgent (charges one unit at a time; a slow, reckless player).
// Both Tactician policies play seize maps against the boss (TacticianAgent `objectives`;
// --seizeAgent 0 restores the ScriptedAgent fallback) and fall back to ScriptedAgent on
// escape maps, so escape rows measure the map, not the style.
//
// Player units are protected (HP floors at 1, as in sim:strategy's protected runs) so
// every run reaches the end; "KOs" counts the hits that would have killed a unit, the
// price of the style. The harness runs the same anti-turtle clock, boss enrage and
// hold wake rules as the battle (engine/TurnPressure.js, engine/HoldActivation.js).

import { loadGameData } from '../tests/testData.js';
import { installSeed, restoreMathRandom } from './lib/SeededRNG.js';
import { RunSimulationDriver } from '../tests/sim/RunSimulationDriver.js';
import { ScriptedAgent } from '../tests/agents/ScriptedAgent.js';
import { TacticianAgent } from './lib/TacticianAgent.js';
import { calculatePar, getRating } from '../src/engine/TurnBonusCalculator.js';
import { writeFileSync } from 'node:fs';
import { computeShadowGain, eclipsePhase } from '../src/engine/EclipseSystem.js';
import { parseArgs, printTable, printHeader, toCSV } from './lib/TableFormatter.js';
import { promoteUnit, resolvePromotionTargets } from '../src/engine/UnitManager.js';
import { gridDistance, parseRange } from '../src/engine/Combat.js';

const opts = parseArgs({
  difficulty: 'dusk',
  policy: 'turtle',
  seeds: 12,
  seed: 1,
  maxActions: 2600,
  csv: false,
  // docs/specs/dusk-pressure.md. The rout ladder, the rung's par inflation and Black Sun's
  // par-neutral template waves come from difficulty.json; these override them for a run:
  legacy: 0, // 1 = the pacing before the ladder (no ladder, inflation 3, waves raise par)
  holdRout: 0, // prototype (sim-only): share of a rout map's non-boss enemies that hold
  noHold: 0, // 1 = no seize/escape holders (difficulty.json holdShare off for the rung)
  seizeOffset: '', // override difficulty.json objectiveParOffset.seize for the rung
  seizeAgent: 1, // 0 = seize maps fall back to ScriptedAgent (the pre-PR 3 sims)
  parMult: '', // override turnBonus.difficultyParMultiplier[difficulty]
  inflation: '', // override difficulty.json parInflation for the rung
  out: '', // write every battle record as JSON lines (re-rate offline under other pars)
  // Calibration: +N to HP/STR/MAG/SKL/SPD/DEF/RES of every deployed unit for the battle
  // only, either one number or per act ("act1:0,act2:2,act3:5,act4:7"). The harness
  // player buys nothing, forges nothing and uses no items, so its army is far weaker than
  // a human's; the edge stands in for that gap (see the spec for the calibration).
  edge: '0',
});

const data = loadGameData();
if (opts.parMult !== '')
  data.turnBonus.difficultyParMultiplier[opts.difficulty] = Number(opts.parMult);
const rung = data.difficulty.modes[opts.difficulty];
if (Number(opts.legacy)) {
  rung.routLadder = null;
  rung.parInflation = null;
  rung.templateWavesRaisePar = true;
}
if (opts.inflation !== '') rung.parInflation = Number(opts.inflation);
if (Number(opts.noHold)) rung.holdShare = null;
if (opts.seizeOffset !== '')
  rung.objectiveParOffset = { ...(rung.objectiveParOffset || {}), seize: Number(opts.seizeOffset) };

/** Calibration edge for an act: a number, or "act1:0,act2:2,act3:6,act4:8". */
function edgeFor(act) {
  const raw = String(opts.edge ?? 0);
  if (!raw.includes(':')) return Math.max(0, Math.trunc(Number(raw) || 0));
  for (const part of raw.split(',')) {
    const [k, v] = part.split(':');
    if (k === act) return Math.max(0, Math.trunc(Number(v) || 0));
  }
  return 0;
}

function centroid(units) {
  const n = Math.max(1, units.length);
  return {
    col: units.reduce((a, u) => a + u.col, 0) / n,
    row: units.reduce((a, u) => a + u.row, 0) / n,
  };
}

/**
 * Hold AI prototype on rout maps: a holder waits until a player unit stands inside its
 * own threat area (real movement + max weapon range), it is hurt, or a holder within 3
 * tiles of it woke; then it hunts like everyone else for the rest of the battle.
 */
function installHold(battle, share) {
  const bc = battle.battleConfig;
  if (!(share > 0) || bc?.objective !== 'rout') return 0;
  const p = centroid(battle.playerUnits);
  const pool = battle.enemyUnits
    .filter((e) => !e.isBoss && !e.aiMode && e.weapon)
    .sort(
      (a, b) => gridDistance(b.col, b.row, p.col, p.row) - gridDistance(a.col, a.row, p.col, p.row),
    );
  const n = Math.round(pool.length * share);
  const holders = pool.slice(0, n);
  for (const h of holders) h._hold = true;
  const ai = battle.aiController;
  const decide = ai._decideAction.bind(ai);
  const threatened = (enemy) => {
    const positions = new Map();
    for (const u of battle.enemyUnits)
      if (u !== enemy) positions.set(`${u.col},${u.row}`, { faction: 'enemy' });
    const reach = battle.grid.getMovementRange(
      enemy.col,
      enemy.row,
      enemy.mov ?? enemy.stats?.MOV,
      enemy.moveType,
      positions,
      'enemy',
    );
    const { max } = parseRange(enemy.weapon.range);
    const tiles = [{ col: enemy.col, row: enemy.row }];
    for (const k of reach.keys()) {
      const [c, r] = k.split(',').map(Number);
      tiles.push({ col: c, row: r });
    }
    return battle.playerUnits.some((u) =>
      tiles.some((t) => gridDistance(t.col, t.row, u.col, u.row) <= max),
    );
  };
  ai._decideAction = (enemy, allEnemies, playerUnits, npcUnits) => {
    if (enemy._hold) {
      const woke = enemy.currentHP < enemy.stats.HP || threatened(enemy);
      if (woke) {
        enemy._hold = false;
        for (const mate of battle.enemyUnits)
          if (mate._hold && gridDistance(mate.col, mate.row, enemy.col, enemy.row) <= 3)
            mate._hold = false;
      } else {
        return { path: null, target: null, reason: 'hold' };
      }
    }
    return decide(enemy, allEnemies, playerUnits, npcUnits);
  };
  return n;
}

const EDGE_STATS = ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES'];

class PushAgent extends TacticianAgent {
  _planFor(u, threats) {
    return super._planFor(u, threats, true);
  }
}

function makeAgent(driver) {
  if (opts.policy === 'scripted') return new ScriptedAgent(driver);
  const objectives = Number(opts.seizeAgent) !== 0;
  if (opts.policy === 'push') return new PushAgent(driver, { rescue: true, objectives });
  return new TacticianAgent(driver, { rescue: true, objectives });
}

class PacingDriver extends RunSimulationDriver {
  constructor(gameData, options) {
    super(gameData, { ...options, invincibility: true });
    this.battles = [];
  }

  async _runBattleNode(node) {
    // A real player tops up between fights (Vulneraries, staves, churches) and promotes
    // with a Master Seal at level 15+; the harness player can do neither (sim:strategy
    // does the same), so without this HP attrition, not play style, sets the pace.
    const rm = this.runManager;
    for (const u of [...rm.roster].sort((a, b) => Number(b.isLord) - Number(a.isLord))) {
      if (u.tier === 'promoted' || (u.level || 1) < 15 || rm.gold < 2500) continue;
      const target = resolvePromotionTargets(u, this.gameData.classes, this.gameData.lords)?.[0];
      if (!target) continue;
      const bonuses =
        this.gameData.lords.find((l) => l.name === u.name)?.promotionBonuses ||
        target.promotionBonuses;
      if (!bonuses || !rm.spendGold(2500)) continue;
      promoteUnit(u, target, bonuses, this.gameData.skills);
    }
    for (const u of rm.roster) u.currentHP = u.stats.HP;
    const before = this.battles.length;
    const res = await super._runBattleNode(node);
    // A battle that ran out of actions is force-won by the protected driver; keep it out
    // of the turn statistics (it measures the harness agent, not the map).
    if (res?.result === 'victory_timeout_forced' && this.battles.length > before)
      this.battles[this.battles.length - 1].forced = true;
    return res;
  }

  _enableInvincibilityIfConfigured(driver) {
    const battle = driver.battle;
    const edge = edgeFor(this.runManager.currentAct);
    if (edge) {
      for (const u of battle.playerUnits) {
        for (const k of EDGE_STATS) u.stats[k] = (u.stats[k] || 0) + edge;
        u.currentHP += edge;
        u._simEdge = edge;
      }
    }
    const record = {
      act: this.runManager.currentAct,
      objective: battle.battleConfig?.objective,
      template: battle.battleConfig?.templateId || '',
      parStart: battle.turnPar,
      enemiesStart: battle.enemyUnits.length,
      // Par before inflation, difficulty multiplier and template bonus (offline re-rating).
      rawPar: calculatePar(
        {
          cols: battle.battleConfig.cols,
          rows: battle.battleConfig.rows,
          enemyCount: battle.enemyUnits.length,
          objective: battle.battleConfig.objective,
          mapLayout: battle.battleConfig.mapLayout,
          terrainData: this.gameData.terrain,
          parBonus: 0,
        },
        { ...this.gameData.turnBonus, parInflation: 0, difficultyParMultiplier: {} },
        null,
      ),
      parBonus: battle.battleConfig.parBonus || 0,
      hasWaves: Boolean(
        battle.battleConfig?.reinforcements?.waves?.length ||
        battle.battleConfig?.reinforcements?.scriptedWaves?.length,
      ),
      hasRepeating: Boolean(battle.battleConfig?.reinforcements?.repeatingWaves?.length),
      wavesArrived: 0,
      reinfUnits: 0,
      kos: 0,
      guards: battle.enemyUnits.filter((e) => e.aiMode === 'guard').length,
      holdersStart: battle.enemyUnits.filter((e) => e.aiMode === 'hold').length,
      edge,
    };
    record.ladder = Boolean(battle.battleConfig?.reinforcements?.ladder?.waves?.length);
    record.holders = installHold(battle, Number(opts.holdRout) || 0);
    if (record.ladder) record.hasWaves = true;
    this._current = record;
    const originalRemove = battle._removeUnit.bind(battle);
    battle._removeUnit = (unit) => {
      if (unit?.faction === 'player') {
        record.kos++;
        unit.currentHP = Math.max(1, unit.currentHP || 1);
        return;
      }
      originalRemove(unit);
    };
    const originalApply = battle._applyReinforcementsForTurn.bind(battle);
    battle._applyReinforcementsForTurn = (turn) => {
      const before = battle.enemyUnits.length;
      const result = originalApply(turn);
      const added = battle.enemyUnits.length - before;
      if (added > 0) {
        record.reinfUnits += added;
        const waves = new Set(
          (result?.spawns || []).map((s) => `${s.waveType || 'p'}:${s.waveIndex}`),
        );
        record.wavesArrived += waves.size;
      }
      return result;
    };
    this._patchPlayerHP(driver);
  }

  _completeBattle(driver, merged, node) {
    for (const u of merged) {
      if (!u._simEdge) continue;
      for (const k of EDGE_STATS) u.stats[k] -= u._simEdge;
      u.currentHP = Math.max(1, Math.min(u.stats.HP, u.currentHP - u._simEdge));
      delete u._simEdge;
    }
    const r = this._current;
    const turns = driver.battle.turnManager?.turnNumber || 0;
    const par = Number.isFinite(driver.battle.turnPar) ? driver.battle.turnPar : null;
    if (r) {
      r.turns = turns;
      r.parEnd = par;
      r.rating = par == null ? '-' : getRating(turns, par, data.turnBonus).rating;
      r.shadow = computeShadowGain(
        { turnsTaken: turns, par, difficultyId: this.runManager.difficultyId },
        data.eclipse,
      );
      r.isBoss = node.type === 'boss';
      this.battles.push(r);
      this._current = null;
    }
    return super._completeBattle(driver, merged, node);
  }
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const r1 = (x) => Math.round(x * 10) / 10;
const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);

function summarize(label, battles) {
  const n = battles.length;
  const count = (k) => battles.filter((b) => b.rating === k).length;
  return {
    group: label,
    n,
    turns: r1(mean(battles.map((b) => b.turns))),
    'turns p50': median(battles.map((b) => b.turns)),
    par: r1(mean(battles.map((b) => b.parEnd ?? 0))),
    'turns-par': r1(mean(battles.map((b) => b.turns - (b.parEnd ?? b.turns)))),
    'S%': pct(count('S'), n),
    'A%': pct(count('A'), n),
    'B%': pct(count('B'), n),
    'C%': pct(count('C'), n),
    shadow: r1(mean(battles.map((b) => b.shadow))),
    'waves/btl': r1(mean(battles.map((b) => b.wavesArrived))),
    'wavesCfg%': pct(battles.filter((b) => b.hasWaves).length, n),
    'KOs/btl': r1(mean(battles.map((b) => b.kos))),
    'reinf/btl': r1(mean(battles.map((b) => b.reinfUnits))),
  };
}

function clean(battles) {
  return battles.filter((b) => !b.forced);
}

async function main() {
  const runs = [];
  const all = [];
  for (let seed = opts.seed; seed < opts.seed + opts.seeds; seed++) {
    installSeed(seed);
    let driver;
    let result;
    try {
      driver = new PacingDriver(data, {
        runOptions: { runSeed: seed, difficultyId: opts.difficulty, autoSelectBlessing: false },
        maxBattleActions: opts.maxActions,
        battleAgentFactory: (d) => makeAgent(d),
      });
      result = await driver.run();
    } finally {
      restoreMathRandom();
    }
    const battles = driver.battles;
    all.push(...battles);
    const shadow = driver.runManager.eclipse?.shadow ?? 0;
    runs.push({
      seed,
      result: result.result,
      battles: battles.length,
      turns: battles.reduce((s, b) => s + b.turns, 0),
      shadow,
      phase: eclipsePhase(shadow, data.eclipse).name,
      kos: battles.reduce((s, b) => s + b.kos, 0),
      // Shadow the force-won battles added (the harness agent's stalls, not the map).
      forcedShadow: battles.filter((b) => b.forced).reduce((s, b) => s + b.shadow, 0),
    });
    if (!opts.csv) {
      const last = runs.at(-1);
      console.error(
        `seed ${seed}: ${last.result} battles ${last.battles} turns ${last.turns} shadow ${last.shadow} (${last.phase}) KOs ${last.kos}`,
      );
    }
  }

  if (opts.out) {
    writeFileSync(
      opts.out,
      all
        .map((b) => JSON.stringify({ difficulty: opts.difficulty, policy: opts.policy, ...b }))
        .join('\n') + '\n',
    );
  }
  if (opts.csv) {
    const rows = all.map((b) => ({ difficulty: opts.difficulty, policy: opts.policy, ...b }));
    toCSV(Object.keys(rows[0] || {}), rows);
    return;
  }

  const knobs = [
    Number(opts.holdRout) ? `holdRout ${opts.holdRout}` : '',
    opts.parMult !== '' ? `parMult ${opts.parMult}` : '',
    opts.inflation !== '' ? `inflation ${opts.inflation}` : '',
    String(opts.edge) !== '0' ? `edge ${opts.edge}` : '',
    Number(opts.legacy) ? 'legacy pacing (no ladder)' : '',
  ]
    .filter(Boolean)
    .join(', ');
  printHeader(
    `Pacing — ${opts.difficulty}, policy ${opts.policy}, ${opts.seeds} runs${knobs ? ` (${knobs})` : ''}`,
  );
  const forced = all.filter((b) => b.forced).length;
  const played = clean(all);
  const rows = [summarize('ALL', played)];
  for (const obj of ['rout', 'seize', 'escape']) {
    const sub = played.filter((b) => b.objective === obj);
    if (sub.length) rows.push(summarize(obj, sub));
  }
  for (const act of ['act1', 'act2', 'act3', 'act4', 'finalBoss']) {
    const sub = played.filter((b) => b.act === act && b.objective === 'rout');
    if (sub.length) rows.push(summarize(`${act} rout`, sub));
  }
  const waved = played.filter((b) => b.objective === 'rout' && b.hasWaves);
  if (waved.length) rows.push(summarize('rout w/ waves', waved));
  printTable(Object.keys(rows[0]), rows);

  const shadows = runs.map((r) => r.shadow);
  const netShadows = runs.map((r) => Math.max(0, r.shadow - r.forcedShadow));
  const forcedBy = {};
  for (const b of all.filter((x) => x.forced))
    forcedBy[b.objective] = (forcedBy[b.objective] || 0) + 1;
  const phases = {};
  for (const r of runs) phases[r.phase] = (phases[r.phase] || 0) + 1;
  console.log(
    `\nRuns: ${runs.length}, victories ${runs.filter((r) => r.result === 'victory').length}; ` +
      `battles/run ${r1(mean(runs.map((r) => r.battles)))}; turns/run ${r1(mean(runs.map((r) => r.turns)))}; ` +
      `final shadow mean ${r1(mean(shadows))} (min ${Math.min(...shadows)}, max ${Math.max(...shadows)}); ` +
      `phases ${JSON.stringify(phases)}; would-be KOs/run ${r1(mean(runs.map((r) => r.kos)))}; ` +
      `forced (action budget) battles excluded from the table: ${forced} ${JSON.stringify(forcedBy)}; ` +
      `final shadow net of forced battles ${r1(mean(netShadows))} ` +
      `(Pale ${netShadows.filter((x) => x < 25).length}, Waning ${netShadows.filter((x) => x >= 25 && x < 50).length}, ` +
      `Umbral ${netShadows.filter((x) => x >= 50 && x < 75).length}, Totality+ ${netShadows.filter((x) => x >= 75).length})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
