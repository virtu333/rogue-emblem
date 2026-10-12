// The ability-slot split (#344) reaches every saved copy of a suspended battle's army, so the
// three ways back into an interrupted battle hand back one loadout: Resume Battle (the
// checkpoint's own unit groups), a Vision rewind (the timeline's destinations) and Continue
// from Map (the roster). engine/SavedBattleSlots.js, run by RunManager.fromJSON.
//
// The fixture is a real save written by the build before #344 (main at a6e26248^): a
// RunDriver run (seed 42) with four Thieves each equipping five abilities (Shove, Pull, Blink,
// Smite, Steal: the old five-slot cap, Steal, the Thief's innate, last), a journey battle scene
// with Edric, Wren and Ash deployed, Rook benched and Kit escaped, a turn-start checkpoint,
// then Wren's and Ash's steals through the production AbilityController, saved by the scene's
// own suspend checkpoint. Its timeline holds a full keyframe and two patched destinations.
//
// Expected loadouts are derived from the rule, not the code: three ability slots, locked
// skills first (Steal is the Thief's), the rest in list order; so Steal, Shove and Pull stay
// in list order and Blink and Smite go to the bench, marked unseen.
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
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

import { JourneyStorage } from './harness/RunDriver.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';
import { AbilityController } from '../src/ui/AbilityController.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { TurnManager } from '../src/engine/TurnManager.js';
import { RunManager } from '../src/engine/RunManager.js';
import { getEntryState, hydrateBattleTimeline } from '../src/engine/BattleTimeline.js';
import { loadGameData } from './testData.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';

const FIXTURE = new URL('./fixtures/saves/pre344-five-abilities-midbattle.json', import.meta.url);
const rawSave = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));
const data = loadGameData();

const OLD = ['shove', 'pull', 'blink', 'smite', 'steal'];
const SETTLED = {
  skills: ['shove', 'pull', 'steal'],
  benchedSkills: ['blink', 'smite'],
  benchedUnseen: ['blink', 'smite'],
};
const THIEVES = ['Wren', 'Ash', 'Rook', 'Kit'];
const loadout = (unit) => ({
  skills: unit.skills,
  benchedSkills: unit.benchedSkills,
  benchedUnseen: unit.benchedUnseen,
});

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

/** Resume Battle as the slot screen does it: the loaded run's checkpoint into a fresh scene. */
function resume(saved) {
  const run = RunManager.fromJSON(saved, data);
  const checkpoint = run.battleInProgress.checkpoint;
  const scene = journeyBattleScene(run, data);
  scene._battleSession = 1;
  scene.scene = { isActive: () => true };
  scene._addConditionIcon = () => {};
  Object.assign(scene.grid, {
    cols: 8,
    rows: 8,
    mapLayout: Array.from({ length: 8 }, () => Array(8).fill(0)),
    fogEnabled: false,
    getMoveCost: () => 1,
    getTerrainAt: () => data.terrain[0],
  });
  const suspend = new BattleSuspendController(scene);
  suspend.applyUnits(checkpoint);
  scene.turnManager = new TurnManager({ onPhaseChange: () => {}, checkBattleEnd: () => false });
  scene.turnManager.init(scene.playerUnits, scene.enemyUnits, scene.npcUnits);
  suspend.finalizeResume(checkpoint);
  scene._abilityController = new AbilityController(scene);
  scene._visionController = new VisionRewindController(scene, run);
  vi.spyOn(scene._visionController, 'playRewindEffect').mockImplementation(() => {});
  return { run, scene };
}

/** Every army unit the scene holds, by name: deployed, escaped and benched. */
function armyOf(scene) {
  return Object.fromEntries(
    [...scene.playerUnits, ...scene.escapedUnits, ...scene.nonDeployedUnits].map((u) => [
      u.name,
      u,
    ]),
  );
}

/**
 * A JSON copy with every unit's loadout lists removed (what the migration may touch), and the
 * commander flag the load has always re-stamped from `commanderEntityId`.
 */
function withoutLoadout(value) {
  return JSON.parse(JSON.stringify(value), (key, v) =>
    v && typeof v === 'object' && !Array.isArray(v) && 'battleEntityId' in v
      ? Object.fromEntries(
          Object.entries(v).filter(
            ([k]) => !['skills', 'benchedSkills', 'benchedUnseen', 'isCommander'].includes(k),
          ),
        )
      : v,
  );
}

const timelineStates = (timeline) =>
  timeline.entries.filter((e) => e.snapshotId).map((e) => getEntryState(timeline, e.id));

