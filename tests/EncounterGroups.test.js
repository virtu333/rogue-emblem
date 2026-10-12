// Encounter groups, PR 2.1 (docs/specs/large-maps/02-encounters-and-pacing.md §3, §6;
// engine/EncounterGroups.js, engine/EncounterTriggers.js). Ways it can go wrong, one test each:
//   - the check wakes a different unit, or for a different reason, than today's hold rule did
//     (fuzzed against a frozen copy of HoldActivation.wakeHolders);
//   - a generated map's packs are written as groups an older client would misplay, that fail
//     their own validator, or that disagree with the spawns;
//   - the state is lost, or comes back wrong, through a checkpoint; an old checkpoint with none
//     is refused or derives the wrong turn; a state that disagrees with its units is accepted;
//   - a resumed enemy phase checks again, or the battle and the AI keep two states;
//   - an authored wake turn fires early, late or twice;
//   - a trigger this build cannot evaluate is accepted (a group that could never wake);
//   - an initially awake group's onWake is not written onto its spawns.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import {
  applyInitialOnWake,
  battleEncounterGroups,
  captureEncounterState,
  checkEncounters,
  encounterGroupErrors,
  encounterSourceFor,
  encounterStateFromUnits,
  groupIdOf,
  groupsFromHoldPacks,
  isValidEncounterState,
  writeHoldEncounterGroups,
} from '../src/engine/EncounterGroups.js';
import { wakeTriggerErrors } from '../src/engine/EncounterTriggers.js';
import { applyHoldSpawn } from '../src/engine/HoldActivation.js';
import { AIController } from '../src/engine/AIController.js';
import { createPlayerKnowledge } from '../src/engine/PlayerKnowledge.js';
import { generateSeededBattle } from '../src/engine/BattleScout.js';
import { resolveDifficultyMode } from '../src/engine/DifficultyEngine.js';
import { requiredRunFormat } from '../src/engine/RunFormat.js';
import {
  captureBattleWorldState,
  restoreBattleWorldState,
} from '../src/engine/BattleSnapshotState.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { HeadlessGrid } from './harness/HeadlessGrid.js';
import { legacyWakeHolders } from './helpers/legacyWakeHolders.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const T = Object.fromEntries(data.terrain.map((t, i) => [t.name, i]));
const lance = data.weapons.find((w) => w.name === 'Iron Lance');
const bow = data.weapons.find((w) => w.name === 'Iron Bow');

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function foe(name, col, row, pack, size, extra = {}) {
  return applyHoldSpawn(
    {
      name,
      faction: 'enemy',
      className: 'Soldier',
      col,
      row,
      currentHP: 20,
      stats: { HP: 20, MOV: 4 },
      mov: 4,
      moveType: 'Infantry',
      weapon: structuredClone(extra.bow ? bow : lance),
      inventory: [],
      skills: [],
    },
    { aiMode: 'hold', holdPack: pack, holdPackSize: size, holdWakeTurn: extra.wakeTurn },
  );
}

function threatContext(grid, playerUnits, enemyUnits) {
  const knowledge = createPlayerKnowledge({ grid, units: [...playerUnits, ...enemyUnits] });
  return { grid, enemyUnits, ballistas: [], positions: () => knowledge.positions() };
}

