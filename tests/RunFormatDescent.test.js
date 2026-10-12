// The Descent's save compatibility (engine/RunFormat.js `descent`, `rite`, `vigil`,
// `defeatObjective`; act-v-descent): a client from before the Descent must refuse a Descent run it
// cannot play. On such a save it would build template rout maps for the unknown set pieces (no
// Lieutenant seated at the gate), show a boss recruit after the gate and grant no gate Vision, let
// the Eclipse take the Stair, the Vigil or the Landing, and pay `finalBoss`'s gold-only loot.
//
// What can go wrong, one row each below:
//   - a Descent run reaches an older client unmarked: at route entry, mid-Vigil, with a Rite,
//     at the gate (the stages; the older client reads the marker, never the Descent's fields);
//   - the run is marked only when `enabled` is read, or only while some field still shows it (the
//     floor from _buildActNodeMap: whatever happens after, every later save keeps the id);
//   - one mechanic goes undetected on its own (the detection rows: each planted alone holds its
//     one id, so dropping any one rule fails its row), including the defeat model on an event set
//     piece of any act, a checkpoint's vigilState in a Vision snapshot or a timeline patch;
//   - the defeat model's id swallows a model this build cannot play (that stays `objectives`);
//   - a non-Descent run, or an old save with none of these, is refused or changed (no false
//     refusal: unmarked, and the guard-only client accepts it).
// The loader's side for an older client (loadRun, the slot card) is RunFormatDescentOlderClient.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager, loadRun } from '../src/engine/RunManager.js';
import { getRunKey } from '../src/engine/SlotManager.js';
import {
  CAPABILITY_IDS,
  CLIENT_CAPABILITIES,
  RUN_CAPABILITIES,
  requiredRunFormat,
  runFormatBlock,
  storedRunFormat,
} from '../src/engine/RunFormat.js';
import { diffBattleState } from '../src/engine/BattleStateDelta.js';
import { DEFEAT_BOSS_OBJECTIVES } from '../src/engine/Descent.js';
import { applyGenerationFields, generateSeededBattle } from '../src/engine/BattleScout.js';
import {
  atGateRun,
  descentEntryRun,
  descentNode,
  midVigilCheckpoint,
  midVigilRun,
  pastVigilRun,
  startedRun,
  withDescentOff,
  withDescentOn,
} from './helpers/descentRunFormatFixtures.js';

// The plain build these rows set against the Descent: the same data with it switched off (the
// shipped file has it on), so the old 2-node final act is built here on purpose.
const gameData = withDescentOff(loadGameData());
const descentData = withDescentOn(gameData);

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

// A client with the run-format guard (#305) and nothing of the Descent: format 2, it plays none
// of the capabilities, and the Descent's ids reach it only by name in a save's marker. What the
// marker alone refuses there is refused whatever its own detection finds.
const GUARD_ONLY = Object.freeze({ runFormat: 2, clientCapabilities: [] });
const markerOf = (saved) => ({
  requiresClient: saved.requiresClient,
  requiresCapabilities: saved.requiresCapabilities,
});
const olderClientBlock = (saved) => runFormatBlock(markerOf(saved), GUARD_ONLY);
const ids = (saved) => requiredRunFormat(saved).capabilities;
const DESCENT_IDS = ['descent', 'rite', 'vigil', 'defeatObjective'];

describe('the Descent’s capabilities', () => {
  it('four ids at format 2, after the guard’s seven, and this build plays exactly them', () => {
    expect(CAPABILITY_IDS.slice(-4)).toEqual(DESCENT_IDS);
    for (const id of DESCENT_IDS) expect(RUN_CAPABILITIES[id]).toBe(2);
    expect([...CLIENT_CAPABILITIES]).toEqual(DESCENT_IDS);
    // Not the large-maps model: a written objectives model beyond `defeat` is still refused.
    expect(CLIENT_CAPABILITIES).not.toContain('objectives');
  });
});

