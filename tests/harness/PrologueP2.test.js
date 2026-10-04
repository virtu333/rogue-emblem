// Prologue P2, "Old Hands" (docs/specs/prologue-chapter.md §6 P2, §8): the harness
// owns the final tiles. Edric (at P1's expected level, and at his P1 stats as the
// floor) and Gaspar against the outrider squad at the ford, through the real engine
// (HeadlessBattle on the locked config, the roster buildPrologueRoster builds for a
// replay). Three policies: the intended play (chip with the lance, finish with
// Edric, never into a lethal counter), the naive play (attack the nearest enemy with
// the equipped weapon, drink the Vulnerary when P1's note said so) and Gaspar alone.
import { afterEach, describe, expect, it } from 'vitest';
import { HeadlessBattle, HEADLESS_STATES } from './HeadlessBattle.js';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { buildPrologueBattleConfig, buildPrologueRoster } from '../../src/engine/Prologue.js';
import { enemyThreatTiles } from '../../src/engine/ThreatForecast.js';
import { getCombatForecast, gridDistance } from '../../src/engine/Combat.js';
import { equipWeapon } from '../../src/engine/UnitManager.js';
import { healUnit } from '../../src/engine/UnitHealth.js';
import { XP_MIN } from '../../src/utils/constants.js';

const data = loadGameData();
const prologue = data.prologue;
const chapter = prologue.chapters.find((c) => c.id === 'p2_old_hands');
const config = buildPrologueBattleConfig(chapter, data.terrain);
const PARAMS = { act: 'act1', objective: 'rout', difficultyId: 'normal' };
const SEEDS = 300;
const VILLAGE = chapter.villageTile;
const BRIDGE = { col: 5, row: 2 };

afterEach(() => restoreMathRandom());

/** Edric at the chapter's expected level (a replay), or at his P1 stats (`floor`). */
function startP2(seed, { floor = false } = {}) {
  installSeed(seed);
  const spec = floor ? { ...chapter, rosterLevels: undefined } : chapter;
  const roster = buildPrologueRoster(prologue, data, spec);
  const battle = new HeadlessBattle(data, { ...PARAMS }, roster);
  battle.init({ battleConfig: config });
  return battle;
}

const enemy = (battle, id) => battle.enemyUnits.find((u) => u.authoredId === id) || null;
const unit = (battle, name) => battle.playerUnits.find((u) => u.name === name) || null;
const key = (t) => `${t.col},${t.row}`;
const same = (a, b) => a.col === b.col && a.row === b.row;
const weapon = (u, name) => (u.inventory || []).find((w) => w.name === name);
const terrain = (name) => data.terrain.find((t) => t.name === name);

async function finishPhase(battle) {
  if (battle.battleState === HEADLESS_STATES.PLAYER_IDLE) await battle.endTurn();
  if (battle.battleState === HEADLESS_STATES.ENEMY_PHASE) await battle._processEnemyPhase();
}

function stoppableTiles(battle) {
  const u = battle.selectedUnit;
  const tiles = [...battle.movementRange]
    .filter(([, e]) => e?.stoppable !== false)
    .map(([k, e]) => {
      const [col, row] = k.split(',').map(Number);
      return { col, row, cost: e?.cost ?? 0 };
    });
  if (!tiles.some((t) => same(t, u))) tiles.push({ col: u.col, row: u.row, cost: 0 });
  return tiles;
}

function attackFrom(battle, tile, target, weaponName = null) {
  battle.moveTo(tile.col, tile.row);
  const u = battle.selectedUnit;
  if (weaponName) equipWeapon(u, weapon(u, weaponName));
  battle.chooseAction('Attack');
  battle.chooseAttackTarget(target);
}

function moveAndWait(battle, tile) {
  battle.moveTo(tile.col, tile.row);
  battle.chooseAction('Wait');
}