/** A random board: packs (some with a wake turn), loose foes, disturbances, losses, players. */
function randomBoard(seed) {
  const r = rng(seed);
  const pick = (n) => Math.floor(r() * n);
  const width = 16;
  const height = 9;
  const layout = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => (r() < 0.12 ? T.Forest : T.Plain)),
  );
  const fog = r() < 0.4;
  const grid = new HeadlessGrid(width, height, data.terrain, layout, fog);
  const taken = new Set();
  const free = () => {
    for (;;) {
      const col = pick(width);
      const row = pick(height);
      if (!taken.has(`${col},${row}`)) {
        taken.add(`${col},${row}`);
        return { col, row };
      }
    }
  };
  const enemies = [];
  const packs = 1 + pick(3);
  for (let p = 0; p < packs; p++) {
    const size = 1 + pick(3);
    const wakeTurn = r() < 0.3 ? 2 + pick(4) : undefined;
    for (let i = 0; i < size; i++) {
      const at = free();
      enemies.push(foe(`P${p}-${i}`, at.col, at.row, p, size, { wakeTurn, bow: r() < 0.3 }));
    }
  }
  for (let i = 0; i < pick(3); i++) {
    const at = free();
    const loose = foe(`L${i}`, at.col, at.row, 0, 1);
    for (const k of ['aiMode', 'holdPack', 'holdPackSize', 'holdPost', 'holdWakeTurn'])
      delete loose[k];
    enemies.push(loose);
  }
  // Shuffle the battle's order so packs interleave.
  for (let i = enemies.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [enemies[i], enemies[j]] = [enemies[j], enemies[i]];
  }
  for (const e of enemies) {
    if (e.aiMode !== 'hold') continue;
    const roll = r();
    if (roll < 0.08) e.holdDisturbed = ['hurt', 'status', 'moved'][pick(3)];
    else if (roll < 0.12)
      e.col = Math.min(width - 1, e.col + 1); // shoved off its post, unmarked
    else if (roll < 0.17) e.currentHP = 0; // falling
  }
  // A turn already checked (a resumed phase).
  const turn = r() < 0.15 ? null : 1 + pick(6);
  let packOnly = false;
  if (turn !== null && r() < 0.2) {
    // A check marks every holder it leaves holding, so a resumed turn is marked on all of them;
    // now and then only part of one pack carries it (holders put on the board after the check).
    packOnly = r() < 0.4;
    const pack = enemies.find((e) => e.aiMode === 'hold')?.holdPack;
    for (const e of enemies)
      if (e.aiMode === 'hold' && (!packOnly || e.holdPack === pack) && (!packOnly || r() < 0.7))
        e.holdCheckedTurn = turn;
  }
  // Some fell and were removed from the board.
  const board = enemies.filter(() => r() >= 0.06);
  const players = [];
  for (let i = 0; i < 1 + pick(3); i++) {
    const at = free();
    players.push({
      name: `H${i}`,
      faction: 'player',
      col: at.col,
      row: at.row,
      currentHP: 20,
      stats: { HP: 20 },
      moveType: r() < 0.3 ? 'Flying' : 'Infantry',
    });
  }
  if (fog) grid.updateFogOfWar(players);
  return { grid, enemies: board, players, enraged: r() < 0.06, turn, partial: packOnly };
}

const observed = (enemies) =>
  enemies.map((e) => [e.name, e.aiMode ?? null, e.holdDisturbed ?? null, e.holdWoke ?? null, e.holdCheckedTurn ?? null]); // prettier-ignore

