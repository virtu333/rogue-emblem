// Review fixes for Keen Eye and Holdfast. Each test names a way the first pass could fail:
//   - the harness marked a unit as moved for standing still, so Holdfast never held for an
//     attack made from where the unit stands (the scene only sets hasMoved on a real move)
//   - a throw while undimming a unit skipped the anchor stamp; the handoff fallback left stale
//     movement and no anchors
//   - the forecast's counter-risk and affix notes read the plain Hit, not the first strike's
//   - a recruit that joined mid-phase could never hold ground
//   - _turnAnchor was dropped by the real suspend restore or the Vision rewind restore
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/LevelUpPopup.js', () => ({
  LevelUpPopup: class {
    async show() {}
  },
}));
vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => {}),
  showMinorHint: vi.fn(),
  showContextualHint: vi.fn(),
}));

import './harness/JourneyTestSetup.js';
import { GameDriver } from './harness/GameDriver.js';
import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { isHoldingGround, stampTurnAnchors } from '../src/engine/BlessingCombatMods.js';
import { settleRecruitJoin } from '../src/engine/BattleRecruits.js';
import { getCombatForecast } from '../src/engine/Combat.js';
import { counterRisk } from '../src/ui/forecastDisplay.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PROFILE = {
  actHitBonus: 0,
  firstStrikeHitBonus: 10,
  stationary: { defBonus: 2, avoidBonus: 10 },
  legacyTerrainBonuses: [],
};

describe('harness moveTo matches the scene: standing still is not moving', () => {
  function board() {
    const driver = new GameDriver(data, { act: 'act1', objective: 'rout', battleSeed: 5 });
    driver.init();
    const b = driver.battle;
    b.runManager = { getBlessingCombatProfile: () => PROFILE };
    const edric = b.playerUnits.find((u) => u.name === 'Edric');
    b.battleConfig.reinforcements = null;
    return { b, edric };
  }

  it('a unit that taps its own tile keeps hasMoved false and still holds ground', () => {
    const { b, edric } = board();
    expect(isHoldingGround(edric, b.turnManager.turnNumber)).toBe(true);
    b.selectUnit('Edric');
    b.moveTo(edric.col, edric.row);
    expect(edric.hasMoved).toBe(false);
    expect(isHoldingGround(edric, b.turnManager.turnNumber)).toBe(true);
  });

  it('a unit that really moves is marked as moved and stops holding', () => {
    const { b, edric } = board();
    b.selectUnit('Edric');
    const dest = [...b.movementRange.entries()].find(
      ([key, entry]) => entry.stoppable !== false && key !== `${edric.col},${edric.row}`,
    )[0];
    const [col, row] = dest.split(',').map(Number);
    b.moveTo(col, row);
    expect(edric.hasMoved).toBe(true);
    expect(isHoldingGround(edric, b.turnManager.turnNumber)).toBe(false);
  });

  it('an attack made from where the unit stands gets Holdfast in its combat mods', () => {
    const { b, edric } = board();
    const foe = b.enemyUnits[0];
    foe.col = edric.col + 1;
    foe.row = edric.row;
    b.selectUnit('Edric');
    b.moveTo(edric.col, edric.row);
    const { atkMods } = b._buildSkillCtx(edric, foe);
    expect(atkMods.defBonus).toBeGreaterThanOrEqual(2);
    expect(atkMods.avoidBonus).toBeGreaterThanOrEqual(10);
    expect(atkMods.firstStrikeHitBonus).toBe(10);
  });

  it('the same attack after a real step has no Holdfast', () => {
    const { b, edric } = board();
    const foe = b.enemyUnits[0];
    b.selectUnit('Edric');
    const [key] = [...b.movementRange.entries()].find(
      ([k, entry]) => entry.stoppable !== false && k !== `${edric.col},${edric.row}`,
    );
    const [col, row] = key.split(',').map(Number);
    b.moveTo(col, row);
    const { atkMods } = b._buildSkillCtx(edric, foe);
    expect(atkMods.defBonus).toBe(0);
    expect(atkMods.avoidBonus).toBe(0);
  });
});

