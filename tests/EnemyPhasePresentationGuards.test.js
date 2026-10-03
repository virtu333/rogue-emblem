// Presentation that follows a settled model change must never stop the flow around it:
//  - D7  executeCombat's recovery clears highlights after the attacker's action is
//        consumed; a throw there skipped completeBattleAction (no unitActed, no auto-end).
//  - D8  the weapon-swap banner swallowed its failure with no telemetry.
//  - an enemy status staff's banner, badge and fx follow a spent staff and an applied
//        condition; a throw there left the enemy unmarked as acted, cutting the phase short.
//  - the boss-enrage fx and music are likewise after the enrage itself.
import { afterEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';

vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: vi.fn() }));

import { reportAsyncError } from '../src/utils/errorReporter.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { presentationFailureProxy } from './harness/PresentationFailureProxy.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { registerBattleEntity } from '../src/engine/BattleEntityIdentity.js';
import { AIController } from '../src/engine/AIController.js';
import { hasCondition } from '../src/engine/StatusConditionSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const originalRandom = Math.random;
afterEach(() => {
  Math.random = originalRandom;
  reportAsyncError.mockClear();
  vi.restoreAllMocks();
});

const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const unit = (name, faction, col, row, extra = {}) => ({
  name,
  faction,
  level: 10,
  tier: 'base',
  className: faction === 'player' ? 'Fighter' : 'Soldier',
  col,
  row,
  xp: 0,
  currentHP: 30,
  stats: { HP: 30, STR: 10, MAG: 0, SKL: 10, SPD: 8, DEF: 5, RES: 5, LCK: 5, MOV: 5 },
  moveType: 'Infantry',
  weapon: weapon('Iron Sword'),
  inventory: [],
  proficiencies: [{ type: 'Sword', rank: 'Mast' }],
  skills: [],
  accessory: null,
  affixes: [],
  ...extra,
});

function battle(units) {
  const scene = journeyBattleScene({ battleInProgress: {} }, data);
  scene.runManager = null;
  scene._battleRewindPolicy = 'fixed-v1';
  scene._battleRng = createBattleRng(42);
  Math.random = scene._battleRng;
  Object.assign(scene.grid, {
    cols: 12,
    rows: 12,
    fogEnabled: false,
    isVisible: () => true,
    clearTemporaryTerrainsBySource: () => {},
    getMoveCost: () => 1,
    getTerrainAt: () => data.terrain.find((t) => t.name === 'Plain'),
  });
  scene.battleConfig = { objective: 'rout' };
  scene.goldEarned = 0;
  scene.turnPar = 99;
  scene.turnBonusConfig = data.turnBonus;
  scene.getCurrentTurnNumber = () => 1;
  scene.playerUnits = units.filter((u) => u.faction === 'player');
  scene.enemyUnits = units.filter((u) => u.faction === 'enemy');
  scene.npcUnits = [];
  const calls = presentationFailureProxy(scene, 0);
  for (const u of units) registerBattleEntity(scene, u);
  scene.sys = { isActive: () => true };
  scene.scene = { isActive: () => true };
  scene.showActionMenu = vi.fn();
  return { scene, calls };
}
const errors = () =>
  reportAsyncError.mock.calls.map(([context, , extra]) => [context, extra?.label]);

describe('D7: a highlight clear that throws in the combat recovery', () => {
  async function recover(broken) {
    const attacker = unit('Fighter', 'player', 2, 2);
    const foe = unit('Foe', 'enemy', 3, 2);
    const { scene } = battle([attacker, foe]);
    if (broken) {
      // clearAttackHighlights also runs as the strike begins; only the recovery's call fails.
      const clear = scene.grid[broken];
      let calls = 0;
      scene.grid[broken] = (...args) => {
        if (broken === 'clearAttackHighlights' && ++calls === 1)
          return clear.apply(scene.grid, args);
        throw new Error(`${broken} layer destroyed`);
      };
    }
    // The domain failure that sends the strike into recovery.
    vi.spyOn(scene, '_prepareCombatContext').mockImplementation(() => {
      throw new Error('combat domain failure');
    });
    await scene.executeCombat(attacker, foe);
    return { scene, attacker };
  }
  const recoveryReports = () =>
    errors().filter(([, label]) => label === 'combat recovery highlights');

  it.each(['clearHighlights', 'clearAttackHighlights'])(
    'a throwing %s still consumes the action and tells the turn manager exactly once',
    async (broken) => {
      const calm = await recover(null);
      expect(calm.scene.turnManager.unitActedCalls).toBe(1);
      expect(recoveryReports()).toEqual([]);
      reportAsyncError.mockClear();
      const world = await recover(broken);
      expect(world.attacker.hasActed).toBe(true);
      expect(world.scene.battleState).toBe('PLAYER_IDLE');
      expect(world.scene.selectedUnit).toBeNull();
      expect(world.scene.turnManager.unitActedCalls).toBe(1);
      expect(recoveryReports()).toEqual([
        ['battle_presentation_failed', 'combat recovery highlights'],
      ]);
    },
  );
});