describe('the check wakes exactly as the hold rule it replaces', () => {
  it('600 random boards: same units, same reasons, same marks left on every unit', () => {
    const reasons = new Set();
    let woke = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const board = randomBoard(seed);
      const before = structuredClone(board.enemies);
      const legacy = structuredClone(before);
      const fresh = structuredClone(before);
      const args = (enemyUnits) => ({
        enemyUnits,
        playerUnits: board.players,
        threatContext: threatContext(board.grid, board.players, enemyUnits),
        bossEnraged: board.enraged,
        turn: board.turn,
      });
      const old = legacyWakeHolders(args(legacy)).map((w) => [w.unit.name, w.reason]);
      const groups = battleEncounterGroups(null, fresh);
      const now = checkEncounters({ groups, ...args(fresh) });
      expect(
        now.woken.map((w) => [w.unit.name, w.reason]),
        `seed ${seed}`,
      ).toEqual(old);
      expect(observed(fresh), `seed ${seed}`).toEqual(observed(legacy));
      // The record agrees with the units it was taken with (a pack the check saw only part of
      // wakes only that part, under either rule, and is left split).
      if (!board.partial)
        expect(isValidEncounterState(now.state, fresh), `seed ${seed}`).toBe(true);
      for (const w of now.woken) reasons.add(w.reason);
      woke += now.woken.length;
    }
    // The boards reached every way a pack wakes.
    expect([...reasons].sort()).toEqual(['enrage', 'fallen', 'hurt', 'moved', 'status', 'threat', 'turn']); // prettier-ignore
    expect(woke).toBeGreaterThan(200);
  });

  it('the woken record names the group and the trigger; the rest are marked checked', () => {
    const layout = Array.from({ length: 7 }, () => Array(14).fill(T.Plain));
    const grid = new HeadlessGrid(14, 7, data.terrain, layout, false);
    const enemies = [foe('A', 11, 3, 0, 2), foe('B', 13, 3, 0, 2), foe('C', 13, 6, 1, 1)];
    enemies[1].holdDisturbed = 'status';
    const hero = { name: 'Hero', faction: 'player', col: 0, row: 0, currentHP: 20, stats: { HP: 20 } }; // prettier-ignore
    const groups = battleEncounterGroups(null, enemies);
    const { state, woken } = checkEncounters({
      groups,
      enemyUnits: enemies,
      playerUnits: [hero],
      threatContext: threatContext(grid, [hero], enemies),
      turn: 3,
    });
    expect(woken.map((w) => [w.unit.name, w.reason, w.groupId])).toEqual([
      ['A', 'status', 'hold:0'],
      ['B', 'status', 'hold:0'],
    ]);
    expect(state.groups['hold:0']).toEqual({
      state: 'awake',
      wokeTurn: 3,
      reason: 'hurt',
      size: 2,
    });
    expect(state.groups['hold:1']).toEqual({ state: 'dormant', wokeTurn: null, reason: null, size: 1 }); // prettier-ignore
    expect(state.checkedTurn).toBe(3);
    expect(enemies[2].holdCheckedTurn).toBe(3);
    // The same turn again changes nothing, even with the hero now standing at C's side.
    hero.col = 12;
    hero.row = 6;
    expect(checkEncounters({ groups, state, enemyUnits: enemies, playerUnits: [hero], threatContext: threatContext(grid, [hero], enemies), turn: 3 }).woken).toEqual([]); // prettier-ignore
    expect(checkEncounters({ groups, state, enemyUnits: enemies, playerUnits: [hero], threatContext: threatContext(grid, [hero], enemies), turn: 4 }).woken.map((w) => w.unit.name)).toEqual(['C']); // prettier-ignore
  });
});

describe('an authored wake turn', () => {
  const pack = () => [foe('A', 11, 3, 0, 2, { wakeTurn: 4 }), foe('B', 13, 3, 0, 2, { wakeTurn: 4 })]; // prettier-ignore
  const run = (enemies, state, turn) =>
    checkEncounters({ groups: battleEncounterGroups(null, enemies), state, enemyUnits: enemies, turn }); // prettier-ignore

  it('becomes an absolute turn trigger that fires at its turn, or the first check after it', () => {
    expect(groupsFromHoldPacks(pack())[0].wake).toEqual([
      { kind: 'danger' },
      { kind: 'hurt' },
      { kind: 'turn', turn: 4, delay: 0 },
    ]);
    for (const turn of [1, 2, 3]) expect(run(pack(), null, turn).woken).toEqual([]);
    expect(run(pack(), null, 4).woken.map((w) => w.reason)).toEqual(['turn', 'turn']);
    // A resume that skipped turn 4's check still wakes at 6 (`>=`, never `===`).
    expect(run(pack(), null, 6).woken).toHaveLength(2);
    // And it fires once: the group is awake after.
    const enemies = pack();
    const first = run(enemies, null, 4);
    expect(run(enemies, first.state, 5).woken).toEqual([]);
  });
});

