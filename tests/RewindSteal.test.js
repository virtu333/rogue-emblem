// The transfer of a stolen item across a checkpoint, a resume and a Vision rewind, on the
// production path (the journey harness, as tests/RewindSmiteTransfuse.test.js). Spec 3G:
// "Rewind and resume restore both sides from one snapshot, so the item can never exist
// twice or vanish." Each test reads the item's uid across every place it can be: the
// carrier, every unit's bag, the convoy.
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
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

import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';
import { AbilityController } from '../src/ui/AbilityController.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { TurnManager } from '../src/engine/TurnManager.js';
import { RunManager } from '../src/engine/RunManager.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';

let storage;
beforeEach(() => {
  pickers.length = 0;
  storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  installSeed(42);
});
afterEach(() => {
  restoreMathRandom();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const UID = 'itm_vuln';

/** A Thief (0,1) beside a Brigand (1,1) that carries a Vulnerary with its own uid. */
function fixture({ bagFull = false } = {}) {
  const driver = new RunDriver(storage, { seed: 42 });
  const run = driver.run;
  run.visionChargesRemaining = 3;
  run.beginBattleInProgress(run.nodeMap.nodes[0].id, { battleParams: {} });
  const scene = journeyBattleScene(run, driver.data);
  const template = run.roster[1];
  const herb = () => ({ ...structuredClone(driver.data.consumables.find((c) => c.name === 'Herb')) }); // prettier-ignore
  const make = (name, col, row, extra = {}) => {
    const unit = { ...structuredClone(template), name, col, row, hasActed: false, ...extra };
    delete unit.battleEntityId;
    return unit;
  };
  const vulnerary = {
    ...structuredClone(driver.data.consumables.find((c) => c.name === 'Vulnerary')),
    uid: UID,
    uses: 2,
    _casts: 4,
  };
  const thief = make('Thief', 0, 1, {
    faction: 'player',
    isCommander: true,
    skills: ['steal'],
    consumables: bagFull ? [herb(), herb(), herb()].map((h, i) => ({ ...h, uid: `itm_herb${i}` })) : [], // prettier-ignore
    stats: { ...template.stats, SPD: 30 },
  });
  const brigand = make('Brigand', 1, 1, {
    faction: 'enemy',
    carriedItem: vulnerary,
    stats: { ...template.stats, SPD: 1 },
  });
  const bystander = make('Bystander', 3, 3, { faction: 'enemy' });
  scene.playerUnits = [thief];
  scene.enemyUnits = [brigand, bystander];
  for (const unit of [...scene.playerUnits, ...scene.enemyUnits]) scene.addUnitGraphic(unit);
  scene._battleCommanderId = thief.battleEntityId;
  Object.assign(scene.grid, { fogEnabled: false, getMoveCost: () => 1 });
  scene._abilityController = new AbilityController(scene);
  scene._visionController = new VisionRewindController(scene, run);
  vi.spyOn(scene._visionController, 'playRewindEffect').mockImplementation(() => {});
  scene.captureVisionSnapshot();
  scene._timelineBoundary = 'turn_start';
  expect(scene._captureSuspendCheckpoint({ session: scene._battleSession })).toBe(true);
  return { driver, scene, run, thief, brigand, bystander };
}

/** Every place an item can be, by uid: the one list the invariant reads. */
function placesOf(uid, scene, run) {
  const found = [];
  const units = [...scene.playerUnits, ...scene.enemyUnits, ...(scene.npcUnits || [])];
  for (const u of units) {
    if (u.carriedItem?.uid === uid) found.push(`${u.name}.carried`);
    for (const it of u.consumables || []) if (it?.uid === uid) found.push(`${u.name}.bag`);
    for (const it of u.inventory || []) if (it?.uid === uid) found.push(`${u.name}.bag`);
  }
  for (const it of run.convoy.consumables) if (it?.uid === uid) found.push('convoy');
  for (const it of run.convoy.weapons) if (it?.uid === uid) found.push('convoy');
  return found;
}

const steal = async (scene, thief, onto) => {
  const skill = scene.gameData.skills.find((entry) => entry.id === 'steal');
  const targeting = scene._abilityController._targeting();
  const target = targeting.find(thief, skill).find((entry) => entry.unit === onto);
  expect(target, 'the thief can steal from it').toBeTruthy();
  expect(await targeting.execute(thief, skill, target)).toBe(true);
  scene.battleState = 'PLAYER_IDLE';
};

/** The run as it was saved at the checkpoint (before the action is drawn). */
function saveAtCheckpoint(f) {
  let saved = null;
  f.scene.grid.clearAttackHighlights = () => {
    saved ||= JSON.parse(storage.getItem('emblem_rogue_slot_1_run'));
  };
  return () => saved;
}

function resume(driver, saved) {
  const checkpoint = saved.battleInProgress.checkpoint;
  const restoredRun = RunManager.fromJSON(saved, driver.data);
  const restored = journeyBattleScene(restoredRun, driver.data);
  restored._battleSession = 1;
  restored.scene = { isActive: () => true };
  restored._addConditionIcon = () => {};
  Object.assign(restored.grid, {
    cols: 8,
    rows: 8,
    mapLayout: Array.from({ length: 8 }, () => Array(8).fill(0)),
    fogEnabled: false,
    getMoveCost: () => 1,
    getTerrainAt: () => driver.data.terrain[0],
  });
  const suspend = new BattleSuspendController(restored);
  suspend.applyUnits(checkpoint);
  restored.turnManager = new TurnManager({ onPhaseChange: () => {}, checkBattleEnd: () => false });
  restored.turnManager.init(restored.playerUnits, restored.enemyUnits, restored.npcUnits);
  suspend.finalizeResume(checkpoint);
  return { restored, restoredRun };
}

const rewindToBefore = (scene, title) => {
  pickers.length = 0;
  scene._visionController.openRewind();
  const { rows } = pickers.at(-1).options.listing;
  expect(rows[0].title).toBe(title);
  pickers.at(-1).options.onConfirm(rows[0].id);
  scene.battleState = 'PLAYER_IDLE';
};

describe('a stolen item can never exist twice or vanish', () => {
  it('into the bag: steal, resume and rewind each leave the uid in exactly one place', async () => {
    const f = fixture();
    const { scene, run, thief, brigand } = f;
    const saved = saveAtCheckpoint(f);
    expect(placesOf(UID, scene, run)).toEqual(['Brigand.carried']);

    await steal(scene, thief, brigand);
    expect(placesOf(UID, scene, run)).toEqual(['Thief.bag']);
    expect(thief.consumables[0]).toMatchObject({ uid: UID, uses: 2, _casts: 4, name: 'Vulnerary' });
    expect(brigand.carriedItem).toBeUndefined();

    // Resume from the checkpoint the action saved: both sides come back together.
    const { restored, restoredRun } = resume(f.driver, saved());
    expect(placesOf(UID, restored, restoredRun)).toEqual(['Thief.bag']);
    const resumedThief = restored.playerUnits.find((u) => u.name === 'Thief');
    expect(resumedThief.consumables[0]).toMatchObject({ uid: UID, uses: 2, _casts: 4 });
    expect(restored.enemyUnits.find((u) => u.name === 'Brigand').carriedItem).toBeUndefined();

    // Rewind to before the steal: the carrier holds it again, the bag is empty.
    rewindToBefore(scene, 'Before Thief’s steal on Brigand');
    expect(placesOf(UID, scene, run)).toEqual(['Brigand.carried']);
    const back = scene.enemyUnits.find((u) => u.name === 'Brigand');
    expect(back.carriedItem).toMatchObject({ uid: UID, uses: 2, _casts: 4, name: 'Vulnerary' });
    expect(scene.playerUnits.find((u) => u.name === 'Thief').consumables).toEqual([]);

    // The rewind's own checkpoint resumes to the same: still one place.
    const again = resume(f.driver, JSON.parse(storage.getItem('emblem_rogue_slot_1_run')));
    expect(placesOf(UID, again.restored, again.restoredRun)).toEqual(['Brigand.carried']);

    // And the steal can be made again: nothing was lost on the way.
    await steal(
      scene,
      scene.playerUnits.find((u) => u.name === 'Thief'),
      back,
    );
    expect(placesOf(UID, scene, run)).toEqual(['Thief.bag']);
  });

  it('into the convoy: the same, with the convoy as the other side of the snapshot', async () => {
    const f = fixture({ bagFull: true });
    const { scene, run, thief, brigand } = f;
    const saved = saveAtCheckpoint(f);
    expect(run.convoy.consumables.filter((i) => i.uid === UID)).toEqual([]);

    await steal(scene, thief, brigand);
    expect(placesOf(UID, scene, run)).toEqual(['convoy']);
    expect(thief.consumables.map((i) => i.uid)).toEqual(['itm_herb0', 'itm_herb1', 'itm_herb2']);
    expect(run.convoy.consumables.find((i) => i.uid === UID)).toMatchObject({ uses: 2, _casts: 4 });

    // The run saved at the checkpoint holds the convoy copy, and the carrier is empty.
    const persisted = saved();
    expect(persisted.convoy.consumables.filter((i) => i.uid === UID)).toHaveLength(1);
    const { restored, restoredRun } = resume(f.driver, persisted);
    expect(placesOf(UID, restored, restoredRun)).toEqual(['convoy']);

    // Rewind: the convoy gives it up and the carrier has it back, in one step.
    rewindToBefore(scene, 'Before Thief’s steal on Brigand');
    expect(placesOf(UID, scene, run)).toEqual(['Brigand.carried']);
    expect(run.convoy.consumables.filter((i) => i.uid === UID)).toEqual([]);

    const saved2 = JSON.parse(storage.getItem('emblem_rogue_slot_1_run'));
    expect(saved2.convoy.consumables.filter((i) => i.uid === UID)).toEqual([]);
    const again = resume(f.driver, saved2);
    expect(placesOf(UID, again.restored, again.restoredRun)).toEqual(['Brigand.carried']);
  });

  it('a refused steal leaves the checkpoint and every place exactly as they were', async () => {
    const f = fixture({ bagFull: true });
    const { scene, run, thief, brigand } = f;
    while (run.addToConvoy({ ...run.gameData.consumables.find((c) => c.name === 'Herb') }));
    scene.showActionMenu = vi.fn(); // the refusal reshows the menu; the stub scene has no map
    const skill = scene.gameData.skills.find((entry) => entry.id === 'steal');
    const before = structuredClone({ convoy: run.convoy, thief, brigand });
    expect(scene._abilityController._targeting().find(thief, skill)).toEqual([]);
    expect(
      await scene._abilityController._targeting().execute(thief, skill, { unit: brigand }),
    ).toBe(false);
    expect(structuredClone({ convoy: run.convoy, thief, brigand })).toEqual(before);
    expect(placesOf(UID, scene, run)).toEqual(['Brigand.carried']);
  });

  it('the rewind row names the steal, and the timeline never lists it as two things', async () => {
    const f = fixture();
    await steal(f.scene, f.thief, f.brigand);
    f.scene._visionController.openRewind();
    const rows = pickers.at(-1).options.listing.rows.map((r) => r.title);
    expect(rows[0]).toBe('Before Thief’s steal on Brigand');
    expect(new Set(rows).size).toBe(rows.length);
  });
});