describe('D8: the weapon-swap banner', () => {
  it('reports a banner that throws, and still announces the next swap', async () => {
    const a = unit('Mira', 'player', 0, 0);
    const b = unit('Joss', 'player', 1, 0);
    const { scene } = battle([a, b]);
    const shown = [];
    scene.showBriefBanner = vi.fn(async (message) => {
      shown.push(message);
      if (shown.length === 1) throw new Error('banner host gone');
    });
    await scene._announceWeaponSwaps([
      { unit: a, to: weapon('Iron Sword') },
      { unit: b, to: weapon('Iron Lance') },
    ]);
    expect(shown).toEqual([
      'Mira is out of shots: now wielding Iron Sword',
      'Joss is out of shots: now wielding Iron Lance',
    ]);
    expect(errors()).toEqual([['battle_presentation_failed', 'weapon swap banner']]);
  });

  it('reports a banner that throws synchronously too', async () => {
    const a = unit('Mira', 'player', 0, 0);
    const { scene } = battle([a]);
    scene.showBriefBanner = () => {
      throw new Error('banner host gone');
    };
    await expect(
      scene._announceWeaponSwaps([{ unit: a, to: weapon('Iron Sword') }]),
    ).resolves.toBeUndefined();
    expect(errors()).toEqual([['battle_presentation_failed', 'weapon swap banner']]);
  });
});

describe('an enemy status staff whose banner, badge or fx throws', () => {
  /** Two staff-bearers; the first one's presentation fails. The AI drives the phase. */
  async function phase({ sabotage, branch = 'hit' }) {
    const target = unit('Target', 'player', 8, 5);
    const mage = unit('Hexer', 'enemy', 5, 5, {
      className: 'Mage',
      statusStaff: weapon('Sleep Staff'),
    });
    const second = unit('Second', 'enemy', 5, 8, {
      className: 'Mage',
      statusStaff: weapon('Sleep Staff'),
    });
    const { scene } = battle([target, mage, second]);
    const ai = new AIController(scene.grid, {});
    ai._delay = async () => {};
    const decide = (enemy) => ({
      path: null,
      target: null,
      statusStaffTarget: target,
      reason: 'status_staff',
      who: enemy.name,
    });
    vi.spyOn(ai, '_decideAction').mockImplementation(decide);
    // hit: a roll of 0 lands; miss: a roll of 0.99 cannot beat the hit chance.
    scene._battleRng = () => (branch === 'miss' ? 0.99 : 0);
    Math.random = scene._battleRng;
    if (branch === 'immune')
      target.accessory = { name: 'Ward', combatEffects: { statusImmunity: true } };
    sabotage(scene);
    const done = [];
    await ai.processEnemyPhase(scene.enemyUnits, scene.playerUnits, [], {
      onStatusStaff: (enemy, t) => scene.executeEnemyStatusStaff(enemy, t),
      onUnitDone: async (enemy) => {
        enemy.hasActed = true;
        done.push(enemy.name);
      },
    });
    return { scene, mage, second, target, done };
  }
  const boom = () => {
    throw new Error('renderer destroyed');
  };

  it.each([
    [
      'the banner',
      (scene) => (scene.showBriefBanner = vi.fn(async () => boom())),
      'status staff banner',
    ],
    ['the status badge', (scene) => (scene._addConditionIcon = boom), 'status staff icon'],
    [
      'the fx',
      (scene) => {
        scene._combatFx.playStatus = boom;
      },
      'status staff fx',
    ],
  ])(
    '%s: the staff use stands, the enemy is marked acted and the phase goes on',
    async (_, sabotage, label) => {
      const { mage, second, target, done } = await phase({ sabotage });
      expect(done).toEqual(['Hexer', 'Second']);
      expect([mage.hasActed, second.hasActed]).toEqual([true, true]);
      expect(mage.statusStaff._usesSpent).toBe(1);
      expect(second.statusStaff._usesSpent).toBe(1);
      expect(hasCondition(target, 'sleep')).toBe(true);
      expect(errors()).toContainEqual(['battle_presentation_failed', label]);
    },
  );

  it.each(['miss', 'immune'])(
    'a %s banner that throws does not stop the phase either',
    async (branch) => {
      const { done, mage } = await phase({
        branch,
        sabotage: (scene) => (scene.showBriefBanner = vi.fn(async () => boom())),
      });
      expect(done).toEqual(['Hexer', 'Second']);
      expect(mage.hasActed).toBe(true);
      expect(errors()).toContainEqual(['battle_presentation_failed', 'status staff banner']);
    },
  );
});

describe('the boss enrage cue', () => {
  it('a throwing music, fx or banner cannot cut the turn-pressure update short', () => {
    const boss = unit('Boss', 'enemy', 5, 5, { isBoss: true });
    const { scene } = battle([unit('Edric', 'player', 0, 0), boss]);
    boss.graphic = scene.add.sprite();
    scene._musicCtrl = {
      onBossEnrage: () => {
        throw new Error('audio gone');
      },
    };
    scene._combatFx.playEnrage = () => {
      throw new Error('fx gone');
    };
    scene.showBriefBanner = () => Promise.reject(new Error('banner gone'));
    expect(() => scene._playBossEnrageFx()).not.toThrow();
    return Promise.resolve().then(() => {
      expect(
        errors()
          .map(([, label]) => label)
          .sort(),
      ).toEqual(['boss enrage banner', 'boss enrage fx', 'boss enrage music']);
    });
  });
});
