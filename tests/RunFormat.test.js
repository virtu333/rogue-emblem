// The run-format guard (docs/specs/large-maps/04-set-pieces.md §12.1, §16.5; engine/RunFormat.js):
// a run that holds a mechanic an older client would misplay carries a marker, the loader refuses a
// run this client cannot play and leaves its save exactly as stored, and the slot card says so.
// Tests 19, 23, 25, 26 and the detection half of 27 (§13). The cloud hold-back is
// CloudSyncFormatLocal.test.js; the key census is harness/RunFormatRegistry.test.js.
//
// No large-maps writer exists yet (each lands with its own spec's PR), so the mechanics below are
// planted by hand in the shapes the specs name. Test 23's boss-kit fixture is planted the same way until
// 05 K1 compiles a real kit; its states and the fields each one holds follow 05 §7.2 / §9.5.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager, loadRun } from '../src/engine/RunManager.js';
import { getMetaKey, getRunKey, getSlotSummary } from '../src/engine/SlotManager.js';
import {
  CAPABILITY_IDS,
  CLIENT_CAPABILITIES,
  LEGACY_RUN_FORMAT,
  RUN_CAPABILITIES,
  RUN_FORMAT,
  RUN_FORMAT_FIELDS,
  RUN_FORMAT_FIELD_CLASSES,
  RunFormatError,
  effectiveRunFormat,
  requiredRunFormat,
  runFormatBlock,
  runFormatMarker,
  storedRunFormat,
} from '../src/engine/RunFormat.js';
import { diffBattleState } from '../src/engine/BattleStateDelta.js';
import { slotCardModel, NEEDS_NEWER_CLIENT_TEXT } from '../src/ui/slotCardModel.js';
import { pickResumeSlot } from '../src/ui/titleMenuModel.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';

const gameData = loadGameData();

const store = new Map();
let writes = 0;
beforeEach(() => {
  store.clear();
  writes = 0;
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      writes++;
      store.set(k, String(v));
    },
    removeItem: (k) => {
      writes++;
      store.delete(k);
    },
  });
  return () => vi.unstubAllGlobals();
});

function newRun({ difficultyId = 'normal', seed = 11 } = {}) {
  const previous = Math.random;
  Math.random = createSeededRng(seed);
  try {
    const run = new RunManager(gameData);
    run.startRun({ runSeed: seed, difficultyId });
    return run;
  } finally {
    Math.random = previous;
  }
}

const bossNode = (run) => run.nodeMap.nodes.find((n) => n.type === 'boss');
const battleNode = (run) => run.nodeMap.nodes.find((n) => n.type === 'battle' && n.battleParams);
const ids = (saved) => requiredRunFormat(saved).capabilities;

describe('the capability table', () => {
  it('every capability needs format 2, and this build plays only the Descent’s, the Entity kit, NG+, the Vigil’s shields and Hammerfall', () => {
    expect(RUN_FORMAT).toBe(2);
    expect(LEGACY_RUN_FORMAT).toBe(1);
    expect(CAPABILITY_IDS).toEqual([
      'encounters',
      'parModel',
      'objectives',
      'gateTerrain',
      'bossKit',
      'arena',
      'setPiece',
      'descent',
      'rite',
      'vigil',
      'defeatObjective',
      'entityKit',
      'ngPlus',
      'vigilWards',
      'abyss',
      'hammerfall',
    ]);
    for (const id of CAPABILITY_IDS) expect(RUN_CAPABILITIES[id]).toBe(2);
    // The Descent's writers have shipped; no large-maps writer has. A client never writes
    // what it can't read (test 24). RunFormatDescent.test.js holds the Descent's ids,
    // NgPlus.test.js NG+'s.
    expect(CLIENT_CAPABILITIES).toEqual([
      'descent',
      'rite',
      'vigil',
      'defeatObjective',
      'entityKit',
      'ngPlus',
      'vigilWards',
      'abyss',
      'hammerfall',
    ]);
  });

  it('every registry entry is a capability id or one of the named classes', () => {
    for (const [place, fields] of Object.entries(RUN_FORMAT_FIELDS)) {
      for (const [key, owner] of Object.entries(fields)) {
        const owners = Array.isArray(owner) ? owner : [owner];
        for (const id of owners)
          expect(
            CAPABILITY_IDS.includes(id) || RUN_FORMAT_FIELD_CLASSES.includes(id),
            `${place}.${key}: ${id}`,
          ).toBe(true);
      }
    }
  });
});

