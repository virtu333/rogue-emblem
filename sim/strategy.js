// sim/strategy.js — strategic-layer audit (docs/specs/strategy-layer.md, method and
// numbers; docs/specs/strategy-layer-proposal.md, proposals).
//
//   npm run sim:strategy -- --section <name> [--seeds N] [--seed S] [--difficulty normal]
//
//   spawn      recruit survival vs spawn placement      [--replays 4]
//   unitvalue  one more unit vs other node rewards      [--trials 60; the spec used 150]
//   route      recruit-first vs other routing policies  [--policies recruit,battle,church] [--muster N]
//   graph      recruit nodes and services per route (generated node maps)
//   blessings  blessing and price power                 [--candidates 1-4] [--only id,…]
//   arts       what Scroll Archive can hand out on day one
//
// Battles are played by TacticianAgent (sim/lib/TacticianAgent.js; --agent scripted for
// the stock harness agent) with casual-mode KOs; see the spec for the method's limits.
//
// spawn: recruit survival. Real node maps and real rosters come from invincible
//   full runs (RunSimulationDriver, recruit-first routing, RescueAgent battles), which
//   capture every recruit battle's entry state. Each capture is then replayed with
//   fresh battle seeds by two players: RescueAgent (lords walk to the recruit and Talk)
//   and the stock ScriptedAgent (never goes for the recruit). Player units are
//   invincible in both so the only question is whether the recruit lives; the recruit
//   itself is never protected. Geometry is measured on the generated map: the lord's
//   real path cost to a tile beside the recruit, and how many foes can hit the
//   recruit in the first enemy phase.

import { loadGameData } from '../tests/testData.js';
import { installSeed, restoreMathRandom } from './lib/SeededRNG.js';
import { RunSimulationDriver } from '../tests/sim/RunSimulationDriver.js';
import { GameDriver } from '../tests/harness/GameDriver.js';
import { ScriptedAgent } from '../tests/agents/ScriptedAgent.js';
import { RescueAgent, distanceFieldToAdjacent } from './lib/RescueAgent.js';
import { TacticianAgent } from './lib/TacticianAgent.js';
import { NODE_TYPES } from '../src/utils/constants.js';
import { isInRange } from '../src/engine/Combat.js';
import { parseArgs, printTable, printHeader } from './lib/TableFormatter.js';

const opts = parseArgs({
  section: 'spawn',
  seeds: 30,
  replays: 4,
  difficulty: 'normal',
  seed: 1,
  maxActions: 2600,
  agent: 'tactician',
});

const gameData = loadGameData();

/**
 * Battle player. `tactician` (default) is a careful human-like player; `scripted` is the
 * harness's reckless charger. `rescue` = goes for the recruit; otherwise ignores it.
 */
function makeAgent(driver, rescue) {
  if (opts.agent === 'scripted')
    return rescue ? new RescueAgent(driver) : new ScriptedAgent(driver);
  return new TacticianAgent(driver, { rescue });
}

function hash32(text) {
  let h = 2166136261 >>> 0;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h >>> 0;
}

/** Battle params the harness needs to spawn the recruit the Loom previews. */
function recruitParams(rm, node) {
  const ctx = rm.getRecruitBattleContext(node);
  return {
    recruitNodeId: ctx.nodeId,
    recruitRunSeed: ctx.runSeed,
    recruitRoster: structuredClone(ctx.roster),
    startingLordNames: ctx.startingLordNames,
    recruitLevelBonus: ctx.recruitLevelBonus,
    deployBonus: ctx.deployBonus,
  };
}

function pct(n, d) {
  return d > 0 ? Math.round((1000 * n) / d) / 10 : 0;
}
function mean(xs) {
  return xs.length ? Math.round((100 * xs.reduce((s, x) => s + x, 0)) / xs.length) / 100 : 0;
}

// ---------------------------------------------------------------------------
// Capture: run invincible recruit-first runs and record every recruit battle.

class CapturingDriver extends RunSimulationDriver {
  constructor(data, options) {
    super(data, options);
    this.captures = [];
  }
  async _runBattleNode(node) {
    if (node.type === NODE_TYPES.RECRUIT) {
      const params = this.runManager.getBattleParams(node) || {};
      params.metaEffects = structuredClone(this.runManager.getEffectiveMetaEffects?.() ?? null);
      params.fallenUnits = structuredClone(this.runManager.fallenUnits || []);
      Object.assign(params, recruitParams(this.runManager, node));
      this.captures.push({
        act: this.runManager.currentAct,
        nodeId: node.id,
        row: node.row,
        params,
        roster: structuredClone(this.runManager.getRoster()),
        deployBonus: this.runManager.getDeployBonus(),
      });
    }
    return super._runBattleNode(node);
  }
}

async function captureRecruitBattles(seeds, difficulty) {
  const all = [];
  for (let seed = opts.seed; seed < opts.seed + seeds; seed++) {
    installSeed(seed);
    try {
      const driver = new CapturingDriver(gameData, {
        runOptions: { runSeed: seed, difficultyId: difficulty, autoSelectBlessing: false },
        invincibility: true,
        maxBattleActions: opts.maxActions,
        battleAgentFactory: (d) => makeAgent(d, true),
      });
      await driver.run();
      for (const c of driver.captures) all.push({ ...c, runSeed: seed });
    } finally {
      restoreMathRandom();
    }
  }
  return all;
}

// ---------------------------------------------------------------------------
// Replay one capture.

import { DEPLOY_LIMITS } from '../src/utils/constants.js';
import { chooseDeployRoster } from '../tests/sim/RunPolicies.js';

function deployFor(capture) {
  const limits = DEPLOY_LIMITS[capture.act] || { min: 1, max: 4 };
  const max = Math.max(1, Math.min(capture.roster.length, limits.max + capture.deployBonus));
  const count = Math.min(Math.max(limits.min, max), capture.roster.length);
  return { count, units: chooseDeployRoster(capture.roster, count).map((u) => structuredClone(u)) };
}

/** Foes that can attack `target` in enemy phase 1 (real movement, units ignored). */
function firstPhaseThreats(battle, target) {
  let count = 0;
  for (const enemy of battle.enemyUnits) {
    if (!enemy.weapon) continue;
    const range = battle.grid.getMovementRange(enemy.col, enemy.row, enemy.mov, enemy.moveType);
    let hits = false;
    for (const key of range.keys()) {
      const [c, r] = key.split(',').map(Number);
      const d = Math.abs(c - target.col) + Math.abs(r - target.row);
      if (d > 0 && isInRange(enemy.weapon, d)) {
        hits = true;
        break;
      }
    }
    if (hits) count++;
  }
  return count;
}

async function replay(capture, replayIndex, agentKind) {
  const params = structuredClone(capture.params);
  const deploy = deployFor(capture);
  params.deployCount = deploy.count;
  const seed = hash32(`${capture.runSeed}:${capture.nodeId}:${replayIndex}`);
  params.battleSeed = seed;
  installSeed(seed);
  try {
    const driver = new GameDriver(gameData, params, deploy.units);
    driver.init();
    const b = driver.battle;
    const npc0 = b.npcUnits[0];
    if (!npc0) return null;
    // Geometry at spawn.
    const lords = b.playerUnits.filter((u) => u.isLord);
    let best = { cost: Infinity, mov: 5 };
    for (const lord of lords) {
      const field = distanceFieldToAdjacent(b.grid, npc0, lord.moveType);
      const c = field.get(`${lord.col},${lord.row}`) ?? Infinity;
      if (c < best.cost) best = { cost: c, mov: lord.stats.MOV };
    }
    const turnsToReach = Number.isFinite(best.cost)
      ? Math.max(1, Math.ceil(best.cost / best.mov))
      : 99;
    const threats = firstPhaseThreats(b, npc0);
    // Player invincibility (the recruit is not protected).
    const originalRemove = b._removeUnit.bind(b);
    let npcDiedTurn = null;
    let recruitedTurn = null;
    b._removeUnit = (unit, o) => {
      if (unit?.faction === 'player') {
        unit.currentHP = Math.max(1, unit.currentHP || 1);
        return;
      }
      if (unit?.faction === 'npc' && npcDiedTurn === null)
        npcDiedTurn = b.turnManager?.turnNumber || 0;
      originalRemove(unit, o);
    };
    const originalTalk = b._executeTalk.bind(b);
    b._executeTalk = (lord, npc) => {
      recruitedTurn = b.turnManager?.turnNumber || 0;
      originalTalk(lord, npc);
    };
    const agent = makeAgent(driver, agentKind === 'rescue');
    for (let i = 0; i < opts.maxActions && !driver.isTerminal(); i++) {
      if (recruitedTurn !== null || npcDiedTurn !== null) break;
      const legal = driver.listLegalActions();
      if (!legal.length) break;
      const action = agent.chooseAction(legal);
      if (!action) break;
      await driver.step(action);
      for (const u of b.playerUnits) if (u.currentHP <= 0) u.currentHP = 1;
    }
    return {
      act: capture.act,
      recruited: recruitedTurn !== null,
      recruitedTurn,
      died: npcDiedTurn !== null,
      diedTurn: npcDiedTurn,
      cost: best.cost,
      turnsToReach,
      threats,
      npcClass: npc0.className,
      npcLevel: npc0.level,
      cols: b.battleConfig.cols,
      npcColFrac: npc0.col / Math.max(1, b.battleConfig.cols - 1),
    };
  } finally {
    restoreMathRandom();
  }
}

