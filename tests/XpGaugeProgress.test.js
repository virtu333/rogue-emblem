// The EXP gauge in the battle's flow (docs/specs/exp-bars.md §2.2, §4, §7): every gain
// queues a record, presentQueuedProgress plays each unit's gauge then its cards, the
// prologue's level-up beat comes after the cards, and nothing here touches game state.
// Failure modes:
//   - a Mentor's Band kill plays gauge A, gauge B, then the cards (or the cards first);
//   - staff and dance (present: false) never queue a record, so they never show a gauge;
//   - a capped unit gets a gauge or a "+N" float for XP it never gained;
//   - the old "+N XP" float still draws;
//   - a gauge opens over a blocking prologue note, or before the beat of the card ahead;
//   - pending gauges alone make a boundary a recovery, or capture a checkpoint;
//   - a gauge-only queue is dropped where a card-only queue would have shown.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { shown } = vi.hoisted(() => ({ shown: [] }));

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/LevelUpPopup.js', () => ({
  LevelUpPopup: class {
    constructor(_scene, unit, levelUp) {
      this.unit = unit;
      this.levelUp = levelUp;
    }
    show() {
      shown.push(`card ${this.unit.name} ${this.levelUp.newLevel}`);
      return Promise.resolve();
    }
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { presentQueuedProgress, presentQueuedLevelUps } from '../src/ui/BattlePresentationCheckpoint.js'; // prettier-ignore
import { classifyBattleBoundary } from '../src/ui/BattleCheckpointAdapter.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const cls = (name) => data.classes.find((c) => c.name === name);
const band = data.accessories.find((a) => a.name === "Mentor's Band");

function unit(name, level, xp, extra = {}) {
  const u = createRecruitUnit({ name, level }, cls('Fighter'), data.weapons);
  Object.assign(u, { name, level, xp, faction: 'player', currentHP: u.stats.HP }, extra);
  return u;
}

function makeScene() {
  const scene = new BattleScene();
  scene.registry = { get: () => null };
  scene.grid = { gridToPixel: () => ({ x: 0, y: 0 }) };
  scene.add = { text: vi.fn(() => ({ setOrigin: () => ({ setDepth: () => ({}) }) })) };
  scene.tweens = { add: vi.fn() };
  scene.updateHPBar = vi.fn();
  scene._playLevelUpSfx = vi.fn();
  scene._stopLevelUpSfx = vi.fn();
  scene.gameData = { classes: data.classes, skills: data.skills, traits: data.traits };
  scene.battleParams = { xpMultiplier: 1 };
  scene.turnManager = { currentPhase: 'player', turnNumber: 1 };
  scene.getEnemyXpMultiplier = () => 1;
  scene.getTurnPressureState = () => ({ xpMultiplier: 1 });
  scene._xpGauge = {
    play: vi.fn(async (record) => {
      shown.push(`gauge ${record.unitName} +${record.gained}`);
      return true;
    }),
  };
  return scene;
}

/** A level-10 holder of Mentor's Band beside a level-3 trainee, both a point from a level. */
function bandPair(scene) {
  const holder = unit('Holder', 10, 99, {
    battleEntityId: 'u1',
    col: 2,
    row: 2,
    accessory: structuredClone(band),
  });
  const trainee = unit('Trainee', 3, 99, { battleEntityId: 'u2', col: 3, row: 2 });
  scene.playerUnits = [holder, trainee];
  return { holder, trainee };
}

beforeEach(() => {
  shown.length = 0;
});

describe('the gain record queue', () => {
  it("a Mentor's Band kill that levels both: gauge A, A's card, gauge B, B's card", async () => {
    const scene = makeScene();
    const { holder, trainee } = bandPair(scene);
    const foe = { name: 'Foe', level: 10, tier: 'base', faction: 'enemy' };
    await scene.awardXP(holder, foe, true, null, null);
    expect(holder.level).toBe(11);
    expect(trainee.level).toBe(4);
    expect(scene._pendingXpGauges.map((r) => r.unitName)).toEqual(['Holder', 'Trainee']);
    // Nothing is drawn while the gain is applied.
    expect(shown).toEqual([]);
    await presentQueuedProgress(scene, null, { session: scene._battleSession });
    const [a, b] = shown.filter((s) => s.startsWith('gauge'));
    expect(shown).toEqual([a, 'card Holder 11', b, 'card Trainee 4']);
    expect(a).toMatch(/^gauge Holder \+\d+$/);
    expect(b).toMatch(/^gauge Trainee \+\d+$/);
    expect(scene._pendingXpGauges).toEqual([]);
    expect(scene._pendingLevelUpPopups).toEqual([]);
    // The record counts what was gained: from 99 to the next level's leftover.
    expect(scene._xpGauge.play.mock.calls[0][0]).toMatchObject({
      before: { level: 10, xp: 99 },
      after: { level: 11, xp: holder.xp },
      gained: 1 + holder.xp,
    });
  });

  it('staff and dance gains (present: false) queue their record too', () => {
    const scene = makeScene();
    const cleric = unit('Cleric', 5, 0, { battleEntityId: 'u3' });
    scene.playerUnits = [cleric];
    expect(scene.awardScaledXP(cleric, 20, { present: false })).toBe(20);
    expect(scene._pendingXpGauges).toEqual([
      {
        unitId: 'u3',
        unitName: 'Cleric',
        before: { level: 5, extendedLevels: 0, xp: 0, capped: false },
        after: { level: 5, extendedLevels: 0, xp: 20, capped: false },
        gained: 20,
        segments: [{ from: 0, to: 20, level: 5, extendedLevels: 0, label: '5' }],
      },
    ]);
  });

  it('a capped unit: no gauge, no card and no float', async () => {
    const scene = makeScene();
    const veteran = unit('Veteran', 20, 0, { battleEntityId: 'u4' });
    scene.playerUnits = [veteran];
    // The award is still the scaled number (Mentor's Band and tests read it)...
    expect(scene.awardScaledXP(veteran, 30)).toBe(30);
    // ...but nothing was gained, so nothing is shown.
    expect(veteran.xp).toBe(0);
    expect(scene._pendingXpGauges ?? []).toEqual([]);
    expect(scene._pendingLevelUpPopups ?? []).toEqual([]);
    await presentQueuedProgress(scene, null, { session: scene._battleSession });
    expect(scene._xpGauge.play).not.toHaveBeenCalled();
    expect(scene.add.text).not.toHaveBeenCalled();
    expect(scene.tweens.add).not.toHaveBeenCalled();
  });

  it('the old "+N XP" float is gone: a gain draws nothing until its gauge plays', () => {
    const scene = makeScene();
    const fighter = unit('Fighter', 5, 0, { battleEntityId: 'u5' });
    scene.playerUnits = [fighter];
    scene.awardScaledXP(fighter, 30);
    expect(scene.add.text).not.toHaveBeenCalled();
    expect(scene.tweens.add).not.toHaveBeenCalled();
    expect(BattleScene.prototype._presentScaledXP).toBeUndefined();
  });

  it('keeps the old name as an alias', () => {
    expect(presentQueuedLevelUps).toBe(presentQueuedProgress);
  });
});

describe('with the prologue', () => {
  /** A chapter whose notes hold the screen until read (`release`). */
  function chapter() {
    const waits = [];
    const prologue = {
      presenting: 0,
      isPresenting() {
        return this.presenting > 0;
      },
      idle: vi.fn(function idle() {
        if (this.presenting === 0) return Promise.resolve();
        return new Promise((resolve) => waits.push(resolve));
      }),
      onLevelUp: vi.fn(function onLevelUp(u) {
        shown.push(`beat ${u.name}`);
        this.presenting += 1;
        return new Promise((resolve) =>
          waits.push(() => {
            this.presenting -= 1;
            resolve(true);
          }),
        );
      }),
    };
    const release = () => {
      const next = waits.shift();
      next?.();
    };
    return { prologue, release, waits };
  }
  const tick = async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  };

  it('gauge, then the card, then the beat; the next gauge waits for that beat', async () => {
    const scene = makeScene();
    const { holder } = bandPair(scene);
    const { prologue, release } = chapter();
    scene._prologue = prologue;
    await scene.awardXP(holder, { name: 'Foe', level: 10, tier: 'base' }, true, null, null);
    const done = presentQueuedProgress(scene, null, { session: scene._battleSession });
    await tick();
    expect(shown.map((s) => s.split(' +')[0])).toEqual([
      'gauge Holder',
      'card Holder 11',
      'beat Holder',
    ]);
    release(); // the beat's note is read
    await tick();
    expect(shown.map((s) => s.split(' +')[0])).toEqual([
      'gauge Holder',
      'card Holder 11',
      'beat Holder',
      'gauge Trainee',
      'card Trainee 4',
      'beat Trainee',
    ]);
    release();
    await done;
  });

  it('never opens a gauge over a note already on screen', async () => {
    const scene = makeScene();
    const fighter = unit('Fighter', 5, 0, { battleEntityId: 'u5' });
    scene.playerUnits = [fighter];
    const { prologue, release } = chapter();
    scene._prologue = prologue;
    prologue.presenting = 1; // a blocking note is showing
    scene.awardScaledXP(fighter, 30);
    const done = presentQueuedProgress(scene, null, { session: scene._battleSession });
    await tick();
    expect(scene._xpGauge.play).not.toHaveBeenCalled();
    prologue.presenting = 0;
    release();
    await done;
    expect(shown).toEqual(['gauge Fighter +30']);
  });
});

