// Prologue P1, "Banner at Dawn" (docs/specs/prologue-chapter.md §6 P1, §8): the harness
// owns the final tiles. Edric alone against two Fighters on the authored map, with the
// authored units and spawns, through the real engine (HeadlessBattle on the locked config).
import { afterEach, describe, expect, it } from 'vitest';
import { HeadlessBattle, HEADLESS_STATES } from './HeadlessBattle.js';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { buildPrologueBattleConfig, buildPrologueUnits } from '../../src/engine/Prologue.js';
import { enemyThreatTiles } from '../../src/engine/ThreatForecast.js';
import { getCombatForecast, gridDistance } from '../../src/engine/Combat.js';

const data = loadGameData();
const prologue = data.prologue;
const chapter = prologue.chapters.find((c) => c.id === 'p1_banner_at_dawn');
const config = buildPrologueBattleConfig(chapter, data.terrain);
const FORT = { col: 3, row: 2 }; // the gated move (beat p1_move_to_fort)
const FORT_B = { col: 5, row: 4 }; // the cover inside b's reach (the fight with b)
const PARAMS = { act: 'act1', objective: 'rout', difficultyId: 'normal' };
const SEEDS = 300;

afterEach(() => restoreMathRandom());

function startP1(seed) {
  installSeed(seed);
  const [edric] = buildPrologueUnits(prologue, data, ['Edric']);
  const battle = new HeadlessBattle(data, { ...PARAMS }, [edric]);
  battle.init({ battleConfig: config });
  return battle;
}

const enemy = (battle, id) => battle.enemyUnits.find((u) => u.authoredId === id) || null;
const edricOf = (battle) => battle.playerUnits.find((u) => u.name === 'Edric') || null;
const key = (t) => `${t.col},${t.row}`;
const same = (a, b) => a.col === b.col && a.row === b.row;

async function finishPhase(battle) {
  if (battle.battleState === HEADLESS_STATES.PLAYER_IDLE) await battle.endTurn();
  if (battle.battleState === HEADLESS_STATES.ENEMY_PHASE) await battle._processEnemyPhase();
}

function stoppableTiles(battle) {
  const unit = battle.selectedUnit;
  const tiles = [...battle.movementRange]
    .filter(([, e]) => e?.stoppable !== false)
    .map(([k, e]) => {
      const [col, row] = k.split(',').map(Number);
      return { col, row, cost: e?.cost ?? 0 };
    });
  if (!tiles.some((t) => same(t, unit))) tiles.push({ col: unit.col, row: unit.row, cost: 0 });
  return tiles;
}

function attackFrom(battle, tile, target) {
  battle.moveTo(tile.col, tile.row);
  battle.chooseAction('Attack');
  battle.chooseAttackTarget(target);
}

function moveAndWait(battle, tile) {
  battle.moveTo(tile.col, tile.row);
  battle.chooseAction('Wait');
}

/** Edric's move for one player phase under a policy, then the enemy phase. */
async function playTurn(battle, policy) {
  const edric = edricOf(battle);
  if (!edric || edric.hasActed) return finishPhase(battle);
  battle.selectUnit('Edric');
  policy(battle, edric, stoppableTiles(battle));
  await finishPhase(battle);
}

/**
 * The spec's intended play: turn 1 onto the Fort and strike `a`; then finish `a` if it
 * lives; then step onto the cover in `b`'s reach and let `b` come; then strike `b`.
 */
function intended(battle, edric, tiles) {
  const a = enemy(battle, 'a');
  const b = enemy(battle, 'b');
  const adjacent = (target) =>
    tiles
      .filter((t) => gridDistance(t.col, t.row, target.col, target.row) === 1)
      .sort((p, q) => p.cost - q.cost);
  const strike = (target) => {
    const from = adjacent(target).find((t) => same(t, edric)) || adjacent(target)[0];
    if (!from) return false;
    attackFrom(battle, from, target);
    return true;
  };
  if (a && strike(a)) return;
  if (b && b.aiMode === 'hold' && tiles.some((t) => same(t, FORT_B))) {
    moveAndWait(battle, FORT_B);
    return;
  }
  if (b && strike(b)) return;
  moveAndWait(battle, edric);
}

/**
 * The naive policy (§8): strike the nearest enemy if any tile in reach allows it (the
 * cheapest such tile), else any enemy, else walk to the tile nearest the nearest enemy.
 * Ties break by move cost, then row, then column. No items, no terrain sense.
 */
