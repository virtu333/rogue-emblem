// Prologue P4's policies and helpers (docs/specs/prologue-chapter.md §6 P4, §8), shared by
// its proofs (PrologueP4.test.js, PrologueP4Scavenge.test.js). P4 is entered from P3's real
// end states (the run's own army, at the levels P1-P3 leave it) after the watchtower's Rest
// (healed) or Scavenge (HP carries), with any deploy the screen allows, or from the
// replay's canned roster.
// The naive play: the nearest enemy with the equipped weapon from the cheapest tile, plus
// only what the notes say (the deploy note's sword against axes, heal the hurt, drink at
// 60%, no strike into a counter that kills, switch to the weapon that shows ×2 on the
// forecast, a lord leaves the foe whose weapon beats his to someone else to open, the
// commander pulls back at half HP, Sera and Tamsin keep out of reach where they can, strike
// the throne's holder from 2 where you can, and a lord walks to the gate and seizes once
// Varro falls). The intended play: the same habits with every lesson applied (intended()).
// Two measures that the chapter is no free win: the reckless play (reckless()) and Gaspar
// riding alone (gasparAlone()).
import { HeadlessBattle, HEADLESS_STATES } from './HeadlessBattle.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import {
  buildPrologueBattleConfig,
  buildPrologueRoster,
  prologueProtectedNames,
} from '../../src/engine/Prologue.js';
import { enemyThreatTiles } from '../../src/engine/ThreatForecast.js';
import { getBossEnrageTurn } from '../../src/engine/TurnBonusCalculator.js';
import { getWeaponTriangleBonus, gridDistance } from '../../src/engine/Combat.js';
import { canEquip, equipWeapon } from '../../src/engine/UnitManager.js';
import { healUnitFully } from '../../src/engine/UnitHealth.js';
import { serializeUnit } from '../../src/engine/RunManager.js';
import * as P3 from './prologueP3Policies.js';

export const data = P3.data;
export const prologue = data.prologue;
export const CHAPTER_ID = 'p4_quarry_gate';
export const chapter = prologue.chapters.find((c) => c.id === CHAPTER_ID) || null;
export const PARAMS = { act: 'act1', objective: 'seize', difficultyId: 'normal' };
export const SEEDS = 300;
/**
 * The deploys the proofs play (the screen allows any two or three with Edric): every
 * three-unit deploy, and Edric with Gaspar alone. Sera is the only healer.
 */
export const DEPLOYS = [
  ['Edric', 'Gaspar', 'Sera'],
  ['Edric', 'Gaspar', 'Tamsin'],
  ['Edric', 'Tamsin', 'Sera'],
  ['Edric', 'Gaspar'],
];

let current = chapter
  ? { chapter, config: buildPrologueBattleConfig(chapter, data.terrain) }
  : null;

/** The chapter the proofs play (the authored one; exploration may swap in a draft). */
export function useChapter(ch) {
  current = { chapter: ch, config: buildPrologueBattleConfig(ch, data.terrain) };
  return current;
}
export const p4 = () => current;

const { key, same, unit, forecastAt, worstDamage, stoppableTiles, attackFrom, moveAndWait } = P3;
export { key, same, unit, forecastAt, worstDamage, stoppableTiles, attackFrom, moveAndWait };

export const enemy = (battle, id) => battle.enemyUnits.find((u) => u.authoredId === id) || null;
export const boss = (battle) => battle.enemyUnits.find((u) => u.isBoss && u.currentHP > 0) || null;
export const throne = (battle) => battle.battleConfig.thronePos;
export const onThrone = (battle, u) => Boolean(u) && same(u, throne(battle));

/**
 * P4's army: a roster (P3's end state, or the replay's), with the units named in
 * `deploy` fielded in that order (the deploy screen's choice; Edric always first).
 */
export function startP4(
  seed,
  { roster = null, deploy = null, adjust = null, prepare = null } = {},
) {
  installSeed(seed);
  const all = roster
    ? structuredClone(roster)
    : buildPrologueRoster(prologue, data, current.chapter);
  adjust?.(all);
  const names = deploy || all.map((u) => u.name).slice(0, current.config.playerSpawns.length);
  const units = names.map((n) => all.find((u) => u.name === n)).filter(Boolean);
  prepare?.(units);
  const battle = new HeadlessBattle(data, { ...PARAMS }, units);
  battle.init({ battleConfig: current.config });
  return battle;
}

