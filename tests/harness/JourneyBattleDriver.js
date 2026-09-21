// Combat state-machine adapter. Resolution is real; targeting/animations are outside
// this fixture. Popup presentation is held open by the rendering-only test shell.
import { expect } from 'vitest';
import { journeyBattleScene } from './JourneyBattleScene.js';
import { createUnit } from '../../src/engine/UnitManager.js';
import { createSeededRng } from '../../src/engine/BlessingEngine.js';
import { resolveCombat } from '../../src/engine/Combat.js';
import { loadRun } from '../../src/engine/RunManager.js';
import { BattleSuspendController } from '../../src/ui/BattleSuspendController.js';
import {
  presentQueuedLevelUps,
  completeResolvedAction,
} from '../../src/ui/BattlePresentationCheckpoint.js';
import { canInspectUnit } from '../../src/engine/BattleInformation.js';

function battleScene(run, data) {
  const scene = journeyBattleScene(run, data);
  scene.reseedBattleRng = (seed) => {
    Math.random = createSeededRng(seed);
  };
  return scene;
}
const project = (scene) => ({
  units: ['playerUnits', 'enemyUnits', 'npcUnits'].map((group) =>
    scene[group].map((u) => ({
      name: u.name,
      hp: u.currentHP,
      level: u.level,
      xp: u.xp,
      stats: u.stats,
      skills: u.skills,
      acted: u.hasActed === true,
      weapon: u.weapon?.name,
    })),
  ),
  pending: scene._pendingActionCompletion || null,
  map: scene.grid.mapLayout,
  fog: [...scene.grid.visibleSet],
});
export class JourneyBattleDriver {
  constructor(driver) {
    this.driver = driver;
    this.phase = 'ready';
    this.round = 0;
    this.coverage = {};
  }
  actions() {
    if (this.phase === 'ready') return [0, 1].map((target) => ({ type: 'combat-resolve', target }));
    if (this.phase === 'popup')
      return [{ type: 'combat-popup-reload' }, { type: 'combat-popup-dismiss' }];
    if (this.phase === 'settled') return [{ type: 'combat-suspend-resume' }];
    return [];
  }
  snapshot() {
    return { phase: this.phase, round: this.round, state: this.scene ? project(this.scene) : null };
  }
  assertDurable() {
    const cp = loadRun(this.driver.data, 1).battleInProgress.checkpoint;
    const stored = journeyBattleScene(this.driver.run, this.driver.data);
    new BattleSuspendController(stored).applyUnits(cp);
    stored._pendingActionCompletion = cp.pendingActionCompletion;
    // World restore occurs in finalizeResume, which also consumes continuation.
    stored.grid.mapLayout = cp.mapLayout || stored.grid.mapLayout;
    expect(project(stored).units, 'combat checkpoint units').toEqual(project(this.scene).units);
    expect(cp.fog.visible, 'checkpoint fog').toEqual([...this.scene.grid.visibleSet]);
    expect(cp.pendingActionCompletion || null, 'combat continuation').toEqual(
      this.scene._pendingActionCompletion || null,
    );
  }
  reload() {
    const writes = this.driver.storage.writes;
    const run = loadRun(this.driver.data, 1);
    expect(this.driver.storage.writes, 'reload must not save before reading').toBe(writes);
    const scene = battleScene(run, this.driver.data);
    const controller = new BattleSuspendController(scene);
    controller.applyUnits(run.battleInProgress.checkpoint);
    controller.finalizeResume(run.battleInProgress.checkpoint);
    this.driver.run = run;
    return scene;
  }
  async step(action) {
    this.driver.trace.push(action);
    this.coverage[action.type] = (this.coverage[action.type] || 0) + 1;
    if (action.type === 'combat-resolve') {
      const { run, data } = this.driver;
      run.clearBattleInProgress();
      run.beginBattleInProgress(run.nodeMap.nodes[0].id, { battleParams: {} });
      const s = (this.scene = journeyBattleScene(run, data));
      const unit = createUnit(
        data.classes.find((c) => c.name === 'Fighter'),
        14,
        data.weapons,
        { name: 'Journey veteran' },
      );
      Object.assign(unit, { xp: 99, col: 1, row: 1, faction: 'player' });
      // Durable high-HP sparring fixture prevents battle-end scene transitions.
      unit.stats.HP = unit.currentHP = 150;
      s.playerUnits = [unit];
      s.enemyUnits = [0, 1].map((i) => {
        const foe = structuredClone(unit);
        Object.assign(foe, {
          name: `Journey foe ${i}`,
          xp: 0,
          faction: 'enemy',
          col: 3,
          row: i + 2,
        });
        return foe;
      });
      expect(s._captureSuspendCheckpoint()).toBe(true);
      const enemy = s.enemyUnits[action.target];
      const result = resolveCombat(unit, unit.weapon, enemy, enemy.weapon, 1, null, null, {
        skillsData: data.skills,
      });
      unit.currentHP = result.attackerHP;
      enemy.currentHP = result.defenderHP;
      await s.awardScaledXP(unit, 20);
      this.expectedXP = { level: unit.level, xp: unit.xp, stats: structuredClone(unit.stats) };
      s._journeyPopup = () =>
        new Promise((resolve) => {
          this.closePopup = resolve;
        });
      this.presentation = presentQueuedLevelUps(s, { kind: 'combat', unitName: unit.name });
      expect(this.closePopup, 'real presentation reaches popup').toBeTypeOf('function');
      this.phase = 'popup';
      this.assertDurable();
    } else if (action.type === 'combat-popup-reload') {
      const old = this.scene;
      this.scene = this.reload();
      old._sceneShutdownCleanedUp = true;
      this.closePopup();
      await this.presentation;
      this.phase = 'settled';
    } else if (action.type === 'combat-popup-dismiss') {
      this.closePopup();
      await this.presentation;
      completeResolvedAction(this.scene, this.scene._pendingActionCompletion);
      this.phase = 'settled';
    } else {
      this.assertDurable();
      const before = project(this.scene);
      this.scene = this.reload();
      expect(project(this.scene)).toEqual(before);
      expect(this.scene.turnManager.unitActedCalls).toBe(0);
      this.round++;
      this.phase = this.round >= 4 ? 'done' : 'ready';
    }
    if (this.phase === 'settled' || this.phase === 'done') {
      const unit = this.scene.playerUnits[0];
      expect({ level: unit.level, xp: unit.xp, stats: unit.stats }).toEqual(this.expectedXP);
      expect(unit.hasActed).toBe(true);
      expect(canInspectUnit(this.scene.grid, this.scene.enemyUnits[0])).toBe(false);
      this.assertDurable();
    }
  }
}