describe('each stage of a Descent run is refused by an older client', () => {
  it.each([
    ['First Light', 'normal', ['descent', 'rite']],
    ['Dusk', 'dusk', ['descent', 'rite']],
    // The gate's node params carry its defeat model from the route's build.
    ['Nightfall', 'hard', ['descent', 'rite', 'defeatObjective']],
    ['Black Sun', 'lunatic', ['descent', 'rite', 'defeatObjective']],
  ])('route entry on %s', (_label, difficultyId, expected) => {
    const run = descentEntryRun(descentData, { difficultyId });
    expect(run.nodeMap.descent).toBeTruthy();
    const saved = run.toJSON();
    expect(saved.requiresClient).toBe(2);
    expect(saved.requiresCapabilities).toEqual(expected);
    expect(olderClientBlock(saved)).toMatchObject({ format: 2, missing: expected });
    // This build plays it: it loads.
    expect(runFormatBlock(saved)).toBeNull();
    expect(RunManager.fromJSON(structuredClone(saved), descentData).nodeMap.descent).toEqual(
      run.nodeMap.descent,
    );
  });

  it('mid-Vigil: a checkpoint with the Vigil’s count (and its locked map)', () => {
    const saved = midVigilRun(descentData).toJSON();
    expect(saved.battleInProgress.checkpoint.vigilState.words).toBe(4);
    expect(saved.requiresCapabilities).toEqual(['descent', 'rite', 'vigil', 'defeatObjective']);
    expect(olderClientBlock(saved)?.missing).toContain('vigil');
    expect(runFormatBlock(saved)).toBeNull();
  });

  it('a Rite that has taken words', () => {
    const run = pastVigilRun(descentData);
    // The Rite the run entered with, the Column won under par, then the Vigil's 4 words: each
    // number read from the data (descent.json `rite`), so a retune moves no assertion here.
    const entry = descentEntryRun(descentData).rite.words;
    const words = Math.max(0, entry + descentData.descent.rite.underPar.column) + 4;
    expect(run.rite.words).toBe(words);
    const saved = run.toJSON();
    expect(saved.rite.words).toBe(words);
    expect(saved.requiresCapabilities).toContain('rite');
    expect(olderClientBlock(saved)?.missing).toContain('rite');
  });

  it('at the gate: its battle in progress, a defeat of @boss on the locked map', () => {
    const run = atGateRun(descentData);
    const gate = descentNode(run, 'gate');
    const saved = run.toJSON();
    expect(saved.battleInProgress.battleParams.bossRole).toBe('gate');
    expect(saved.battleConfigsByNodeId[gate.id].objectives).toEqual(DEFEAT_BOSS_OBJECTIVES);
    expect(saved.requiresCapabilities).toEqual(['descent', 'rite', 'vigil', 'defeatObjective']);
    expect(olderClientBlock(saved)?.missing).toEqual(
      expect.arrayContaining(['descent', 'defeatObjective']),
    );
  });

  it('a save whose writer left the marker out is still refused here by what it holds', () => {
    const saved = atGateRun(descentData).toJSON();
    delete saved.requiresClient;
    delete saved.requiresCapabilities;
    expect(runFormatBlock(saved, GUARD_ONLY)).toMatchObject({
      format: 2,
      missing: ['descent', 'rite', 'vigil', 'defeatObjective'],
    });
  });
});

describe('the run is held from the moment the route is built', () => {
  it('not when `enabled` is read: a run with the Descent on is unmarked until the final act', () => {
    const run = startedRun(descentData, { difficultyId: 'hard' });
    expect(run.requiredCapabilityFloor).toEqual([]);
    expect(run.toJSON()).not.toHaveProperty('requiresCapabilities');
  });

  it('the floor holds `descent` from the build, before any save, whatever happens after', () => {
    const run = startedRun(descentData, { difficultyId: 'hard' });
    run.actIndex = run.actSequence.indexOf('finalBoss') - 1;
    run.advanceAct();
    expect(run.requiredCapabilityFloor).toContain('descent');
    // Whatever the payload later shows (a route map no client should meet again, the Rite gone,
    // every locked map pruned), every later save still names the route.
    run.nodeMap = { ...startedRun(gameData).nodeMap };
    run.rite = null;
    run.battleConfigsByNodeId = {};
    expect(ids(run.toJSON())).toEqual([]);
    expect(run.toJSON().requiresCapabilities).toContain('descent');
    // ...and across a load.
    const loaded = RunManager.fromJSON(run.toJSON(), descentData);
    expect(loaded.toJSON().requiresCapabilities).toContain('descent');
  });

  it('a new run drops the old floor first, so a run that opens in the Descent keeps its own', () => {
    // A rung whose only act is the Descent (no shipped rung is; this pins the order in startRun).
    const data = structuredClone(descentData);
    data.difficulty.modes.hard.actsIncluded = ['finalBoss'];
    const run = startedRun(data, { difficultyId: 'hard' });
    expect(run.currentAct).toBe('finalBoss');
    expect(run.nodeMap.descent).toBeTruthy();
    expect(run.requiredCapabilityFloor).toEqual(['descent']);
    // And the next run on the same manager starts clean.
    run.startRun({ runSeed: 78, difficultyId: 'normal' });
    expect(run.currentAct).toBe('act1');
    expect(run.requiredCapabilityFloor).toEqual([]);
  });
});

