// The merchant caravan (CaravanSystem.createCaravanUnit) lives in scene.npcUnits but
// is never a recruit. Playtest: a lord next to it was offered Talk, which turned the
// Merchant into a player unit (no class, no growths), lost the caravan shop, and the
// objective line asked the player to "Recruit: ... Merchant". These pin the scene's
// Talk gate, Talk itself and the objective line against the real caravan unit.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (val, min, max) => Math.max(min, Math.min(max, val)) },
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { createCaravanUnit } from '../src/engine/CaravanSystem.js';
import { RecruitBeaconController } from '../src/ui/RecruitBeaconController.js';
import { CARAVAN_HINT } from '../src/ui/CaravanController.js';
import { loadGameData } from './testData.js';

function makeDisplayObject(seed = {}) {
  return {
    ...seed,
    setDepth() {
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setOrigin() {
      return this;
    },
    on() {
      return this;
    },
    destroy() {},
  };
}

const sword = { name: 'Iron Sword', type: 'Sword', might: 5, hit: 90, weight: 5, range: '1' };

function makeLord() {
  return {
    name: 'Edric',
    faction: 'player',
    isLord: true,
    col: 3,
    row: 2,
    currentHP: 20,
    stats: { HP: 20 },
    weapon: sword,
    inventory: [sword],
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    consumables: [],
    skills: [],
  };
}

function makeRecruit(col, row) {
  return {
    name: 'Garrick',
    className: 'Cavalier',
    faction: 'npc',
    col,
    row,
    currentHP: 20,
    stats: { HP: 20 },
  };
}

function makeScene(npcUnits) {
  const scene = new BattleScene();
  Object.assign(scene, {
    hideActionMenu: vi.fn(),
    _showWeaponDetailTooltip: vi.fn(),
    _hideWeaponDetailTooltip: vi.fn(),
    findAttackTargets: vi.fn(() => []),
    findHealTargets: vi.fn(() => []),
    getActiveHealStaff: vi.fn(() => null),
    _getWeaponArtChoices: vi.fn(() => []),
    _getSelectedWeaponArtForUnit: vi.fn(() => null),
    getPromotionConsumable: vi.fn(() => null),
    findShoveTargets: vi.fn(() => []),
    findPullTargets: vi.fn(() => []),
    findTradeTargets: vi.fn(() => []),
    findSwapTargets: vi.fn(() => []),
    findDanceTargets: vi.fn(() => []),
    findBreakTargets: vi.fn(() => []),
    registry: { get: vi.fn(() => null) },
    npcUnits,
    enemyUnits: [],
    playerUnits: [],
    runManager: { roster: [{}, {}], getRosterCap: () => 12 },
    battleConfig: { objective: 'rout' },
    gameData: { classes: [], lords: [] },
    _playerDeathsThisBattle: 0,
    cameras: { main: { centerX: 320, centerY: 240, width: 640, height: 480 } },
    input: { on: vi.fn(), off: vi.fn() },
    grid: { cols: 10, gridToPixel: () => ({ x: 64, y: 64 }) },
    add: { rectangle: () => makeDisplayObject() },
    _clampMenuPosition: (x, y) => ({ x, y }),
    _pinToScreen: vi.fn(),
    _registerActionMenu: vi.fn(),
  });
  scene._makeMenuTextButton = vi.fn((_x, _y, label) => makeDisplayObject({ label }));
  return scene;
}

const menuLabels = (scene) => scene._makeMenuTextButton.mock.calls.map((call) => call[2]);

describe('merchant caravan is not a recruit', () => {
  it('offers a lord next to the caravan no Talk; next to a recruit it does', () => {
    const lord = makeLord();
    const caravan = createCaravanUnit('act2', { col: 4, row: 2 });
    const scene = makeScene([caravan]);
    scene.playerUnits = [lord];

    expect(scene.findTalkTarget(lord)).toBeNull();
    BattleScene.prototype.showActionMenu.call(scene, lord);
    expect(menuLabels(scene)).not.toContain('Talk');

    // Same scene, a recruit on the other side: Talk is offered and names the recruit.
    const recruit = makeRecruit(2, 2);
    scene.npcUnits.push(recruit);
    scene._makeMenuTextButton.mockClear();
    expect(scene.findTalkTarget(lord)).toBe(recruit);
    BattleScene.prototype.showActionMenu.call(scene, lord);
    expect(menuLabels(scene)).toContain('Talk');
  });

  it('Talk with only the caravan adjacent leaves it an NPC and the army unchanged', async () => {
    const lord = makeLord();
    const caravan = createCaravanUnit('act1', { col: 3, row: 3 });
    const scene = makeScene([caravan]);
    scene.playerUnits = [lord];
    scene.finishUnitAction = vi.fn();
    scene.dialogueOverlay = { show: vi.fn(() => Promise.resolve()) };

    await scene.executeTalk(lord);

    expect(scene.finishUnitAction).toHaveBeenCalledWith(lord);
    expect(scene.dialogueOverlay.show).not.toHaveBeenCalled();
    expect(caravan.faction).toBe('npc');
    expect(scene.npcUnits).toEqual([caravan]);
    expect(scene.playerUnits).toEqual([lord]);
  });

  it('the objective line asks for no recruit while only the caravan is on the field', () => {
    const caravan = createCaravanUnit('act2', { col: 6, row: 1 });
    const scene = makeScene([caravan]);
    scene.enemyUnits = [{ currentHP: 10 }, { currentHP: 10 }];
    scene.objectiveText = { setText: vi.fn(), setColor: vi.fn() };
    // The real beacon, synced the way BattleScene's update loop does.
    scene._recruitBeacon = new RecruitBeaconController(scene);
    scene._recruitBeacon.sync();

    scene.updateObjectiveText();
    expect(scene.objectiveText.setText).toHaveBeenLastCalledWith('Rout: 2 enemies remaining');

    const recruit = makeRecruit(2, 2);
    scene.npcUnits.push(recruit);
    scene._recruitBeacon.sync();
    scene.updateObjectiveText();
    expect(scene.objectiveText.setText).toHaveBeenLastCalledWith(
      'Rout: 2 enemies remaining\nRecruit: reach Garrick with a lord · Talk',
    );
  });

  it("the caravan hint says staves can't heal it, which is true", () => {
    expect(CARAVAN_HINT).toContain('if it survives, it will trade with you.');
    expect(CARAVAN_HINT).toContain("Staves can't heal it.");
    const heal = loadGameData().weapons.find((w) => w.name === 'Heal');
    const healer = {
      ...makeLord(),
      name: 'Sera',
      isLord: false,
      stats: { HP: 18, MAG: 8 },
      weapon: heal,
      inventory: [heal],
      proficiencies: [{ type: 'Staff', rank: 'Prof' }],
    };
    const caravan = createCaravanUnit('act2', { col: 4, row: 2 });
    caravan.currentHP = 1;
    const hurtAlly = { ...makeLord(), col: 2, row: 2, currentHP: 5 };
    const scene = makeScene([caravan]);
    scene.playerUnits = [healer, hurtAlly];
    scene.getActiveHealStaff = BattleScene.prototype.getActiveHealStaff;
    scene.getUsableStaves = BattleScene.prototype.getUsableStaves;
    // The healer reaches both; only the army is a staff target.
    expect(BattleScene.prototype.findHealTargets.call(scene, healer)).toEqual([hurtAlly]);
  });
});