describe('generated maps write their packs as groups', () => {
  const RUNGS = ['dusk', 'hard', 'lunatic'];
  const maps = [];
  for (const objective of ['seize', 'escape']) {
    for (let seed = 0; seed < 90; seed++) {
      const difficultyId = RUNGS[seed % 3];
      const m = resolveDifficultyMode(data.difficulty, difficultyId).modifiers;
      const act = ['act1', 'act2', 'act3', 'act4'][Math.floor(seed / 3) % 4];
      const params = { act, objective, deployCount: 5, difficultyId, holdShare: m.holdShare, objectiveParOffset: m.objectiveParOffset }; // prettier-ignore
      maps.push({ label: `${objective} ${difficultyId} ${act} ${seed}`, config: generateSeededBattle(params, data, 300 + seed) }); // prettier-ignore
    }
  }

  it('every pack is a sound hold group its spawns carry, and nothing else is grouped', () => {
    let grouped = 0;
    for (const { label, config } of maps) {
      const holders = config.enemySpawns.filter((s) => s.aiMode === 'hold');
      if (!holders.length) {
        expect(config.encounterGroups, label).toBeUndefined();
        expect(
          config.enemySpawns.some((s) => 'encounterGroupId' in s),
          label,
        ).toBe(false);
        continue;
      }
      grouped++;
      expect(config.encounterVersion, label).toBe(1);
      expect(encounterGroupErrors(config), label).toEqual([]);
      const packs = new Set(holders.map((s) => s.holdPack));
      expect(config.encounterGroups.map((g) => g.id).sort(), label).toEqual([...packs].map((p) => `hold:${p}`).sort()); // prettier-ignore
      for (const [index, spawn] of config.enemySpawns.entries()) {
        const group = config.encounterGroups.find((g) => g.members.includes(index));
        expect(group?.id ?? null, `${label} spawn ${index}`).toBe(spawn.aiMode === 'hold' ? `hold:${spawn.holdPack}` : null); // prettier-ignore
      }
    }
    expect(grouped).toBeGreaterThan(100);
  });

  it('an older client plays them as today: a run holding them needs no capability', () => {
    const configs = Object.fromEntries(maps.map((m, i) => [`n${i}`, m.config]));
    expect(requiredRunFormat({ battleConfigsByNodeId: configs })).toEqual({ format: 1, capabilities: [] }); // prettier-ignore
  });

  it('the validator refuses what this build cannot play', () => {
    const base = structuredClone(maps.find((m) => m.config.encounterGroups).config);
    const broken = (edit) => {
      const config = structuredClone(base);
      edit(config);
      return encounterGroupErrors(config);
    };
    expect(broken(() => {})).toEqual([]);
    expect(broken((c) => (c.encounterGroups[0].wake = [{ kind: 'sight' }]))).not.toEqual([]);
    expect(broken((c) => (c.encounterGroups[0].wake = []))).not.toEqual([]);
    expect(broken((c) => (c.encounterGroups[0].wake = [{ kind: 'turn', turn: 3 }]))).not.toEqual(
      [],
    ); // default delay 1
    expect(broken((c) => (c.encounterGroups[0].onWake = { mode: 'guard' }))).not.toEqual([]);
    expect(broken((c) => (c.encounterGroups[0].state = 'patrol'))).not.toEqual([]);
    expect(broken((c) => c.encounterGroups[0].members.push(9999))).not.toEqual([]);
    // A member that names another group (the pack index alone still places one without an id).
    expect(
      broken((c) => (c.enemySpawns[c.encounterGroups[0].members[0]].encounterGroupId = 'hold:77')),
    ).not.toEqual([]);
    expect(broken((c) => delete c.enemySpawns[c.encounterGroups[0].members[0]].aiMode)).not.toEqual([]); // prettier-ignore
    expect(broken((c) => (c.enemySpawns[0].encounterGroupId = 'pod:9'))).not.toEqual([]);
    expect(broken((c) => (c.encounterVersion = 2))).not.toEqual([]);
  });
});

describe('triggers this build evaluates', () => {
  it('danger, hurt and the absolute turn at delay 0; anything else is refused', () => {
    expect(wakeTriggerErrors({ kind: 'danger' })).toEqual([]);
    expect(wakeTriggerErrors({ kind: 'hurt', delay: 0 })).toEqual([]);
    expect(wakeTriggerErrors({ kind: 'turn', turn: 4, delay: 0 })).toEqual([]);
    for (const bad of [
      { kind: 'groupWoken', group: 'pod:0' },
      { kind: 'danger', delay: 1 },
      { kind: 'turn', turn: 4 },
      { kind: 'turn', parOffset: -2, delay: 0 },
      { kind: 'turn', turn: 0, delay: 0 },
      { kind: 'hurt', by: 'x' },
      null,
    ])
      expect(wakeTriggerErrors(bad), JSON.stringify(bad)).not.toEqual([]);
  });
});