/**
 * Where the throne's holder can strike next phase (AIController's clamp: while not
 * aggressive, a boss on a seize map only stands on the throne or a tile beside it).
 * Aggressive (enraged, or the anti-turtle clock), it is the Danger reach.
 */
function bossReach(battle, v) {
  const t = throne(battle);
  if (battle.aiController?.aggressiveMode || !t) return null;
  const occupied = new Set(
    [...battle.playerUnits, ...battle.enemyUnits, ...battle.npcUnits]
      .filter((x) => x !== v && x.currentHP > 0)
      .map(key),
  );
  const range = battle.grid.getMovementRange(v.col, v.row, v.mov, v.moveType, null, null);
  const stands = [{ col: v.col, row: v.row }];
  for (const [k, e] of range) {
    if (e?.stoppable === false || occupied.has(k)) continue;
    const [col, row] = k.split(',').map(Number);
    if (gridDistance(col, row, t.col, t.row) <= 1) stands.push({ col, row });
  }
  const out = new Set();
  for (const s of stands)
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      out.add(`${s.col + dc},${s.row + dr}`);
  return out;
}

/**
 * Enemies (other than `exclude`) that can strike `tile` next phase. Judged as the
 * enemy phase plays it: enemies move one after another, so one may step aside and
 * free a tile for the next; only our own units block (the Danger overlay's view,
 * pessimistic about that order).
 */
export function reachers(battle, tile, exclude = null) {
  const ctx = battle._playerThreatContext();
  const positions = new Map([...ctx.positions()].filter(([, v]) => v?.faction !== 'enemy'));
  return battle.enemyUnits.filter((e) => {
    if (e === exclude || !(e.currentHP > 0)) return false;
    if (e.isBoss) {
      const zone = bossReach(battle, e);
      if (zone) return zone.has(key(tile));
    }
    return enemyThreatTiles(ctx, e, positions).damage.has(key(tile));
  });
}

/** Worst damage everything that reaches `tile` could deal `u` there next phase. */
export function exposure(battle, u, tile, { exclude = null, crits = false } = {}) {
  const saved = [u.col, u.row];
  Object.assign(u, { col: tile.col, row: tile.row });
  try {
    return reachers(battle, tile, exclude)
      .map((e) => worstDamage(forecastAt(battle, e, e, e.weapon, u).attacker, { crits }))
      .reduce((a, b) => a + b, 0);
  } finally {
    [u.col, u.row] = saved;
  }
}

/** Every strike `u` could make: P3's strike options, judged with P4's boss-aware reach. */
export function strikeOptions(battle, u, tiles, { perTarget = 8 } = {}) {
  const options = [];
  for (const weapon of P3.combatWeapons(u)) {
    for (const target of battle.enemyUnits) {
      if (!(target.currentHP > 0)) continue;
      for (const from of P3.strikeTiles(tiles, target, weapon).slice(0, perTarget)) {
        const f = forecastAt(battle, u, from, weapon, target);
        const dealt = f.attacker.damage * f.attacker.attackCount;
        const left = target.currentHP - dealt;
        const kills = left <= 0;
        const sure = f.attacker.hit >= 100 && f.attacker.damage >= target.currentHP;
        const counter = sure ? 0 : worstDamage(f.defender, { crits: false });
        const held = u.weapon;
        u.weapon = weapon;
        const exp = exposure(battle, u, from, { exclude: kills ? target : null });
        u.weapon = held;
        const melee = gridDistance(from.col, from.row, target.col, target.row) === 1;
        options.push({ target, from, weapon, dealt, left, kills, counter, exp, melee, after: u.currentHP - counter - exp, hit: f.attacker.hit }); // prettier-ignore
      }
    }
  }
  return options;
}

