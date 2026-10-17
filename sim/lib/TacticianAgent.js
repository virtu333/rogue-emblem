// TacticianAgent.js — a careful player for battle sims (the stock ScriptedAgent charges
// every unit at the nearest enemy one at a time, which no human does and which makes
// every extra unit look like a liability).
//
// Each player phase it plans one unit at a time, re-reading the board after every
// action:
// * Threat map: for every enemy, the tiles it can reach next enemy phase (real
//   movement, player units block) and the expected damage it would deal to a given
//   unit standing on a given tile (getCombatForecast, 2RN hit odds). Siege artillery
//   reads the Danger overlay's rule with the move previewed (enemyThreatTiles): it
//   strikes only from its post while a player unit is in its siege range.
// * Attack plans score expected damage dealt, a kill bonus, the counter taken, and the
//   danger of the landing tile (remaining foes only if the kill is likely). A plan that
//   leaves the commander in lethal danger is almost never taken.
// * Healers heal the most hurt ally in reach; lords Talk to a recruit beside them and,
//   with `rescue`, walk toward the recruit before anything else.
// * Units with nothing worth doing hold the safest tile near the squad (bait-and-punish,
//   the dominant human strategy). If nothing has come into contact for two turns the
//   squad advances, still weighting danger, so guard maps do not stall.
// Escape objectives fall back to ScriptedAgent's rules. Seize objectives do too unless
// `objectives` is set: then, while the boss lives, the same planning advances on the
// boss instead of the nearest foe (a push walks straight at it; a careful player edges
// forward until something can reach it, then holds and punishes, which pulls a
// garrison's holders out to it), and once the boss falls ScriptedAgent walks a lord to
// the throne and seizes. On a defeat map (BattleObjectives) the remaining targets take the
// boss's place for every objective option: attacks on them score higher and the squad advances
// on them from turn one (a target on a post never comes, and a summoning circle keeps contact
// alive, so waiting for either times out). Deterministic: no randomness of its own.
//
// A multi-tile foe (the Entity's 3×3 body, anchored at its top-left tile) is measured as the
// battle measures it: attack tiles, the counter's distance and every distance an advance
// weighs read EntitySystem.combatDistance (any body tile), and its own strike is the Danger
// overlay's rule (ThreatForecast.enemyThreatTiles: range 2 from the body, never a step).

import { ScriptedAgent, wardCircleClaims } from '../../tests/agents/ScriptedAgent.js';
import {
  getCombatForecast,
  forecastStrikeGroups,
  forecastRawDamage,
  gridDistance,
  parseRange,
  isStaff,
  getEffectiveStaffRange,
  resolveHeal,
  nextStrikeWeapon,
  isWardedUnit,
} from '../../src/engine/Combat.js';
import { hitProbability } from '../../src/engine/HitRoll.js';
import { getCombatWeapons } from '../../src/engine/UnitManager.js';
import { enemyThreatTiles, positionsWithMoverAt } from '../../src/engine/ThreatForecast.js';
import { holdsPost } from '../../src/engine/SiegeArtillery.js';
import { distanceFieldToAdjacent } from './RescueAgent.js';
import { movementOptionsFor } from '../../src/engine/PassMovement.js';
import { combatDistance, isLargeUnit } from '../../src/engine/EntitySystem.js';
import { objectiveTargetUnits } from '../../src/engine/BattleObjectives.js';

const key = (c, r) => `${c},${r}`;

function expected(side) {
  return forecastStrikeGroups(side).reduce(
    (sum, g) => sum + Math.max(0, Number(g.damage) || 0) * hitProbability(g.hit) * g.count,
    0,
  );
}

export class TacticianAgent {
  constructor(driver, options = {}) {
    this.driver = driver;
    this.fallback = new ScriptedAgent(driver);
    this.rescue = options.rescue !== false;
    this.objectives = options.objectives === true;
    this.plan = null;
    this.lastContactTurn = 1;
    this._fields = new Map();
  }

