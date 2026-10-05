// Prologue P2, "Old Hands" (docs/specs/prologue-chapter.md §6 P2, §8): the harness
// owns the final tiles. Edric (at P1's expected level, and at his P1 stats as the
// floor) and Gaspar against the outrider squad at the ford, through the real engine
// (HeadlessBattle on the locked config, the roster buildPrologueRoster builds for a
// replay). Three policies: the intended play (chip with the lance, finish with
// Edric, never into a lethal counter), the naive play (attack the nearest enemy with
// the equipped weapon, drink the Vulnerary when P1's note said so) and Gaspar alone.
import { afterEach, describe, expect, it } from 'vitest';
import { restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { getCombatForecast } from '../../src/engine/Combat.js';
import { enemyThreatTiles } from '../../src/engine/ThreatForecast.js';
import { XP_MIN } from '../../src/utils/constants.js';
import {
  BRIDGE,
  SEEDS,
  VILLAGE,
  bothStand,
  config,
  enemy,
  exposure,
  finishPhase,
  gasparOnly,
  intended,
  key,
  moveAndWait,
  naive,
  play,
  prologue,
  startP2,
  stoppableTiles,
  strikeTiles,
  terrain,
  trackKills,
  unit,
  weapon,
} from './prologueP2Policies.js';

afterEach(() => restoreMathRandom());

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
  }, 120000); // 300 seeds × a full battle: slow under a loaded CI box

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
  }, 120000); // 300 seeds × a full battle: slow under a loaded CI box

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