describe('a run with no capability (format 1)', () => {
  it('writes neither field, loads, and every client reads it', () => {
    const run = newRun();
    const saved = run.toJSON();
    expect(saved).not.toHaveProperty('requiresClient');
    expect(saved).not.toHaveProperty('requiresCapabilities');
    expect(requiredRunFormat(saved)).toEqual({ format: 1, capabilities: [] });
    expect(runFormatBlock(saved)).toBeNull();
    // A client from before the guard (format 1, no capabilities) reads it too.
    expect(runFormatBlock(saved, { runFormat: 1, clientCapabilities: [] })).toBeNull();
    store.set(getRunKey(1), JSON.stringify(saved));
    expect(loadRun(gameData, 1)).toBeInstanceOf(RunManager);
  });

  it('a save from before the marker loads and gains no ids (test 26)', () => {
    const saved = newRun().toJSON();
    const loaded = RunManager.fromJSON(structuredClone(saved), gameData);
    expect(loaded.requiredCapabilityFloor).toEqual([]);
    expect(loaded.toJSON()).not.toHaveProperty('requiresCapabilities');
  });

  it('the prologue stays unmarked (it is local-only by its mode)', () => {
    const run = new RunManager(gameData);
    run.startPrologue(gameData);
    expect(run.mode).toBe('prologue');
    const saved = run.toJSON();
    expect(saved).not.toHaveProperty('requiresClient');
    expect(saved).not.toHaveProperty('requiresCapabilities');
  });
});

