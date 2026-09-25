// TacticianAgent.js — a careful player for battle sims (the stock ScriptedAgent charges
// every unit at the nearest enemy one at a time, which no human does and which makes
// every extra unit look like a liability).
//
// Each player phase it plans one unit at a time, re-reading the board after every
// action:
// * Threat map: for every enemy, the tiles it can reach next enemy phase (real
//   movement, player units block) and the expected damage it would deal to a given
//   unit standing on a given tile (getCombatForecast, 2RN hit odds).
// * Attack plans score expected damage dealt, a kill bonus, the counter taken, and the
//   danger of the landing tile (remaining foes only if the kill is likely). A plan that
//   leaves the commander in lethal danger is almost never taken.
// * Healers heal the most hurt ally in reach; lords Talk to a recruit beside them and,
//   with `rescue`, walk toward the recruit before anything else.
// * Units with nothing worth doing hold the safest tile near the squad (bait-and-punish,
//   the dominant human strategy). If nothing has come into contact for two turns the
//   squad advances, still weighting danger, so guard maps do not stall.
// Seize and escape objectives fall back to ScriptedAgent's rules. Deterministic: no
// randomness of its own.

import { ScriptedAgent } from '../../tests/agents/ScriptedAgent.js';
import {
  getCombatForecast,
  gridDistance,
  parseRange,
  isStaff,
  getEffectiveStaffRange,
  resolveHeal,
} from '../../src/engine/Combat.js';
import { hitProbability } from '../../src/engine/HitRoll.js';
import { getCombatWeapons } from '../../src/engine/UnitManager.js';
import { distanceFieldToAdjacent } from './RescueAgent.js';

const key = (c, r) => `${c},${r}`;

function expected(side) {
  return (
    Math.max(0, Number(side?.damage) || 0) *
    hitProbability(side?.hit) *
    Math.max(0, Number(side?.attackCount) || 0)
  );
}

export class TacticianAgent {
  constructor(driver, options = {}) {
    this.driver = driver;
    this.fallback = new ScriptedAgent(driver);
    this.rescue = options.rescue !== false;
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
    if (obj === 'seize' || obj === 'escape') return this.fallback.chooseAction(legal);
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
    for (const e of b.enemyUnits) {
      if (!e.weapon || isStaff(e.weapon) || e.currentHP <= 0) continue;
      const reach = [];
      for (const [k, entry] of this._enemyReach(e)) {
        if (entry?.stoppable === false) continue;
        const [c, r] = k.split(',').map(Number);
        reach.push({ c, r });
      }
      out.push({ e, reach, range: parseRange(e.weapon.range) });
    }
    return out;
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
      let best = null;
      for (const p of t.reach) {
        if (occupied.has(key(p.c, p.r))) continue;
        if (p.c === tile.col && p.r === tile.row) continue;
        const d = gridDistance(p.c, p.r, tile.col, tile.row);
        if (d < t.range.min || d > t.range.max) continue;
        best = { d, p };
        break;
      }
      if (!best) continue;
      attackers++;
      const fc = getCombatForecast(
        { ...t.e },
        t.e.weapon,
        { ...unit, col: tile.col, row: tile.row },
        unit.weapon,
        best.d,
        b.grid.getTerrainAt(best.p.c, best.p.r),
        defTerrain,
        { skillsData: b.gameData.skills || [] },
      );
      total += expected(fc.attacker);
      worst +=
        Math.max(0, Number(fc.attacker?.damage) || 0) *
        Math.max(0, Number(fc.attacker?.attackCount) || 0);
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
    const advance = turn - this.lastContactTurn >= 2;
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
    const nearestEnemyDist = (tile) =>
      Math.min(
        Infinity,
        ...b.enemyUnits.map((e) => gridDistance(tile.col, tile.row, e.col, e.row)),
      );
    let best = null;
    const consider = (plan) => {
      if (!best || plan.score > best.score) best = plan;
    };

    for (const tile of tiles) {
      const terrain = b.grid.getTerrainAt(tile.col, tile.row);
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
        const d = gridDistance(tile.col, tile.row, e.col, e.row);
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
          (e.isBoss ? 3 : 0) -
          1.1 * taken -
          0.6 * danger.total -
          (lethal ? lethalWeight : 0) +
          (npc ? -0.8 * (npcField.get(key(tile.col, tile.row)) ?? 20) : 0);
        consider({ unit: u, tile, action: 'Attack', target: e, score });
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
            (this._lethal(u, danger, hpNow) ? lethalWeight : 0);
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
      consider({ unit: u, tile, action: 'Wait', target: null, score: score - 4 });
    }
    return best;
  }
}
