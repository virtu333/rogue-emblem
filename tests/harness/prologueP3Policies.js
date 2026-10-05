// Prologue P3's policies and helpers (docs/specs/prologue-chapter.md §6 P3, §8), shared by
// its proofs (PrologueP3.test.js) and P4's, which enters P4 from P3's real end states. The
// intended play (Talk, Sera heals and strikes from 2 tiles, Edric and Gaspar hold a line,
// Tamsin shoots from behind) and the naive play (walk Edric to Sera and Talk as the coach
// says, then attack the nearest enemy with the equipped weapon; Sera heals a hurt ally next
// to her; an unarmed unit waits), run through the real engine (HeadlessBattle).
import { HeadlessBattle, HEADLESS_STATES } from './HeadlessBattle.js';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import {
  buildPrologueBattleConfig,
  buildPrologueRoster,
  buildPrologueUnits,
  prologueProtectedNames,
} from '../../src/engine/Prologue.js';
import { enemyThreatTiles } from '../../src/engine/ThreatForecast.js';
import { getCombatForecast, gridDistance, parseRange } from '../../src/engine/Combat.js';
import { equipWeapon } from '../../src/engine/UnitManager.js';
import { healUnit, healUnitFully } from '../../src/engine/UnitHealth.js';
import { serializeUnit } from '../../src/engine/RunManager.js';
import * as P2 from './prologueP2Policies.js';

export const data = loadGameData();
export const prologue = data.prologue;
export const chapter = prologue.chapters.find((c) => c.id === 'p3_seer_on_the_road');
export const config = buildPrologueBattleConfig(chapter, data.terrain);
export const PARAMS = { act: 'act1', objective: 'rout', difficultyId: 'normal' };
export const SEEDS = 300;
// The threat exercise (§6 P3 lesson 7): the forest at the front, and the safe tile.
export const FOREST_PAIR = [
  { col: 6, row: 1 },
  { col: 6, row: 2 },
];
export const SAFE_TILE = { col: 4, row: 3 };

export const key = (t) => `${t.col},${t.row}`;
export const same = (a, b) => a.col === b.col && a.row === b.row;
export const enemy = (battle, id) => battle.enemyUnits.find((u) => u.authoredId === id) || null;
export const unit = (battle, name) => battle.playerUnits.find((u) => u.name === name) || null;
export const sera = (battle) =>
  battle.playerUnits.find((u) => u.name === 'Sera') ||
  battle.npcUnits.find((u) => u.name === 'Sera') ||
  null;
export const terrain = (name) => data.terrain.find((t) => t.name === name);

/**
 * The roster P3 is entered with: the chapter's replay roster (Edric at its expected
 * level, Gaspar, Tamsin with her bow), then `adjust` (HP, an unarmed Tamsin, ...).
 */
export function startP3(seed, { roster = null, adjust = null } = {}) {
  installSeed(seed);
  const units = roster ? structuredClone(roster) : buildPrologueRoster(prologue, data, chapter);
  adjust?.(units);
  const battle = new HeadlessBattle(data, { ...PARAMS }, units);
  battle.init({ battleConfig: config });
  return battle;
}

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

export const rangeOf = (w) => parseRange(w?.range || '1');
export const combatWeapons = (u) =>
  (u.inventory || []).filter((w) => w && w.type !== 'Staff' && w.type !== 'Scroll');

/** Tiles in reach from which `target` is within `weapon`'s range, cheapest first. */
export function strikeTiles(tiles, target, weapon) {
  const { min, max } = rangeOf(weapon);
  return tiles
    .filter((t) => {
      const d = gridDistance(t.col, t.row, target.col, target.row);
      return d >= min && d <= max;
    })
    .sort((p, q) => p.cost - q.cost || p.row - q.row || p.col - q.col);
}