function naive(battle, edric, tiles) {
  const byDistance = [...battle.enemyUnits].sort(
    (x, y) =>
      gridDistance(edric.col, edric.row, x.col, x.row) -
      gridDistance(edric.col, edric.row, y.col, y.row),
  );
  for (const target of byDistance) {
    const from = tiles
      .filter((t) => gridDistance(t.col, t.row, target.col, target.row) === 1)
      .sort((p, q) => p.cost - q.cost || p.row - q.row || p.col - q.col)[0];
    if (from) {
      attackFrom(battle, from, target);
      return;
    }
  }
  const nearest = byDistance[0];
  const to = (t) => gridDistance(t.col, t.row, nearest.col, nearest.row);
  const best = [...tiles].sort(
    (p, q) => to(p) - to(q) || p.cost - q.cost || p.row - q.row || p.col - q.col,
  )[0];
  moveAndWait(battle, best);
}

async function play(battle, policy, maxTurns = 12) {
  const trail = [];
  for (let turn = 0; turn < maxTurns && !battle.result; turn++) {
    await playTurn(battle, policy);
    const edric = edricOf(battle);
    trail.push(edric ? { col: edric.col, row: edric.row, hp: edric.currentHP } : null);
  }
  return trail;
}

/** Infantry Danger tiles from a tile, computed here from terrain.json (Dijkstra + range 1). */
function infantryReach(from, mov) {
  const cost = (col, row) => {
    const raw = data.terrain[config.mapLayout[row][col]].moveCost.Infantry;
    return raw === '--' ? Infinity : Number(raw);
  };
  const best = new Map([[key(from), 0]]);
  const queue = [{ ...from, spent: 0 }];
  while (queue.length) {
    queue.sort((p, q) => p.spent - q.spent);
    const cur = queue.shift();
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const col = cur.col + dc;
      const row = cur.row + dr;
      if (col < 0 || row < 0 || col >= config.cols || row >= config.rows) continue;
      const spent = cur.spent + cost(col, row);
      if (spent > mov || spent >= (best.get(`${col},${row}`) ?? Infinity)) continue;
      best.set(`${col},${row}`, spent);
      queue.push({ col, row, spent });
    }
  }
  const danger = new Set();
  for (const k of best.keys()) {
    const [col, row] = k.split(',').map(Number);
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const c = col + dc;
      const r = row + dr;
      if (c >= 0 && r >= 0 && c < config.cols && r < config.rows) danger.add(`${c},${r}`);
    }
  }
  return danger;
}

/** The forecast of `attacker` (standing on `from`) striking `defender` (standing on `at`). */
function forecastAt(battle, attacker, from, defender, at) {
  const saved = [attacker.col, attacker.row, defender.col, defender.row];
  Object.assign(attacker, { col: from.col, row: from.row });
  Object.assign(defender, { col: at.col, row: at.row });
  try {
    const ctx = battle._buildSkillCtx(attacker, defender);
    return getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      gridDistance(from.col, from.row, at.col, at.row),
      battle.grid.getTerrainAt(from.col, from.row),
      battle.grid.getTerrainAt(at.col, at.row),
      ctx,
    );
  } finally {
    battle._clearCombatRollSession();
    [attacker.col, attacker.row, defender.col, defender.row] = saved;
  }
}

/** Worst HP one side of a forecast can take off the other: every strike hits, and crits. */
function worstDamage(side) {
  if (!side || side.attackCount === 0) return 0;
  const strike = side.crit > 0 ? side.damage * 3 : side.damage;
  return strike * Math.max(1, side.attackCount || 1);
}