describe('the state rides the checkpoint', () => {
  function battle() {
    const layout = Array.from({ length: 7 }, () => Array(14).fill(T.Plain));
    const grid = new HeadlessGrid(14, 7, data.terrain, layout, false);
    const enemies = [foe('A', 11, 3, 0, 2), foe('B', 13, 3, 0, 2), foe('C', 13, 6, 1, 1)];
    const config = { encounterVersion: 1, encounterGroups: writeHoldEncounterGroups(enemies) };
    const hero = { name: 'Hero', faction: 'player', col: 0, row: 0, currentHP: 20, stats: { HP: 20 } }; // prettier-ignore
    const scene = { grid, battleConfig: config, enemyUnits: enemies, playerUnits: [hero], npcUnits: [], encounterState: null }; // prettier-ignore
    return { scene, hero };
  }

  it('captured as a copy, restored as its own object; a snapshot without one re-reads the units', () => {
    const { scene } = battle();
    scene.enemyUnits[0].holdDisturbed = 'hurt';
    const source = encounterSourceFor(scene);
    const { groups, state } = source();
    checkEncounters({ groups, state, enemyUnits: scene.enemyUnits, turn: 2 });
    const snap = JSON.parse(JSON.stringify(captureBattleWorldState(scene)));
    expect(snap.encounterState.groups['hold:0'].state).toBe('awake');
    expect(snap.encounterState.checkedTurn).toBe(2);
    scene.encounterState.checkedTurn = 9; // the live object moves on; the snapshot did not
    expect(snap.encounterState.checkedTurn).toBe(2);
    restoreBattleWorldState(scene, snap);
    expect(scene.encounterState).toEqual(snap.encounterState);
    expect(scene.encounterState).not.toBe(snap.encounterState);
    // An older snapshot holds none: the battle reads it from the units again.
    restoreBattleWorldState(scene, { ...snap, encounterState: undefined });
    expect(scene.encounterState).toBeNull();
    expect(source().state).toEqual({
      version: 1,
      checkedTurn: 2,
      groups: {
        'hold:0': { state: 'awake', wokeTurn: null, reason: 'hurt', size: 2 },
        'hold:1': { state: 'dormant', wokeTurn: null, reason: null, size: 1 },
      },
      fired: {},
    });
  });

  it('the validator holds the record to its units and its own shape', () => {
    const { scene } = battle();
    const state = captureEncounterState(scene);
    const units = scene.enemyUnits.map((u) => serializeBattleUnit(u));
    expect(isValidEncounterState(state, units)).toBe(true);
    const bad = (edit, list = units) => {
      const copy = structuredClone(state);
      edit(copy);
      return isValidEncounterState(copy, list);
    };
    expect(bad((s) => (s.groups['hold:0'].state = 'awake'))).toBe(false); // members still hold
    expect(bad((s) => (s.groups['hold:0'].state = 'asleep'))).toBe(false);
    expect(bad((s) => (s.version = 2))).toBe(false);
    expect(bad((s) => (s.checkedTurn = 0))).toBe(false);
    expect(bad((s) => (s.fired['hold:0/hurt'] = { firedTurn: 4, dueTurn: 3 }))).toBe(false);
    expect(bad((s) => (s.fired = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`hold:${i}/x`, { firedTurn: 1, dueTurn: 1 }]))))).toBe(false); // prettier-ignore
    expect(bad((s) => (s.fired['hold:0/hurt'] = { firedTurn: 3, dueTurn: 4 }))).toBe(true);
    // A woken member under a dormant record is refused; a fallen one does not count.
    const woken = structuredClone(units);
    delete woken[0].aiMode;
    expect(isValidEncounterState(state, woken)).toBe(false);
    woken[0].currentHP = 0;
    expect(isValidEncounterState(state, woken)).toBe(true);
  });

  it("a resumed phase with the saved state does not check again; the AI keeps the battle's state", async () => {
    const { scene, hero } = battle();
    const ai = new AIController(scene.grid, data, { objective: 'seize' });
    ai._delay = () => Promise.resolve();
    ai.setHoldContext(() => threatContext(scene.grid, scene.playerUnits, scene.enemyUnits));
    ai.setEncounterSource(encounterSourceFor(scene));
    const callbacks = (turnNumber) => ({
      turnNumber,
      onMoveUnit: async () => {},
      onAttack: async () => {},
      onUnitDone: async (e) => (e.hasActed = true),
    });
    await ai.processEnemyPhase(scene.enemyUnits, scene.playerUnits, [], callbacks(3));
    expect(scene.encounterState.checkedTurn).toBe(3);
    const saved = JSON.parse(JSON.stringify(captureBattleWorldState(scene)));
    const units = scene.enemyUnits.map((e) => JSON.parse(JSON.stringify(serializeBattleUnit(e))));
    // The resume: the hero has walked into A's reach since, but turn 3 was checked.
    scene.enemyUnits.splice(0, scene.enemyUnits.length, ...units);
    for (const e of scene.enemyUnits) e.hasActed = false;
    restoreBattleWorldState(scene, saved);
    hero.col = 9;
    hero.row = 3;
    await ai.processEnemyPhase(scene.enemyUnits, scene.playerUnits, [], callbacks(3));
    expect(scene.enemyUnits.every((e) => e.aiMode === 'hold')).toBe(true);
    for (const e of scene.enemyUnits) e.hasActed = false;
    await ai.processEnemyPhase(scene.enemyUnits, scene.playerUnits, [], callbacks(4));
    expect(scene.encounterState.groups['hold:0']).toMatchObject({ state: 'awake', wokeTurn: 4, reason: 'danger' }); // prettier-ignore
    expect(scene.enemyUnits.slice(0, 2).map((e) => e.holdWoke)).toEqual(['threat', 'threat']);
    expect(isValidEncounterState(scene.encounterState, scene.enemyUnits)).toBe(true);
  });
});