/** Tiles in reach from which `target` is one tile away, cheapest first. */
function strikeTiles(tiles, target) {
  return tiles
    .filter((t) => gridDistance(t.col, t.row, target.col, target.row) === 1)
    .sort((p, q) => p.cost - q.cost || p.row - q.row || p.col - q.col);
}

/** The forecast of `attacker` striking `defender` from `from` with `weaponObj`. */
function forecastAt(battle, attacker, from, weaponObj, defender) {
  const saved = [attacker.col, attacker.row];
  Object.assign(attacker, { col: from.col, row: from.row });
  try {
    const ctx = battle._buildSkillCtx(attacker, defender);
    return getCombatForecast(
      attacker,
      weaponObj,
      defender,
      defender.weapon,
      gridDistance(from.col, from.row, defender.col, defender.row),
      battle.grid.getTerrainAt(from.col, from.row),
      battle.grid.getTerrainAt(defender.col, defender.row),
      ctx,
    );
  } finally {
    battle._clearCombatRollSession();
    [attacker.col, attacker.row] = saved;
  }
}

/** Worst HP a forecast side can take off the other: every strike hits (and crits). */
function worstDamage(side, { crits = true } = {}) {
  if (!side || !side.attackCount) return 0;
  const strike = crits && side.crit > 0 ? side.damage * 3 : side.damage;
  return strike * side.attackCount;
}

/** Enemies (other than `exclude`) whose Danger tiles hold `tile` (player knowledge). */
function reachers(battle, tile, exclude = null) {
  const ctx = battle._playerThreatContext();
  return battle.enemyUnits.filter(
    (e) => e !== exclude && enemyThreatTiles(ctx, e).damage.has(key(tile)),
  );
}

/** Worst damage every enemy that reaches `tile` could deal `u` next phase. */
function exposure(battle, u, tile, { exclude = null, crits = false } = {}) {
  let total = 0;
  for (const e of reachers(battle, tile, exclude)) {
    total += worstDamage(forecastAt(battle, e, e, e.weapon, u).attacker, { crits });
  }
  return total;
}

/** Walking distance from any tile to `target` for `u`'s move type (terrain only). */
function pathDistances(battle, u, target) {
  const range = battle.grid.getMovementRange(target.col, target.row, 99, u.moveType, null, null);
  return (t) => range.get(key(t))?.cost ?? Infinity;
}

/** A unit at 60% HP or less drinks its Vulnerary: P1's note, and the coach's own goal. */
function drinkIfHurt(battle, u) {
  const vul = (u.consumables || []).find((c) => c.name === 'Vulnerary');
  if (!vul || u.currentHP * 100 > u.stats.HP * 60) return false;
  healUnit(u, Number(vul.value) || 10);
  u.consumables.splice(u.consumables.indexOf(vul), 1);
  moveAndWait(battle, u);
  return true;
}

/**
 * The naive policy (§8): strike the nearest enemy (by the road) that any tile in reach
 * allows, with the equipped weapon, from the cheapest such tile; else walk toward the
 * nearest enemy. No weapon choice, no terrain sense; the Vulnerary when hurt.
 */
function naive(battle, u, tiles) {
  if (drinkIfHurt(battle, u)) return;
  const byDistance = battle.enemyUnits
    .map((e) => ({ e, d: pathDistances(battle, u, e)(u) }))
    .sort((x, y) => x.d - y.d)
    .map((x) => x.e);
  for (const target of byDistance) {
    const from = strikeTiles(tiles, target)[0];
    if (from) {
      attackFrom(battle, from, target);
      return;
    }
  }
  const to = pathDistances(battle, u, byDistance[0]);
  const best = [...tiles].sort(
    (p, q) => to(p) - to(q) || p.cost - q.cost || p.row - q.row || p.col - q.col,
  )[0];
  moveAndWait(battle, best);
}

/** Gaspar rides at the squad alone; Edric stays where he spawned (§6 P2, the Seth risk). */
function gasparOnly(battle, u, tiles) {
  if (u.name === 'Edric') return moveAndWait(battle, u);
  naive(battle, u, tiles);
}