describe('the player-phase reset stamps anchors even when presentation throws', () => {
  function resetScene(undim) {
    const scene = new BattleScene();
    scene.undimUnit = undim;
    scene.playerUnits = [
      {
        name: 'A',
        faction: 'player',
        col: 2,
        row: 3,
        currentHP: 10,
        hasMoved: true,
        _movementSpent: 3,
      },
      { name: 'B', faction: 'player', col: 4, row: 1, currentHP: 10, hasActed: true },
    ];
    return scene;
  }

  it('stamps before the undim call: a throwing undim leaves every unit anchored', () => {
    const scene = resetScene(() => {
      throw new Error('sprite gone');
    });
    // _recoverPlayerHandoff is the caller that survives the throw; drive the reset directly.
    scene.battleState = 'ENEMY_PHASE';
    scene._settleUnitSpritesAfterError = () => {};
    scene.showBriefBanner = () => {};
    scene.captureVisionSnapshot = () => {};
    scene.updateVisionHud = () => {};
    scene._captureSuspendCheckpoint = () => {};
    scene.refreshEndTurnControl = () => {};
    scene.visionDialog = null;
    scene._playerTurnStartToken = { settle() {} };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(scene._recoverPlayerHandoff(4, Error('handoff'))).toBe(true);
    for (const u of scene.playerUnits) {
      expect(u._turnAnchor).toEqual({ turn: 4, col: u.col, row: u.row });
      expect(u.hasMoved).toBe(false);
      expect(u._movementSpent).toBe(0);
    }
    expect(isHoldingGround(scene.playerUnits[0], 4)).toBe(true);
  });

  it('the fallback alone (reset threw before any flag) still zeroes movement and stamps', () => {
    const scene = resetScene(() => {});
    scene.battleState = 'ENEMY_PHASE';
    scene._settleUnitSpritesAfterError = () => {};
    scene.showBriefBanner = () => {};
    scene.captureVisionSnapshot = () => {};
    scene.updateVisionHud = () => {};
    scene._captureSuspendCheckpoint = () => {};
    scene.refreshEndTurnControl = () => {};
    scene._playerTurnStartToken = { settle() {} };
    // The weapon-art usage reset is the first presentation-free call that can throw.
    scene.playerUnits[0]._battleWeaponArtUsage = { get turn() { throw new Error('bad usage'); } }; // prettier-ignore
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(scene._recoverPlayerHandoff(2, Error('handoff'))).toBe(true);
    for (const u of scene.playerUnits) {
      expect(u._turnAnchor).toEqual({ turn: 2, col: u.col, row: u.row });
      expect(u._movementSpent).toBe(0);
    }
  });
});

describe('forecast readers use the first strike’s Hit', () => {
  const blade = {
    name: 'Test Blade',
    type: 'Sword',
    might: 20,
    hit: 70,
    crit: 0,
    weight: 1,
    range: '1',
    special: '',
  };
  const unit = (name, faction, extra = {}) => ({
    name,
    level: 5,
    tier: 'base',
    faction,
    col: faction === 'player' ? 0 : 1,
    row: 0,
    currentHP: 30,
    stats: { HP: 30, STR: 12, MAG: 0, SKL: 5, SPD: 9, DEF: 2, RES: 2, LCK: 5, MOV: 5 },
    moveType: 'Infantry',
    className: 'Myrmidon',
    weaponRank: 'Prof',
    weapon: blade,
    inventory: [blade],
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    skills: [],
    affixes: [],
    accessory: null,
    ...extra,
  });
  const forecast = (atkMods, defender) => {
    const attacker = unit('Edric', 'player');
    return getCombatForecast(attacker, blade, defender, blade, 1, null, null, {
      atkMods: { hitBonus: 0, avoidBonus: 0, defBonus: 0, critBonus: 0, ...atkMods },
      defMods: { hitBonus: 0, avoidBonus: 0, defBonus: 0, critBonus: 0 },
      affixData: data.affixes,
      visibleUnits: [],
    });
  };

  it('counterRisk stays quiet when only Keen Eye makes the opening blow a sure kill', () => {
    // The first strike is 100 (the later ones 90): the foe dies before it can counter.
    const fc = {
      attacker: { name: 'Edric', hit: 90, firstHit: 100, damage: 30, hp: 20 },
      defender: { canCounter: true, hit: 80, damage: 25, crit: 0, hp: 30 },
      display: { simpleExchange: true },
    };
    expect(counterRisk(fc, 20)).toBe('');
    // Without a first-strike Hit the same numbers still warn.
    delete fc.attacker.firstHit;
    expect(counterRisk(fc, 20)).toContain('could defeat Edric');
  });

  it('counterRisk still warns when even the first strike is not a sure thing', () => {
    const fc = {
      attacker: { name: 'Edric', hit: 80, firstHit: 90, damage: 30, hp: 20 },
      defender: { canCounter: true, hit: 80, damage: 25, crit: 0, hp: 30 },
      display: { simpleExchange: true },
    };
    expect(counterRisk(fc, 20)).toContain('could defeat Edric');
  });

  it('keeps the foe’s affix notes when the base Hit is 0 but the first strike can land', () => {
    const shielded = unit('Guard', 'enemy', { affixes: ['shielded'] });
    // Raw Hit far below 0, so every later strike is 0; the bonus lifts the first above it.
    const plain = forecast({ hitBonus: -200 }, shielded);
    expect(plain.attacker.hit).toBe(0);
    expect(plain.attacker.firstHit).toBe(0);
    expect(plain.defender.affixNotes.map((n) => n.affixId)).toEqual([]);
    const keen = forecast({ hitBonus: -200, firstStrikeHitBonus: 300 }, shielded);
    expect(keen.attacker.hit).toBe(0);
    expect(keen.attacker.firstHit).toBe(100);
    expect(keen.defender.affixNotes.map((n) => n.affixId)).toEqual(['shielded']);
  });
});