async function sectionSpawn() {
  printHeader(
    `Recruit survival — ${opts.seeds} runs × ${opts.replays} replays (${opts.difficulty})`,
  );
  const captures = await captureRecruitBattles(opts.seeds, opts.difficulty);
  const rows = [];
  const byAct = new Map();
  for (const cap of captures) {
    for (let r = 0; r < opts.replays; r++) {
      for (const kind of ['rescue', 'ignore']) {
        const res = await replay(cap, r, kind);
        if (!res) continue;
        const k = `${res.act}|${kind}`;
        if (!byAct.has(k)) byAct.set(k, []);
        byAct.get(k).push(res);
      }
    }
  }
  const acts = [...new Set(captures.map((c) => c.act))];
  for (const act of acts) {
    for (const kind of ['rescue', 'ignore']) {
      const list = byAct.get(`${act}|${kind}`) || [];
      if (!list.length) continue;
      const turn1Deaths = list.filter((x) => x.died && x.diedTurn <= 1).length;
      rows.push({
        act,
        player: kind,
        n: list.length,
        'recruited%': pct(list.filter((x) => x.recruited).length, list.length),
        'died%': pct(list.filter((x) => x.died).length, list.length),
        'diedT1%': pct(turn1Deaths, list.length),
        pathCost: mean(list.map((x) => x.cost).filter(Number.isFinite)),
        turnsToReach: mean(list.map((x) => x.turnsToReach)),
        'reachT1%': pct(list.filter((x) => x.turnsToReach <= 1).length, list.length),
        'reachT3+%': pct(list.filter((x) => x.turnsToReach >= 3).length, list.length),
        threatsT1: mean(list.map((x) => x.threats)),
        'thr>=2%': pct(list.filter((x) => x.threats >= 2).length, list.length),
        colFrac: mean(list.map((x) => x.npcColFrac)),
      });
    }
  }
  printTable(
    [
      'act',
      'player',
      'n',
      'recruited%',
      'died%',
      'diedT1%',
      'pathCost',
      'turnsToReach',
      'reachT1%',
      'reachT3+%',
      'threatsT1',
      'thr>=2%',
      'colFrac',
    ],
    rows,
  );
  // Death rate by turns-to-reach (rescue player only).
  const buckets = [];
  for (const [label, test] of [
    ['reach T1', (x) => x.turnsToReach <= 1],
    ['reach T2', (x) => x.turnsToReach === 2],
    ['reach T3', (x) => x.turnsToReach === 3],
    ['reach T4+', (x) => x.turnsToReach >= 4],
  ]) {
    const list = [...byAct.entries()]
      .filter(([k]) => k.endsWith('|rescue'))
      .flatMap(([, v]) => v)
      .filter(test);
    buckets.push({
      bucket: label,
      n: list.length,
      'recruited%': pct(list.filter((x) => x.recruited).length, list.length),
      'died%': pct(list.filter((x) => x.died).length, list.length),
      threatsT1: mean(list.map((x) => x.threats)),
    });
  }
  printTable(['bucket', 'n', 'recruited%', 'died%', 'threatsT1'], buckets, {
    title: 'Rescue outcome by lord turns-to-reach',
  });
}

// ---------------------------------------------------------------------------
// Commander-protected runs: the commander cannot die (a lethal hit is counted as a
// run loss and the commander is restored), every other unit has real permadeath.
// "Commander KOs" per act is the survival measure: a run with zero commander KOs is a
// run the scripted player would have won.

import {
  generateMercenaryCandidates,
  grantMercenaryClassSkills,
} from '../src/engine/ColosseumEngine.js';
import { resolveRecruitScalingTargets } from '../src/engine/RecruitScaling.js';
import { generateBossRecruitCandidates } from '../src/engine/BossRecruitSystem.js';
import { findCommander } from '../src/engine/Commander.js';

import { buildRecruitNodeUnit } from '../src/engine/RecruitNodeSystem.js';

const POLICY_PRIORITY = {
  recruit: ['recruit', 'battle', 'colosseum', 'shop', 'church', 'ruins', 'boss'],
  battle: ['battle', 'shop', 'colosseum', 'church', 'recruit', 'ruins', 'boss'],
  shop: ['shop', 'colosseum', 'battle', 'church', 'recruit', 'ruins', 'boss'],
  church: ['church', 'shop', 'colosseum', 'battle', 'recruit', 'ruins', 'boss'],
  // Services are never entered; take fights only (recruit last).
  fights: ['battle', 'recruit', 'shop', 'colosseum', 'church', 'ruins', 'boss'],
};

function policyChooser(policy) {
  const order = POLICY_PRIORITY[policy];
  return (available) =>
    [...available].sort((a, b) => {
      const ra = order.indexOf(a.type);
      const rb = order.indexOf(b.type);
      if (ra !== rb) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
      return (b.row || 0) - (a.row || 0);
    })[0];
}

class ProtectedDriver extends RunSimulationDriver {
  constructor(data, options) {
    super(data, { ...options, invincibility: true });
    this.policy = options.policy || 'recruit';
    this.chooser = policyChooser(this.policy);
    this.actStats = {};
    this.captures = [];
    this.capture = options.capture || null;
  }
  init() {
    super.init();
    this.options.onInit?.(this.runManager);
  }
  _act() {
    const a = this.runManager.currentAct;
    this.actStats[a] ||= {
      commanderKOs: 0,
      unitKOs: 0,
      battles: 0,
      turns: 0,
      recruitNodes: 0,
      recruitsJoined: 0,
      recruitsLost: 0,
      mercsHired: 0,
      mercGold: 0,
      churchVisits: 0,
      churchHpRestored: 0,
      churchHpPct: [],
      churchRevives: 0,
      churchPromotions: 0,
      shopVisits: 0,
      shopSpent: 0,
      goldEnd: 0,
      rosterEnd: 0,
      deploySlotsEmpty: 0,
    };
    return this.actStats[a];
  }

  /**
   * Proposal A (--muster N): a guaranteed, unseasoned recruit joins once the act's
   * N-th node is done, in acts 1 and 2 (docs/specs/strategy-layer-proposal.md).
   */
  _maybeMuster() {
    const after = Number(opts.muster) || 0;
    const rm = this.runManager;
    if (!after || !['act1', 'act2'].includes(rm.currentAct)) return;
    this._mustered ||= new Set();
    if (this._mustered.has(rm.currentAct)) return;
    const done = rm.nodeMap.nodes.filter((n) => n.completed).length;
    if (done < after || rm.roster.length >= rm.getRosterCap()) return;
    this._mustered.add(rm.currentAct);
    const pool = this.gameData.recruits?.[rm.currentAct]?.classPool || [];
    if (!pool.length) return;
    const className = pool[hash32(`muster:${rm.runSeed}:${rm.currentAct}`) % pool.length];
    const built = buildRecruitNodeUnit({
      preview: { className, name: `Muster ${rm.currentAct}` },
      nodeId: `muster-${rm.currentAct}`,
      runSeed: rm.runSeed,
      act: rm.currentAct,
      roster: rm.roster,
      fallenUnits: rm.fallenUnits,
      gameData: this.gameData,
      metaEffects: rm.getEffectiveMetaEffects(),
      startingLordNames: rm.getStartingLordNames(),
      seasoned: false,
    });
    if (!built?.unit || built.isLord) return;
    built.unit.faction = 'player';
    rm.roster.push(built.unit);
    this._act().mustered = (this._act().mustered || 0) + 1;
  }