describe("membership and the battle's groups", () => {
  it('a unit belongs by its group id, else by its hold pack; config groups win over derived ones', () => {
    expect(groupIdOf({ encounterGroupId: 'pod:1', holdPack: 0 })).toBe('pod:1');
    expect(groupIdOf({ holdPack: 2 })).toBe('hold:2');
    expect(groupIdOf({})).toBeNull();
    const units = [foe('A', 1, 1, 0, 1), foe('B', 3, 3, 1, 1)];
    const listed = [{ id: 'hold:0', members: [0], state: 'dormant', wake: [{ kind: 'hurt' }], onWake: { mode: 'hunt' } }]; // prettier-ignore
    const groups = battleEncounterGroups({ encounterGroups: listed }, units);
    expect(groups.map((g) => g.id)).toEqual(['hold:0', 'hold:1']);
    expect(groups[0]).toBe(listed[0]);
    // A config group's own wakes are the ones read: this one ignores danger.
    const state = encounterStateFromUnits(groups, units);
    expect(state.groups['hold:0']).toMatchObject({ state: 'dormant', size: 1 });
  });
});

describe('an initially awake group', () => {
  it('writes its onWake onto its spawns: hunt clears the hold, seek walks to its anchor', () => {
    const spawns = [
      { col: 1, row: 1, encounterGroupId: 'raiders' },
      { col: 2, row: 1, encounterGroupId: 'raiders' },
      { col: 5, row: 5, encounterGroupId: 'picket', aiMode: 'guard' },
      { col: 6, row: 6 },
    ];
    const groups = [
      { id: 'raiders', members: [0, 1], state: 'awake', onWake: { mode: 'seek', anchor: 'mill' } },
      { id: 'picket', members: [2], state: 'awake', onWake: { mode: 'hunt' } },
    ];
    const anchors = { mill: { tiles: [[9, 4]] } };
    applyInitialOnWake({ groups, spawns, anchors });
    expect(spawns.slice(0, 2).map((s) => [s.aiMode, s.aiTargetTile])).toEqual([
      ['seek_tile', { col: 9, row: 4 }],
      ['seek_tile', { col: 9, row: 4 }],
    ]);
    expect(spawns[2].aiMode).toBeUndefined();
    expect(spawns[3]).toEqual({ col: 6, row: 6 });
    const config = { encounterVersion: 1, encounterGroups: groups, enemySpawns: spawns, anchors };
    expect(encounterGroupErrors(config)).toEqual([]);
    expect(encounterGroupErrors({ ...config, anchors: {} })).not.toEqual([]);
  });
});