export function attackFrom(battle, tile, target, weaponObj = null) {
  battle.moveTo(tile.col, tile.row);
  const u = battle.selectedUnit;
  if (weaponObj && u.weapon !== weaponObj) equipWeapon(u, weaponObj);
  battle.chooseAction('Attack');
  battle.chooseAttackTarget(target);
}

export function moveAndWait(battle, tile) {
  battle.moveTo(tile.col, tile.row);
  battle.chooseAction('Wait');
}

export function healFrom(battle, tile, ally) {
  battle.moveTo(tile.col, tile.row);
  battle.chooseAction('Heal');
  battle.chooseHealTarget(ally.name);
}

export function talkFrom(battle, tile) {
  battle.moveTo(tile.col, tile.row);
  battle.chooseAction('Talk');
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

/** Worst damage every enemy that reaches `tile` could deal `u` there next phase. */
export function exposure(battle, u, tile, { exclude = null, crits = false, sides = false } = {}) {
  // Judged with the unit standing there: its old tile no longer blocks a path.
  const saved = [u.col, u.row];
  Object.assign(u, { col: tile.col, row: tile.row });
  try {
    const foes = reachers(battle, tile, exclude);
    const hits = foes
      .map((e) => worstDamage(forecastAt(battle, e, e, e.weapon, u).attacker, { crits }))
      .sort((a, b) => b - a);
    // `sides`: melee foes need a free tile beside it, so no more of them strike than
    // there are (a held line). Without it, every foe that reaches strikes.
    const cap = sides && foes.every((e) => rangeOf(e.weapon).max <= 1) ? openSides(battle, u, tile) : hits.length; // prettier-ignore
    return hits.slice(0, cap).reduce((a, b) => a + b, 0);
  } finally {
    [u.col, u.row] = saved;
  }
}

/** Tiles beside `tile` a foe could stand on: on the map, passable, not held by an ally. */
export function openSides(battle, u, tile) {
  const held = new Set(
    [...battle.playerUnits, ...battle.npcUnits].filter((x) => x !== u).map((x) => key(x)),
  );
  let open = 0;
  for (const [dc, dr] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const t = { col: tile.col + dc, row: tile.row + dr };
    if (t.col < 0 || t.row < 0 || t.col >= config.cols || t.row >= config.rows) continue;
    if (held.has(key(t))) continue;
    const cost = battle.grid.getMoveCost(t.col, t.row, 'Infantry');
    if (!Number.isFinite(cost)) continue;
    open++;
  }
  return open;
}

/** Walking distance from any tile to `target` for `u`'s move type (terrain only). */
export function pathDistances(battle, u, target) {
  const range = battle.grid.getMovementRange(target.col, target.row, 99, u.moveType, null, null);
  return (t) => range.get(key(t))?.cost ?? Infinity;
}

export function nearestEnemy(battle, u) {
  return battle.enemyUnits
    .map((e) => ({ e, d: pathDistances(battle, u, e)(u) }))
    .sort((x, y) => x.d - y.d)[0]?.e;
}

/** A unit at 60% HP or less drinks its Vulnerary (P1's note), where it stands or at `to`. */
export function drinkIfHurt(battle, u, to = u) {
  const vul = (u.consumables || []).find((c) => c.name === 'Vulnerary');
  if (!vul || u.currentHP * 100 > u.stats.HP * 60) return false;
  healUnit(u, Number(vul.value) || 10);
  vul.uses = (vul.uses ?? 1) - 1;
  if (!(vul.uses > 0)) u.consumables.splice(u.consumables.indexOf(vul), 1);
  moveAndWait(battle, to);
  return true;
}

/** Tiles next to Sera (green) that `tiles` hold, cheapest first. */
export function talkTiles(battle, tiles) {
  const npc = battle.npcUnits.find((u) => u.name === 'Sera');
  if (!npc) return [];
  return tiles
    .filter((t) => gridDistance(t.col, t.row, npc.col, npc.row) === 1)
    .sort((p, q) => p.cost - q.cost || p.row - q.row || p.col - q.col);
}

/** The ally Sera would heal from `tiles`: the most hurt one a heal reaches. */
export function healPlan(battle, u, tiles, { below = 1 } = {}) {
  if (!battle._getUsableStaves(u).length) return null;
  const hurt = battle.playerUnits
    .filter((a) => a !== u && a.currentHP > 0 && a.currentHP < a.stats.HP * below)
    .sort((a, b) => a.currentHP / a.stats.HP - b.currentHP / b.stats.HP);
  for (const ally of hurt) {
    const from = tiles
      .filter((t) => gridDistance(t.col, t.row, ally.col, ally.row) === 1)
      .sort((p, q) => p.cost - q.cost || p.row - q.row || p.col - q.col);
    if (from.length) return { ally, from };
  }
  return null;
}

/** Attack the nearest enemy reachable with the equipped weapon, from the cheapest tile. */
export function naiveAttack(battle, u, tiles) {
  if (!combatWeapons(u).length) return false;
  const weapon = u.weapon && u.weapon.type !== 'Staff' ? u.weapon : combatWeapons(u)[0];
  const byDistance = battle.enemyUnits
    .map((e) => ({ e, d: pathDistances(battle, u, e)(u) }))
    .sort((x, y) => x.d - y.d)
    .map((x) => x.e);
  for (const target of byDistance) {
    const from = strikeTiles(tiles, target, weapon)[0];
    if (!from) continue;
    // P1's forecast lesson: never confirm a strike whose counter, every hit landing,
    // would kill the attacker (the forecast shows it; Cancel is free).
    const f = forecastAt(battle, u, from, weapon, target);
    if (worstDamage(f.defender, { crits: false }) >= u.currentHP) continue;
    attackFrom(battle, from, target, weapon);
    return true;
  }
  return false;
}

export function walkToward(battle, u, tiles) {
  const target = nearestEnemy(battle, u);
  if (!target) return moveAndWait(battle, u);
  const to = pathDistances(battle, u, target);
  const best = [...tiles].sort(
    (p, q) => to(p) - to(q) || p.cost - q.cost || p.row - q.row || p.col - q.col,
  )[0];
  moveAndWait(battle, best);
}

/**
 * The naive policy (§8), with P3's two taught moves: Edric walks to Sera and Talks
 * while she is green (the coach's first goal), and Sera heals an ally below 60% she
 * can reach (the heal note). Otherwise: drink the Vulnerary at 60%, strike the nearest
 * enemy with the equipped weapon from the cheapest tile, else walk toward it. An
 * unarmed unit can't attack and waits where it stands.
 */
export function naive(battle, u, tiles) {
  if (u.name === 'Edric' && battle.npcUnits.some((n) => n.name === 'Sera')) {
    const at = talkTiles(battle, tiles)[0];
    if (at) return talkFrom(battle, at);
    const npc = battle.npcUnits.find((n) => n.name === 'Sera');
    const to = pathDistances(battle, u, npc);
    const best = [...tiles].sort((p, q) => to(p) - to(q) || p.cost - q.cost)[0];
    return moveAndWait(battle, best);
  }
  // The fragile note (Sera, Tamsin): "Tap Back" from a tile in reach when one out of
  // reach would do. The same plan, from the tiles no enemy reaches when there are any.
  const fragile = u.name === 'Sera' || u.name === 'Tamsin';
  const outOfReach = fragile ? tiles.filter((t) => reachers(battle, t).length === 0) : [];
  const from = outOfReach.length ? outOfReach : tiles;
  if (u.name === 'Sera') {
    // The heal note first: from out of reach when a tile next to the ally is; for an
    // ally under half, from a tile where she survives every hit that reaches it.
    const plan =
      healPlan(battle, u, from, { below: 0.75 }) ||
      healPlan(
        battle,
        u,
        tiles.filter((t) => exposure(battle, u, t) < u.currentHP),
        { below: 0.5 },
      );
    if (plan) return healFrom(battle, plan.from[0], plan.ally);
  }
  if (drinkIfHurt(battle, u)) return;
  // P3's commander note: at half HP or less, Edric pulls back to the tile the fewest
  // enemies reach and waits for a heal.
  if (u.isCommander && u.currentHP * 2 <= u.stats.HP) {
    const back = [...tiles].sort(
      (p, q) => exposure(battle, u, p) - exposure(battle, u, q) || p.cost - q.cost,
    )[0];
    return moveAndWait(battle, back);
  }
  if (!combatWeapons(u).length) return moveAndWait(battle, u);
  if (naiveAttack(battle, u, from)) return;
  walkToward(battle, u, from);
}

/** Every strike `u` could make this phase: weapon, target, tile, and what it leaves. */
export function strikeOptions(battle, u, tiles, { perTarget = 8 } = {}) {
  const options = [];
  for (const weapon of combatWeapons(u)) {
    for (const target of battle.enemyUnits) {
      for (const from of strikeTiles(tiles, target, weapon).slice(0, perTarget)) {
        const f = forecastAt(battle, u, from, weapon, target);
        const dealt = f.attacker.damage * f.attacker.attackCount;
        const left = target.currentHP - dealt;
        const kills = left <= 0;
        // No counter only when the first strike surely lands and kills.
        const sure = f.attacker.hit >= 100 && f.attacker.damage >= target.currentHP;
        const counter = sure ? 0 : worstDamage(f.defender, { crits: false });
        const held = u.weapon;
        u.weapon = weapon;
        const exp = exposure(battle, u, from, { exclude: kills ? target : null });
        u.weapon = held;
        options.push({ target, from, weapon, dealt, left, kills, counter, exp, after: u.currentHP - counter - exp, hit: f.attacker.hit }); // prettier-ignore
      }
    }
  }
  return options;
}

/**
 * The intended play (§6 P3): the naive play's habits, with every lesson of the
 * chapter applied every time. Edric Talks from the tile the fewest enemies reach.
 * Sera heals an ally under three quarters from out of reach, else strikes from 2
 * tiles (no counter) where at most one hit can reach her; Tamsin shoots from out of
 * reach when she can. Gaspar chips what Edric can then finish and picks the better
 * weapon; Edric takes kills. Any unit at half HP or less drinks or pulls back, and no
 * strike is confirmed whose counter could kill.
 */
export function intended(battle, u, tiles) {
  if (u.name === 'Edric' && battle.npcUnits.some((n) => n.name === 'Sera')) {
    const options = talkTiles(battle, tiles).map((t) => ({ t, exp: exposure(battle, u, t) }));
    options.sort((a, b) => a.exp - b.exp || a.t.cost - b.t.cost);
    if (options[0]) return talkFrom(battle, options[0].t);
  }
  const fragile = u.name === 'Sera' || u.name === 'Tamsin';
  const out = tiles.filter((t) => exposure(battle, u, t) === 0);
  if (u.name === 'Sera') {
    const plan =
      healPlan(battle, u, out, { below: 0.75 }) ||
      healPlan(
        battle,
        u,
        tiles.filter((t) => exposure(battle, u, t) * 2 <= u.currentHP),
        { below: 0.5 },
      );
    if (plan) return healFrom(battle, plan.from[0], plan.ally);
  }
  const low = u.currentHP * 2 <= u.stats.HP;
  const leastExposed = () =>
    [...tiles].sort(
      (p, q) => exposure(battle, u, p) - exposure(battle, u, q) || p.cost - q.cost,
    )[0];
  if (low && drinkIfHurt(battle, u, leastExposed())) return;
  // Hurt, a sure kill (first strike lands and kills: no counter) still comes first.
  const sureKill = low
    ? strikeOptions(battle, u, tiles).find((o) => o.kills && o.counter === 0 && o.after >= 1)
    : null;
  if (sureKill) return attackFrom(battle, sureKill.from, sureKill.target, sureKill.weapon);
  if (low && !fragile) return moveAndWait(battle, leastExposed());
  const options = strikeOptions(battle, u, fragile ? tiles : tiles, { perTarget: 6 }).filter((o) =>
    fragile ? o.counter === 0 && o.exp * 2 <= u.currentHP : o.after >= 1,
  );
  const edric = unit(battle, 'Edric');
  const edricFinish = (t) => {
    if (u.name !== 'Gaspar' || !edric || edric.hasActed) return 0;
    const f = forecastAt(battle, edric, edric, edric.weapon, t);
    return f.attacker.damage * f.attacker.attackCount;
  };
  const value = (o) =>
    (o.kills ? (u.name === 'Gaspar' ? 20 : 50) : 0) +
    (!o.kills && o.left <= edricFinish(o.target) ? 40 : 0) +
    o.dealt * (o.hit / 100) -
    o.counter / 2 -
    o.exp / 4;
  const pick = options.sort((a, b) => value(b) - value(a) || a.from.cost - b.from.cost)[0];
  if (pick) return attackFrom(battle, pick.from, pick.target, pick.weapon);
  moveAndWait(battle, holdTile(battle, u, fragile && out.length ? out : tiles));
}

/** The closest tile to the nearest foe where `u` survives the worst enemy phase. */
export function holdTile(battle, u, tiles) {
  const nearest = nearestEnemy(battle, u);
  const to = nearest ? pathDistances(battle, u, nearest) : () => 0;
  const scored = tiles.map((t) => ({ t, exp: exposure(battle, u, t) }));
  const okay = scored.filter((x) => u.currentHP - x.exp >= 1);
  if (okay.length)
    return okay.sort((p, q) => to(p.t) - to(q.t) || p.exp - q.exp || p.t.cost - q.t.cost)[0].t;
  return scored.sort((p, q) => p.exp - q.exp || to(p.t) - to(q.t) || p.t.cost - q.t.cost)[0].t;
}

// The front line moves first, so the back line's safe tiles are judged against it.
export const ORDER = ['Edric', 'Gaspar', 'Tamsin', 'Sera'];
intended.order = ['Edric', 'Gaspar', 'Tamsin', 'Sera'];
// With an ally hurt, Sera mends first; otherwise the front line moves first.
intended.orderFor = (battle) => {
  const hurt = battle.playerUnits.some((u) => u.name !== 'Sera' && u.currentHP < u.stats.HP * 0.75); // prettier-ignore
  if (!hurt) return ['Edric', 'Gaspar', 'Tamsin', 'Sera'];
  // Sera green: Edric reaches her first; blue: she mends before anyone moves.
  return battle.npcUnits.some((u) => u.name === 'Sera')
    ? ['Edric', 'Sera', 'Gaspar', 'Tamsin']
    : ['Sera', 'Edric', 'Gaspar', 'Tamsin'];
};

/** One player phase under a policy (Edric, Sera once she has joined, Gaspar, Tamsin). */
export async function playTurn(battle, policy, onPhaseEnd = null) {
  for (const name of policy.orderFor?.(battle) || policy.order || ORDER) {
    const u = unit(battle, name);
    if (!u || u.hasActed || battle.battleState !== HEADLESS_STATES.PLAYER_IDLE) continue;
    battle.selectUnit(name);
    policy(battle, u, stoppableTiles(battle));
    if (battle.result) return;
  }
  onPhaseEnd?.(battle);
  await finishPhase(battle);
}

export async function play(battle, policy, { maxTurns = 12, onPhaseEnd = null } = {}) {
  const trail = [];
  for (let turn = 0; turn < maxTurns && !battle.result; turn++) {
    await playTurn(battle, policy, onPhaseEnd);
    const hp = {};
    for (const name of ORDER) hp[name] = (name === 'Sera' ? sera(battle) : unit(battle, name))?.currentHP ?? 0; // prettier-ignore
    trail.push({ turn: turn + 1, ...hp, joined: Boolean(unit(battle, 'Sera')) });
  }
  return trail;
}

export const PROTECTED = prologueProtectedNames(chapter, data);
export const allStand = (battle) =>
  battle.result === 'victory' &&
  PROTECTED.every((name) => (name === 'Sera' ? unit(battle, 'Sera') : unit(battle, name))?.currentHP > 0); // prettier-ignore

// --- Entering P3 -------------------------------------------------------------------

/** Tamsin as the fork leaves her: authored, with the bow (the lesson's Withdraw) or without. */
export function tamsin({ armed = true } = {}) {
  return buildPrologueUnits(prologue, data, ['Tamsin'], {
    items: armed ? { Tamsin: ['Iron Bow'] } : null,
  })[0];
}

/**
 * P2's real end states: P2 played to victory by `policy` (Edric at the chapter's
 * expected level, or at P1's stats with `floor`), its two survivors saved as the run
 * saves them (serializeUnit), staves refilled. Losses are dropped (the chapter would
 * have restarted). Memoised per key: the proofs reuse them.
 */
export const p2Cache = new Map();
export async function p2EndStates({ policy = 'naive', floor = false, seeds = 100 } = {}) {
  // floor: P2 entered with Edric at P1's stats (P2's own bound), never used by P3.
  const cacheKey = `${policy}:${floor}:${seeds}`;
  if (p2Cache.has(cacheKey)) return p2Cache.get(cacheKey);
  const out = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const battle = P2.startP2(seed, { floor });
    await P2.play(battle, policy === 'naive' ? P2.naive : P2.intended);
    if (P2.bothStand(battle)) {
      const units = ['Edric', 'Gaspar'].map((name) =>
        structuredClone(serializeUnit(battle.playerUnits.find((u) => u.name === name))),
      );
      for (const u of units)
        for (const w of u.inventory || []) if (w.perBattleUses) w._usesSpent = 0;
      out.push(units);
    }
    restoreMathRandom();
  }
  p2Cache.set(cacheKey, out);
  return out;
}