  get b() {
    return this.driver.battle;
  }

  chooseAction(legal) {
    const b = this.b;
    const obj = b.battleConfig?.objective;
    if (obj === 'escape') return this.fallback.chooseAction(legal);
    if (obj === 'seize' && (!this.objectives || !this._boss())) {
      // With the boss down, only a lord can seize: keep the others off the throne (a
      // non-lord parked on it stalls the battle; ScriptedAgent has no such rule).
      const throne = b.battleConfig?.thronePos;
      const sel = b.selectedUnit;
      if (this.objectives && throne && sel && !sel.isLord) {
        const moves = legal.filter(
          (a) =>
            a.type === 'move_to' && !(a.payload.col === throne.col && a.payload.row === throne.row),
        );
        if (moves.length)
          return (
            moves.find((a) => a.payload.col === sel.col && a.payload.row === sel.row) || moves[0]
          );
      }
      return this.fallback.chooseAction(legal);
    }
    const byType = (t) => legal.filter((a) => a.type === t);

    if (legal.some((a) => a.type === 'select_unit')) {
      this.plan = this._bestPlan();
      if (!this.plan) return legal.find((a) => a.type === 'end_turn') || legal[0];
      return legal.find(
        (a) => a.type === 'select_unit' && a.payload.unitName === this.plan.unit.name,
      );
    }
    const plan = this.plan;
    if (byType('move_to').length) {
      const m = plan
        ? byType('move_to').find(
            (a) => a.payload.col === plan.tile.col && a.payload.row === plan.tile.row,
          )
        : null;
      if (m) return m;
      const u = b.selectedUnit;
      return (
        byType('move_to').find((a) => a.payload.col === u.col && a.payload.row === u.row) ||
        byType('move_to')[0]
      );
    }
    if (legal.some((a) => a.type === 'choose_action')) {
      const want = plan?.action || 'Wait';
      const pick =
        legal.find((a) => a.type === 'choose_action' && a.payload.label === want) ||
        legal.find((a) => a.type === 'choose_action' && a.payload.label === 'Wait');
      return pick || legal[0];
    }
    if (byType('choose_target').length) {
      const t = plan?.target
        ? byType('choose_target').find((a) => a.payload.targetName === plan.target.name)
        : null;
      return t || byType('choose_target')[0];
    }
    return legal.find((a) => a.type === 'end_turn') || legal[0];
  }

  /** A defeat map's targets still standing (BattleObjectives), else none. */
  _defeatTargets() {
    const b = this.b;
    return objectiveTargetUnits(
      b.battleConfig,
      b.objectiveField?.() ?? { enemyUnits: b.enemyUnits },
    );
  }

  /** The defeat targets an advance closes on: those that can be hurt, else every one left. */
  _marks() {
    const targets = this._defeatTargets();
    const open = targets.filter((u) => !isWardedUnit(u));
    return open.length > 0 ? open : targets;
  }

  /**
   * Whether the squad closes on the foe this turn rather than holding: after two turns with no
   * contact, and from turn one on a defeat map (its targets stand on posts and its circles keep
   * calling, so waiting for contact or for quiet never ends).
   */
  _advancing(turn) {
    return turn - this.lastContactTurn >= 2 || this._defeatTargets().length > 0;
  }

  /** The living seize boss, or null. */
  _boss() {
    return this.b.enemyUnits.find((e) => e.isBoss && e.currentHP > 0) || null;
  }

  // --- threat model -------------------------------------------------------

  _enemyReach(enemy) {
    const b = this.b;
    const positions = b._buildUnitPositionMap('enemy');
    return b.grid.getMovementRange(
      enemy.col,
      enemy.row,
      enemy.stats?.MOV ?? enemy.mov,
      enemy.moveType,
      positions,
      'enemy',
    );
  }