  async run() {
    if (!this.runManager) this.init();
    for (let step = 0; step < this.options.maxNodes; step++) {
      if (this.runManager.isRunComplete()) return this._buildResult('victory');
      this._maybeMuster();
      const available = this.runManager.getAvailableNodes();
      if (!available?.length) return this._buildResult('stuck');
      const node = this.chooser(available);
      this.metrics.nodesVisited++;
      let res;
      if (['battle', 'boss', 'recruit'].includes(node.type)) res = await this._runBattleNode(node);
      else if (node.type === 'shop') res = await this._runShopNode(node);
      else if (node.type === 'church') res = this._runChurchNode(node);
      else if (node.type === 'colosseum') res = this._runColosseumNode(node);
      else {
        this.runManager.markNodeComplete(node.id);
        res = { result: 'skipped' };
      }
      this.trace.push({ act: this.runManager.currentAct, nodeType: node.type, ...res });
      if (res.result === 'defeat' || res.result === 'timeout') return this._buildResult(res.result);
      if (this.runManager.isActComplete()) {
        const s = this._act();
        s.goldEnd = this.runManager.gold;
        s.rosterEnd = this.runManager.roster.length;
        {
          const cap =
            (DEPLOY_LIMITS[this.runManager.currentAct]?.max || 6) +
            this.runManager.getDeployBonus();
          const top = [...this.runManager.roster]
            .map((u) =>
              ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'].reduce(
                (acc, k) => acc + (u.stats?.[k] || 0),
                0,
              ),
            )
            .sort((a, b) => b - a)
            .slice(0, cap);
          s.power = top.reduce((a, b) => a + b, 0);
          s.lordPower = this.runManager.roster
            .filter((u) => u.isLord)
            .reduce(
              (acc, u) =>
                acc +
                ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'].reduce(
                  (a, k) => a + (u.stats?.[k] || 0),
                  0,
                ),
              0,
            );
        }
        s.rosterLevels = this.runManager.roster.map(
          (u) =>
            `${u.name}:${u.className}:${u.level}${u.tier === 'promoted' ? 'P' : ''}:${u.weapon?.name || '-'}`,
        );
        if (this.runManager.isRunComplete()) return this._buildResult('victory');
        this.runManager.advanceAct();
      }
    }
    return this._buildResult('timeout');
  }

  async _runBattleNode(node) {
    // Casual-mode semantics: a KO'd non-commander sits out the rest of this battle and
    // returns at 1 HP afterwards (so the army's size is not an artifact of the scripted
    // player's recklessness); a commander KO — a lost run in real play — is counted and
    // the commander restored so the run can be measured to the end.
    const s = this._act();
    const rm = this.runManager;
    s.battles++;
    if (node.type === 'recruit') s.recruitNodes++;
    const limits = DEPLOY_LIMITS[rm.currentAct] || { min: 1, max: 4 };
    const deployBonus = rm.getDeployBonus();
    const cap = limits.max + deployBonus;
    s.deploySlotsEmpty += Math.max(0, cap - rm.roster.length);
    // A real player promotes: buy a Master Seal (2500 G) for any unit at level 15+
    // (lords first) while gold allows. The stock driver only promotes at churches.
    for (const u of [...rm.roster].sort((a, b) => Number(b.isLord) - Number(a.isLord))) {
      if (u.tier === 'promoted' || (u.level || 1) < 15 || rm.gold < 2500) continue;
      const target = resolvePromotionTargets(u, this.gameData.classes, this.gameData.lords)?.[0];
      if (!target) continue;
      const bonuses =
        this.gameData.lords.find((l) => l.name === u.name)?.promotionBonuses ||
        target.promotionBonuses;
      if (!bonuses || !rm.spendGold(2500)) continue;
      promoteUnit(u, target, bonuses, this.gameData.skills);
      s.sealPromotions = (s.sealPromotions || 0) + 1;
    }
    if (this.options.healBetween) {
      // A real player tops up with Vulneraries and staves between fights; the scripted
      // player cannot use items, so without this HP attrition spirals from act 2 on.
      for (const u of rm.roster) u.currentHP = u.stats.HP;
    }
    const params = rm.getBattleParams(node) || {};
    params.metaEffects = structuredClone(rm.getEffectiveMetaEffects?.() ?? rm.metaEffects ?? null);
    params.fallenUnits = structuredClone(rm.fallenUnits || []);
    if (node.type === 'recruit') Object.assign(params, recruitParams(rm, node));
    if (this.capture && node.type !== 'boss' && node.type !== 'recruit') {
      this.captures.push({
        act: rm.currentAct,
        nodeId: node.id,
        params: structuredClone(params),
        roster: structuredClone(rm.getRoster()),
        deployBonus,
        gold: rm.gold,
      });
    }
    const deployMax = Math.max(1, Math.min(rm.roster.length, cap));
    params.deployCount = Math.min(Math.max(limits.min, deployMax), rm.roster.length);
    const fullRoster = rm.getRoster();
    const deployed = chooseDeployRoster(fullRoster, params.deployCount);
    const deployedKeys = new Set(deployed.map((u) => `${u.name}::${u.className}`));
    const driver = new GameDriver(
      this.gameData,
      params,
      deployed.map((u) => structuredClone(u)),
    );
    driver.init();
    const battle = driver.battle;
    const benched = [];
    const original = battle._removeUnit.bind(battle);
    let cmdrKOThisBattle = 0;
    battle._removeUnit = (unit, o) => {
      if (unit?.faction === 'player' && unit.isCommander) {
        s.commanderKOs++;
        cmdrKOThisBattle++;
        unit.currentHP = unit.stats.HP;
        return;
      }
      if (unit?.faction === 'player') {
        s.unitKOs++;
        benched.push(unit);
      }
      if (unit?.faction === 'npc') s.recruitsLost++;
      original(unit, o);
    };
    const agent = this.options.battleAgentFactory(driver);
    const before = new Set(rm.roster.map((u) => `${u.name}::${u.className}`));
    const turnCap = opts.turnCap || 30;
    let stalled = false;
    for (let i = 0; i < this.options.maxBattleActions && !driver.isTerminal(); i++) {
      if ((battle.turnManager?.turnNumber || 0) > turnCap) {
        stalled = true;
        break;
      }
      const legal = driver.listLegalActions();
      if (!legal?.length) break;
      const action = agent.chooseAction(legal);
      if (!action) break;
      await driver.step(action);
    }
    if (stalled) s.stalls = (s.stalls || 0) + 1;
    if (cmdrKOThisBattle > 0) s.battlesWithCmdrKO = (s.battlesWithCmdrKO || 0) + 1;
    const turns = Math.min(turnCap + 1, battle.turnManager?.turnNumber || 0);
    s.turns += turns;
    if (opts.verbose)
      console.log(
        `  ${rm.currentAct} ${node.type} ${params.objective}${params.isElite ? '*' : ''} t=${turns} cmdrKO=${s.commanderKOs} result=${driver.getTerminalResult()}`,
      );
    this.metrics.battles++;
    this.metrics.totalTurns += turns;
    const survivors = [...battle.playerUnits, ...(battle.escapedUnits || [])];
    for (const u of benched) {
      u.currentHP = 1;
      u.faction = 'player';
      survivors.push(u);
    }
    const bench = fullRoster.filter((u) => !deployedKeys.has(`${u.name}::${u.className}`));
    rm.completeBattle([...survivors, ...bench], node.id, battle.goldEarned || 0, {
      turnCount: turns,
      turnPar: battle.turnPar,
    });
    // Act bosses offer a recruit (BossRecruitOverlay): take the highest-level candidate.
    if (node.type === 'boss' && !rm.isRunComplete() && rm.roster.length < rm.getRosterCap()) {
      const candidates =
        generateBossRecruitCandidates(
          rm.currentAct,
          rm.roster,
          this.gameData,
          rm.getEffectiveMetaEffects(),
          rm.fallenUnits || [],
          [...rm.getTakenUnitNames()],
        ) || [];
      const pick = [...candidates]
        .map((c) => c?.unit)
        .filter(Boolean)
        .sort((a, b) => (b.level || 0) - (a.level || 0))[0];
      if (pick) {
        rm.grantRecruitBlessingConsumables?.(pick);
        rm.assignUnitUid(pick);
        rm.roster.push(pick);
        s.bossRecruits = (s.bossRecruits || 0) + 1;
      }
    }
    const joined = rm.roster.filter((u) => !before.has(`${u.name}::${u.className}`)).length;
    if (node.type === 'recruit') s.recruitsJoined += joined;
    this.metrics.recruitsGained += joined;
    return { result: 'victory', turns, recruitsGained: joined };
  }

  async _runShopNode(node) {
    const s = this._act();
    s.shopVisits++;
    const res = await super._runShopNode(node);
    s.shopSpent += res.spent || 0;
    return res;
  }

  _runChurchNode(node) {
    const s = this._act();
    s.churchVisits++;
    let missing = 0;
    let total = 0;
    for (const u of this.runManager.roster) {
      missing += Math.max(0, u.stats.HP - u.currentHP);
      total += u.stats.HP;
    }
    s.churchHpRestored += missing;
    s.churchHpPct.push(total > 0 ? missing / total : 0);
    const res = super._runChurchNode(node);
    if (res.revived) s.churchRevives++;
    if (res.promoted) s.churchPromotions++;
    return res;
  }

  _runColosseumNode(node) {
    const s = this._act();
    const rm = this.runManager;
    const roster = rm.roster;
    let hired = null;
    if (roster.length < rm.getRosterCap()) {
      const { recruitTargetLevel } = resolveRecruitScalingTargets(roster);
      const level = findCommander(roster) ? recruitTargetLevel : 1;
      const candidates = generateMercenaryCandidates(
        rm.currentAct,
        level,
        this.gameData.recruits,
        this.gameData.classes,
        this.gameData.weapons,
        this.gameData.skills,
        rm.difficultyId,
        this.gameData.colosseum,
        Math.random,
        this.gameData.traits || null,
        [...rm.getTakenUnitNames()],
      ).filter((c) => c?.unit && c.hireCost <= rm.gold);
      candidates.sort((a, b) => (b.unit.level || 0) - (a.unit.level || 0));
      const pick = candidates[0];
      if (pick && rm.spendGold(pick.hireCost)) {
        pick.unit.faction = 'player';
        grantMercenaryClassSkills?.(pick.unit, this.gameData.classes, this.gameData.skills);
        rm.assignUnitUid(pick.unit);
        roster.push(pick.unit);
        hired = pick.unit.name;
        s.mercsHired++;
        s.mercGold += pick.hireCost;
      }
    }
    rm.markNodeComplete(node.id);
    return { result: 'colosseum_done', hired };
  }
}