describe('a recruit that joins mid-phase can hold ground', () => {
  const recruit = () => ({
    name: 'Mira',
    faction: 'npc',
    col: 5,
    row: 5,
    currentHP: 10,
    stats: { HP: 10 },
    hasMoved: true,
    _movementSpent: 4,
  });
  const join = (npc, turn) =>
    settleRecruitJoin({
      npc,
      npcUnits: [npc],
      playerUnits: [],
      battleRecruits: [],
      runManager: null,
      turn,
    });

  it('is anchored at its join tile for the current turn', () => {
    const npc = recruit();
    expect(join(npc, 3)).not.toBeNull();
    expect(npc.faction).toBe('player');
    expect(npc._turnAnchor).toEqual({ turn: 3, col: 5, row: 5 });
    expect(isHoldingGround(npc, 3)).toBe(true);
  });

  it('does not hold on another turn, and a join without a turn stamps nothing', () => {
    const npc = recruit();
    join(npc, 3);
    expect(isHoldingGround(npc, 4)).toBe(false);
    const other = recruit();
    join(other, undefined);
    expect(other._turnAnchor).toBeUndefined();
  });
});

describe('_turnAnchor survives the real restores', () => {
  function fixture() {
    const storage = new JourneyStorage();
    vi.stubGlobal('localStorage', storage);
    const driver = new RunDriver(storage);
    driver.run.beginBattleInProgress('anchor-battle', { act: 'act1', objective: 'rout' });
    const scene = journeyBattleScene(driver.run, driver.data);
    scene._battleSession = 1;
    scene.playerUnits = driver.run.roster;
    scene.playerUnits.forEach((u, i) => {
      u.col = i;
      u.row = 1;
      scene.addUnitGraphic(u);
    });
    scene._battleRewindPolicy = 'fixed-v1';
    stampTurnAnchors(scene.playerUnits, 1);
    return { driver, scene };
  }

  it('BattleSuspendController.applyUnits restores the anchor from a checkpoint (refresh mid-turn)', () => {
    const { driver, scene } = fixture();
    const suspend = new BattleSuspendController(scene);
    scene._battleSuspendController = suspend;
    expect(suspend.captureCheckpoint({ session: 1 })).toBe(true);
    const checkpoint = JSON.parse(JSON.stringify(driver.run.battleInProgress.checkpoint));
    const edricAnchor = scene.playerUnits[0]._turnAnchor;
    expect(edricAnchor).toEqual({ turn: 1, col: 0, row: 1 });

    const restored = journeyBattleScene(driver.run, driver.data);
    new BattleSuspendController(restored).applyUnits(checkpoint);
    const back = restored.playerUnits[0];
    expect(back._turnAnchor).toEqual(edricAnchor);
    expect(isHoldingGround(back, 1)).toBe(true);
  });

  it('the Vision rewind restore gives the anchor back with the position it described', () => {
    const { scene } = fixture();
    scene.captureVisionSnapshot();
    const unit = scene.playerUnits[0];
    // Play on: the unit walks away, then a rewind brings it home.
    unit.col = 3;
    unit.hasMoved = true;
    unit._movementSpent = 2;
    vi.spyOn(scene._visionController, 'playRewindEffect').mockImplementation(() => {});
    expect(scene.applyVisionSnapshot()).toBe(true);
    const back = scene.playerUnits[0];
    expect(back._turnAnchor).toEqual({ turn: 1, col: 0, row: 1 });
    expect(back.col).toBe(0);
    expect(isHoldingGround(back, 1)).toBe(true);
  });
});