  _threats() {
    const b = this.b;
    const out = [];
    // The Danger overlay's view (BattleScene.threatContext), for a foe that holds its post
    // (siege artillery, a status-staff caster: SiegeArtillery): it strikes from where it stands.
    let ctx = null;
    let positions = null;
    for (const e of b.enemyUnits) {
      // The weapon it strikes with next: a spent Breachbolt gives way to its fallback.
      const weapon = nextStrikeWeapon(e);
      if (!weapon || isStaff(weapon) || e.currentHP <= 0) continue;
      const threat = { e, weapon, reach: [], range: parseRange(weapon.range) };
      if (isLargeUnit(e)) {
        // A big body (the Entity, the Iron Guardian) never steps: it strikes from its body
        // (enemyThreatTiles, a Guardian's Hammerfall marks too), and the tiles it reaches do not
        // depend on where anyone stands, so they are read once.
        ctx ||= b._playerThreatContext();
        Object.assign(threat, { planted: true, strikes: enemyThreatTiles(ctx, e).damage });
        out.push(threat);
        continue;
      }
      for (const [k, entry] of this._enemyReach(e)) {
        if (entry?.stoppable === false) continue;
        const [c, r] = k.split(',').map(Number);
        threat.reach.push({ c, r });
      }
      if (holdsPost(e)) {
        ctx ||= b._playerThreatContext();
        positions ||= ctx.positions();
        Object.assign(threat, { planted: true, ctx, positions });
      }
      out.push(threat);
    }
    return out;
  }

  /**
   * A foe that strikes from where it stands (one that holds its post, or the Entity), with
   * `unit` moved to `tile`: null when it cannot strike the tile (ThreatForecast.enemyThreatTiles,
   * as Danger with the move previewed), else the strike's distance (from any tile of its body:
   * combatDistance) and its post (it never walks while it holds it: SiegeArtillery.holdsPost).
   */
  _plantedStrike(t, unit, tile) {
    const strikes =
      t.strikes ||
      enemyThreatTiles(t.ctx, t.e, positionsWithMoverAt(t.positions, unit, tile.col, tile.row))
        .damage;
    if (!strikes.has(key(tile.col, tile.row))) return null;
    return { d: combatDistance(t.e, tile), p: { c: t.e.col, r: t.e.row } };
  }

  /** Expected damage foes could deal to `unit` standing on `tile` next enemy phase. */
  _danger(unit, tile, threats, exclude = null) {
    const b = this.b;
    const occupied = new Set(
      [...b.playerUnits, ...b.npcUnits].filter((u) => u !== unit).map((u) => key(u.col, u.row)),
    );
    let total = 0;
    let worst = 0;
    let attackers = 0;
    const defTerrain = b.grid.getTerrainAt(tile.col, tile.row);
    for (const t of threats) {
      if (t.e === exclude) continue;
      let best = t.planted ? this._plantedStrike(t, unit, tile) : undefined;
      if (best === null) continue;
      for (const p of best ? [] : t.reach) {
        if (occupied.has(key(p.c, p.r))) continue;
        if (p.c === tile.col && p.r === tile.row) continue;
        // A walker is one tile (the Entity, the one multi-tile unit, is planted above).
        const d = gridDistance(p.c, p.r, tile.col, tile.row);
        if (d < t.range.min || d > t.range.max) continue;
        best = { d, p };
        break;
      }
      if (!best) continue;
      attackers++;
      const fc = getCombatForecast(
        { ...t.e },
        t.weapon,
        { ...unit, col: tile.col, row: tile.row },
        unit.weapon,
        best.d,
        b.grid.getTerrainAt(best.p.c, best.p.r),
        defTerrain,
        { skillsData: b.gameData.skills || [] },
      );
      total += expected(fc.attacker);
      worst += forecastRawDamage(fc.attacker);
    }
    return { total, worst, attackers };
  }

  /** The commander plans against the worst case (every blow lands); others the average. */
  _lethal(unit, danger, hp) {
    return unit.isCommander ? danger.worst >= hp : danger.total >= hp;
  }