const neighbours = (t) =>
  [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
    .map(([dc, dr]) => ({ col: t.col + dc, row: t.row + dr }))
    .filter((n) => n.col >= 0 && n.row >= 0 && n.col < config.cols && n.row < config.rows);

describe('Prologue P1: Banner at Dawn', () => {
  it("the Fort lies outside b's Danger tiles, by path cost", () => {
    const battle = startP1(prologue.seed);
    const b = enemy(battle, 'b');
    const engine = enemyThreatTiles(battle._playerThreatContext(), b).damage;
    const independent = infantryReach(b, b.stats.MOV);
    expect([...engine].sort()).toEqual([...independent].sort());
    expect(engine.has(key(FORT))).toBe(false);
    // ...and b's reach does hold the second Fort, where the fight with b is meant to happen.
    expect(engine.has(key(FORT_B))).toBe(true);
  });

  it('Edric reaches the Fort on turn 1 and can strike a from it', () => {
    const battle = startP1(prologue.seed);
    battle.selectUnit('Edric');
    expect(stoppableTiles(battle).some((t) => same(t, FORT))).toBe(true);
    battle.moveTo(FORT.col, FORT.row);
    expect(battle.getAvailableActions().map((a) => a.label)).toContain('Attack');
    battle.chooseAction('Attack');
    expect(battle.attackTargets).toEqual([enemy(battle, 'a')]);
  });

  it('b stays held through enemy phase 1 when Edric takes the Fort', async () => {
    for (let seed = 1; seed <= 40; seed++) {
      const battle = startP1(seed);
      battle.selectUnit('Edric');
      attackFrom(battle, FORT, enemy(battle, 'a'));
      // Just before the enemy phase: the Fort is still outside b's reach.
      const b = enemy(battle, 'b');
      expect(enemyThreatTiles(battle._playerThreatContext(), b).damage.has(key(FORT))).toBe(false);
      await finishPhase(battle);
      expect(b.aiMode).toBe('hold');
      expect({ col: b.col, row: b.row }).toEqual({ col: 7, row: 5 });
      expect(b.holdWoke).toBeUndefined();
      restoreMathRandom();
    }
  });

  it('the intended play wins with Edric alive, and turn 1 goes as the beats say', async () => {
    const minHp = [];
    let crits = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const battle = startP1(seed === 1 ? prologue.seed : seed);
      const a = enemy(battle, 'a');
      battle.selectUnit('Edric');
      attackFrom(battle, FORT, a);
      if (battle.enemyUnits.includes(a)) {
        // Turn 1 (beat p1_first_forecast): a is left on 6...
        expect(a.currentHP).toBe(6);
        await finishPhase(battle);
        // ...and on enemy phase 1 a attacks, and Edric's counter kills it.
        expect(battle.enemyUnits.includes(a)).toBe(false);
      } else {
        crits++; // Edric's 1% crit ends a on turn 1.
      }
      const trail = await play(battle, intended);
      expect(battle.result).toBe('victory');
      const edric = edricOf(battle);
      expect(edric.currentHP).toBeGreaterThan(0);
      minHp.push(Math.min(edric.currentHP, ...trail.filter(Boolean).map((t) => t.hp)));
      restoreMathRandom();
    }
    expect(crits).toBeLessThan(SEEDS * 0.05);
    console.log(
      `[P1 intended] ${SEEDS}/${SEEDS} wins; lowest HP seen ${Math.min(...minHp)}; a critted on turn 1 in ${crits}`,
    );
  });

  it('the naive policy wins every seed with Edric alive', async () => {
    let wins = 0;
    let lowest = Infinity;
    const fortBTurns = new Set();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const battle = startP1(seed);
      const trail = await play(battle, naive);
      if (battle.result === 'victory' && edricOf(battle)?.currentHP > 0) wins++;
      for (const step of trail.filter(Boolean)) lowest = Math.min(lowest, step.hp);
      // Where the naive walk ends turn 2: the cover in b's reach.
      if (trail[1]) fortBTurns.add(key(trail[1]));
      restoreMathRandom();
    }
    console.log(`[P1 naive] ${wins}/${SEEDS} wins; lowest HP seen ${lowest}`);
    expect(wins).toBe(SEEDS);
    expect([...fortBTurns]).toEqual([key(FORT_B)]);
  });

  it('no run of Fighter hits and crits kills Edric within two enemy phases', () => {
    const battle = startP1(prologue.seed);
    const edric = edricOf(battle);
    const a = enemy(battle, 'a');
    const b = enemy(battle, 'b');
    const startHP = edric.stats.HP;

    // Turn 1, from the Fort: Edric's strikes are certain, a's counter is the only risk.
    const opening = forecastAt(battle, edric, FORT, a, a);
    expect(opening.attacker.hit).toBe(100);
    const aLeft = a.stats.HP - opening.attacker.damage * opening.attacker.attackCount;
    expect(aLeft).toBe(6);
    const turn1 = worstDamage(opening.defender);

    // Enemy phase 1: b can't reach the Fort (its Danger tiles), so only a strikes, from
    // any tile next to the Fort; Edric's counter there always hits and kills it.
    expect(infantryReach(b, b.stats.MOV).has(key(FORT))).toBe(false);
    let phase1 = 0;
    for (const tile of neighbours(FORT)) {
      const strike = forecastAt(battle, a, tile, edric, FORT);
      phase1 = Math.max(phase1, worstDamage(strike.attacker));
      expect(strike.attacker.attackCount).toBe(1);
      expect(strike.defender.hit).toBe(100);
      expect(strike.defender.damage).toBeGreaterThanOrEqual(aLeft);
    }

    // Turn 2 starts on the Fort: 10% of max HP (the opening attack reset the streak).
    const fortHeal = Math.max(1, Math.floor(startHP / 10));

    // Enemy phase 2, wherever Edric waits (still on the Fort, or the cover in b's reach,
    // the naive policy's tile): assume b is awake and reaches him from any side.
    for (const spot of [FORT, FORT_B]) {
      let phase2 = 0;
      for (const tile of neighbours(spot)) {
        phase2 = Math.max(phase2, worstDamage(forecastAt(battle, b, tile, edric, spot).attacker));
      }
      const worstHP = startHP - turn1 - phase1 + fortHeal - phase2;
      expect(worstHP, `worst HP waiting at ${key(spot)}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("the spec's numbers hold for the authored units (getCombatForecast)", () => {
    const battle = startP1(prologue.seed);
    const edric = edricOf(battle);
    const a = enemy(battle, 'a');
    const sword = edric.weapon;
    const axe = a.weapon;
    const terrain = (name) => data.terrain.find((t) => t.name === name);
    // By hand, from the GDD formulas (CLAUDE.md) and the data:
    // Edric: STR 6 + Iron Sword 5 + 1 (sword beats axe) - Fighter DEF 4 = 8.
    const edricHit = sword.might + edric.stats.STR + 1 - a.stats.DEF;
    expect(edricHit).toBe(8);
    // AS: Edric 8 - max(0, 3 - floor(6/5)) = 6; Fighter 5 - max(0, 7... 6 - floor(8/5)) = 0.
    const edricAS = edric.stats.SPD - Math.max(0, sword.weight - Math.floor(edric.stats.STR / 5));
    const fighterAS = a.stats.SPD - Math.max(0, axe.weight - Math.floor(a.stats.STR / 5));
    expect([edricAS, fighterAS]).toEqual([6, 0]);
    // Fighter: STR 8 + Iron Axe 7 - 1 (disadvantage) - Edric DEF 5 (+2 on a Fort).
    const fighterDamage = (def) => a.stats.STR + axe.might - 1 - def;
    expect([fighterDamage(edric.stats.DEF), fighterDamage(edric.stats.DEF + 2)]).toEqual([9, 7]);
    // Hit: 80 + SKL 3 x 2 + LCK 2 - 10 (disadvantage) - Edric's avoid (SPD 8 x 2 + LCK 6,
    // +20 on a Fort) = 56 on Plain, 36 on a Fort.
    const fighterHit = (terrainAvoid) =>
      axe.hit +
      a.stats.SKL * 2 +
      a.stats.LCK -
      10 -
      (edric.stats.SPD * 2 + edric.stats.LCK + terrainAvoid);
    expect([fighterHit(0), fighterHit(20)]).toEqual([56, 36]);

    const plain = terrain('Plain');
    const fort = terrain('Fort');
    const edricStrike = getCombatForecast(edric, sword, a, axe, 1, plain, plain);
    expect(edricStrike.attacker.damage).toBe(edricHit);
    expect(edricStrike.attacker.doubles).toBe(true);
    expect(edricStrike.attacker.attackCount).toBe(2);
    expect(edricStrike.attacker.damage * edricStrike.attacker.attackCount).toBe(16);
    for (const [ground, damage, hit] of [
      [plain, 9, 56],
      [fort, 7, 36],
    ]) {
      const fighterStrike = getCombatForecast(a, axe, edric, sword, 1, plain, ground);
      expect([fighterStrike.attacker.damage, fighterStrike.attacker.hit]).toEqual([damage, hit]);
      expect(fighterStrike.attacker.doubles).toBe(false);
      expect(fighterStrike.attacker.crit).toBe(0);
    }
  });
});