/**
 * The intended play (§6 P2): Gaspar chips with the lance so Edric finishes, a sword
 * kill only for a foe Edric cannot reach, and no attack whose worst counter plus the
 * worst enemy phase would leave the unit short; Edric visits the village when it is
 * safe; both advance to the least exposed tile that still closes in, Gaspar never a
 * turn ahead of Edric.
 */
function intended(battle, u, tiles) {
  const edric = unit(battle, 'Edric');
  const gaspar = unit(battle, 'Gaspar');
  if (u.name === 'Edric' && drinkIfHurt(battle, u)) return;
  const options = [];
  for (const target of battle.enemyUnits) {
    for (const from of strikeTiles(tiles, target).slice(0, 3)) {
      const names = u.name === 'Gaspar' ? ['Steel Lance', 'Iron Sword'] : [u.weapon?.name];
      for (const name of names) {
        const w = u.name === 'Gaspar' ? weapon(u, name) : u.weapon;
        const f = forecastAt(battle, u, from, w, target);
        const left = target.currentHP - f.attacker.damage * f.attacker.attackCount;
        const kills = left <= 0;
        const after =
          u.currentHP -
          worstDamage(f.defender, { crits: false }) -
          exposure(battle, u, from, { exclude: kills ? target : null });
        options.push({ target, from, name, left, kills, after });
      }
    }
  }
  const floor = u.name === 'Gaspar' ? 2 : 4;
  const safe = options.filter((o) => o.after >= floor).sort((a, b) => b.after - a.after);
  if (u.name === 'Gaspar') {
    const edricHit = (t) =>
      edric && !edric.hasActed ? forecastAt(battle, edric, edric, edric.weapon, t).attacker.damage : 0; // prettier-ignore
    const chips = safe.filter(
      (o) => o.name === 'Steel Lance' && !o.kills && o.left > 0 && o.left <= edricHit(o.target),
    );
    const lanceFirst = (a, b) => (a.name === 'Steel Lance' ? 0 : 1) - (b.name === 'Steel Lance' ? 0 : 1); // prettier-ignore
    const kills = safe.filter((o) => o.kills).sort(lanceFirst);
    const pick = chips[0] || kills[0] || safe.filter((o) => o.name === 'Steel Lance')[0];
    if (pick) return attackFrom(battle, pick.from, pick.target, pick.name);
  } else {
    const finish = safe.filter((o) => o.kills)[0];
    if (finish) return attackFrom(battle, finish.from, finish.target);
    const villageOpen = battle._villageState?.status === 'intact';
    if (
      villageOpen &&
      tiles.some((t) => same(t, VILLAGE)) &&
      u.currentHP - exposure(battle, u, VILLAGE) > 0
    )
      // prettier-ignore
      return moveAndWait(battle, VILLAGE);
    const chip = safe.filter((o) => o.after >= 8)[0];
    if (chip) return attackFrom(battle, chip.from, chip.target);
  }
  const nearest = battle.enemyUnits
    .map((e) => ({ e, d: pathDistances(battle, u, e)(u) }))
    .sort((x, y) => x.d - y.d)[0].e;
  const to = pathDistances(battle, u, nearest);
  const anchor = u.name === 'Gaspar' ? edric : gaspar;
  const near = (t) => (anchor ? gridDistance(t.col, t.row, anchor.col, anchor.row) : 0);
  const margin = u.name === 'Gaspar' ? 5 : 8;
  const scored = tiles.map((t) => ({ t, exp: exposure(battle, u, t) }));
  const okay = scored.filter((x) => u.currentHP - x.exp >= margin);
  const pool = okay.length ? okay : scored;
  const score = (x) => to(x.t) * 2 + x.exp + (u.name === 'Gaspar' && near(x.t) > 4 ? 6 : 0);
  const best = [...pool].sort(
    (p, q) => score(p) - score(q) || p.t.cost - q.t.cost || p.t.row - q.t.row || p.t.col - q.t.col,
  )[0];
  moveAndWait(battle, best.t);
}