// One planted mechanic per row: where the spec's detection table says it is found, and the one
// capability it holds. A row that also raised another id would mean a detector reads too much.
const config = (extra = {}) => ({ objective: 'rout', enemySpawns: [], ...extra });
const state = (extra = {}) => ({ playerUnits: [], enemyUnits: [], ...extra });
const DETECTION_ROWS = [
  // encounters
  [
    'a group that is not a hold pack',
    'encounters',
    { config: config({ encounterGroups: [{ id: 'court', members: [] }] }) },
  ],
  [
    'a hold group with a relative wake',
    'encounters',
    {
      config: config({
        encounterGroups: [{ id: 'hold:a', members: [], wake: [{ kind: 'turn', parOffset: 1 }] }],
      }),
    },
  ],
  [
    'a hold group that waits before it wakes',
    'encounters',
    {
      config: config({
        encounterGroups: [{ id: 'hold:a', members: [], wake: [{ kind: 'danger', delay: 1 }] }],
      }),
    },
  ],
  [
    'a hold group that does something else on waking',
    'encounters',
    { config: config({ encounterGroups: [{ id: 'hold:a', onWake: { mode: 'guard' } }] }) },
  ],
  ['triggered waves', 'encounters', { config: config({ reinforcements: { triggeredWaves: [{}] } }) }], // prettier-ignore
  ['a patrol', 'encounters', { config: config({ enemySpawns: [{ patrolIndex: 0 }] }) }],
  ['a spawn in a court', 'encounters', { config: config({ enemySpawns: [{ encounterGroupId: 'court' }] }) }], // prettier-ignore
  ['encounter state of a court', 'encounters', { state: state({ encounterState: { groups: { court: {} } } }) }], // prettier-ignore
  ['a fired trigger', 'encounters', { state: state({ encounterState: { fired: { 'wave:1': true } } }) }], // prettier-ignore
  ['a unit in a court', 'encounters', { state: state({ enemyUnits: [{ encounterGroupId: 'court' }] }) }], // prettier-ignore
  ['the run’s encounter plan', 'encounters', { run: { difficultyModifiers: { encounterPlan: { act2: 'pods' } } } }], // prettier-ignore
  // parModel
  ['a locked par model', 'parModel', { config: config({ parModel: 'groups-v1' }) }],
  ['a par model on the params', 'parModel', { params: { parModel: 'groups-v1' } }],
  // objectives
  ['two primaries', 'objectives', { config: config({ objectives: { primary: [{ kind: 'rout' }, { kind: 'seize' }] } }) }], // prettier-ignore
  ['a defeat objective', 'objectives', { config: config({ objectives: { primary: [{ kind: 'defeat' }] } }) }], // prettier-ignore
  ['phases', 'objectives', { config: config({ objectives: { primary: [{ kind: 'rout' }], phases: [{}] } }) }], // prettier-ignore
  ['a bonus beyond village and caravan', 'objectives', { config: config({ objectives: { primary: [{ kind: 'rout' }], bonus: [{ id: 'armoury' }] } }) }], // prettier-ignore
  ['a par adjustment', 'objectives', { config: config({ objectives: { primary: [{ kind: 'rout' }], parAdjust: 1 } }) }], // prettier-ignore
  ['NPC allies', 'objectives', { config: config({ npcAllies: [] }) }],
  ['a clamped spawn', 'objectives', { config: config({ enemySpawns: [{ clampTile: [1, 1] }] }) }],
  ['a phase reached', 'objectives', { state: state({ objectiveState: { phase: 1 } }) }],
  ['a second throne', 'objectives', { state: state({ objectiveState: { thrones: { east: {} } } }) }], // prettier-ignore
  ['an objective preview', 'objectives', { params: { objectivePreview: { kind: 'defeat' } } }, ['objectives', 'setPiece']], // prettier-ignore
  ['Vision rewards for objectives', 'objectives', { run: { bonusVisionActs: ['act2'] } }],
  // gateTerrain
  ['a structure', 'gateTerrain', { config: config({ structures: [{ id: 'gate' }] }) }],
  ['a Gate tile', 'gateTerrain', { state: state({ mapLayout: [[0, 20]] }) }],
  // bossKit
  ['a boss kit', 'bossKit', { config: config({ bossKit: { id: 'archmage' } }) }],
  ['a boss signature', 'bossKit', { config: config({ bossSignature: { id: 'calculation' } }) }],
  ['a kit on a boss spawn', 'bossKit', { config: config({ enemySpawns: [{ bossKit: {} }] }) }],
  ['boss state', 'bossKit', { state: state({ bossState: { signature: { pending: true } } }) }],
  ['kits switched on for the run', 'bossKit', { run: { difficultyModifiers: { bossKits: { enabled: true } } } }], // prettier-ignore
  // arena
  ['an arena variant on a node', 'arena', { params: { arenaVariant: 0 } }],
  ['an arena variant on a config', 'arena', { config: config({ arenaVariant: 1 }) }],
  // setPiece (assembled only)
  ['an assembled piece’s fallback', 'setPiece', { params: { setPiece: 'mill_ford', setPieceFallback: { objective: 'seize' } } }], // prettier-ignore
  ['an assembled piece’s choices', 'setPiece', { config: config({ setPieceVersion: 1, setPieceChoices: {} }) }], // prettier-ignore
  ['set pieces offered', 'setPiece', { run: { setPiecesOffered: ['mill_ford'] } }],
  // vigilWards: a locked Vigil's shields (which is a Vigil too), a checkpoint's broken circles
  ['a warded Vigil', 'vigilWards', { config: config({ vigil: { sigils: [], circles: [], wards: true } }) }, ['vigil', 'vigilWards']], // prettier-ignore
  ['a choir', 'vigilWards', { config: config({ vigil: { sigils: [], circles: [], choir: true } }) }, ['vigil', 'vigilWards']], // prettier-ignore
  ['a broken circle', 'vigilWards', { state: state({ vigilState: { words: 0, broken: { circle_a: 2 } } }) }, ['vigil', 'vigilWards']], // prettier-ignore
  // abyss
  ['an Abyss tile on a locked map', 'abyss', { config: config({ mapLayout: [[0, 19]] }) }],
  ['an Abyss tile on a checkpoint', 'abyss', { state: state({ mapLayout: [[19, 0]] }) }],
];

/** A run save holding `planted` in its place. */
function plant(base, planted) {
  const saved = structuredClone(base);
  const node = saved.nodeMap.nodes.find((n) => n.type === 'battle' && n.battleParams);
  if (planted.params) Object.assign(node.battleParams, planted.params);
  if (planted.config) saved.battleConfigsByNodeId = { [node.id]: planted.config };
  if (planted.state)
    saved.battleInProgress = { nodeId: node.id, battleParams: {}, checkpoint: planted.state };
  if (planted.run) {
    for (const [key, value] of Object.entries(planted.run)) {
      saved[key] =
        key === 'difficultyModifiers'
          ? { ...(saved[key] || {}), ...value }
          : structuredClone(value);
    }
  }
  return saved;
}

