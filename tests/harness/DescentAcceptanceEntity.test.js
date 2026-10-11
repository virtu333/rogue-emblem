// Acceptance, scenario 5 (the Entity's finale, played to its end): on the Descent's last node (the
// Entity, `eldritch_sanctum`, generated and locked for a real Nightfall run past its gate), a
// mortal army kills the Entity with real attacks (its counters, its enemy-phase strikes and its
// splash all landing), then seizes the throne it sat on; the run then ends in victory. No forced
// win, no invincibility: the harness's own rules end the battle. Ways this breaks:
//   - the throne can be seized while the Entity lives, or never once it is dead
//   - the Entity's splash never lands in a real enemy phase, lands more or fewer tiles than its
//     Answered count allows, or splashes the Entity's own target twice
//   - a Rite tier reaches the Entity's HP or stones (it carries none on any tier)
//   - the finale's victory does not end the run, or pays a Vision charge
import { afterEach, describe, expect, it } from 'vitest';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { createRite } from '../../src/engine/Rite.js';
import { entityDistanceTo, entitySplashCountFor, isEntity } from '../../src/engine/EntitySystem.js';
import { ENTITY_SPLASH_COUNT } from '../../src/utils/constants.js';
import {
  baseData,
  descentRun,
  endTurn,
  nodeOf,
  passNode,
  playNode,
  strike,
  strongArmy,
  survivorsOf,
  winNode,
} from './DescentAcceptanceKit.js';

afterEach(() => restoreMathRandom());

const ANSWERED = baseData.descent.rite.bands.find((b) => b.id === 'answered').min;