  // --- planning -------------------------------------------------------------

  _reach(unit) {
    const b = this.b;
    const range = b.grid.getMovementRange(
      unit.col,
      unit.row,
      unit.stats.MOV,
      unit.moveType,
      b._buildUnitPositionMap('player'),
      'player',
      0,
      movementOptionsFor(unit),
    );
    const tiles = [{ col: unit.col, row: unit.row }];
    for (const [k, entry] of range) {
      if (entry?.stoppable === false) continue;
      const [col, row] = k.split(',').map(Number);
      if (col === unit.col && row === unit.row) continue;
      tiles.push({ col, row });
    }
    return tiles;
  }

  _field(target, moveType) {
    const k = `${target.col},${target.row},${moveType}`;
    if (!this._fields.has(k))
      this._fields.set(k, distanceFieldToAdjacent(this.b.grid, target, moveType));
    return this._fields.get(k);
  }

  _bestPlan() {
    const b = this.b;
    const units = b.playerUnits.filter((u) => !u.hasActed);
    if (!units.length) return null;
    const threats = this._threats();
    const turn = b.turnManager?.turnNumber || 1;
    // Contact: any foe can reach any of our units this coming enemy phase.
    const contact = b.playerUnits.some((u) => this._danger(u, u, threats).attackers > 0);
    if (contact) this.lastContactTurn = turn;
    const advance = this._advancing(turn);
    this._claims = wardCircleClaims(b);
    let best = null;
    for (const u of units) {
      const plan = this._planFor(u, threats, advance);
      if (plan && (!best || plan.score > best.score)) best = plan;
    }
    return best;
  }