/** Who killed each authored enemy (by id), recorded through the harness's kill funnel. */
function trackKills(battle) {
  const kills = {};
  const original = battle._applyKillRewards.bind(battle);
  battle._applyKillRewards = (victim, killer) => {
    if (victim?.authoredId) kills[victim.authoredId] = killer?.name || null;
    return original(victim, killer);
  };
  return kills;
}

/** One player phase under a policy (Gaspar, then Edric), then the enemy phase. */
async function playTurn(battle, policy, onPhaseEnd = null) {
  for (const name of ['Gaspar', 'Edric']) {
    const u = unit(battle, name);
    if (!u || u.hasActed || battle.battleState !== HEADLESS_STATES.PLAYER_IDLE) continue;
    battle.selectUnit(name);
    policy(battle, u, stoppableTiles(battle));
  }
  onPhaseEnd?.(battle);
  await finishPhase(battle);
}

async function play(battle, policy, { maxTurns = 14, onPhaseEnd = null } = {}) {
  const trail = [];
  for (let turn = 0; turn < maxTurns && !battle.result; turn++) {
    await playTurn(battle, policy, onPhaseEnd);
    trail.push({
      turn: turn + 1,
      edric: unit(battle, 'Edric')?.currentHP ?? 0,
      gaspar: unit(battle, 'Gaspar')?.currentHP ?? 0,
    });
  }
  return trail;
}

const bothStand = (battle) =>
  battle.result === 'victory' &&
  unit(battle, 'Edric')?.currentHP > 0 &&
  unit(battle, 'Gaspar')?.currentHP > 0;

