// A promotion that swears an Oath and opens a weapon type, for a unit whose five skill slots
// and five-weapon bag are already full: the Oath takes its own slot (#382) and the new type's
// Iron weapon goes to the convoy (#381), on every promotion path (church altar, the roster's
// Master Seal, a battle's Master Seal), and through every way back into the run (save and
// load, Resume Battle, a Vision rewind, Continue from Map). Nothing is lost, and nothing is
// duplicated: one Oath, one Iron Sword.
//
// Ways this goes wrong, each caught below:
//   the Oath benched, or benching one of the five; the five reshuffled
//   the Iron Sword dropped, put in the full bag, or sent to the convoy twice
//   a load (or two) moving a skill again, or doubling the Oath or the sword
//   a resumed battle missing the sword or the Oath; a rewind leaving either behind, or a
//   second promotion after a rewind leaving two
//   Continue from Map keeping the battle's promotion or the convoy's sword
//
// Expected values are read from the rules, not the code: Aldo is a Cavalier (Lances) who
// promotes to Paladin (Lances, Swords), so the one grant is the Iron Sword; his deed (three
// enemy phases held on a bridge) swears Oath of the Bridge, Pavise.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';

const pickers = vi.hoisted(() => []);
vi.mock('../src/ui/VisionRewindPicker.js', () => ({
  VisionRewindPicker: class {
    constructor(scene, options) {
      this.options = options;
      pickers.push(this);
    }
    destroy() {}
  },
}));
vi.mock('../src/ui/serviceSave.js', () => ({ saveServiceRun: vi.fn(() => '') }));

import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { JourneyStorage, RunDriver } from './harness/RunDriver.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { TurnManager } from '../src/engine/TurnManager.js';
import { RunManager } from '../src/engine/RunManager.js';
import {
  createUnit,
  getClassInnateSkills,
  resolvePromotionTargets,
} from '../src/engine/UnitManager.js';
import { commitBattleDeeds, emptyBattleDeeds } from '../src/engine/DeedSystem.js';
import { promoteAtChurch } from '../src/engine/ChurchCommands.js';
import { applyRosterClassChange } from '../src/engine/RosterCommands.js';
import { OATH_SLOT, SKILL_SLOT, equippedOfKind } from '../src/engine/SkillSlots.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { PromotionController } from '../src/ui/PromotionController.js';
import { PromotionChoicePanel } from '../src/ui/PromotionChoicePanel.js';
import { LevelUpPopup } from '../src/ui/LevelUpPopup.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';
import { _resetUidCounter } from '../src/utils/itemUid.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const cls = (name) => data.classes.find((c) => c.name === name);
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const FIVE = ['luna', 'astra', 'vantage', 'wrath', 'sol'];
const LANCES = ['Iron Lance', 'Steel Lance', 'Javelin', 'Iron Lance', 'Steel Lance'];
const OATH = 'pavise';
// Paladin's own innate skills arrive at a full skill pool: they, never the Oath, wait.
const PALADIN_INNATE = getClassInnateSkills('Paladin', data.skills).filter(
  (id) => !FIVE.includes(id),
);
const originalRandom = Math.random;
let deedKey = 0;