// One planted mechanic per row, on a plain run's save: where it is found and the one capability
// it holds (a row that also raised another id would mean a detector reads too much).
const vigilConfig = (run) => {
  const params = {
    ...run.getBattleParams(battleNodeOf(run)),
    setPiece: 'the_vigil',
    objective: 'rout',
  };
  applyGenerationFields(params, { deployCount: 6, isBoss: false });
  return generateSeededBattle(params, gameData, 5);
};
const battleNodeOf = (run) => run.nodeMap.nodes.find((n) => n.type === 'battle' && n.battleParams);
const config = (extra = {}) => ({ objective: 'rout', enemySpawns: [], ...extra });
const state = (extra = {}) => ({ playerUnits: [], enemyUnits: [], ...extra });
const VIGIL_MODEL = {
  version: 1,
  primary: [
    {
      id: 'voices',
      kind: 'defeat',
      targets: ['voice_calling', 'voice_binding', 'voice_feeding', 'voice_waking'],
      label: 'the Voices',
    },
  ],
};

const DETECTION_ROWS = [
  // descent: the route map, its stamped nodes (done or not), a route boss's params
  ['a Descent route map', 'descent', { nodeMap: { descent: { v: 1, routeId: 'entity', finale: 'entity' } } }], // prettier-ignore
  ['an authored node', 'descent', { node: { authored: 'descent' } }],
  ['an authored node already done', 'descent', { node: { authored: 'descent', completed: true } }], // prettier-ignore
  ['a node’s route key', 'descent', { node: { descentKey: 'stair' } }],
  ['a node’s event pool', 'descent', { node: { eventPool: 'descent' } }],
  ['a fallable node', 'descent', { node: { fallable: true } }],
  ['a Rite target node', 'descent', { node: { riteTarget: true } }],
  ['a boss seated by name', 'descent', { params: { bossName: 'The Lieutenant' } }],
  ['a boss role', 'descent', { params: { bossRole: 'gate' } }],
  ['a boss role on the battle in progress', 'descent', { flagParams: { bossRole: 'finale' } }],
  // rite
  ['the run’s Rite', 'rite', { run: { rite: { v: 1, words: 3, start: 3, log: [] } } }],
  ['a Rite of a version this build never wrote', 'rite', { run: { rite: { v: 2 } } }],
  ['the Rite at entry', 'rite', { params: { riteAtEntry: 3 } }],
  ['the Rite’s tier', 'rite', { params: { riteBand: 'spoken' } }],
  ['the Hollowed level rule', 'rite', { params: { riteLevel: { perWordLevel: 4, levelCap: 4 } } }], // prettier-ignore
  ['the tier’s mods', 'rite', { params: { riteMods: { revivalStones: 1 } } }],
  ['the Rite on the battle in progress', 'rite', { flagParams: { riteAtEntry: 0 } }],
  ['a map the Rite changed', 'rite', { config: config({ riteMods: { band: 'answered' } }) }],
  ['the Entity’s splash count', 'rite', { config: config({ entitySplashCount: 3 }) }],
  // vigil
  ['a locked Vigil', 'vigil', { config: config({ vigil: { sigils: [], circles: [] } }) }],
  ['a checkpoint’s Vigil count', 'vigil', { state: state({ vigilState: midVigilCheckpoint().vigilState }) }], // prettier-ignore
  ['a Vision snapshot’s Vigil count', 'vigil', { state: state({ visionSnapshot: state({ vigilState: { words: 1 } }) }) }], // prettier-ignore
  ['the pending Vision snapshot’s', 'vigil', { state: state({ pendingVisionSnapshot: state({ vigilState: { words: 0 } }) }) }], // prettier-ignore
  // defeatObjective: the model this build plays, on a locked map or a node's params
  ['a defeat of @boss on a node', 'defeatObjective', { params: { objectives: structuredClone(DEFEAT_BOSS_OBJECTIVES) } }], // prettier-ignore
  ['a defeat of @boss locked', 'defeatObjective', { config: config({ objectives: structuredClone(DEFEAT_BOSS_OBJECTIVES) }) }], // prettier-ignore
  ['the Voices (named targets, a label)', 'defeatObjective', { config: config({ objectives: VIGIL_MODEL }) }], // prettier-ignore
  ['two defeat primaries, one needing one of two', 'defeatObjective', { config: config({ objectives: { version: 1, primary: [{ id: 'a', kind: 'defeat', targets: ['x', 'y'], need: 1 }, { id: 'b', kind: 'defeat', targets: ['@boss'] }] } }) }], // prettier-ignore
  // ...and a model it cannot play stays `objectives`, never the defeat id
  ['a defeat model with phases', 'objectives', { config: config({ objectives: { ...VIGIL_MODEL, phases: [{}] } }) }], // prettier-ignore
  ['a defeat model of a later version', 'objectives', { config: config({ objectives: { ...VIGIL_MODEL, version: 2 } }) }], // prettier-ignore
  ['a defeat beside another kind', 'objectives', { config: config({ objectives: { version: 1, primary: [VIGIL_MODEL.primary[0], { id: 'flee', kind: 'escape' }] } }) }], // prettier-ignore
  ['a defeat with a key this build never reads', 'objectives', { config: config({ objectives: { version: 1, primary: [{ ...VIGIL_MODEL.primary[0], phase: 1 }] } }) }], // prettier-ignore
  ['a defeat naming no target', 'objectives', { config: config({ objectives: { version: 1, primary: [{ id: 'a', kind: 'defeat', targets: [] }] } }) }], // prettier-ignore
];