describe('Prologue P2: Old Hands', () => {
  it("the spec's numbers hold: the lance chips the Archer, the sword kills it, Edric finishes", () => {
    const battle = startP2(prologue.seed, { floor: true });
    const gaspar = unit(battle, 'Gaspar');
    const edric = unit(battle, 'Edric');
    const archer = enemy(battle, 'a');
    const plain = terrain('Plain');
    const lance = getCombatForecast(gaspar, weapon(gaspar, 'Steel Lance'), archer, archer.weapon, 1, plain, plain); // prettier-ignore
    expect([lance.attacker.damage, lance.attacker.attackCount, lance.attacker.doubles]).toEqual([16, 1, false]); // prettier-ignore
    expect(lance.attacker.hit).toBe(88);
    expect(lance.defender.canCounter).toBe(false);
    expect(archer.stats.HP - lance.attacker.damage).toBe(2);
    const sword = getCombatForecast(gaspar, weapon(gaspar, 'Iron Sword'), archer, archer.weapon, 1, plain, plain); // prettier-ignore
    expect([sword.attacker.damage, sword.attacker.attackCount, sword.attacker.doubles]).toEqual([12, 2, true]); // prettier-ignore
    expect(sword.attacker.damage * sword.attacker.attackCount).toBeGreaterThanOrEqual(archer.stats.HP); // prettier-ignore
    const finish = getCombatForecast(edric, edric.weapon, archer, archer.weapon, 1, plain, plain);
    expect(finish.attacker.damage).toBe(8);
    expect(finish.attacker.hit).toBe(100);
    expect(finish.defender.canCounter).toBe(false);
    // The Fighter: axes beat Gaspar's lance (10 at 75%), his sword beats the axe.
    const fighter = enemy(battle, 'b');
    const axeOnLance = getCombatForecast(fighter, fighter.weapon, gaspar, weapon(gaspar, 'Steel Lance'), 1, plain, plain); // prettier-ignore
    expect([axeOnLance.attacker.damage, axeOnLance.attacker.hit]).toEqual([10, 75]);
    const swordOnAxe = getCombatForecast(gaspar, weapon(gaspar, 'Iron Sword'), fighter, fighter.weapon, 1, plain, plain); // prettier-ignore
    expect([swordOnAxe.attacker.damage, swordOnAxe.attacker.attackCount]).toEqual([13, 2]);
    // The Soldier at its post: lances beat Edric's sword; Gaspar's lance is the answer.
    const soldier = enemy(battle, 'd');
    expect(soldier.aiMode).toBe('guard');
    const edricVsSoldier = getCombatForecast(edric, edric.weapon, soldier, soldier.weapon, 1, plain, plain); // prettier-ignore
    expect(edricVsSoldier.display?.triangle?.damage).toBeLessThan(0);
    expect(edricVsSoldier.defender.damage).toBe(8);
    const lanceVsSoldier = getCombatForecast(gaspar, weapon(gaspar, 'Steel Lance'), soldier, soldier.weapon, 1, plain, plain); // prettier-ignore
    expect(lanceVsSoldier.attacker.damage).toBe(13);
    // No enemy of the chapter can crit Edric: his luck covers every one of them.
    for (const e of battle.enemyUnits) {
      const f = getCombatForecast(e, e.weapon, edric, edric.weapon, 1, plain, plain);
      expect(f.attacker.crit, e.authoredId).toBe(0);
    }
  });

  it('a replay enters with Edric at level 2 and the standard veteran; the village and loot are authored', () => {
    const battle = startP2(prologue.seed);
    expect(unit(battle, 'Edric').level).toBe(2);
    const gaspar = unit(battle, 'Gaspar');
    expect(gaspar.specialCharId).toBe('old_knight');
    expect(gaspar.inventory.map((w) => w.name)).toEqual(['Steel Lance', 'Iron Sword']);
    expect(gaspar.skills).toEqual(['measured_step', 'aegis']);
    expect(config.villageTile).toEqual({ col: 3, row: 4, uncontested: true, reward: 'Iron Bow' });
    expect(config.hidePar).toBe(true);
    expect(battle.turnPar).toBeNull();
    expect(config.loot.map((l) => l.item || `${l.gold}g`)).toEqual(['Iron Lance', 'Vulnerary', '150g']); // prettier-ignore
  });

  it('a kill earns Gaspar the minimum XP while the same kill grows Edric', () => {
    const battle = startP2(prologue.seed);
    const gaspar = unit(battle, 'Gaspar');
    const edric = unit(battle, 'Edric');
    const archer = enemy(battle, 'a');
    const before = { g: gaspar.xp, e: edric.xp, level: edric.level };
    battle._awardCombatXP(gaspar, archer, true, archer.stats.HP, archer.stats.HP);
    battle._awardCombatXP(edric, archer, true, archer.stats.HP, archer.stats.HP);
    expect(gaspar.xp - before.g).toBe(XP_MIN);
    expect((edric.level - before.level) * 100 + edric.xp - before.e).toBeGreaterThanOrEqual(30);
  });

  it('turn 1 is the Jagen beat: both can reach the Archer, and only the Fighter can reach the bridge', () => {
    const battle = startP2(prologue.seed, { floor: true });
    const archer = enemy(battle, 'a');
    battle.selectUnit('Gaspar');
    expect(strikeTiles(stoppableTiles(battle), archer).length).toBeGreaterThan(0);
    battle.cancel();
    battle.selectUnit('Edric');
    expect(strikeTiles(stoppableTiles(battle), archer).length).toBeGreaterThan(0);
    battle.cancel();
    const ctx = battle._playerThreatContext();
    const fighter = enemy(battle, 'b');
    const soldier = enemy(battle, 'd');
    expect(enemyThreatTiles(ctx, fighter).damage.has(key(BRIDGE))).toBe(true);
    expect(enemyThreatTiles(ctx, soldier).damage.has(key(BRIDGE))).toBe(false);
    expect(enemyThreatTiles(ctx, soldier).damage.has(key(VILLAGE))).toBe(false);
  });

  it('the Soldier guards its post until someone comes within three tiles of it', async () => {
    const battle = startP2(prologue.seed);
    const soldier = enemy(battle, 'd');
    const post = { col: soldier.col, row: soldier.row };
    battle.selectUnit('Gaspar');
    moveAndWait(battle, { col: 4, row: 2 });
    battle.selectUnit('Edric');
    moveAndWait(battle, unit(battle, 'Edric'));
    await finishPhase(battle);
    expect({ col: soldier.col, row: soldier.row }).toEqual(post);
  });

  it('the intended play wins every seed with nobody falling, Edric finishing the Archer, and no exposure that could kill him', async () => {
    let edricFinishes = 0;
    let villageVisits = 0;
    let lowestEdric = Infinity;
    let lowestGaspar = Infinity;
    const turns = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const battle = startP2(seed === 1 ? prologue.seed : seed, { floor: seed % 2 === 0 });
      const kills = trackKills(battle);
      // Where every player phase leaves Edric: no sequence of hits and crits kills him.
      const guard = (b) => {
        const edric = unit(b, 'Edric');
        if (!edric) return;
        const worst = exposure(b, edric, edric, { crits: true });
        expect(worst, `seed ${seed}, turn ${b.turnManager.turnNumber}`).toBeLessThan(edric.currentHP); // prettier-ignore
      };
      const trail = await play(battle, intended, { onPhaseEnd: guard });
      expect(bothStand(battle), `seed ${seed}`).toBe(true);
      if (kills.a === 'Edric') edricFinishes++;
      if (battle._villageState?.status === 'visited') villageVisits++;
      for (const step of trail) {
        lowestEdric = Math.min(lowestEdric, step.edric);
        lowestGaspar = Math.min(lowestGaspar, step.gaspar);
      }
      turns.push(trail.length);
      restoreMathRandom();
    }
    console.log(
      `[P2 intended] ${SEEDS}/${SEEDS} wins; lowest HP Edric ${lowestEdric}, Gaspar ${lowestGaspar}; Edric finished the Archer in ${edricFinishes}; village visited ${villageVisits}; turns ${Math.min(...turns)}-${Math.max(...turns)}`,
    );
    // The lance lands 88% of the time; a miss leaves the Archer for the next turn.
    expect(edricFinishes).toBeGreaterThanOrEqual(SEEDS * 0.85);
    expect(villageVisits).toBeGreaterThanOrEqual(SEEDS * 0.98);
    expect(Math.max(...turns)).toBeLessThanOrEqual(8);
  });

  it('the naive policy wins (almost) every seed with nobody falling, at either level of Edric', async () => {
    for (const floor of [false, true]) {
      let wins = 0;
      let lowestEdric = Infinity;
      let lowestGaspar = Infinity;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const battle = startP2(seed, { floor });
        const trail = await play(battle, naive);
        if (bothStand(battle)) wins++;
        for (const step of trail) {
          lowestEdric = Math.min(lowestEdric, step.edric);
          lowestGaspar = Math.min(lowestGaspar, step.gaspar);
        }
        restoreMathRandom();
      }
      console.log(
        `[P2 naive${floor ? ', Edric at P1 stats' : ''}] ${wins}/${SEEDS} wins with both standing; lowest HP Edric ${lowestEdric}, Gaspar ${lowestGaspar}`,
      );
      expect(wins).toBeGreaterThanOrEqual(SEEDS * 0.98);
    }
  });

  it('Gaspar alone does not solve the map: riding at the squad loses him', async () => {
    let gasparFell = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const battle = startP2(seed);
      await play(battle, gasparOnly);
      if (!(unit(battle, 'Gaspar')?.currentHP > 0)) gasparFell++;
      restoreMathRandom();
    }
    console.log(`[P2 Gaspar-only] Gaspar fell in ${gasparFell}/100`);
    expect(gasparFell).toBeGreaterThanOrEqual(80);
  });
});