describe('detection: each mechanic holds its capability and no other', () => {
  const base = newRun().toJSON();
  it.each(DETECTION_ROWS)('%s', (_label, id, planted, expected = [id]) => {
    expect(ids(plant(base, planted))).toEqual(expected);
  });

  it('a finished node’s params are history, not a mechanic', () => {
    const saved = plant(base, { params: { arenaVariant: 0 } });
    saved.nodeMap.nodes.find((n) => n.battleParams?.arenaVariant === 0).completed = true;
    expect(ids(saved)).toEqual([]);
  });

  it('a Vision snapshot and the pending one are read like the checkpoint', () => {
    for (const key of ['visionSnapshot', 'pendingVisionSnapshot']) {
      const saved = plant(base, { state: state({ [key]: state({ bossState: { count: 1 } }) }) });
      expect(ids(saved), key).toEqual(['bossKit']);
    }
  });

  it('a rewind timeline destination is read, full or as a patch on its keyframe', () => {
    const keyframe = state({ turnNumber: 1 });
    const later = state({ turnNumber: 2, bossState: { firedTurns: [2] } });
    const full = plant(base, { state: state() });
    full.battleInProgress.timeline = { snapshots: { a: keyframe, b: later } };
    expect(ids(full)).toEqual(['bossKit']);
    const patched = plant(base, { state: state() });
    patched.battleInProgress.timeline = {
      snapshots: { a: keyframe, b: { base: 'a', patch: diffBattleState(keyframe, later) } },
    };
    expect(ids(patched)).toEqual(['bossKit']);
    // A malformed patch restores nothing and holds nothing.
    patched.battleInProgress.timeline.snapshots.b.patch = { op: 'nonsense' };
    expect(() => requiredRunFormat(patched)).not.toThrow();
  });
});

describe('legacy-equivalent runs are never held (test 25)', () => {
  const base = newRun({ difficultyId: 'dusk' }).toJSON();
  const holdGroups = [
    { id: 'hold:0', members: ['e1', 'e2'], state: 'dormant', wake: [{ kind: 'danger' }, { kind: 'hurt', delay: 0 }], onWake: { mode: 'hunt' } }, // prettier-ignore
    { id: 'hold:1', members: ['e3'] },
    // An event set piece's `holdWakeTurn` as 02 §3.6's adapter writes it: the absolute turn.
    { id: 'hold:2', members: ['e4'], wake: [{ kind: 'turn', turn: 3, delay: 0 }] },
  ];
  it('hold packs, derived objectives, a mirroring state and an empty boss state are format 1', () => {
    const saved = plant(base, {
      config: config({
        objective: 'seize',
        encounterGroups: holdGroups,
        objectives: {
          primary: [{ kind: 'seize', thrones: [[3, 3]] }],
          bonus: [{ id: 'village' }, { id: 'caravan' }],
          parAdjust: 0,
        },
        enemySpawns: [{ holdPack: 0, holdWakeTurn: 3, encounterGroupId: 'hold:0' }],
      }),
    });
    saved.battleInProgress = {
      nodeId: 'x',
      battleParams: { setPiece: 'toll_house', deployCap: 5 },
      checkpoint: state({
        encounterState: { groups: { 'hold:0': { awake: false } }, fired: {} },
        objectiveState: { phase: 0, status: { seize: 'open', village: 'open' }, thrones: { throne: {} } }, // prettier-ignore
        bossState: {},
        villageState: { visited: false },
        caravanExited: false,
        enemyUnits: [{ encounterGroupId: 'hold:0' }],
      }),
    };
    expect(requiredRunFormat(saved)).toEqual({ format: 1, capabilities: [] });
    expect(runFormatBlock(saved, { runFormat: 1, clientCapabilities: [] })).toBeNull();
    expect(runFormatMarker(saved)).toEqual({});
  });

  it('the shipped event set pieces are format 1: unentered, locked and mid-battle (test 27)', () => {
    const run = newRun({ seed: 3 });
    const node = battleNode(run);
    node.battleParams.setPiece = 'toll_house';
    node.battleParams.deployCap = 5;
    expect(ids(run.toJSON())).toEqual([]);
    run.battleConfigsByNodeId[node.id] = config({
      templateId: 'setpiece:toll_house',
      setPieceId: 'toll_house',
      setPieceVariant: 'a',
      mirrored: true,
      formationSpares: [],
      enemySpawns: [{ holdPack: 0, holdWakeTurn: 3 }],
    });
    expect(ids(run.toJSON())).toEqual([]);
    run.battleInProgress = {
      nodeId: node.id,
      battleParams: { ...node.battleParams },
      checkpoint: state({ enemyUnits: [{ holdWakeTurn: 3 }] }),
    };
    expect(ids(run.toJSON())).toEqual([]);
    // The same node made assembled holds `setPiece`.
    node.battleParams.setPieceFallback = { objective: 'seize', templateId: 'castle_ruins' };
    expect(ids(run.toJSON())).toEqual(['setPiece']);
  });
});

