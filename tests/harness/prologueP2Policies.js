// Prologue P2's policies and helpers (docs/specs/prologue-chapter.md §6 P2, §8), shared
// by its proofs (PrologueP2.test.js) and P3's, which enters P3 from P2's real end states.
import { HeadlessBattle, HEADLESS_STATES } from './HeadlessBattle.js';
import { loadGameData } from '../testData.js';
import { installSeed } from '../../sim/lib/SeededRNG.js';
import { buildPrologueBattleConfig, buildPrologueRoster } from '../../src/engine/Prologue.js';
import { enemyThreatTiles } from '../../src/engine/ThreatForecast.js';
import { getCombatForecast, gridDistance } from '../../src/engine/Combat.js';
import { equipWeapon } from '../../src/engine/UnitManager.js';
import { healUnit } from '../../src/engine/UnitHealth.js';

export const data = loadGameData();
export const prologue = data.prologue;
export const chapter = prologue.chapters.find((c) => c.id === 'p2_old_hands');
export const config = buildPrologueBattleConfig(chapter, data.terrain);
export const PARAMS = { act: 'act1', objective: 'rout', difficultyId: 'normal' };
export const SEEDS = 300;
export const VILLAGE = chapter.villageTile;
export const BRIDGE = { col: 5, row: 2 };

/** Edric at the chapter's expected level (a replay), or at his P1 stats (`floor`). */
export function startP2(seed, { floor = false } = {}) {
  installSeed(seed);
  const spec = floor ? { ...chapter, rosterLevels: undefined } : chapter;
  const roster = buildPrologueRoster(prologue, data, spec);
  const battle = new HeadlessBattle(data, { ...PARAMS }, roster);
  battle.init({ battleConfig: config });
  return battle;
}

export const enemy = (battle, id) => battle.enemyUnits.find((u) => u.authoredId === id) || null;
export const unit = (battle, name) => battle.playerUnits.find((u) => u.name === name) || null;
export const key = (t) => `${t.col},${t.row}`;
export const same = (a, b) => a.col === b.col && a.row === b.row;
export const weapon = (u, name) => (u.inventory || []).find((w) => w.name === name);
export const terrain = (name) => data.terrain.find((t) => t.name === name);

export async function finishPhase(battle) {
  if (battle.battleState === HEADLESS_STATES.PLAYER_IDLE) await battle.endTurn();
  if (battle.battleState === HEADLESS_STATES.ENEMY_PHASE) await battle._processEnemyPhase();
}

export function stoppableTiles(battle) {
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

export function attackFrom(battle, tile, target, weaponName = null) {
  battle.moveTo(tile.col, tile.row);
  const u = battle.selectedUnit;
  if (weaponName) equipWeapon(u, weapon(u, weaponName));
  battle.chooseAction('Attack');
  battle.chooseAttackTarget(target);
}

export function moveAndWait(battle, tile) {
  battle.moveTo(tile.col, tile.row);
  battle.chooseAction('Wait');
}

/** Tiles in reach from which `target` is one tile away, cheapest first. */
export function strikeTiles(tiles, target) {
  return tiles
    .filter((t) => gridDistance(t.col, t.row, target.col, target.row) === 1)
    .sort((p, q) => p.cost - q.cost || p.row - q.row || p.col - q.col);
}

/** The forecast of `attacker` striking `defender` from `from` with `weaponObj`. */
export function forecastAt(battle, attacker, from, weaponObj, defender) {
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
export function worstDamage(side, { crits = true } = {}) {
  if (!side || !side.attackCount) return 0;
  const strike = crits && side.crit > 0 ? side.damage * 3 : side.damage;
  return strike * side.attackCount;
}

/** Enemies (other than `exclude`) whose Danger tiles hold `tile` (player knowledge). */
export function reachers(battle, tile, exclude = null) {
  const ctx = battle._playerThreatContext();
  return battle.enemyUnits.filter(
    (e) => e !== exclude && enemyThreatTiles(ctx, e).damage.has(key(tile)),
  );
}

/** Worst damage every enemy that reaches `tile` could deal `u` next phase. */
export function exposure(battle, u, tile, { exclude = null, crits = false } = {}) {
  let total = 0;
  for (const e of reachers(battle, tile, exclude)) {
    total += worstDamage(forecastAt(battle, e, e, e.weapon, u).attacker, { crits });
  }
  return total;
}

/** Walking distance from any tile to `target` for `u`'s move type (terrain only). */
export function pathDistances(battle, u, target) {
  const range = battle.grid.getMovementRange(target.col, target.row, 99, u.moveType, null, null);
  return (t) => range.get(key(t))?.cost ?? Infinity;
}

/** A unit at 60% HP or less drinks its Vulnerary: P1's note, and the coach's own goal. */
export function drinkIfHurt(battle, u) {
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
export function naive(battle, u, tiles) {
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
export function gasparOnly(battle, u, tiles) {
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
export function intended(battle, u, tiles) {
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
export function trackKills(battle) {
  const kills = {};
  const original = battle._applyKillRewards.bind(battle);
  battle._applyKillRewards = (victim, killer) => {
    if (victim?.authoredId) kills[victim.authoredId] = killer?.name || null;
    return original(victim, killer);
  };
  return kills;
}

/** One player phase under a policy (Gaspar, then Edric), then the enemy phase. */
export async function playTurn(battle, policy, onPhaseEnd = null) {
  for (const name of ['Gaspar', 'Edric']) {
    const u = unit(battle, name);
    if (!u || u.hasActed || battle.battleState !== HEADLESS_STATES.PLAYER_IDLE) continue;
    battle.selectUnit(name);
    policy(battle, u, stoppableTiles(battle));
  }
  onPhaseEnd?.(battle);
  await finishPhase(battle);
}

export async function play(battle, policy, { maxTurns = 14, onPhaseEnd = null } = {}) {
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

export const bothStand = (battle) =>
  battle.result === 'victory' &&
  unit(battle, 'Edric')?.currentHP > 0 &&
  unit(battle, 'Gaspar')?.currentHP > 0;
