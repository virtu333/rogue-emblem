import { afterEach, describe, it, expect, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { BattleScene } from '../src/scenes/BattleScene.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { isolateBattleTextFactory } from '../src/utils/presentationText.js';
import { loadGameData } from './testData.js';
const original = Math.random;
afterEach(() => {
  Math.random = original;
  vi.restoreAllMocks();
});

function battle() {
  const scene = new BattleScene();
  Object.assign(scene, {
    _battleRewindPolicy: 'fixed-v1',
    visionBaseSeed: 42,
    _battleDecisionRngState: createBattleRng(42).getState(),
    turnManager: { currentPhase: 'player', turnNumber: 1 },
  });
  scene.reseedBattleRng(42);
  return scene;
}

describe('fixed outcomes through production battle methods', () => {
  it('forecast A → B → A, cancel and weapon cycling do not draw or change Gambler', () => {
    const scene = battle();
    const attacker = {
      name: 'A',
      battleEntityId: 'u1',
      col: 0,
      row: 0,
      accessory: { combatEffects: { gamblerCoin: true } },
    };
    const a = { name: 'Enemy', battleEntityId: 'u2', col: 1, row: 0 };
    const b = { ...a, battleEntityId: 'u3', col: 0, row: 1 };
    const before = scene._battleRng.getState();
    const direct = scene._getGamblerAtkDelta(attacker, scene._ensureCombatRollSession(attacker, a));
    for (const target of [b, a, b, a]) {
      scene._clearCombatRollSession();
      attacker.weapon = { name: 'temporary preview' };
      scene._getGamblerAtkDelta(attacker, scene._ensureCombatRollSession(attacker, target));
    }
    scene._clearCombatRollSession();
    attacker.weapon = { name: 'Iron Sword' };
    const mods = {};
    scene._applyAccessoryPhaseCombatMods(
      attacker,
      mods,
      scene._ensureCombatRollSession(attacker, a),
    );
    expect(mods.atkBonus).toBe(direct);
    expect(scene._battleRng.getState()).toEqual(before);
    const stream = Array.from({ length: 50 }, () => Math.random());
    scene.reseedBattleRng(0, JSON.parse(JSON.stringify(before)));
    scene._clearCombatRollSession();
    expect(scene._getGamblerAtkDelta(attacker, scene._ensureCombatRollSession(attacker, a))).toBe(
      direct,
    );
    expect(Array.from({ length: 50 }, () => Math.random())).toEqual(stream);
  });

  it("Gambler's Coin: one flip per unit per phase, whatever the tile, target or decision", () => {
    // Playtest 2026-09-29 #16: the flip was keyed by decision cursor, tiles and target,
    // so previewing other tiles and targets could fish for the win.
    const coin = loadGameData().accessories.find((a) => a.name === "Gambler's Coin");
    const { winAtkBonus, lossAtkPenalty } = coin.combatEffects.gambler;
    const scene = battle();
    const attacker = { name: 'A', battleEntityId: 'u1', col: 0, row: 0, accessory: coin };
    const flip = (target, tile, cursorShift = 0) => {
      scene._clearCombatRollSession();
      Object.assign(attacker, tile);
      scene._battleDecisionRngState = {
        ...createBattleRng(42).getState(),
        cursor: 7 + cursorShift,
      };
      return scene._getGamblerAtkDelta(attacker, scene._ensureCombatRollSession(attacker, target));
    };
    const before = scene._battleRng.getState();
    const seen = new Set();
    for (let turn = 1; turn <= 40; turn++) {
      scene.turnManager.turnNumber = turn;
      const flips = [];
      for (let i = 0; i < 4; i++)
        for (let tile = 0; tile < 3; tile++) {
          const target = { name: 'E', battleEntityId: `u${10 + i}`, col: 5, row: i };
          flips.push(flip(target, { col: tile, row: tile }, i + tile));
        }
      // Every combat this phase shares the unit's one flip.
      expect(new Set(flips).size).toBe(1);
      seen.add(flips[0]);
    }
    // Still a coin: across turns it lands both ways, on the data's numbers.
    expect([...seen].sort((a, b) => a - b)).toEqual([lossAtkPenalty, winAtkBonus]);
    // Forecast flips never draw from the battle stream.
    expect(scene._battleRng.getState()).toEqual(before);
  });

  it('legacy text UUID allocation cannot change fixed battle outcomes and teardown restores factory', () => {
    const scene = battle();
    const text = vi.fn(() => Array.from({ length: 150 }, () => Math.random()));
    scene.add = { text };
    const dispose = isolateBattleTextFactory(scene);
    const before = scene._battleRng.getState();
    scene.add.text('new canvas widget');
    expect(scene._battleRng.getState()).toEqual(before);
    dispose();
    expect(scene.add.text).toBe(text);
  });

  it('fixed suspend saves exact cursor without reseeding, including write failure', () => {
    const scene = battle();
    Object.assign(scene, {
      _battleSession: 1,
      playerUnits: [],
      enemyUnits: [],
      npcUnits: [],
      grid: { mapLayout: [[0]] },
      battleState: 'PLAYER_IDLE',
      runManager: {
        rngSeed: 42,
        battleInProgress: {},
        setBattleCheckpoint(cp) {
          this.battleInProgress.checkpoint = cp;
        },
      },
      _persistBattleRunState: vi.fn(() => ({ ok: false })),
    });
    Math.random();
    Math.random();
    const cursor = scene._battleRng.getState();
    expect(new BattleSuspendController(scene).captureCheckpoint()).toBe(false);
    expect(scene._battleRng.getState()).toEqual(cursor);
    expect(scene.runManager.battleInProgress.checkpoint.rngState).toEqual(cursor);
  });
});