/** P3's roster from a P2 end state: the Market (HP carries) or the Chapel (healed). */
export function enteringRoster(p2Units, { chapel = false, armed = true } = {}) {
  const units = structuredClone(p2Units);
  if (chapel) for (const u of units) healUnitFully(u);
  return [...units, tamsin({ armed })];
}

/** Play P3 over seeds from rosters; the tally every proof reports. */
export async function tally(policy, rosters, { seeds = SEEDS, onPhaseEnd = null } = {}) {
  const result = { wins: 0, total: 0, deaths: {}, lows: {}, turns: [], losses: [] };
  for (let i = 0; i < seeds; i++) {
    const seed = i + 1;
    const roster = rosters ? rosters[i % rosters.length] : null;
    const battle = startP3(seed, { roster });
    const trail = await play(battle, policy, { onPhaseEnd: onPhaseEnd && ((b) => onPhaseEnd(b, seed)) }); // prettier-ignore
    result.total++;
    if (allStand(battle)) result.wins++;
    else {
      result.losses.push(seed);
      for (const name of PROTECTED)
        if (!((name === 'Sera' ? unit(battle, 'Sera') : unit(battle, name))?.currentHP > 0))
          result.deaths[name] = (result.deaths[name] || 0) + 1;
    }
    for (const step of trail)
      for (const name of ORDER) result.lows[name] = Math.min(result.lows[name] ?? 99, step[name]);
    result.turns.push(trail.length);
    restoreMathRandom();
  }
  return result;
}

export const report = (label, t) =>
  console.log(
    `[P3 ${label}] ${t.wins}/${t.total} wins with nobody falling; deaths ${JSON.stringify(t.deaths)}; lowest HP ${JSON.stringify(t.lows)}; turns ${Math.min(...t.turns)}-${Math.max(...t.turns)}; first losses ${t.losses.slice(0, 8).join(',')}`,
  );

// --- The proofs ----------------------------------------------------------------------