describe('boundaries and presenters', () => {
  it('pending gauges alone never make a boundary a recovery', () => {
    const scene = {
      battleState: 'PLAYER_IDLE',
      turnManager: { currentPhase: 'player' },
      _pendingXpGauges: [{ unitName: 'A', gained: 5, segments: [{ from: 0, to: 5 }] }],
    };
    expect(classifyBattleBoundary(scene)).toBe('destination');
    expect(classifyBattleBoundary({ ...scene, _pendingLevelUpPopups: [{}] })).toBe('recovery');
  });

  it('finishUnitAction presents a gauge-only queue and captures nothing for it', async () => {
    const scene = makeScene();
    const fighter = unit('Fighter', 5, 0, { battleEntityId: 'u5' });
    scene.playerUnits = [fighter];
    scene.awardScaledXP(fighter, 30);
    scene._captureSuspendCheckpoint = vi.fn(() => true);
    // The battle ends at completion: the action stops there (completeResolvedAction).
    scene.checkBattleEnd = vi.fn(() => true);
    const finishing = scene.finishUnitAction(fighter, { session: scene._battleSession });
    expect(scene.battleState).toBe('COMBAT_RESOLVING');
    await finishing;
    expect(shown).toEqual(['gauge Fighter +30']);
    expect(scene._captureSuspendCheckpoint).not.toHaveBeenCalled();
    expect(scene._pendingActionCompletion).toBeNull();
    expect(scene.checkBattleEnd).toHaveBeenCalledOnce();
  });

  it('with a card queued too, the continuation is captured before the gauge plays', async () => {
    const scene = makeScene();
    const fighter = unit('Fighter', 5, 95, { battleEntityId: 'u5' });
    scene.playerUnits = [fighter];
    scene.awardScaledXP(fighter, 30);
    let seen = null;
    scene._captureSuspendCheckpoint = vi.fn(() => {
      seen = { action: scene._pendingActionCompletion, shown: [...shown] };
      return true;
    });
    scene.checkBattleEnd = vi.fn(() => true);
    await scene.finishUnitAction(fighter, { session: scene._battleSession });
    expect(seen).toEqual({
      action: { kind: 'finish', unitName: 'Fighter', unitId: 'u5', skipCanto: false },
      shown: [],
    });
    expect(shown).toEqual(['gauge Fighter +30', 'card Fighter 6']);
  });
});