describe('the Entity, killed and its throne seized, ends the run', () => {
  it('Nightfall, an Answered Rite: real strikes, real splash, a real seize', async () => {
    installSeed(61);
    const rm = descentRun('hard', { runSeed: 61 });
    winNode(rm, 'stair');
    winNode(rm, 'column');
    winNode(rm, 'vigil');
    passNode(rm, 'landing');
    winNode(rm, 'gate');
    passNode(rm, 'ruins');
    rm.rite = createRite({ start: ANSWERED + 1 });
    const node = nodeOf(rm, 'entity');
    expect(node.id).toBe(rm.nodeMap.bossNodeId);

    const army = strongArmy(rm, 4);
    const { driver, b, battleConfig } = playNode(rm, node, army);
    const entity = b.enemyUnits.find((u) => isEntity(u));
    expect(entity).toBeTruthy();
    expect(entity.revivalStones || 0).toBe(0);
    const splashCount = entitySplashCountFor(battleConfig);
    expect(splashCount).toBe(
      ENTITY_SPLASH_COUNT + (baseData.descent.rite.mods.answered.entity.splashDelta || 0),
    );
    const throne = battleConfig.thronePos;
    expect(throne).toBeTruthy();

    // Every splash the battle makes, recorded as the harness makes it (the one rule, unchanged).
    const splashes = [];
    const splash = b._applyEntitySplash.bind(b);
    b._applyEntitySplash = (attacker, target) => {
      const before = new Map(b.playerUnits.map((u) => [u, u.currentHP]));
      const record = splash(attacker, target);
      const struck = [...before].filter(([u, hp]) => u !== target && u.currentHP < hp);
      splashes.push({ target, struck: struck.map(([u]) => u), record });
      return record;
    };

    const lord = b.playerUnits.find((u) => u.isLord);
    // Turn 1: three of the army close on the Entity side by side and wait, so its enemy phase
    // has a target with neighbours for the splash to find.
    const side = [];
    for (let r = 0; r < battleConfig.rows && side.length < 3; r++) {
      for (let c = 0; c < battleConfig.cols && side.length < 3; c++) {
        if (entityDistanceTo(entity, c, r) !== 1 || b.getUnitAt(c, r)) continue;
        const cost = b.grid.getTerrainAt(c, r)?.moveCost?.Infantry;
        if (!(cost > 0 && cost < 99)) continue;
        if (side.length && Math.abs(side.at(-1).col - c) + Math.abs(side.at(-1).row - r) !== 1)
          continue;
        side.push({ col: c, row: r });
      }
    }
    expect(side).toHaveLength(3);
    const waiting = b.playerUnits.filter((u) => u !== lord).slice(0, 3);
    for (const [i, unit] of waiting.entries()) {
      Object.assign(unit, side[i]);
      await driver.step({ type: 'select_unit', payload: { unitName: unit.name } });
      await driver.step({ type: 'move_to', payload: side[i] });
      await driver.step({ type: 'choose_action', payload: { label: 'Wait' } });
    }
    const hpBeforePhase = entity.currentHP;
    await endTurn(driver);
    expect(b.result).toBeNull();
    // The army's counters landed in the Entity's own phase (its counter reach is the army's).
    expect(entity.currentHP).toBeLessThan(hpBeforePhase);

    let entityStrikes = 0;
    for (let turn = 0; turn < 12 && b.enemyUnits.includes(entity) && !b.result; turn++) {
      for (const unit of [...b.playerUnits]) {
        if (!b.enemyUnits.includes(entity) || b.result) break;
        if (unit.hasActed || unit === lord) continue;
        const hpBefore = entity.currentHP;
        await strike(driver, unit, entity);
        if (entity.currentHP < hpBefore || !b.enemyUnits.includes(entity)) entityStrikes++;
      }
      if (b.enemyUnits.includes(entity) && !b.result) await endTurn(driver);
    }
    expect(b.result).toBeNull(); // the army stands; the Entity is down, the throne not yet taken
    expect(b.enemyUnits).not.toContain(entity);
    expect(entityStrikes).toBeGreaterThan(0); // the last blow was a player's attack
    expect(b.playerUnits).toContain(lord);

    // The Entity struck in its enemy phases, and its splash landed beside its targets.
    expect(splashes.length).toBeGreaterThan(0);
    const landed = splashes.filter((s) => s.struck.length > 0);
    expect(landed.length).toBeGreaterThan(0);
    for (const s of splashes) {
      expect(s.struck.length).toBeLessThanOrEqual(splashCount);
      expect(s.struck).not.toContain(s.target);
    }

    // The lord takes the throne: Seize is offered only now, and wins the battle.
    lord.col = throne.col;
    lord.row = throne.row;
    if (lord.hasActed) await endTurn(driver);
    await driver.step({ type: 'select_unit', payload: { unitName: lord.name } });
    await driver.step({ type: 'move_to', payload: { col: throne.col, row: throne.row } });
    const offered = driver.listLegalActions().map((a) => a.payload?.label);
    expect(offered).toContain('Seize');
    await driver.step({ type: 'choose_action', payload: { label: 'Seize' } });
    expect(b.result).toBe('victory');

    // The run's commit: the act and the run are complete; no Vision from the finale.
    const vision = rm.visionChargesRemaining;
    expect(
      rm.completeBattle(survivorsOf(b), node.id, b.goldEarned, {
        turnCount: b.turnManager.turnNumber,
        turnPar: b.turnPar ?? null,
      }),
    ).toBe(true);
    expect(rm.isActComplete()).toBe(true);
    expect(rm.isRunComplete()).toBe(true);
    expect(rm.visionChargesRemaining).toBe(vision);
  }, 120_000);

  it('the throne is not offered while the Entity lives', () => {
    installSeed(62);
    const rm = descentRun('hard', { runSeed: 62 });
    for (const key of ['stair', 'column', 'vigil']) winNode(rm, key);
    passNode(rm, 'landing');
    winNode(rm, 'gate');
    passNode(rm, 'ruins');
    const { b, battleConfig } = playNode(rm, nodeOf(rm, 'entity'), strongArmy(rm, 1));
    const lord = b.playerUnits.find((u) => u.isLord);
    const throne = battleConfig.thronePos;
    // Stand the lord on the throne by hand (the Entity's footprint covers it in play).
    lord.col = throne.col;
    lord.row = throne.row;
    b.selectUnit(lord.name);
    b.moveTo(throne.col, throne.row);
    expect(b.getAvailableActions().map((a) => a.label)).not.toContain('Seize');
  });
});