describe('test 23: a First Light boss kit with no set piece anywhere', () => {
  // Act II on First Light, a procedural seize, the Archmage's signature-only kit (05 §7.2, §9.5):
  // a signature and nothing else, so no group, phase or objectives.
  function fixture(stage) {
    const run = newRun({ difficultyId: 'normal', seed: 23 });
    run.advanceAct();
    run.difficultyModifiers = { ...run.difficultyModifiers, bossKits: { enabled: true } };
    const boss = bossNode(run);
    if (stage === 'locked' || stage === 'checkpoint')
      run.battleConfigsByNodeId[boss.id] = config({
        objective: 'seize',
        templateId: 'castle_ruins',
        bossKit: { id: 'archmage', tier: 'signature' },
        bossSignature: { id: 'calculation', tiles: 2, lethal: false },
        enemySpawns: [{ isBoss: true, className: 'Sage', bossKit: { id: 'archmage' } }],
      });
    if (stage === 'checkpoint')
      run.battleInProgress = {
        nodeId: boss.id,
        battleParams: { ...boss.battleParams },
        checkpoint: state({ bossState: { signature: { pending: { tiles: [[4, 4], [4, 5]] } }, count: 1 } }), // prettier-ignore
      };
    return run;
  }
  const deepKeys = (value, out = new Set()) => {
    if (value && typeof value === 'object')
      for (const [k, v] of Object.entries(value)) {
        out.add(k);
        if (typeof v === 'string') out.add(v);
        deepKeys(v, out);
      }
    return out;
  };

  it.each(['start', 'locked', 'checkpoint'])(
    'state %s needs format 2 for bossKit alone',
    (stage) => {
      const run = fixture(stage);
      const saved = run.toJSON();
      const seen = deepKeys(saved);
      for (const key of ['setPiece', 'setPieceFallback', 'setPiecesOffered', 'objectivePreview'])
        expect(seen.has(key), key).toBe(false);
      expect([...seen].some((k) => typeof k === 'string' && k.startsWith('setpiece:'))).toBe(false);
      expect(requiredRunFormat(saved)).toEqual({ format: 2, capabilities: ['bossKit'] });
      expect(saved.requiresClient).toBe(2);
      expect(saved.requiresCapabilities).toEqual(['bossKit']);
      // The marker deleted, the payload still says format 2 (the cloud hold-back reads this).
      delete saved.requiresClient;
      delete saved.requiresCapabilities;
      expect(effectiveRunFormat(saved)).toBe(2);
    },
  );

  it('a client without bossKit (this build) refuses it and leaves the slot untouched', () => {
    const raw = JSON.stringify(fixture('checkpoint').toJSON());
    store.set(getRunKey(1), raw);
    writes = 0;
    expect(loadRun(gameData, 1)).toBeNull();
    expect(store.get(getRunKey(1))).toBe(raw);
    expect(writes).toBe(0);
    // A client at format 1 refuses it by number too.
    expect(runFormatBlock(JSON.parse(raw), { runFormat: 1, clientCapabilities: ['bossKit'] })).toMatchObject({ format: 2 }); // prettier-ignore
    // A client that plays bossKit would take it.
    expect(runFormatBlock(JSON.parse(raw), { clientCapabilities: ['bossKit'] })).toBeNull();
  });
});