/** A plain run's save holding `planted` in its place. */
function plant(base, planted) {
  const saved = structuredClone(base);
  const node = battleNodeOf(saved);
  if (planted.nodeMap) Object.assign(saved.nodeMap, planted.nodeMap);
  if (planted.node) Object.assign(node, planted.node);
  if (planted.params) Object.assign(node.battleParams, planted.params);
  if (planted.config) saved.battleConfigsByNodeId = { [node.id]: planted.config };
  if (planted.state || planted.flagParams)
    saved.battleInProgress = {
      nodeId: node.id,
      battleParams: { ...(planted.flagParams || {}) },
      checkpoint: planted.state || state(),
    };
  if (planted.run) Object.assign(saved, structuredClone(planted.run));
  return saved;
}

describe('detection: each Descent mechanic holds its capability and no other', () => {
  const base = startedRun(gameData, { difficultyId: 'hard' }).toJSON();

  it('the plain run holds none', () => {
    expect(ids(base)).toEqual([]);
    expect(base.rite).toBeNull();
  });

  it.each(DETECTION_ROWS)('%s', (_label, id, planted) => {
    expect(ids(plant(base, planted))).toEqual([id]);
  });

  it('a rewind timeline destination’s Vigil count, full or as a patch on its keyframe', () => {
    const keyframe = state({ turnNumber: 1 });
    const later = state({ turnNumber: 2, vigilState: midVigilCheckpoint().vigilState });
    const saved = plant(base, { state: state() });
    saved.battleInProgress.timeline = {
      snapshots: { a: keyframe, b: { base: 'a', patch: diffBattleState(keyframe, later) } },
    };
    expect(ids(saved)).toEqual(['vigil']);
  });

  it('a finished node’s Rite params are history; its route stamps are not', () => {
    const saved = plant(base, { params: { riteAtEntry: 2 } });
    battleNodeOf(saved).completed = true;
    expect(ids(saved)).toEqual([]);
    battleNodeOf(saved).authored = 'descent';
    expect(ids(saved)).toEqual(['descent']);
  });

  it('an event set piece with the defeat model, outside Act V: a real map, locked on Act II', () => {
    const run = startedRun(gameData, { difficultyId: 'hard', seed: 31 });
    run.advanceAct();
    const node = battleNodeOf(run);
    const locked = vigilConfig(run);
    // The Vigil's piece fought on Act II carries both its model and its circles.
    expect(locked.objectives).toEqual(VIGIL_MODEL);
    run.lockBattleConfig(node.id, locked);
    const saved = run.toJSON();
    expect(saved.nodeMap).not.toHaveProperty('descent');
    expect(saved.requiresCapabilities).toEqual(['vigil', 'defeatObjective']);
    expect(olderClientBlock(saved)?.missing).toEqual(['vigil', 'defeatObjective']);
    // A seize piece fought as a defeat of its boss (the gate's rule) holds the model alone.
    const params = {
      ...run.getBattleParams(node),
      setPiece: 'the_glass',
      objective: 'rout',
      objectives: structuredClone(DEFEAT_BOSS_OBJECTIVES),
    };
    applyGenerationFields(params, { deployCount: 6, isBoss: false });
    const glass = generateSeededBattle(params, gameData, 7);
    expect(glass.objectives).toEqual(DEFEAT_BOSS_OBJECTIVES);
    expect(glass).not.toHaveProperty('vigil');
    run.battleConfigsByNodeId = {};
    run.requiredCapabilityFloor = [];
    run.lockBattleConfig(node.id, glass);
    expect(run.toJSON().requiresCapabilities).toEqual(['defeatObjective']);
  });
});