async function protectedRun(seed, policy, extra = {}) {
  installSeed(seed);
  try {
    const driver = new ProtectedDriver(gameData, {
      runOptions: { runSeed: seed, difficultyId: opts.difficulty, autoSelectBlessing: false },
      maxBattleActions: opts.maxActions,
      battleAgentFactory: (d) => makeAgent(d, true),
      policy,
      healBetween: opts.heal !== 'off',
      ...extra,
    });
    const result = await driver.run();
    return { result, actStats: driver.actStats, captures: driver.captures, driver };
  } finally {
    restoreMathRandom();
  }
}

async function sectionRoute() {
  printHeader(
    `Route policies — ${opts.seeds} runs each (${opts.difficulty}); commander protected, others permadeath`,
  );
  const policies = String(opts.policies || 'recruit,battle,shop,church').split(',');
  const rows = [];
  const churchRows = [];
  for (const policy of policies) {
    const perAct = {};
    let cleanRuns = 0;
    let runs = 0;
    for (let seed = opts.seed; seed < opts.seed + opts.seeds; seed++) {
      const { actStats } = await protectedRun(seed, policy);
      runs++;
      let totalKO = 0;
      for (const [act, s] of Object.entries(actStats)) {
        if (opts.verbose) console.log(policy, seed, act, (s.rosterLevels || []).join(' '));
        perAct[act] ||= [];
        perAct[act].push(s);
        totalKO += s.commanderKOs;
      }
      if (totalKO === 0) cleanRuns++;
    }
    for (const [act, list] of Object.entries(perAct)) {
      const sum = (k) => list.reduce((acc, s) => acc + (s[k] || 0), 0);
      rows.push({
        policy,
        act,
        runs: list.length,
        'cmdrSafe%': pct(list.filter((s) => s.commanderKOs === 0).length, list.length),
        'cmdrKOBattle%': pct(sum('battlesWithCmdrKO'), sum('battles')),
        'stall%': pct(sum('stalls'), sum('battles')),
        unitKO: mean(list.map((s) => s.unitKOs)),
        turns: mean(list.map((s) => s.turns)),
        recruitNodes: mean(list.map((s) => s.recruitNodes)),
        joined: mean(list.map((s) => s.recruitsJoined)),
        mercs: mean(list.map((s) => s.mercsHired)),
        rosterEnd: mean(list.map((s) => s.rosterEnd)),
        emptySlots: Math.round((100 * sum('deploySlotsEmpty')) / Math.max(1, sum('battles'))) / 100,
        goldEnd: Math.round(mean(list.map((s) => s.goldEnd))),
        shopSpent: Math.round(mean(list.map((s) => s.shopSpent))),
      });
      churchRows.push({
        policy,
        act,
        visits: mean(list.map((s) => s.churchVisits)),
        'hpMissing%': mean(list.flatMap((s) => s.churchHpPct).map((x) => 100 * x)),
        hpRestored: mean(list.map((s) => s.churchHpRestored)),
        revives: mean(list.map((s) => s.churchRevives)),
        promotions: mean(list.map((s) => s.churchPromotions)),
      });
    }
    rows.push({ policy, act: 'RUN', runs, 'cmdrSafe%': pct(cleanRuns, runs) });
  }
  printTable(
    [
      'policy',
      'act',
      'runs',
      'cmdrSafe%',
      'cmdrKOBattle%',
      'stall%',
      'unitKO',
      'turns',
      'recruitNodes',
      'joined',
      'mercs',
      'rosterEnd',
      'emptySlots',
      'goldEnd',
      'shopSpent',
    ],
    rows,
  );
  printTable(
    ['policy', 'act', 'visits', 'hpMissing%', 'hpRestored', 'revives', 'promotions'],
    churchRows,
    {
      title: 'Church visits (what a church actually gave)',
    },
  );
}

// ---------------------------------------------------------------------------
// value: counterfactual battles (common random numbers). Battle states are captured
// from protected recruit-first runs; each state is replayed with the same battle
// seed under variants, and the deltas are what one node outcome is worth in battle.

import { levelUp, applyLevelUpGains, canEquip } from '../src/engine/UnitManager.js';

const TIER_UP = { Iron: 'Steel', Steel: 'Silver', Silver: 'Silver' };

function upgradeWeapon(unit) {
  const w = unit.weapon;
  if (!w || w.type === 'Staff') return;
  const next = TIER_UP[w.tier];
  if (!next || next === w.tier) return;
  const better = gameData.weapons.find(
    (x) => x.type === w.type && x.tier === next && !x.special && canEquip(unit, x),
  );
  if (!better) return;
  const clone = structuredClone(better);
  const idx = unit.inventory.indexOf(w);
  if (idx >= 0) unit.inventory[idx] = clone;
  else unit.inventory.push(clone);
  unit.weapon = clone;
}

function variantUnits(capture, variant, rng) {
  const deploy = deployFor(capture);
  let units = deploy.units;
  if (variant === 'minus1') {
    const nonLords = units.filter((u) => !u.isLord);
    if (!nonLords.length) return null;
    const drop = nonLords.sort((a, b) => (a.level || 0) - (b.level || 0))[0];
    units = units.filter((u) => u !== drop);
  } else if (variant === 'lordsOnly') {
    units = units.filter((u) => u.isLord);
  } else if (variant === 'plusLevel') {
    for (const u of units) {
      const r = levelUp(u, rng);
      if (r) applyLevelUpGains(u, r);
    }
  } else if (variant === 'weapons') {
    for (const u of units) upgradeWeapon(u);
  } else if (variant === 'hp60') {
    // Arriving without a heal: every unit at 60% HP (what the church's free heal buys back).
    for (const u of units) u.currentHP = Math.max(1, Math.round(u.stats.HP * 0.6));
  } else if (variant === 'plus2Levels') {
    for (let i = 0; i < 2; i++)
      for (const u of units) {
        const r = levelUp(u, rng);
        if (r) applyLevelUpGains(u, r);
      }
  }
  return units;
}

async function playProtected(params, units, seed) {
  installSeed(seed);
  try {
    const p = structuredClone(params);
    p.deployCount = units.length;
    p.battleSeed = seed;
    const driver = new GameDriver(gameData, p, units);
    driver.init();
    const b = driver.battle;
    let cmdrKO = 0;
    let unitKO = 0;
    const original = b._removeUnit.bind(b);
    b._removeUnit = (unit, o) => {
      if (unit?.faction === 'player' && unit.isCommander) {
        cmdrKO++;
        unit.currentHP = unit.stats.HP;
        return;
      }
      if (unit?.faction === 'player') unitKO++;
      original(unit, o);
    };
    const agent = makeAgent(driver, false);
    for (let i = 0; i < opts.maxActions && !driver.isTerminal(); i++) {
      const legal = driver.listLegalActions();
      if (!legal.length) break;
      const a = agent.chooseAction(legal);
      if (!a) break;
      await driver.step(a);
    }
    return {
      turns: b.turnManager?.turnNumber || 0,
      cmdrKO,
      unitKO,
      won: driver.getTerminalResult() === 'victory',
    };
  } finally {
    restoreMathRandom();
  }
}