describe('test 19: the loader refuses a run it cannot play', () => {
  const marked = (extra) => ({ ...newRun().toJSON(), ...extra });

  it.each([
    ['a format above this client', { requiresClient: 3 }, { format: 3, missing: [] }],
    ['an id this client lacks', { requiresClient: 2, requiresCapabilities: ['setPiece'] }, { format: 2, missing: ['setPiece'] }], // prettier-ignore
    ['an id from a later build', { requiresCapabilities: ['tides'] }, { format: 2, missing: ['tides'] }], // prettier-ignore
  ])('%s', (_label, marker, expected) => {
    const saved = marked(marker);
    expect(runFormatBlock(saved)).toMatchObject(expected);
    const raw = JSON.stringify(saved);
    store.set(getRunKey(1), raw);
    store.set(getMetaKey(1), JSON.stringify({ savedAt: 1, runsStarted: 1 }));
    writes = 0;
    expect(loadRun(gameData, 1)).toBeNull();
    expect(store.get(getRunKey(1))).toBe(raw);
    expect(writes).toBe(0);
    expect(() => RunManager.fromJSON(JSON.parse(raw), gameData)).toThrow(RunFormatError);
    // The slot says so; Continue is not offered and Resume never picks it.
    const summary = getSlotSummary(1);
    expect(summary).toMatchObject({ hasActiveRun: true, needsNewerClient: true, runCorrupt: false }); // prettier-ignore
    const card = slotCardModel(1, summary, { gameData });
    expect(card.state).toBe('newer');
    expect(card.status).toBe(NEEDS_NEWER_CLIENT_TEXT);
    expect(card.primary.label).not.toMatch(/Continue|Resume/);
    expect(pickResumeSlot([summary])).toBeNull();
  });

  it('a stored marker is read even when the payload holds nothing (and vice versa)', () => {
    expect(storedRunFormat({ requiresClient: 2, requiresCapabilities: ['arena'] })).toEqual({
      format: 2,
      capabilities: ['arena'],
    });
    expect(storedRunFormat({ requiresClient: 'junk' })).toEqual({ format: 1, capabilities: [] });
    expect(storedRunFormat({ requiresCapabilities: ['arena', 7, '', 'arena'] })).toEqual({
      format: 2,
      capabilities: ['arena'],
    });
    // Derived without a marker: still refused.
    const derived = plant(newRun().toJSON(), { run: { setPiecesOffered: ['mill_ford'] } });
    expect(runFormatBlock(derived)).toMatchObject({ format: 2, missing: ['setPiece'] });
  });

  it('a loadable run alongside: the summary does not flag it', () => {
    store.set(getRunKey(2), JSON.stringify(newRun().toJSON()));
    store.set(getMetaKey(2), JSON.stringify({ savedAt: 1, runsStarted: 1 }));
    const summary = getSlotSummary(2);
    expect(summary.needsNewerClient).toBe(false);
    expect(pickResumeSlot([summary])).toMatchObject({ slot: 2 });
  });
});

describe('test 26: the ratchet', () => {
  it('a run that held bossKit keeps its marker after the config is pruned and kits end', () => {
    const run = newRun({ seed: 26 });
    run.difficultyModifiers = { ...run.difficultyModifiers, bossKits: { enabled: true } };
    expect(run.toJSON().requiresCapabilities).toEqual(['bossKit']);
    run.difficultyModifiers = { ...run.difficultyModifiers, bossKits: { enabled: false } };
    run.battleConfigsByNodeId = {};
    run.advanceAct();
    const saved = run.toJSON();
    expect(requiredRunFormat(saved).capabilities).toEqual([]);
    expect(saved.requiresClient).toBe(2);
    expect(saved.requiresCapabilities).toEqual(['bossKit']);
    expect(effectiveRunFormat(saved)).toBe(2);
  });

  it('the floor unites with what the run holds now, in the table’s order', () => {
    const saved = plant(newRun().toJSON(), { run: { setPiecesOffered: ['x'] } });
    expect(runFormatMarker(saved, ['bossKit', 'later'])).toEqual({
      requiresClient: 2,
      requiresCapabilities: ['bossKit', 'setPiece', 'later'],
    });
  });

  it('a new run starts with no floor', () => {
    const run = newRun();
    run.requiredCapabilityFloor = ['bossKit'];
    run.startRun({ runSeed: 99, difficultyId: 'normal' });
    expect(run.requiredCapabilityFloor).toEqual([]);
  });
});
