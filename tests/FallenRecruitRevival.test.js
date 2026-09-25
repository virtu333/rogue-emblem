// Playtest 2026-09-25: "my archer died last map and I can't revive him at the
// church … maybe it was because I lost him on the mission I recruited him".
//
// Root cause: RunManager.completeBattle recorded casualties by diffing the run
// roster (as it entered the battle) against the survivors. A unit recruited by
// Talk during the battle was never on that roster, so when it fell before the
// victory it vanished — no fallen-ally record, no church revival, and its
// items were lost with it. The battle now keeps an as-joined record of every
// mid-battle recruit in its world state (checkpoint + Vision/rewind snapshots)
// and hands the fallen ones to completeBattle.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RunManager, saveRun, loadRun } from '../src/engine/RunManager.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';
import {
  recordBattleRecruit,
  fallenBattleRecruits,
  normalizeBattleRecruits,
} from '../src/engine/BattleRecruits.js';
import {
  captureBattleWorldState,
  restoreBattleWorldState,
} from '../src/engine/BattleSnapshotState.js';
import { validateBattleState } from '../src/engine/BattleStateSnapshot.js';
import { reviveAtChurch } from '../src/engine/ChurchCommands.js';
import { loadGameData } from './testData.js';

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, val) => {
      store[key] = String(val);
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
    key: vi.fn((i) => Object.keys(store)[i] ?? null),
    get length() {
      return Object.keys(store).length;
    },
  },
  configurable: true,
  writable: true,
});

const gameData = loadGameData();

function makeArcher(name = 'Daska') {
  const classData = gameData.classes.find((c) => c.name === 'Archer');
  const unit = createRecruitUnit(
    { name, level: 3 },
    classData,
    gameData.weapons,
    null,
    null,
    null,
    gameData.classes,
    {
      skillsData: gameData.skills,
    },
  );
  unit.consumables = [structuredClone(gameData.consumables.find((c) => c.name === 'Vulnerary'))];
  return unit;
}

// Minimal battle scene surface the world-state contract reads and writes.
function makeScene(extra = {}) {
  return {
    playerUnits: [],
    enemyUnits: [],
    npcUnits: [],
    grid: null,
    _playerDeathsThisBattle: 0,
    ...extra,
  };
}

function joinArmy(scene, npc) {
  // Mirrors BattleScene.executeTalk: npc → player, then the as-joined record.
  scene.npcUnits = scene.npcUnits.filter((u) => u !== npc);
  npc.faction = 'player';
  npc.battleEntityId = 'u9';
  scene.playerUnits.push(npc);
  scene._battleRecruits = recordBattleRecruit(scene._battleRecruits, npc);
}