async function sectionValue() {
  printHeader(
    `Counterfactual battle value — ${opts.seeds} runs, ${opts.replays} replays per state`,
  );
  const captures = [];
  for (let seed = opts.seed; seed < opts.seed + opts.seeds; seed++) {
    const { captures: caps } = await protectedRun(seed, 'recruit', { capture: true });
    for (const c of caps) captures.push({ ...c, runSeed: seed });
  }
  const variants = ['base', 'minus1', 'lordsOnly', 'plusLevel', 'plus2Levels', 'weapons', 'hp60'];
  const acc = {};
  const meta = {};
  for (const cap of captures) {
    meta[cap.act] ||= { states: 0, hpMissing: [], deployed: [], cap: [] };
    const m = meta[cap.act];
    m.states++;
    const dep = deployFor(cap);
    m.deployed.push(dep.units.length);
    const limits = DEPLOY_LIMITS[cap.act] || { max: 4 };
    m.cap.push(limits.max + cap.deployBonus);
    const tot = dep.units.reduce((s, u) => s + u.stats.HP, 0);
    const cur = dep.units.reduce((s, u) => s + u.currentHP, 0);
    m.hpMissing.push(tot > 0 ? (100 * (tot - cur)) / tot : 0);
    for (let r = 0; r < opts.replays; r++) {
      const seed = hash32(`${cap.runSeed}:${cap.nodeId}:${r}`);
      const results = {};
      for (const v of variants) {
        const rng = (() => {
          let t = hash32(`lv:${seed}`);
          return () => {
            t = (t + 0x6d2b79f5) >>> 0;
            let x = Math.imul(t ^ (t >>> 15), 1 | t);
            x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
            return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
          };
        })();
        const units = variantUnits(cap, v, rng);
        if (!units) continue;
        results[v] = await playProtected(cap.params, units, seed);
      }
      for (const v of variants) {
        if (!results[v] || !results.base) continue;
        const k = `${cap.act}|${v}`;
        acc[k] ||= { n: 0, dTurns: 0, dCmdr: 0, dUnit: 0, cmdrKO: 0, turns: 0 };
        const a = acc[k];
        a.n++;
        a.turns += results[v].turns;
        a.cmdrKO += results[v].cmdrKO;
        a.dTurns += results[v].turns - results.base.turns;
        a.dCmdr += results[v].cmdrKO - results.base.cmdrKO;
        a.dUnit += results[v].unitKO - results.base.unitKO;
      }
    }
  }
  const rows = [];
  for (const act of Object.keys(meta)) {
    const m = meta[act];
    rows.push({
      act,
      variant: '(states)',
      n: m.states,
      turns: mean(m.deployed),
      cmdrKO: mean(m.cap),
      dTurns: mean(m.hpMissing),
    });
    for (const v of variants) {
      const a = acc[`${act}|${v}`];
      if (!a) continue;
      rows.push({
        act,
        variant: v,
        n: a.n,
        turns: Math.round((100 * a.turns) / a.n) / 100,
        cmdrKO: Math.round((100 * a.cmdrKO) / a.n) / 100,
        dTurns: Math.round((100 * a.dTurns) / a.n) / 100,
        dCmdrKO: Math.round((100 * a.dCmdr) / a.n) / 100,
        dUnitKO: Math.round((100 * a.dUnit) / a.n) / 100,
      });
    }
  }
  console.log(
    '\n(states) rows: n = captured battle states, turns = mean deployed, cmdrKO = mean deploy cap, dTurns = mean % HP missing at battle start',
  );
  printTable(['act', 'variant', 'n', 'turns', 'cmdrKO', 'dTurns', 'dCmdrKO', 'dUnitKO'], rows);
}

// ---------------------------------------------------------------------------
// unitvalue: what one more body is worth against what the other nodes buy, on
// controlled squads (built with the game's own factories, levelled with growths)
// fighting mid-act rout battles. Common random numbers: every variant of a trial fights
// the same generated battle with the same combat rolls. The baseline squad is one unit
// short of the act's deploy cap (the state a player is in when choosing a route).

import { RunManager } from '../src/engine/RunManager.js';
import {
  createRecruitUnit,
  promoteUnit,
  resolvePromotionTargets,
  getClassInnateSkills,
  learnSkill,
} from '../src/engine/UnitManager.js';

const SQUAD = {
  // Scenario → act, lord level, promoted?, recruit level, weapon tier, enemy levels (the
  // NodeMapGenerator row band), deploy cap. Levels follow the tactician full-run
  // snapshots (lords lead recruits by about one level; act 3 squads are promoted).
  act1early: {
    act: 'act1',
    lordLevel: 2,
    promoted: false,
    recruitLevel: 2,
    tier: 'Iron',
    foes: [1, 3],
    cap: 4,
    row: 2,
  },
  act1: {
    act: 'act1',
    lordLevel: 4,
    promoted: false,
    recruitLevel: 3,
    tier: 'Iron',
    foes: [2, 3],
    cap: 4,
    row: 3,
  },
  act2: {
    act: 'act2',
    lordLevel: 9,
    promoted: false,
    recruitLevel: 8,
    tier: 'Steel',
    foes: [5, 8],
    cap: 5,
    row: 3,
  },
  act3: {
    act: 'act3',
    lordLevel: 6,
    promoted: true,
    recruitLevel: 4,
    tier: 'Silver',
    foes: [10, 14],
    cap: 6,
    row: 3,
  },
};

function seededRng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function levelTo(unit, level, rng) {
  while ((unit.level || 1) < level) {
    const r = levelUp(unit, rng);
    if (!r) break;
    applyLevelUpGains(unit, r);
  }
}

function giveTier(unit, tier) {
  const w = unit.weapon;
  if (!w || w.type === 'Staff' || w.tier === tier) return;
  const better = gameData.weapons.find(
    (x) => x.type === w.type && x.tier === tier && !x.special && canEquip(unit, x),
  );
  if (!better) return;
  const clone = structuredClone(better);
  const idx = unit.inventory.indexOf(w);
  if (idx >= 0) unit.inventory[idx] = clone;
  else unit.inventory.push(clone);
  unit.weapon = clone;
}

function promote(unit, rng) {
  // Base level 15 at promotion (between the level-10 minimum and the cap).
  levelTo(unit, 15, rng);
  const targets = resolvePromotionTargets(unit, gameData.classes, gameData.lords);
  const target = targets?.[0];
  if (!target) return;
  const bonuses =
    gameData.lords.find((l) => l.name === unit.name)?.promotionBonuses || target.promotionBonuses;
  promoteUnit(unit, target, bonuses, gameData.skills);
}

function buildSquad(act, size, trialSeed) {
  const cfg = SQUAD[act];
  const rng = seededRng(hash32(`squad:${act}:${trialSeed}`));
  const rm = new RunManager(gameData, null);
  rm.runSeed = trialSeed;
  const units = rm.createInitialRoster().map((u) => structuredClone(u));
  // Promoted pool entries (act 3) are built on their base class and promoted below.
  const pool = (gameData.recruits[cfg.act]?.classPool || [])
    .map((name) => {
      const c = gameData.classes.find((x) => x.name === name);
      return c?.tier === 'promoted' ? c.promotesFrom : c?.name;
    })
    .filter(Boolean);
  for (let i = 0; units.length < size; i++) {
    const className = pool[hash32(`cls:${trialSeed}:${i}`) % pool.length];
    const classData = gameData.classes.find((c) => c.name === className);
    const prev = Math.random;
    Math.random = seededRng(hash32(`rec:${trialSeed}:${i}`));
    try {
      const u = createRecruitUnit(
        { name: `R${i}`, className, level: 1 },
        classData,
        gameData.weapons,
        null,
        null,
        null,
        gameData.classes,
        { traitsData: gameData.traits, skillsData: gameData.skills, rng: Math.random },
      );
      for (const sid of getClassInnateSkills(className, gameData.skills)) learnSkill(u, sid);
      u.faction = 'player';
      units.push(u);
    } finally {
      Math.random = prev;
    }
  }
  for (const u of units) {
    if (cfg.promoted) {
      promote(u, rng);
      levelTo(u, u.isLord ? cfg.lordLevel : cfg.recruitLevel, rng);
    } else {
      levelTo(u, u.isLord ? cfg.lordLevel : cfg.recruitLevel, rng);
    }
    giveTier(u, cfg.tier);
    u.currentHP = u.stats.HP;
  }
  return units.slice(0, size);
}