/** A lord on the throne with Varro gone seizes; a lord who can reach it goes there. */
export function trySeize(battle, u, tiles) {
  if (!u.isLord || boss(battle)) return false;
  const t = throne(battle);
  if (!t || !tiles.some((x) => same(x, t))) return false;
  battle.moveTo(t.col, t.row);
  battle.chooseAction('Seize');
  return true;
}

/** Varro gone: the lords walk to the gate (the closest tile to it they can reach). */
function walkToThrone(battle, u, tiles) {
  const t = throne(battle);
  const to = P3.pathDistances(battle, u, t);
  const best = [...tiles].sort(
    (p, q) => to(p) - to(q) || exposure(battle, u, p) - exposure(battle, u, q) || p.cost - q.cost,
  )[0];
  moveAndWait(battle, best);
}

const terrainOf = (battle, t) => battle.grid.getTerrainAt(t.col, t.row)?.name || null;
const healsHere = (battle, t) => ['Fort', 'Throne'].includes(terrainOf(battle, t));

/** The tiles beside the throne a unit can stand on (the gate's step). */
export function stepTiles(battle) {
  const t = throne(battle);
  if (!t) return [];
  return [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
    .map(([dc, dr]) => ({ col: t.col + dc, row: t.row + dr }))
    .filter((x) => Number.isFinite(battle.grid.getMoveCost(x.col, x.row, 'Infantry')));
}

/** The least exposed tile (healing ground first), for a unit that must recover. */
function recoverTile(battle, u, tiles) {
  return [...tiles].sort(
    (p, q) =>
      exposure(battle, u, p) - exposure(battle, u, q) ||
      (healsHere(battle, q) ? 1 : 0) - (healsHere(battle, p) ? 1 : 0) ||
      p.cost - q.cost,
  )[0];
}

/**
 * The naive play (§8): the nearest enemy with the equipped weapon from the cheapest
 * tile, plus what the notes say. Seize once Varro falls (the coach); heal an ally
 * under 60% (P3); the Vulnerary at 60% (P1); no strike whose counter could kill (P1's
 * forecast); the commander pulls back at half HP (P3); Varro on the throne is struck
 * only from 2 tiles (the boss note), never in melee.
 */
export function naive(battle, u, tiles) {
  return naiveCore(battle, u, tiles, {});
}

/** The naive habits, optionally with lessons applied (`smart`'s options). */
function naiveCore(
  battle,
  u,
  tiles,
  { bestWeapon = false, healBelow = 0.6, margin = 0, bossWary = false, danger = false } = {},
) {
  if (trySeize(battle, u, tiles)) return;
  const v = boss(battle);
  // Varro has fallen: the coach's "Now a lord: step onto the gate and Seize". The lords
  // walk to the gate; the others hold where the fewest enemies reach.
  if (!v && throne(battle)) {
    if (u.isLord) return walkToThrone(battle, u, tiles);
    // The gate is the lords' to take: the others hold anywhere but on it.
    const off = tiles.filter((t) => !same(t, throne(battle)));
    return moveAndWait(battle, recoverTile(battle, u, off.length ? off : tiles));
  }
  // `danger` (the intended play): P1's "check who can reach you first" and P3's "count
  // every enemy that reaches you", for every unit. A tile is safe when everything that
  // reaches it, every blow landing, leaves the unit standing (with the commander's margin).
  const room = u.currentHP - margin;
  const exposed = (t, exclude = null) => exposure(battle, u, t, { exclude });
  if (u.name === 'Sera') {
    const plan = P3.healPlan(battle, u, tiles, { below: healBelow });
    if (plan) {
      const from = danger
        ? [...plan.from].sort((p, q) => exposed(p) - exposed(q) || p.cost - q.cost)[0]
        : plan.from[0];
      return P3.healFrom(battle, from, plan.ally);
    }
  }
  if (P3.drinkIfHurt(battle, u)) return;
  // P3's fragile note: Sera and Tamsin back out of a tile in reach when one out of
  // reach would do (the same plan, from the tiles no enemy reaches).
  // The intended play keeps the tiles in reach for strikes it can survive there (below).
  const allTiles = tiles;
  if (u.name === 'Sera' || u.name === 'Tamsin') {
    const out = tiles.filter((t) => reachers(battle, t).length === 0);
    if (out.length) tiles = out;
  }
  if (u.isCommander && u.currentHP * 2 <= u.stats.HP) {
    const back = [...tiles].sort(
      (p, q) => exposure(battle, u, p) - exposure(battle, u, q) || p.cost - q.cost,
    )[0];
    return moveAndWait(battle, back);
  }
  const weapons = P3.combatWeapons(u);
  if (!weapons.length) return moveAndWait(battle, u);
  // `bestWeapon`: before acting, the weapon that answers the nearest foe best is the
  // one in hand (it is what counters next enemy phase: the triangle, P1).
  if (bestWeapon && weapons.length > 1) {
    const near = battle.enemyUnits
      .filter((e) => e.currentHP > 0)
      .map((e) => ({ e, d: P3.pathDistances(battle, u, e)(u) }))
      .sort((x, y) => x.d - y.d)[0]?.e;
    const w = near ? pickWeapon(battle, u, near, weapons, [{ col: u.col, row: u.row, cost: 0 }, ...tiles]) : null; // prettier-ignore
    if (w && w !== u.weapon) equipWeapon(u, w);
  }
  const equipped = u.weapon && u.weapon.type !== 'Staff' ? u.weapon : weapons[0];
  const byDistance = battle.enemyUnits
    .filter((e) => e.currentHP > 0)
    .map((e) => ({ e, d: P3.pathDistances(battle, u, e)(u) }))
    .sort((x, y) => x.d - y.d)
    .map((x) => x.e);
  for (const target of byDistance) {
    // Weapon choice (P2's lesson, `bestWeapon`): the weapon whose forecast deals the
    // most against this foe. The naive keeps the equipped one, except as P2's doubling
    // note says ("Switch weapons on the forecast and watch the ×2"): when it strikes
    // once and another weapon would strike twice from here, that one.
    const weapon = bestWeapon
      ? pickWeapon(battle, u, target, weapons, tiles) || equipped
      : doublingSwitch(battle, u, target, equipped, weapons, tiles);
    // The boss note: the throne's holder is struck from 2 where you can. A unit whose
    // weapon reaches 2 strikes from there; one that can't swings in melee.
    const reaches2 = P3.rangeOf(weapon).max >= 2;
    const fromTiles = P3.strikeTiles(danger ? allTiles : tiles, target, weapon).filter(
      (t) =>
        !(target.isBoss && onThrone(battle, target)) ||
        gridDistance(t.col, t.row, target.col, target.row) >= 2 ||
        !reaches2,
    );
    // `bossWary` (the intended play): the commander never ends a strike inside Varro's
    // answer (the boss note: his axe reaches the gate's step) when that strike's counter
    // and Varro's blow together could drop him.
    const safeFor = (t, f) => {
      if (!(bossWary && u.isCommander && v && v !== target)) return true;
      const zone = bossReach(battle, v);
      if (!zone?.has(key(t))) return true;
      const vs = worstDamage(forecastAt(battle, v, v, v.weapon, { ...u, col: t.col, row: t.row }).attacker, { crits: true }); // prettier-ignore
      return worstDamage(f.defender, { crits: true }) + vs < u.currentHP;
    };
    let from = null;
    let f = null;
    // `danger`: the strike's counter and everything that reaches the tile afterwards
    // (the target too, unless the strike surely kills it) must leave the unit standing;
    // of those tiles, the least exposed.
    const candidates = [];
    for (const t of fromTiles) {
      const tf = forecastAt(battle, u, t, weapon, target);
      if (!safeFor(t, tf)) continue;
      if (!danger) {
        candidates.push({ t, tf, risk: 0 });
        break;
      }
      // The counter comes unless the first blow kills; the target's next blow, unless
      // the whole strike surely kills it.
      const sure = tf.attacker.hit >= 100;
      const first = sure && tf.attacker.damage >= target.currentHP;
      const kills = sure && tf.attacker.damage * tf.attacker.attackCount >= target.currentHP;
      const risk = (first ? 0 : worstDamage(tf.defender, { crits: false })) + exposed(t, kills ? target : null); // prettier-ignore
      if (risk < room) candidates.push({ t, tf, risk });
    }
    candidates.sort((p, q) => p.risk - q.risk || p.t.cost - q.t.cost);
    if (candidates.length) ({ t: from, tf: f } = candidates[0]);
    if (!from) continue;
    const counter = worstDamage(f.defender, { crits: false });
    if (counter >= u.currentHP - margin) continue;
    // P2's "Lances beat swords" note: the lord leaves a foe whose weapon beats his to
    // someone else to open ("Let Gaspar open the Soldier"), and only finishes it.
    if (u.isLord && !bestWeapon && beatenBy(weapon, target)) {
      const kills = f.attacker.hit >= 100 && f.attacker.damage * f.attacker.attackCount >= target.currentHP; // prettier-ignore
      const opened = target.currentHP < target.stats.HP;
      if (!kills && !opened) continue;
    }
    return attackFrom(battle, from, target, weapon);
  }
  const target = byDistance.find((e) => !e.isBoss) || byDistance[0];
  if (!target) return moveAndWait(battle, u);
  const to = P3.pathDistances(battle, u, target);
  // `danger`: close in only through tiles the unit can stand on (else the least exposed).
  let pool = tiles;
  if (danger) {
    const safe = tiles.filter((t) => exposed(t) < room);
    pool = safe.length ? safe : [recoverTile(battle, u, tiles)];
  }
  const best = [...pool].sort(
    (p, q) => to(p) - to(q) || p.cost - q.cost || p.row - q.row || p.col - q.col,
  )[0];
  moveAndWait(battle, best);
}
naive.orderFor = () => ['Edric', 'Gaspar', 'Tamsin', 'Sera'];

/**
 * The reckless play (the measure that the chapter needs positioning): every unit
 * strikes the nearest foe it can reach with what it holds, from the cheapest tile,
 * whatever the forecast or the Danger says; nobody heals, drinks or pulls back.
 */
export function reckless(battle, u, tiles) {
  if (trySeize(battle, u, tiles)) return;
  if (!boss(battle) && throne(battle)) {
    if (u.isLord) return walkToThrone(battle, u, tiles);
    return moveAndWait(battle, u);
  }
  const weapons = P3.combatWeapons(u);
  const weapon = u.weapon && u.weapon.type !== 'Staff' ? u.weapon : weapons[0];
  if (!weapon) return moveAndWait(battle, u);
  const byDistance = battle.enemyUnits
    .filter((e) => e.currentHP > 0)
    .map((e) => ({ e, d: P3.pathDistances(battle, u, e)(u) }))
    .sort((x, y) => x.d - y.d)
    .map((x) => x.e);
  for (const target of byDistance) {
    const from = P3.strikeTiles(tiles, target, weapon)[0];
    if (from) return attackFrom(battle, from, target, weapon);
  }
  const target = byDistance[0];
  if (!target) return moveAndWait(battle, u);
  const to = P3.pathDistances(battle, u, target);
  const best = [...tiles].sort(
    (p, q) => to(p) - to(q) || p.cost - q.cost || p.row - q.row || p.col - q.col,
  )[0];
  moveAndWait(battle, best);
}
reckless.orderFor = () => ['Gaspar', 'Edric', 'Tamsin', 'Sera'];
reckless.prepare = equipAgainstAxes;

/**
 * Gaspar alone (§2 "the veteran supports, never solves"): Gaspar rides at the garrison
 * recklessly; the others hold where they stand until Varro falls, then a lord seizes.
 */
export function gasparAlone(battle, u, tiles) {
  if (u.name === 'Gaspar' || !boss(battle)) return reckless(battle, u, tiles);
  return moveAndWait(battle, u);
}
gasparAlone.orderFor = reckless.orderFor;
gasparAlone.prepare = equipAgainstAxes;

/**
 * The deploy note (in the run): Varro's men carry axes and swords beat axes, so Roster
 * equips before deploying. A fielded unit holding a weapon axes beat, and carrying one
 * that beats axes, equips that one.
 */
export function equipAgainstAxes(units) {
  const axe = { type: 'Axe' };
  for (const u of units) {
    if (!u.weapon || getWeaponTriangleBonus(u.weapon, axe).damage >= 0) continue;
    const better = (u.inventory || []).find(
      (w) => w !== u.weapon && getWeaponTriangleBonus(w, axe).damage > 0 && canEquip(u, w),
    );
    if (better) equipWeapon(u, better);
  }
}
naive.prepare = equipAgainstAxes;

/** The triangle turns against `weapon` when it strikes `target` (P2's note). */
function beatenBy(weapon, target) {
  return getWeaponTriangleBonus(weapon, target.weapon).damage < 0;
}

/** P2's doubling note: the equipped weapon, or one that doubles where it does not. */
function doublingSwitch(battle, u, target, equipped, weapons, tiles) {
  const doubles = (w) => {
    const from = P3.strikeTiles(tiles, target, w)[0];
    return from ? forecastAt(battle, u, from, w, target).attacker.attackCount >= 2 : null;
  };
  if (doubles(equipped) !== false) return equipped;
  return weapons.find((w) => w !== equipped && doubles(w) === true) || equipped;
}

/** The weapon with the most expected damage against `target` from a tile in reach. */
function pickWeapon(battle, u, target, weapons, tiles) {
  let best = null;
  let bestValue = -Infinity;
  for (const w of weapons) {
    // Out of reach this turn: judged as if beside it (what it will face next).
    const from = P3.strikeTiles(tiles, target, w)[0] || { col: target.col, row: target.row + 1 };
    const f = forecastAt(battle, u, from, w, target);
    const value =
      f.attacker.damage * f.attacker.attackCount * (f.attacker.hit / 100) -
      (f.defender.canCounter
        ? (f.defender.damage * f.defender.attackCount * f.defender.hit) / 200
        : 0);
    if (value > bestValue) {
      bestValue = value;
      best = w;
    }
  }
  return best;
}

/**
 * The intended play (§6 P4 "Prompts fade"): the naive habits with every lesson applied,
 * unprompted. The weapon that answers the nearest foe best is in hand before acting and
 * struck with (the triangle, P1-P2); Sera mends an ally under three quarters (P3); every
 * unit counts what can reach it (P1's Danger, P3's "count every enemy that reaches you"):
 * it strikes or moves only where the counter and every blow that can reach the tile leave
 * it standing, the least exposed such tile first, Edric with a margin of 4, and never
 * ends a strike in Varro's answer when the two together could drop him (the boss note);
 * the throne's holder is struck from 2 where you can.
 */
export function intended(battle, u, tiles) {
  return naiveCore(battle, u, tiles, {
    bestWeapon: true,
    healBelow: 0.75,
    margin: u.isCommander ? 4 : 0,
    bossWary: true,
    danger: true,
  });
}
intended.orderFor = () => ['Edric', 'Gaspar', 'Tamsin', 'Sera'];
intended.prepare = equipAgainstAxes;

/** One player phase under a policy, then the enemy phase. */
export async function playTurn(battle, policy, onPhaseEnd = null) {
  for (const name of policy.orderFor?.(battle) || P3.ORDER) {
    const u = unit(battle, name);
    if (!u || u.hasActed || battle.battleState !== HEADLESS_STATES.PLAYER_IDLE) continue;
    battle.selectUnit(name);
    policy(battle, u, stoppableTiles(battle));
    if (battle.result) return;
  }
  onPhaseEnd?.(battle);
  await P3.finishPhase(battle);
}

export async function play(battle, policy, { maxTurns = 14, onPhaseEnd = null } = {}) {
  const trail = [];
  for (let turn = 0; turn < maxTurns && !battle.result; turn++) {
    await playTurn(battle, policy, onPhaseEnd);
    const hp = {};
    for (const u of battle.playerUnits) hp[u.name] = u.currentHP;
    trail.push({ turn: turn + 1, ...hp, varro: boss(battle)?.currentHP ?? 0 });
  }
  return trail;
}

/** Won by seizing, with every fielded unit standing (a fall restarts the chapter). */
export function won(battle, fielded) {
  return (
    battle.result === 'victory' &&
    fielded.every((name) => battle.playerUnits.some((u) => u.name === name && u.currentHP > 0))
  );
}

export const PROTECTED = () => prologueProtectedNames(current.chapter, data);

/**
 * P3's real end states: P3 played to victory by `policy` from P2's end states (through
 * the Market, HP carrying) and from the replay, the four survivors saved as the run
 * saves them, staves refilled. Memoised per key.
 */
const p3Cache = new Map();
export async function p3EndStates({ policy = 'intended', seeds = 60 } = {}) {
  const cacheKey = `${policy}:${seeds}`;
  if (p3Cache.has(cacheKey)) return p3Cache.get(cacheKey);
  const p2 = await P3.p2EndStates({ policy, seeds: Math.min(seeds, 100) });
  const out = [];
  for (let i = 0; i < seeds; i++) {
    const roster = i % 3 === 2 ? null : P3.enteringRoster(p2[i % p2.length]);
    const battle = P3.startP3(i + 1, { roster });
    await P3.play(battle, policy === 'naive' ? P3.naive : P3.intended);
    if (P3.allStand(battle)) {
      const units = ['Edric', 'Gaspar', 'Tamsin', 'Sera'].map((name) =>
        structuredClone(serializeUnit(battle.playerUnits.find((x) => x.name === name))),
      );
      for (const x of units)
        for (const w of x.inventory || []) if (w.perBattleUses) w._usesSpent = 0;
      out.push(units);
    }
    restoreMathRandom();
  }
  p3Cache.set(cacheKey, out);
  return out;
}

/** The watchtower: Rest heals the army; Scavenge leaves HP as P3 left it. */
export function afterWatchtower(units, { rest = true } = {}) {
  const out = structuredClone(units);
  if (rest) for (const x of out) healUnitFully(x);
  return out;
}

/** Play P4 over seeds; the tally every proof reports. */
export async function tally(
  policy,
  rosters,
  { seeds = SEEDS, deploy = null, onPhaseEnd = null, maxTurns = 14 } = {},
) {
  // prettier-ignore
  const result = { wins: 0, total: 0, deaths: {}, lows: {}, turns: [], losses: [], enraged: 0 };
  for (let i = 0; i < seeds; i++) {
    const seed = i + 1;
    const roster = rosters ? rosters[i % rosters.length] : null;
    const battle = startP4(seed, { roster, deploy, prepare: policy.prepare });
    const fielded = battle.playerUnits.map((u) => u.name);
    const trail = await play(battle, policy, {
      maxTurns,
      onPhaseEnd: onPhaseEnd && ((b) => onPhaseEnd(b, seed)),
    });
    result.total++;
    const turns = trail.length;
    const enrage = enrageTurn(battle);
    const inTime = Number.isFinite(enrage) ? turns < enrage : true;
    if (won(battle, fielded) && inTime) result.wins++;
    else {
      result.losses.push(seed);
      if (!inTime) result.enraged++;
      for (const name of fielded)
        if (!battle.playerUnits.some((u) => u.name === name && u.currentHP > 0))
          result.deaths[name] = (result.deaths[name] || 0) + 1;
    }
    for (const step of trail)
      for (const name of fielded)
        result.lows[name] = Math.min(result.lows[name] ?? 99, step[name] ?? 0);
    result.turns.push(turns);
    restoreMathRandom();
  }
  return result;
}

/** The boss's enrage turn: the game's one rule (TurnBonusCalculator.getBossEnrageTurn). */
export function enrageTurn(battle) {
  const par = battle.turnPar;
  if (!Number.isFinite(par)) return null;
  return getBossEnrageTurn(par, data.turnBonus);
}

export const report = (label, t) =>
  console.log(
    `[P4 ${label}] ${t.wins}/${t.total} wins (nobody falling, before enrage); deaths ${JSON.stringify(t.deaths)}; late ${t.enraged}; lowest HP ${JSON.stringify(t.lows)}; turns ${Math.min(...t.turns)}-${Math.max(...t.turns)}; first losses ${t.losses.slice(0, 8).join(',')}`,
  );

export { restoreMathRandom };