describe('a save from before the ability slots, suspended mid-battle', () => {
  it('Resume Battle restores three abilities on every army copy, Steal kept, the rest unchanged', () => {
    const raw = rawSave();
    const { run, scene } = resume(rawSave());
    const army = armyOf(scene);
    for (const name of THIEVES) expect(loadout(army[name]), name).toEqual(SETTLED);
    // Placement: deployed, escaped and benched copies all came back settled.
    expect(scene.escapedUnits.map((u) => u.name)).toEqual(['Kit']);
    expect(scene.nonDeployedUnits.map((u) => u.name)).toEqual(['Rook']);
    // A unit with nothing over the cap, and the foes, are left alone.
    expect(army.Edric.skills).toEqual(['charisma']);
    expect(army.Edric.benchedSkills).toBeUndefined();
    const foes = raw.battleInProgress.checkpoint.enemyUnits;
    expect(scene.enemyUnits.map((u) => u.skills)).toEqual(foes.map((u) => u.skills));

    // The Vision anchor carries the same settled copies.
    const checkpoint = run.battleInProgress.checkpoint;
    for (const unit of checkpoint.visionSnapshot.playerUnits.filter((u) => u.name !== 'Edric'))
      expect(loadout(unit)).toEqual(SETTLED);

    // Nothing but the loadout moved: RNG state, the run domain, entry state, every other field.
    const before = raw.battleInProgress;
    expect(checkpoint.rngState).toEqual(before.checkpoint.rngState);
    expect(checkpoint.decisionRngState).toEqual(before.checkpoint.decisionRngState);
    expect(run.battleInProgress.entryBattleState).toEqual(before.entryBattleState);
    expect(withoutLoadout(checkpoint)).toEqual(withoutLoadout(before.checkpoint));
    expect(scene._battleRng.getState()).toEqual(before.checkpoint.rngState);
  });

  it('Continue from Map hands back the same loadout Resume Battle does', () => {
    const resumed = armyOf(resume(rawSave()).scene);
    const run = RunManager.fromJSON(rawSave(), data);
    expect(run.revertBattleInProgressToEntry()).toBe(true);
    for (const name of THIEVES) {
      const rosterUnit = run.roster.find((u) => u.name === name);
      expect(loadout(rosterUnit), name).toEqual(SETTLED);
      expect(loadout(resumed[name]), name).toEqual(loadout(rosterUnit));
    }
  });

  describe('a Vision rewind after Resume Battle', () => {
    const rewind = (scene, title) => {
      pickers.length = 0;
      scene._visionController.openRewind();
      const { rows } = pickers.at(-1).options.listing;
      const row = rows.find((r) => r.title === title);
      expect(row, `${title} in ${rows.map((r) => r.title)}`).toBeTruthy();
      pickers.at(-1).options.onConfirm(row.id);
      scene.battleState = 'PLAYER_IDLE';
    };

    it.each([
      ['a patched destination', 'Before Ash’s steal on Brigand B', ['Wren'], ['Ash']],
      ['the turn-start keyframe', 'Before Wren’s steal on Brigand A', [], ['Wren', 'Ash']],
    ])(
      'to %s brings back the settled loadout, and so does resuming its save',
      (_, title, robbed, unrobbed) => {
        const { run, scene } = resume(rawSave());
        const charges = run.visionChargesRemaining;
        rewind(scene, title);
        // The rewind happened: a charge spent, the restored point's steals undone.
        expect(run.visionChargesRemaining).toBe(charges - 1);
        const army = armyOf(scene);
        for (const name of robbed) expect(army[name].consumables.some((i) => /vuln/.test(i.uid))).toBe(true); // prettier-ignore
        for (const name of unrobbed) expect(army[name].consumables.some((i) => /vuln/.test(i.uid))).toBe(false); // prettier-ignore
        for (const name of THIEVES) expect(loadout(army[name]), name).toEqual(SETTLED);
        expect(army.Edric.skills).toEqual(['charisma']);

        // The rewind's own checkpoint, resumed: still three.
        const again = armyOf(resume(JSON.parse(storage.getItem('emblem_rogue_slot_1_run'))).scene);
        for (const name of THIEVES) expect(loadout(again[name]), name).toEqual(SETTLED);
      },
    );
  });

  it('every destination the timeline stores is settled, patches still patches, streams unmoved', () => {
    const raw = rawSave();
    const run = RunManager.fromJSON(rawSave(), data);
    const timeline = run.battleInProgress.timeline;
    const forms = Object.values(timeline.snapshots).map((s) => (s.base ? 'patch' : 'full'));
    expect(forms).toEqual(['full', 'patch', 'patch']);
    const rawStates = timelineStates(hydrateBattleTimeline(raw.battleInProgress.timeline));
    // The save as written: every Thief on every destination holds the five, unbenched.
    for (const unit of rawStates.flatMap((s) => s.playerUnits).filter((u) => u.name !== 'Edric')) {
      expect(unit.skills).toEqual(OLD);
      expect(unit.benchedSkills ?? []).toEqual([]);
    }
    const rawForms = Object.values(raw.battleInProgress.timeline.snapshots).map((s) =>
      s.base ? 'patch' : 'full',
    );
    expect(rawForms).toEqual(['full', 'patch', 'patch']);
    const states = timelineStates(timeline);
    expect(states).toHaveLength(3);
    states.forEach((state, i) => {
      for (const unit of state.playerUnits.filter((u) => u.name !== 'Edric'))
        expect(loadout(unit)).toEqual(SETTLED);
      expect(state.rngState).toEqual(rawStates[i].rngState);
      expect(withoutLoadout(state)).toEqual(withoutLoadout(rawStates[i]));
    });
    // Entries, ids, revision and the visual archive are the save's own.
    const { snapshots: _a, ...rest } = timeline;
    const { snapshots: _b, ...rawRest } = hydrateBattleTimeline(raw.battleInProgress.timeline);
    expect(rest).toEqual(rawRest);
  });

  it('is idempotent: a second save and load changes nothing more', () => {
    const first = RunManager.fromJSON(rawSave(), data);
    const once = JSON.parse(JSON.stringify(first.toJSON()));
    const second = RunManager.fromJSON(JSON.parse(JSON.stringify(once)), data);
    const twice = JSON.parse(JSON.stringify(second.toJSON()));
    expect(twice.battleInProgress).toEqual(once.battleInProgress);
    expect(twice.roster).toEqual(once.roster);
    const checkpoint = twice.battleInProgress.checkpoint;
    for (const unit of [
      ...checkpoint.playerUnits,
      ...checkpoint.escapedUnits,
      ...checkpoint.nonDeployedUnits,
    ].filter((u) => THIEVES.includes(u.name)))
      expect(loadout(unit)).toEqual(SETTLED);
    // The settled timeline is not re-encoded on the next load.
    expect(second.battleInProgress.timeline.snapshots).toEqual(
      first.battleInProgress.timeline.snapshots,
    );
  });
});