async function playSquad(act, units, seed, turnCap = 30, extra = {}) {
  installSeed(seed);
  try {
    const cfg = SQUAD[act];
    const params = {
      act: cfg.act,
      objective: 'rout',
      row: cfg.row,
      levelRange: cfg.foes,
      deployCount: units.length,
      difficultyId: opts.difficulty,
      battleSeed: seed,
      ...extra,
    };
    const driver = new GameDriver(gameData, params, units);
    driver.init();
    const b = driver.battle;
    let cmdrKO = 0;
    let unitKO = 0;
    const original = b._removeUnit.bind(b);
    b._removeUnit = (unit, o) => {
      if (unit?.faction === 'player' && unit.isCommander) {
        cmdrKO++;
        unit.currentHP = unit.stats.HP;
        return;
      }
      if (unit?.faction === 'player') unitKO++;
      original(unit, o);
    };
    const agent = makeAgent(driver, false);
    let stalled = false;
    for (let i = 0; i < opts.maxActions && !driver.isTerminal(); i++) {
      if ((b.turnManager?.turnNumber || 0) > turnCap) {
        stalled = true;
        break;
      }
      const legal = driver.listLegalActions();
      if (!legal.length) break;
      const a = agent.chooseAction(legal);
      if (!a) break;
      await driver.step(a);
    }
    return {
      turns: Math.min(turnCap + 1, b.turnManager?.turnNumber || 0),
      cmdrKO,
      unitKO,
      stalled,
    };
  } finally {
    restoreMathRandom();
  }
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function sectionUnitValue() {
  const trials = opts.trials || 60;
  printHeader(`Unit value vs other node outcomes — ${trials} battles per act (${opts.difficulty})`);
  const variants = [
    ['short (cap-1)', (act, t) => buildSquad(act, SQUAD[act].cap - 1, t)],
    ['+1 unit (full)', (act, t) => buildSquad(act, SQUAD[act].cap, t)],
    ['-1 unit (cap-2)', (act, t) => buildSquad(act, SQUAD[act].cap - 2, t)],
    [
      '+1 level all',
      (act, t) => {
        const s = buildSquad(act, SQUAD[act].cap - 1, t);
        const rng = seededRng(hash32(`plus:${t}`));
        for (const u of s) {
          const r = levelUp(u, rng);
          if (r) applyLevelUpGains(u, r);
          u.currentHP = u.stats.HP;
        }
        return s;
      },
    ],
    [
      '+2 levels all',
      (act, t) => {
        const s = buildSquad(act, SQUAD[act].cap - 1, t);
        const rng = seededRng(hash32(`plus:${t}`));
        for (let k = 0; k < 2; k++)
          for (const u of s) {
            const r = levelUp(u, rng);
            if (r) applyLevelUpGains(u, r);
          }
        for (const u of s) u.currentHP = u.stats.HP;
        return s;
      },
    ],
    [
      'weapon tier up',
      (act, t) => {
        const s = buildSquad(act, SQUAD[act].cap - 1, t);
        for (const u of s) upgradeWeapon(u);
        return s;
      },
    ],
    [
      'arrive at 60% HP',
      (act, t) => {
        const s = buildSquad(act, SQUAD[act].cap - 1, t);
        for (const u of s) u.currentHP = Math.max(1, Math.round(u.stats.HP * 0.6));
        return s;
      },
    ],
    // What an elite-like recruit fight costs (the recruit itself not on the field).
    ['fight: +1 foe', (act, t) => buildSquad(act, SQUAD[act].cap - 1, t), { enemyCountBonus: 1 }],
    [
      'fight: +1 foe, foes +1 Lv',
      (act, t) => buildSquad(act, SQUAD[act].cap - 1, t),
      { enemyCountBonus: 1, enemyLevelBonus: 1 },
    ],
    [
      'fight: +1 foe, 1 affixed',
      (act, t) => buildSquad(act, SQUAD[act].cap - 1, t),
      { enemyCountBonus: 1, eclipseAffix: { guaranteedCount: 1, guaranteedTier: 1 } },
    ],
    [
      'fight: +2 foes, foes +1 Lv',
      (act, t) => buildSquad(act, SQUAD[act].cap - 1, t),
      { enemyCountBonus: 2, enemyLevelBonus: 1 },
    ],
  ];
  const rows = [];
  for (const act of String(opts.acts || 'act1early,act1,act2,act3').split(',')) {
    const results = variants.map(() => []);
    for (let t = 0; t < trials; t++) {
      const trialSeed = hash32(`uv:${opts.seed}:${act}:${t}`);
      for (let v = 0; v < variants.length; v++) {
        const squad = variants[v][1](act, trialSeed);
        results[v].push(await playSquad(act, squad, trialSeed, 30, variants[v][2] || {}));
      }
    }
    const base = results[0];
    for (let v = 0; v < variants.length; v++) {
      const r = results[v];
      rows.push({
        act,
        variant: variants[v][0],
        'cmdrKO%': pct(r.filter((x) => x.cmdrKO > 0).length, r.length),
        'ΔcmdrKO%': Math.round(
          pct(r.filter((x) => x.cmdrKO > 0).length, r.length) -
            pct(base.filter((x) => x.cmdrKO > 0).length, base.length),
        ),
        unitKO: mean(r.map((x) => x.unitKO)),
        ΔunitKO:
          Math.round(100 * (mean(r.map((x) => x.unitKO)) - mean(base.map((x) => x.unitKO)))) / 100,
        medTurns: median(r.map((x) => x.turns)),
        meanTurns: mean(r.map((x) => x.turns)),
        'stall%': pct(r.filter((x) => x.stalled).length, r.length),
      });
    }
  }
  printTable(
    [
      'act',
      'variant',
      'cmdrKO%',
      'ΔcmdrKO%',
      'unitKO',
      'ΔunitKO',
      'medTurns',
      'meanTurns',
      'stall%',
    ],
    rows,
  );
}

async function sectionDebug() {
  const act = opts.act || 'act2';
  const trialSeed = hash32(`uv:${opts.seed}:${act}:${opts.trial || 0}`);
  const squad = buildSquad(act, SQUAD[act].cap - 1, trialSeed);
  installSeed(trialSeed);
  try {
    const cfg = SQUAD[act];
    const driver = new GameDriver(
      gameData,
      {
        act: cfg.act,
        objective: 'rout',
        row: cfg.row,
        levelRange: cfg.foes,
        deployCount: squad.length,
        difficultyId: opts.difficulty,
        battleSeed: trialSeed,
      },
      squad,
    );
    driver.init();
    const b = driver.battle;
    console.log(b.battleConfig.templateId, b.battleConfig.cols, 'x', b.battleConfig.rows);
    const fmt = (u) =>
      `${u.name}(${u.className} L${u.level} ${u.currentHP}/${u.stats.HP} @${u.col},${u.row} ${u.weapon?.name})`;
    console.log('P:', b.playerUnits.map(fmt).join(' | '));
    console.log('E:', b.enemyUnits.map(fmt).join(' | '));
    const origRemove = b._removeUnit.bind(b);
    b._removeUnit = (unit, o) => {
      console.log(`   KO ${unit.faction} ${unit.name} by ${o?.killer?.name}`);
      if (unit.faction === 'player' && unit.isCommander) {
        unit.currentHP = unit.stats.HP;
        return;
      }
      origRemove(unit, o);
    };
    const agent = makeAgent(driver, false);
    let lastTurn = 0;
    for (let i = 0; i < opts.maxActions && !driver.isTerminal(); i++) {
      const t = b.turnManager?.turnNumber || 0;
      if (t !== lastTurn) {
        lastTurn = t;
        if (t > (opts.turnCap || 12)) break;
        console.log(`T${t} P:`, b.playerUnits.map(fmt).join(' | '));
        console.log(`   E:`, b.enemyUnits.map(fmt).join(' | '));
      }
      const legal = driver.listLegalActions();
      if (!legal.length) break;
      const a = agent.chooseAction(legal);
      if (a.type === 'choose_action' || a.type === 'choose_target')
        console.log('   ', b.selectedUnit?.name, a.type, JSON.stringify(a.payload));
      await driver.step(a);
    }
    console.log('result', driver.getTerminalResult());
  } finally {
    restoreMathRandom();
  }
}

// ---------------------------------------------------------------------------
// graph: what the node maps offer and what a recruit-greedy route gives up. Exact
// (dynamic programming over each act's DAG), no battles.

function pathStats(nodeMap) {
  const byId = new Map(nodeMap.nodes.map((n) => [n.id, n]));
  const order = [...nodeMap.nodes].sort((a, b) => b.row - a.row);
  const count = (n, type) => (n.type === type ? 1 : 0);
  const elite = (n) => (n.type === 'battle' && n.battleParams?.isElite ? 1 : 0);
  // best[type] = max count of `type` on any path from node to boss.
  const types = ['recruit', 'shop', 'church', 'colosseum'];
  const best = new Map();
  const services = new Map();
  const paths = new Map(); // number of distinct paths to the boss
  const sumRecruits = new Map(); // sum of recruits over all paths (for the random-walk mean)
  for (const n of order) {
    const kids = (n.edges || []).map((id) => byId.get(id)).filter(Boolean);
    const entry = {};
    for (const t of types)
      entry[t] = count(n, t) + (kids.length ? Math.max(...kids.map((k) => best.get(k.id)[t])) : 0);
    entry.elite = elite(n) + (kids.length ? Math.max(...kids.map((k) => best.get(k.id).elite)) : 0);
    best.set(n.id, entry);
    // Services along the recruit-maximising path (ties broken toward more services).
    if (!kids.length) {
      services.set(n.id, { recruits: count(n, 'recruit'), svc: 0, church: 0, shop: 0, colo: 0 });
      paths.set(n.id, 1);
      sumRecruits.set(n.id, count(n, 'recruit'));
    } else {
      let pick = null;
      for (const k of kids) {
        const s = services.get(k.id);
        if (
          !pick ||
          s.recruits > pick.recruits ||
          (s.recruits === pick.recruits && s.svc > pick.svc)
        )
          pick = s;
      }
      const isSvc = ['shop', 'church', 'colosseum'].includes(n.type) ? 1 : 0;
      services.set(n.id, {
        recruits: pick.recruits + count(n, 'recruit'),
        svc: pick.svc + isSvc,
        church: pick.church + count(n, 'church'),
        shop: pick.shop + count(n, 'shop'),
        colo: pick.colo + count(n, 'colosseum'),
      });
      const p = kids.reduce((s, k) => s + paths.get(k.id), 0);
      paths.set(n.id, p);
      sumRecruits.set(
        n.id,
        kids.reduce((s, k) => s + sumRecruits.get(k.id), 0) + count(n, 'recruit') * p,
      );
    }
  }
  // Best services on any path ignoring recruits.
  const svcBest = new Map();
  for (const n of order) {
    const kids = (n.edges || []).map((id) => byId.get(id)).filter(Boolean);
    const isSvc = ['shop', 'church', 'colosseum'].includes(n.type) ? 1 : 0;
    svcBest.set(n.id, isSvc + (kids.length ? Math.max(...kids.map((k) => svcBest.get(k.id))) : 0));
  }
  const start = nodeMap.startNodeId;
  return {
    totals: Object.fromEntries(
      [...types, 'battle'].map((t) => [t, nodeMap.nodes.filter((n) => n.type === t).length]),
    ),
    maxRecruits: best.get(start).recruit,
    maxChurch: best.get(start).church,
    maxColosseum: best.get(start).colosseum,
    greedy: services.get(start),
    bestServices: svcBest.get(start),
    meanRecruitsUniformPath: sumRecruits.get(start) / paths.get(start),
    paths: paths.get(start),
  };
}

async function sectionGraph() {
  const seeds = opts.seeds || 300;
  printHeader(`Node-map structure — ${seeds} seeds (${opts.difficulty})`);
  const acts = {};
  for (let seed = opts.seed; seed < opts.seed + seeds; seed++) {
    const rm = new RunManager(gameData, null);
    rm.startRun({ runSeed: seed, difficultyId: opts.difficulty, autoSelectBlessing: false });
    for (let i = 0; i < rm.actSequence.length; i++) {
      if (i > 0) rm.advanceAct();
      const act = rm.currentAct;
      if (act === 'finalBoss') continue;
      (acts[act] ||= []).push(pathStats(rm.nodeMap));
    }
  }
  const rows = [];
  for (const [act, list] of Object.entries(acts)) {
    const m = (f) => mean(list.map(f));
    rows.push({
      act,
      recruitNodes: m((s) => s.totals.recruit),
      maxOnRoute: m((s) => s.maxRecruits),
      'route≥2%': pct(list.filter((s) => s.maxRecruits >= 2).length, list.length),
      'route≥3%': pct(list.filter((s) => s.maxRecruits >= 3).length, list.length),
      randomRoute: m((s) => s.meanRecruitsUniformPath),
      churches: m((s) => s.totals.church),
      'churchOnRoute%': pct(list.filter((s) => s.maxChurch >= 1).length, list.length),
      colosseums: m((s) => s.totals.colosseum),
      shops: m((s) => s.totals.shop),
      greedySvc: m((s) => s.greedy.svc),
      bestSvc: m((s) => s.bestServices),
      greedyChurch: m((s) => s.greedy.church),
    });
  }
  printTable(
    [
      'act',
      'recruitNodes',
      'maxOnRoute',
      'route≥2%',
      'route≥3%',
      'randomRoute',
      'churches',
      'churchOnRoute%',
      'colosseums',
      'shops',
      'greedySvc',
      'bestSvc',
      'greedyChurch',
    ],
    rows,
  );
  console.log(
    '\nmaxOnRoute = most recruit nodes on one start→boss route; randomRoute = mean over all routes;',
  );
  console.log(
    'greedySvc = services (shop/church/colosseum) on the recruit-maximising route; bestSvc = most services on any route.',
  );
}

// ---------------------------------------------------------------------------
// blessings: every blessing's boon alone, and every tier cost alone, applied at run
// start to the same seeded runs (recruit-first route, tactician player). Deltas against
// the no-blessing run: squad stat points (top deploy-cap units) and lord stat points at
// each act end, gold, commander-KO rate per battle. Boon and cost are measured apart so
// any pairing the shrine can roll can be read as boon + cost.

async function blessingRun(seed, effects, label) {
  const { actStats } = await protectedRun(seed, 'recruit', {
    onInit: (rm) => {
      for (const effect of effects) rm._applySingleRunStartBlessingEffect(`sim:${label}`, effect);
      rm._runStartBlessingsApplied = true;
    },
  });
  return actStats;
}

async function sectionBlessings() {
  const seeds = opts.seeds || 12;
  const catalog = gameData.blessings;
  const configs = [['(none)', 'base', []]];
  const only = opts.only ? String(opts.only).split(',') : null;
  if (opts.candidates) {
    // Forbidden Tome pact candidates (strategy-layer spec), next to the other tier-4 boons.
    const growth = (v) => ({ type: 'all_growths_delta', params: { value: v } });
    const shadow = (v) => ({ type: 'eclipse_shadow_delta', params: { value: v } });
    const def1 = {
      type: 'act_stat_delta_all_units',
      params: { act: 'act1', stat: 'DEF', value: -2 },
    };
    const hp = (v) => ({ type: 'targeted_growths_delta', params: { stats: ['HP'], value: v } });
    const foes = (v, act = null) => ({
      type: 'enemy_level_delta',
      params: act ? { value: v, act } : { value: v },
    });
    const all = ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'];
    const scoped = (v, scope) => ({
      type: 'targeted_growths_delta',
      params: { stats: all, value: v, scope },
    });
    const set = ['1', '2', '3', '4'].includes(String(opts.candidates))
      ? Number(opts.candidates)
      : 1;
    if (set === 4)
      configs.push(
        ['tome +15', 'candidate', [growth(15)]],
        ['lords +15, recruits -10', 'candidate', [scoped(15, 'lords'), scoped(-10, 'recruits')]],
        ['lords +12, recruits -10', 'candidate', [scoped(12, 'lords'), scoped(-10, 'recruits')]],
        ['lords +10, recruits -10', 'candidate', [scoped(10, 'lords'), scoped(-10, 'recruits')]],
      );
    else if (set === 3)
      configs.push(
        ['tome +15', 'candidate', [growth(15)]],
        ['lords +15', 'candidate', [scoped(15, 'lords')]],
        ['lords +15, recruits -10', 'candidate', [scoped(15, 'lords'), scoped(-10, 'recruits')]],
        ['lords +15, recruits -15', 'candidate', [scoped(15, 'lords'), scoped(-15, 'recruits')]],
        ['lords +20, recruits -10', 'candidate', [scoped(20, 'lords'), scoped(-10, 'recruits')]],
        ['recruits -10 alone', 'candidate', [scoped(-10, 'recruits')]],
        ['tome +10, -2 DEF A1', 'candidate', [growth(10), def1]],
      );
    else if (set === 1)
      configs.push(
        ['tome +15', 'candidate', [growth(15)]],
        ['tome +15, shadow 25', 'candidate', [growth(15), shadow(25)]],
        ['tome +15, shadow 40', 'candidate', [growth(15), shadow(40)]],
        ['tome +15, -2 DEF A1', 'candidate', [growth(15), def1]],
        ['tome +15, shadow 25, -2 DEF A1', 'candidate', [growth(15), shadow(25), def1]],
        ['tome +15, HP growth -30', 'candidate', [growth(15), hp(-30)]],
        ['tome +10', 'candidate', [growth(10)]],
        ['tome +10, shadow 25', 'candidate', [growth(10), shadow(25)]],
        ['shadow 25 alone', 'candidate', [shadow(25)]],
        ['shadow 40 alone', 'candidate', [shadow(40)]],
      );
    else
      configs.push(
        ['tome +15', 'candidate', [growth(15)]],
        ['foes +1 Lv (run)', 'candidate', [foes(1)]],
        ['tome +15, foes +1 Lv', 'candidate', [growth(15), foes(1)]],
        ['tome +12, foes +1 Lv', 'candidate', [growth(12), foes(1)]],
        ['tome +10, foes +1 Lv', 'candidate', [growth(10), foes(1)]],
        ['tome +15, foes +2 Lv A1', 'candidate', [growth(15), foes(2, 'act1')]],
        ['tome +15, foes +1 Lv, -2 DEF A1', 'candidate', [growth(15), foes(1), def1]],
      );
    const peers =
      set >= 3
        ? ['scholar_vow']
        : ['arsenal_pact', 'blood_forge', 'war_tutelage', 'armory_stash', 'scholar_vow'];
    for (const id of peers) {
      const b = catalog.blessings.find((x) => x.id === id);
      if (b) configs.push([b.id, `T${b.tier} boon`, b.boons]);
    }
  } else {
    for (const b of catalog.blessings) {
      if (only && !only.includes(b.id)) continue;
      configs.push([b.id, `T${b.tier} boon`, b.boons]);
    }
    if (!only || only.includes('costs'))
      for (const [tier, pool] of Object.entries(catalog.costPools))
        for (const cost of pool) configs.push([cost.label, `T${tier} cost`, cost.effects]);
  }
  printHeader(`Blessing power — ${seeds} runs per row (recruit route, ${opts.difficulty})`);
  const results = [];
  for (const [label, kind, effects] of configs) {
    const acc = { power: {}, lord: {}, gold: {}, ko: 0, battles: 0 };
    for (let seed = opts.seed; seed < opts.seed + seeds; seed++) {
      const stats = await blessingRun(seed, effects, label);
      for (const [act, s] of Object.entries(stats)) {
        (acc.power[act] ||= []).push(s.power || 0);
        (acc.lord[act] ||= []).push(s.lordPower || 0);
        (acc.gold[act] ||= []).push(s.goldEnd || 0);
        acc.ko += s.battlesWithCmdrKO || 0;
        acc.battles += s.battles || 0;
      }
    }
    results.push({ label, kind, acc });
    if (opts.verbose) console.log('done', label);
  }
  const base = results[0].acc;
  const rows = results.map(({ label, kind, acc }) => {
    const d = (field, act) =>
      Math.round(mean(acc[field][act] || []) - mean(base[field][act] || []));
    return {
      blessing: label,
      kind,
      'Δsquad A1': d('power', 'act1'),
      'Δsquad A2': d('power', 'act2'),
      'Δsquad A3': d('power', 'act3'),
      'Δlords A3': d('lord', 'act3'),
      'Δgold A1': d('gold', 'act1'),
      'Δgold A3': d('gold', 'act3'),
      'cmdrKO%': pct(acc.ko, acc.battles),
    };
  });
  printTable(
    [
      'blessing',
      'kind',
      'Δsquad A1',
      'Δsquad A2',
      'Δsquad A3',
      'Δlords A3',
      'Δgold A1',
      'Δgold A3',
      'cmdrKO%',
    ],
    rows,
  );
  console.log(
    '\nΔsquad = stat points (HP+STR+MAG+SKL+SPD+DEF+RES+LCK) of the strongest deploy-cap units at act end, vs no blessing.',
  );
}

// ---------------------------------------------------------------------------
// arts: what Scroll Archive hands out on day one. For every art scroll the run-start
// grant can pick (compatible with a starting lord's weapons), its unlock act and the
// act-1 kill-chance uplift when a lord uses it (forecast odds, one player-phase exchange
// against sampled act-1 foes, lords at level 3 with their starting weapons).

import {
  getWeaponArtCombatMods,
  getWeaponArtAllowedTypes as allowedTypesOf,
} from '../src/engine/WeaponArtSystem.js';
import { sampleEnemyFromAct } from './lib/EnemySampling.js';
import { createEnemy } from './lib/SimUnitFactory.js';

import { hitProbability } from '../src/engine/HitRoll.js';
import { getCombatForecast } from '../src/engine/Combat.js';

async function sectionArts() {
  printHeader('Scroll Archive — what a run-start scroll grant can be');
  const rm = new RunManager(gameData, null);
  rm.runSeed = 1;
  installSeed(99);
  const lords = rm.createInitialRoster().map((u) => structuredClone(u));
  const rng = seededRng(5);
  for (const u of lords) levelTo(u, 3, rng);
  const arts = new Map(gameData.weaponArts.arts.map((a) => [a.id, a]));
  const scrolls = gameData.weapons.filter(
    (w) => w.type === 'Scroll' && typeof w.teachesWeaponArtId === 'string',
  );
  const foes = [];
  for (let i = 0; i < 300; i++) {
    const spec = sampleEnemyFromAct(gameData.enemies, gameData.classes, 'act1', [2, 3]);
    foes.push(createEnemy(spec.className, spec.level, gameData.skills, 'act1'));
  }
  restoreMathRandom();
  const rows = [];
  for (const scroll of scrolls) {
    const art = arts.get(scroll.teachesWeaponArtId);
    if (!art) continue;
    const types = allowedTypesOf(art);
    const user = lords.find((l) =>
      (l.inventory || []).some((w) => types.includes(w.type) && w.type !== 'Staff'),
    );
    if (!user) continue;
    const weapon = user.inventory.find((w) => types.includes(w.type));
    const rankOk =
      (art.requiredRank || 'Prof') !== 'Mast' ||
      (user.proficiencies || []).some((p) => p.type === weapon.type && p.rank === 'Mast');
    let base = 0;
    let withArt = 0;
    for (const foe of foes) {
      const plain = getCombatForecast(user, weapon, foe, foe.weapon, 1, null, null, {
        skillsData: gameData.skills,
      });
      const arted = getCombatForecast(user, weapon, foe, foe.weapon, 1, null, null, {
        skillsData: gameData.skills,
        atkWeaponArtMods: getWeaponArtCombatMods(art),
      });
      const hp = foe.currentHP ?? foe.stats.HP;
      if (opts.verbose && foe === foes[0]) console.log(JSON.stringify(plain.attacker), hp);
      base +=
        (Math.max(0, plain.attacker.damage) *
          hitProbability(plain.attacker.hit) *
          plain.attacker.attackCount) /
        hp;
      withArt +=
        (Math.max(0, arted.attacker.damage) *
          hitProbability(arted.attacker.hit) *
          arted.attacker.attackCount) /
        hp;
    }
    rows.push({
      scroll: scroll.name,
      user: user.name,
      unlocks: art.unlockAct || 'act1',
      price: scroll.price,
      rank: rankOk ? 'ok' : 'Mast',
      hpCost: art.hpCost,
      'dmg%HP': Math.round((1000 * base) / foes.length) / 10,
      'dmg%HP art': Math.round((1000 * withArt) / foes.length) / 10,
    });
  }
  rows.sort((a, b) => a.unlocks.localeCompare(b.unlocks));
  printTable(
    ['scroll', 'user', 'unlocks', 'price', 'rank', 'hpCost', 'dmg%HP', 'dmg%HP art'],
    rows,
  );
  const byAct = {};
  for (const r of rows) byAct[r.unlocks] = (byAct[r.unlocks] || 0) + 1;
  console.log('\nGrantable scrolls by unlock act:', JSON.stringify(byAct), 'of', rows.length);
}

const sections = {
  arts: sectionArts,
  blessings: sectionBlessings,
  graph: sectionGraph,
  debug: sectionDebug,
  spawn: sectionSpawn,
  route: sectionRoute,
  value: sectionValue,
  unitvalue: sectionUnitValue,
};
const run = sections[opts.section];
if (!run) {
  console.error(`Unknown --section ${opts.section}. Known: ${Object.keys(sections).join(', ')}`);
  process.exit(1);
}
await run();