describe('no false refusal', () => {
  it.each(['normal', 'dusk', 'hard', 'lunatic'])(
    '%s: a run walked to the Descent’s door with it switched on stays unmarked',
    (difficultyId) => {
      const run = startedRun(descentData, { difficultyId, seed: 5 });
      const finalAct = run.actSequence.indexOf('finalBoss');
      while (run.actIndex < finalAct - 1) {
        run.advanceAct();
        const saved = run.toJSON();
        expect(saved, run.currentAct).not.toHaveProperty('requiresCapabilities');
        expect(runFormatBlock(saved, GUARD_ONLY), run.currentAct).toBeNull();
      }
    },
  );

  it('the final act built with the Descent off (today’s 2-node map) is format 1', () => {
    const run = descentEntryRun(gameData, { difficultyId: 'hard' });
    expect(run.currentAct).toBe('finalBoss');
    expect(run.nodeMap).not.toHaveProperty('descent');
    expect(run.rite).toBeNull();
    const saved = run.toJSON();
    expect(saved).not.toHaveProperty('requiresCapabilities');
    expect(runFormatBlock(saved, GUARD_ONLY)).toBeNull();
    // ...and a build with the Descent on loads it as it was: no rebuilt route, no marker.
    const loaded = RunManager.fromJSON(structuredClone(saved), descentData);
    expect(loaded.nodeMap).toEqual(run.nodeMap);
    expect(loaded.toJSON()).not.toHaveProperty('requiresCapabilities');
  });

  it('a battle in progress on an ordinary map: its params, map and checkpoint hold nothing', () => {
    const run = startedRun(descentData, { difficultyId: 'lunatic', seed: 12 });
    const node = battleNodeOf(run);
    const params = applyGenerationFields(run.getBattleParams(node), { deployCount: 4 });
    run.lockBattleConfig(node.id, generateSeededBattle(params, gameData, params.battleSeed));
    run.beginBattleInProgress(node.id, { battleParams: params });
    run.battleInProgress.checkpoint = state({ turnNumber: 2 });
    const saved = run.toJSON();
    expect(ids(saved)).toEqual([]);
    expect(saved).not.toHaveProperty('requiresCapabilities');
    expect(runFormatBlock(saved, GUARD_ONLY)).toBeNull();
  });
});

describe('an old save with none of these loads unchanged', () => {
  it('a save from before the Rite (no `rite` key) loads, writes nothing, and stays unmarked', () => {
    const run = startedRun(gameData, { difficultyId: 'dusk', seed: 4 });
    run.advanceAct();
    const old = run.toJSON();
    delete old.rite;
    expect(storedRunFormat(old)).toEqual({ format: 1, capabilities: [] });
    expect(ids(old)).toEqual([]);
    const raw = JSON.stringify(old);
    store.set(getRunKey(1), raw);
    writes = 0;
    const loaded = loadRun(descentData, 1);
    expect(loaded).toBeInstanceOf(RunManager);
    expect(writes).toBe(0);
    expect(store.get(getRunKey(1))).toBe(raw);
    expect(loaded.rite).toBeNull();
    expect(loaded.requiredCapabilityFloor).toEqual([]);
    const again = loaded.toJSON();
    expect(again).not.toHaveProperty('requiresClient');
    expect(again).not.toHaveProperty('requiresCapabilities');
    // It loads exactly as the same save with no Rite (`rite: null`) does: the missing key reads
    // as none, and nothing else is touched by the Descent's fields.
    const current = RunManager.fromJSON({ ...structuredClone(old), rite: null }, descentData);
    expect(again).toEqual(current.toJSON());
  });
});