afterEach(() => {
  Math.random = originalRandom;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Aldo: a level 10 Cavalier with five skills, five lances and a bridge held three times. */
function aldo() {
  const unit = createUnit(cls('Cavalier'), 10, data.weapons, { name: 'Aldo' });
  unit.faction = 'player';
  unit.skills = [...FIVE];
  unit.benchedSkills = [];
  unit.inventory = LANCES.map(weapon);
  unit.weapon = unit.inventory[0];
  unit._battleDeeds = { ...emptyBattleDeeds(), heldPhases: 3, heldPlaces: ['Bridge', 'Bridge', 'Bridge'] }; // prettier-ignore
  commitBattleDeeds([unit], data.deeds, { battleKey: `oath-convoy:${++deedKey}` });
  return unit;
}
const paladin = (unit) =>
  resolvePromotionTargets(unit, data.classes, data.lords).find((c) => c.name === 'Paladin');
const convoySwords = (run) =>
  run.getConvoyItems().weapons.filter((w) => w.name === 'Iron Sword').length;
const masterSeal = () => structuredClone(data.consumables.find((i) => i.effect === 'promote'));

/** Promoted as promised: Oath in its slot, the five kept, the sword in the convoy once. */
function expectPromoted(unit, run, swordsBefore) {
  expect(unit.className).toBe('Paladin');
  expect(unit.skills).toEqual([...FIVE, OATH]);
  expect(equippedOfKind(unit, SKILL_SLOT, data.skills)).toEqual(FIVE);
  expect(equippedOfKind(unit, OATH_SLOT, data.skills)).toEqual([OATH]);
  expect(unit.benchedSkills ?? []).toEqual(PALADIN_INNATE);
  expect(unit.deeds.oath).toMatchObject({ skillId: OATH });
  const known = [...unit.skills, ...(unit.benchedSkills ?? [])];
  expect(new Set(known).size).toBe(known.length);
  expect(unit.inventory.map((w) => w.name)).toEqual(LANCES);
  expect(convoySwords(run)).toBe(swordsBefore + 1);
}
/** Not promoted: the Cavalier as he was, no Oath, no sword in the convoy. */
function expectUnpromoted(unit, run, swordsBefore) {
  expect(unit.className).toBe('Cavalier');
  expect(unit.skills).toEqual(FIVE);
  expect(unit.benchedSkills ?? []).toEqual([]);
  expect(unit.deeds.oath).toBeUndefined();
  expect(unit.inventory.map((w) => w.name)).toEqual(LANCES);
  expect(convoySwords(run)).toBe(swordsBefore);
}
/** Save and load twice: each load hands back the same promoted unit, nothing moved again. */
function expectSurvivesReload(run, swordsBefore) {
  let current = run;
  for (let i = 0; i < 2; i++) {
    current = RunManager.fromJSON(JSON.parse(JSON.stringify(current.toJSON())), data);
    expectPromoted(
      current.roster.find((u) => u.name === 'Aldo'),
      current,
      swordsBefore,
    );
  }
}

describe('between battles', () => {
  let run;
  beforeEach(() => {
    run = new RunManager(data);
    run.startRun({ runSeed: 7 });
    run.gold = 99999;
  });

  it('the church altar: Oath in its own slot, the Iron Sword to the convoy, and a reload keeps both once', () => {
    const unit = aldo();
    run.roster.push(unit);
    const swords = convoySwords(run);
    const res = promoteAtChurch(run, unit, 'c1', paladin(unit), data);
    expect(res.ok).toBe(true);
    expectPromoted(unit, run, swords);
    expect(res.message).toContain('Oath of the Bridge: learned Pavise.');
    expect(res.message).toContain('Bag full: Iron Sword sent to the convoy.');
    expectSurvivesReload(run, swords);
  });

  it("the roster's Master Seal: the same, and the seal spent once", () => {
    const unit = aldo();
    const seal = masterSeal();
    unit.consumables = [seal];
    run.roster.push(unit);
    const swords = convoySwords(run);
    const res = applyRosterClassChange(run, unit, seal, paladin(unit), data);
    expect(res.ok).toBe(true);
    expectPromoted(unit, run, swords);
    expect(unit.consumables).toEqual([]);
    expectSurvivesReload(run, swords);
  });
});

/**
 * The production battle scene (the journey harness): Edric and Aldo on an 8×8 field, a foe
 * far off. The turn's start is the timeline's first point and the rewind's destination.
 */
function battle() {
  _resetUidCounter();
  Math.random = createBattleRng(42);
  vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  const driver = new RunDriver(storage);
  const run = driver.run;
  run.visionChargesRemaining = 3;
  const unit = aldo();
  unit.consumables = [masterSeal()];
  run.roster.push(unit);
  const swords = convoySwords(run);
  run.beginBattleInProgress(run.nodeMap.nodes[0].id, { battleParams: {} });
  const scene = journeyBattleScene(run, data);
  Object.assign(scene, {
    _battleSession: 1,
    _sceneShutdownCleanedUp: false,
    scene: { isActive: () => true },
    sys: { isActive: () => true, settings: { active: true } },
    textures: { exists: () => false },
    _battleRewindPolicy: 'fixed-v1',
    _battleRng: createBattleRng(7),
    battleConfig: { objective: 'rout' },
    goldEarned: 0,
    checkBattleEnd: () => false,
    showPromotionBanner: async () => {},
    showBriefBanner: vi.fn(),
    _playLevelUpSfx: () => {},
    _stopLevelUpSfx: () => {},
  });
  Math.random = scene._battleRng;
  Object.assign(scene.grid, {
    cols: 8,
    rows: 8,
    mapLayout: Array.from({ length: 8 }, () => Array(8).fill(0)),
    fogEnabled: false,
    getMoveCost: () => 1,
    getTerrainAt: () => data.terrain[0],
  });
  // The battle fights the run's copies (BattleScene takes `run.getRoster()`), as in play:
  // the roster itself is never written mid-battle.
  const deployed = run.getRoster();
  const edric = deployed.find((u) => u.name === 'Edric');
  const fighter = deployed.find((u) => u.name === 'Aldo');
  const foe = createUnit(cls('Fighter'), 1, data.weapons, { name: 'Far Foe' });
  Object.assign(edric, { col: 0, row: 0, isCommander: true });
  Object.assign(fighter, { col: 1, row: 1 });
  Object.assign(foe, { col: 7, row: 7, faction: 'enemy' });
  scene.playerUnits = [edric, fighter];
  scene.enemyUnits = [foe];
  for (const u of [...scene.playerUnits, ...scene.enemyUnits]) scene.addUnitGraphic(u);
  scene.turnManager = new TurnManager({ onPhaseChange: () => {}, checkBattleEnd: () => false });
  scene.turnManager.init(scene.playerUnits, scene.enemyUnits, scene.npcUnits);
  scene._battleCommanderId = edric.battleEntityId;
  scene._visionController = new VisionRewindController(scene, run);
  vi.spyOn(scene._visionController, 'playRewindEffect').mockImplementation(() => {});
  scene.captureVisionSnapshot();
  scene._timelineBoundary = 'turn_start';
  expect(scene._captureSuspendCheckpoint({ session: scene._battleSession })).toBe(true);
  vi.spyOn(PromotionChoicePanel.prototype, 'show').mockResolvedValue(cls('Paladin'));
  vi.spyOn(LevelUpPopup.prototype, 'show').mockResolvedValue();
  return { scene, storage, run, unit, swords };
}
const promoteInBattle = async ({ scene }) => {
  const unit = scene.playerUnits.find((u) => u.name === 'Aldo');
  const seal = unit.consumables.find((i) => i.effect === 'promote');
  expect(await new PromotionController(scene).executePromotion(unit, seal)).toBe(true);
  scene.battleState = 'PLAYER_IDLE';
  return unit;
};
const stored = (storage) => JSON.parse(storage.getItem('emblem_rogue_slot_1_run'));

describe("a battle's Master Seal", () => {
  it('promotes as the altar does; the checkpoint holds the Oath in its slot and the sword in the convoy', async () => {
    const ctx = battle();
    const unit = await promoteInBattle(ctx);
    expectPromoted(unit, ctx.run, ctx.swords);
    expect(unit.consumables.some((i) => i.effect === 'promote')).toBe(false);
    expect(ctx.scene.showBriefBanner).toHaveBeenCalledWith(
      'Bag full: Iron Sword sent to the convoy.',
      expect.anything(),
    );

    // Resume Battle: the stored checkpoint, loaded as a refresh loads it, applied to a scene.
    const loaded = RunManager.fromJSON(stored(ctx.storage), data);
    expect(convoySwords(loaded)).toBe(ctx.swords + 1);
    const checkpoint = loaded.battleInProgress.checkpoint;
    const fresh = journeyBattleScene(loaded, data);
    Object.assign(fresh.grid, {
      cols: 8,
      rows: 8,
      mapLayout: Array.from({ length: 8 }, () => Array(8).fill(0)),
    });
    new BattleSuspendController(fresh).applyUnits(checkpoint);
    expectPromoted(
      fresh.playerUnits.find((u) => u.name === 'Aldo'),
      loaded,
      ctx.swords,
    );
    // A second save and load of the resumed battle moves nothing more.
    const again = RunManager.fromJSON(JSON.parse(JSON.stringify(loaded.toJSON())), data);
    expect(again.battleInProgress.checkpoint.playerUnits).toEqual(checkpoint.playerUnits);
    expect(convoySwords(again)).toBe(ctx.swords + 1);
  });

  it('a Vision rewind takes the promotion, the Oath and the sword back together; promoting again leaves one of each', async () => {
    const ctx = battle();
    await promoteInBattle(ctx);
    expect(ctx.scene._visionController.requestRewind({ force: true })).toBe(true);
    const { rows } = pickers.at(-1).options.listing;
    pickers.at(-1).options.onConfirm(rows[0].id);
    ctx.scene.battleState = 'PLAYER_IDLE';
    const unit = ctx.scene.playerUnits.find((u) => u.name === 'Aldo');
    expectUnpromoted(unit, ctx.run, ctx.swords);
    expect(unit.consumables.some((i) => i.effect === 'promote')).toBe(true);
    // The rewound checkpoint, as a refresh would load it, agrees.
    const rewound = RunManager.fromJSON(stored(ctx.storage), data);
    expect(convoySwords(rewound)).toBe(ctx.swords);

    expectPromoted(await promoteInBattle(ctx), ctx.run, ctx.swords);
    const reloaded = RunManager.fromJSON(stored(ctx.storage), data);
    expect(convoySwords(reloaded)).toBe(ctx.swords + 1);
    const saved = reloaded.battleInProgress.checkpoint.playerUnits.find((u) => u.name === 'Aldo');
    expect(saved.skills).toEqual([...FIVE, OATH]);
  });

  it('Continue from Map hands back the Cavalier and the convoy as they entered the battle', async () => {
    const ctx = battle();
    await promoteInBattle(ctx);
    const loaded = RunManager.fromJSON(stored(ctx.storage), data);
    expect(loaded.revertBattleInProgressToEntry()).toBe(true);
    expectUnpromoted(
      loaded.roster.find((u) => u.name === 'Aldo'),
      loaded,
      ctx.swords,
    );
  });
});

// The scene class is imported for its side effects on the harness only.
void BattleScene;