function startRun() {
  const rm = new RunManager(gameData, null);
  rm.startRun();
  const node = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
  return { rm, node };
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

describe('BattleRecruits records', () => {
  it('stores a roster-shaped copy without presentation, battle deltas or conditions', () => {
    const archer = makeArcher();
    archer.graphic = { destroy() {} };
    archer.hpBar = { destroy() {} };
    archer._battleDeltas = { DEF: 2 };
    archer.stats.DEF += 2;
    archer._conditions = [{ id: 'poison', turns: 2 }];
    const baseDef = archer.stats.DEF - 2;
    const [entry] = recordBattleRecruit([], archer);
    expect(entry.name).toBe('Daska');
    expect(entry.unit.graphic).toBeNull();
    expect(entry.unit.hpBar).toBeNull();
    expect(entry.unit.stats.DEF).toBe(baseDef);
    expect(entry.unit._battleDeltas).toBeUndefined();
    expect(entry.unit._conditions).toEqual([]);
    expect(entry.unit.battleEntityId).toBeUndefined();
    // Equipped item stays the same object as its inventory slot.
    expect(entry.unit.weapon).toBe(entry.unit.inventory[0]);
    // The live unit is untouched.
    expect(archer.stats.DEF).toBe(baseDef + 2);
    expect(archer.graphic).not.toBeNull();
    // JSON-safe (it rides in checkpoints and save files).
    expect(() => JSON.stringify(entry)).not.toThrow();
  });

  it('a later record for the same name replaces the earlier one', () => {
    const first = makeArcher();
    let list = recordBattleRecruit([], first);
    const again = makeArcher();
    again.level = 7;
    list = recordBattleRecruit(list, again);
    expect(list).toHaveLength(1);
    expect(list[0].unit.level).toBe(7);
  });

  it('two recruits sharing a name keep separate records (identity, not name)', () => {
    const first = makeArcher('Linnet');
    first.unitUid = 'ru8';
    const second = makeArcher('Linnet');
    second.unitUid = 'ru9';
    let list = recordBattleRecruit([], first);
    list = recordBattleRecruit(list, second);
    expect(list.map((e) => e.unit.unitUid)).toEqual(['ru8', 'ru9']);
    // A later record of the same unit still replaces its earlier one.
    second.level = 7;
    list = recordBattleRecruit(list, second);
    expect(list.map((e) => [e.unit.unitUid, e.unit.level])).toEqual([
      ['ru8', 3],
      ['ru9', 7],
    ]);
    // A living namesake (a hired Linnet) does not make the fallen recruit alive.
    const survivors = [{ name: 'Linnet', unitUid: 'ru2' }, second];
    expect(
      fallenBattleRecruits(list, survivors, [{ name: 'Linnet', unitUid: 'ru2' }]).map(
        (u) => u.unitUid,
      ),
    ).toEqual(['ru8']);
  });

  it('only recruits missing from the survivors are fallen', () => {
    const list = recordBattleRecruit(
      recordBattleRecruit([], makeArcher('Daska')),
      makeArcher('Wren'),
    );
    expect(
      fallenBattleRecruits(list, [{ name: 'Edric' }, { name: 'Wren' }]).map((u) => u.name),
    ).toEqual(['Daska']);
    expect(fallenBattleRecruits(list, [{ name: 'Daska' }, { name: 'Wren' }])).toEqual([]);
    expect(fallenBattleRecruits(undefined, [])).toEqual([]);
  });

  it('drops malformed stored entries', () => {
    expect(normalizeBattleRecruits(null)).toEqual([]);
    expect(
      normalizeBattleRecruits([{ name: 'X' }, { name: 'Y', unit: { name: 'Z', stats: {} } }]),
    ).toEqual([]);
  });
});

describe('battle world state carries the recruit records', () => {
  it('captures, validates and restores them; legacy snapshots restore none', () => {
    const scene = makeScene();
    joinArmy(scene, makeArcher());
    const state = captureBattleWorldState(scene);
    expect(state.battleRecruits).toHaveLength(1);
    const json = JSON.parse(JSON.stringify(state));

    const resumed = makeScene();
    restoreBattleWorldState(resumed, json);
    expect(resumed._battleRecruits.map((e) => e.name)).toEqual(['Daska']);

    const legacy = { ...json };
    delete legacy.battleRecruits;
    const old = makeScene({ _battleRecruits: [{ name: 'stale' }] });
    restoreBattleWorldState(old, legacy);
    expect(old._battleRecruits).toEqual([]);
  });

  it('the canonical state validator accepts the field and rejects a malformed one', () => {
    const base = {
      version: 2,
      phase: 'player',
      turnNumber: 1,
      rngSeed: 1,
      nextEntityId: 2,
      mapLayout: [[0, 0]],
      playerUnits: [
        {
          battleEntityId: 'u1',
          name: 'Edric',
          stats: { HP: 20, STR: 5, MAG: 0, SKL: 5, SPD: 5, DEF: 5, RES: 0, LCK: 5, MOV: 5 },
          currentHP: 20,
          col: 0,
          row: 0,
          inventory: [],
          consumables: [],
          equippedInventoryIndex: -1,
          weapon: null,
        },
      ],
      enemyUnits: [],
      npcUnits: [],
      escapedUnits: [],
      nonDeployedUnits: [],
      runBattleState: null,
    };
    expect(validateBattleState(base)).toBe(true);
    const ok = { ...base, battleRecruits: recordBattleRecruit([], makeArcher()) };
    expect(validateBattleState(JSON.parse(JSON.stringify(ok)))).toBe(true);
    expect(
      validateBattleState({ ...base, battleRecruits: [{ name: 'X', unit: { name: 'Y' } }] }),
    ).toBe(false);
  });

  it('a rewind to before the recruitment forgets the recruit; a rewind to before the death keeps it', () => {
    const scene = makeScene();
    const npc = makeArcher();
    npc.faction = 'npc';
    scene.npcUnits.push(npc);
    const beforeTalk = JSON.parse(JSON.stringify(captureBattleWorldState(scene)));
    joinArmy(scene, npc);
    const afterTalk = JSON.parse(JSON.stringify(captureBattleWorldState(scene)));
    // The recruit falls.
    scene.playerUnits = scene.playerUnits.filter((u) => u !== npc);

    restoreBattleWorldState(scene, afterTalk);
    expect(scene._battleRecruits.map((e) => e.name)).toEqual(['Daska']);
    restoreBattleWorldState(scene, beforeTalk);
    expect(scene._battleRecruits).toEqual([]);
  });
});

describe('completeBattle records a recruit who joined and fell in the same battle', () => {
  it('adds the fallen recruit, moves its items to the convoy, and the church can revive it', () => {
    const { rm, node } = startRun();
    const scene = makeScene({ playerUnits: rm.roster.map((u) => structuredClone(u)) });
    const npc = makeArcher();
    const carried = npc.inventory.map((w) => w.name);
    joinArmy(scene, npc);
    // Suspend + resume in between: the record survives a checkpoint round trip.
    const checkpoint = JSON.parse(JSON.stringify(captureBattleWorldState(scene)));
    const resumed = makeScene({ playerUnits: scene.playerUnits });
    restoreBattleWorldState(resumed, checkpoint);
    // Daska falls; the rest win.
    const survivors = resumed.playerUnits.filter((u) => u.name !== 'Daska');
    const weaponsBefore = rm.convoy.weapons.length;

    expect(
      rm.completeBattle(survivors, node.id, 0, {
        fallenRecruits: fallenBattleRecruits(resumed._battleRecruits, survivors),
      }),
    ).toBe(true);

    const fallen = rm.fallenUnits.find((u) => u.name === 'Daska');
    expect(fallen).toBeTruthy();
    expect(fallen.className).toBe('Archer');
    expect(fallen.faction).toBe('player');
    expect(fallen.inventory).toEqual([]);
    expect(rm.convoy.weapons.slice(weaponsBefore).map((w) => w.name)).toEqual(carried);
    expect(rm.lastBattleCasualtyNotices.some((n) => n.startsWith('Daska:'))).toBe(true);
    expect(rm.roster.some((u) => u.name === 'Daska')).toBe(false);

    // Survives a save/load, then the church lists and revives it.
    expect(saveRun(rm, null, 1).ok).toBe(true);
    const loaded = loadRun(gameData, 1);
    const record = loaded.fallenUnits.find((u) => u.name === 'Daska');
    expect(record).toBeTruthy();
    loaded.gold = 10000;
    const result = reviveAtChurch(loaded, record);
    expect(result.ok).toBe(true);
    const revived = loaded.roster.find((u) => u.name === 'Daska');
    expect(revived.currentHP).toBe(1);
    expect(loaded.fallenUnits.some((u) => u.name === 'Daska')).toBe(false);
  });

  it('a recruit who survives is not recorded as fallen', () => {
    const { rm, node } = startRun();
    const scene = makeScene({ playerUnits: rm.roster.map((u) => structuredClone(u)) });
    joinArmy(scene, makeArcher());
    rm.completeBattle(scene.playerUnits, node.id, 0, {
      fallenRecruits: fallenBattleRecruits(scene._battleRecruits, scene.playerUnits),
    });
    expect(rm.fallenUnits).toEqual([]);
    expect(rm.roster.some((u) => u.name === 'Daska')).toBe(true);
  });

  it('never double-records or resurrects: survivors, roster members and duplicates are ignored', () => {
    const { rm, node } = startRun();
    const edric = rm.roster[0];
    const archer = recordBattleRecruit([], makeArcher())[0].unit;
    const fakeEdric = { ...structuredClone(edric) };
    rm.completeBattle(rm.roster.slice(1), node.id, 0, {
      // A roster member is already covered by the roster diff (entry-time copy).
      fallenRecruits: [archer, archer, fakeEdric, { name: 'Broken' }],
    });
    expect(rm.fallenUnits.map((u) => u.name).sort()).toEqual(['Daska', 'Edric']);
  });

  it('a recruited lord who falls counts toward the run lord falls', () => {
    const { rm, node } = startRun();
    const lord = makeArcher('Kira');
    lord.isLord = true;
    const [entry] = recordBattleRecruit([], lord);
    rm.completeBattle(rm.roster, node.id, 0, { fallenRecruits: [entry.unit] });
    expect(rm.runLordFalls).toContain('Kira');
  });

  it('keeps the legacy behavior when no recruit records are passed', () => {
    const { rm, node } = startRun();
    rm.completeBattle(rm.roster, node.id, 0);
    expect(rm.fallenUnits).toEqual([]);
  });
});