  _planFor(u, threats, advance) {
    const b = this.b;
    const tiles = this._reach(u);
    const hpNow = u.currentHP;
    const lethalWeight = u.isCommander ? 60 : 18;
    const npc = this.rescue && u.isLord ? b.npcUnits[0] : null;
    const npcField = npc ? this._field(npc, u.moveType) : null;
    const weapons = getCombatWeapons(u);
    const allies = b.playerUnits.filter((a) => a !== u);
    // What an advance closes on: the seize boss (with `objectives`), else the nearest foe.
    // Path cost round walls (a castle keep), not straight-line tiles.
    const boss = this.objectives && b.battleConfig?.objective === 'seize' ? this._boss() : null;
    const bossField = boss ? this._field(boss, u.moveType) : null;
    // A defeat map's remaining targets, on the same footing as the boss (path cost, not tiles).
    const marks = boss ? [] : this._marks();
    // A Vigil's ward circle this unit is claimed for: every plan is pulled to it, and standing
    // on it (where the enemy phase breaks it) is worth far more than anything it could strike.
    const circle = this._claims?.get(u) || null;
    const circleField = circle ? this._field(circle, u.moveType) : null;
    const circlePull = (tile) =>
      !circle
        ? 0
        : tile.col === circle.col && tile.row === circle.row
          ? 40
          : -3 *
            (circleField.get(key(tile.col, tile.row)) ??
              20 + gridDistance(tile.col, tile.row, circle.col, circle.row));
    const markFields = marks.map((m) => this._field(m, u.moveType));
    const nearestEnemyDist = (tile) =>
      boss
        ? (bossField.get(key(tile.col, tile.row)) ?? 20 + combatDistance(tile, boss))
        : marks.length
          ? Math.min(
              ...marks.map(
                (m, i) =>
                  markFields[i].get(key(tile.col, tile.row)) ?? 20 + combatDistance(tile, m),
              ),
            )
          : Math.min(Infinity, ...b.enemyUnits.map((e) => combatDistance(tile, e)));
    let best = null;
    const consider = (plan) => {
      if (!best || plan.score > best.score) best = plan;
    };

    for (const tile of tiles) {
      const terrain = b.grid.getTerrainAt(tile.col, tile.row);
      const pull = circlePull(tile);
      // Talk.
      if (npc && gridDistance(tile.col, tile.row, npc.col, npc.row) === 1) {
        const danger = this._danger(u, tile, threats);
        consider({
          unit: u,
          tile,
          action: 'Talk',
          target: null,
          score: 500 - (this._lethal(u, danger, hpNow) ? lethalWeight * 3 : 0),
        });
      }
      // Attacks.
      for (const e of b.enemyUnits) {
        // A warded foe takes no damage: striking it only draws its counter.
        if (isWardedUnit(e)) continue;
        // The battle's distance (HeadlessBattle._findAttackTargets, resolveCombat): an
        // Entity is reached from beside any tile of its body, and counters from there.
        const d = combatDistance(tile, e);
        const w = weapons.find((wp) => {
          const { min, max } = parseRange(wp.range);
          return d >= min && d <= max;
        });
        if (!w) continue;
        const fc = getCombatForecast(
          { ...u, col: tile.col, row: tile.row, weapon: w },
          w,
          e,
          e.weapon,
          d,
          terrain,
          b.grid.getTerrainAt(e.col, e.row),
          { skillsData: b.gameData.skills || [] },
        );
        const dealt = expected(fc.attacker);
        const taken = fc.defender?.canCounter ? expected(fc.defender) : 0;
        const killP = dealt >= e.currentHP ? Math.min(1, hitProbability(fc.attacker.hit) * 1.1) : 0;
        const hpAfter = Math.max(1, hpNow - taken);
        const danger = this._danger(u, tile, threats, killP > 0.6 ? e : null);
        const lethal = this._lethal(u, danger, hpAfter);
        const score =
          dealt +
          25 * killP +
          (e.isBoss ? 3 : 0) +
          (marks.includes(e) ? 6 : 0) -
          1.1 * taken -
          0.6 * danger.total -
          (lethal ? lethalWeight : 0) +
          (npc ? -0.8 * (npcField.get(key(tile.col, tile.row)) ?? 20) : 0) +
          pull;
        consider({ unit: u, tile, action: 'Attack', target: e, score, d, dealt, taken });
      }
      // Heals.
      const staff = b._getActiveHealStaff?.(u);
      if (staff) {
        const range = getEffectiveStaffRange(staff, u);
        for (const a of allies) {
          const missing = a.stats.HP - a.currentHP;
          if (missing <= 0) continue;
          const d = gridDistance(tile.col, tile.row, a.col, a.row);
          if (d < range.min || d > range.max) continue;
          const heal = Math.min(missing, resolveHeal(staff, u, a).healAmount);
          const danger = this._danger(u, tile, threats);
          const urgency = a.currentHP < a.stats.HP * 0.5 ? 1.6 : 1;
          const score =
            heal * urgency * (a.isCommander ? 1.5 : 1) -
            0.6 * danger.total -
            (this._lethal(u, danger, hpNow) ? lethalWeight : 0) +
            pull;
          consider({ unit: u, tile, action: 'Heal', target: a, score });
        }
      }
      // Hold / advance.
      const danger = this._danger(u, tile, threats);
      const lethal = this._lethal(u, danger, hpNow);
      const allyDist = allies.length
        ? Math.min(...allies.map((a) => gridDistance(tile.col, tile.row, a.col, a.row)))
        : 0;
      let score =
        -0.6 * danger.total -
        (lethal ? lethalWeight : 0) -
        0.4 * Math.max(0, allyDist - 2) +
        (Number(terrain?.avoidBonus) || 0) * 0.02 +
        (Number(terrain?.defBonus) || 0) * 0.3;
      if (advance) score -= 1.5 * nearestEnemyDist(tile);
      else score -= 0.05 * nearestEnemyDist(tile);
      if (npc) score -= 2.5 * (npcField.get(key(tile.col, tile.row)) ?? 30);
      score += pull;
      consider({ unit: u, tile, action: 'Wait', target: null, score: score - 4 });
    }
    return best;
  }
}
