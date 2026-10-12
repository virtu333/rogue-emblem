// BattleObjectives (engine/BattleObjectives.js): the objectives model's first kind, `defeat`
// (docs/specs/act-v-descent.md §9.4, large-maps 03 §5.4). One predicate, read by
// BattleScene.checkBattleEnd and the harness's _checkBattleEnd alike.
//
// Ways this goes wrong:
//   - a defeat map is won while a target still stands, or only once every foe is down (a rout);
//   - a target holding a Revival Stone counts as fallen when a bar breaks;
//   - `need` or '@boss' are read wrongly (a dead boss among several, a map with no boss);
//   - a model this build cannot play (a newer version or kind) is half-read instead of played
//     as its legacy string, or a legacy map is read as a model;
//   - the scene and the harness disagree on the same field, or victory beats the army's defeat;
//   - victory is taken in the middle of the enemy phase instead of at its end;
//   - par reads the legacy rout for a defeat map, or nothing at all when the kind is unlisted;
//   - the victory band says ROUTED for a defeat map, or the felled band shows before SLAIN.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import {
  BOSS_REF,
  evaluateObjectives,
  legacyObjectiveKind,
  objectiveKindOf,
  objectivesOf,
  objectivesShapeErrors,
  remainingObjectiveTargets,
  remainingTargets,
  statusView,
} from '../src/engine/BattleObjectives.js';
import { calculatePar, battleParMapParams } from '../src/engine/TurnBonusCalculator.js';
import { objectiveWord, shouldShowFelled, victoryContent } from '../src/ui/ceremonyContent.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { PostCombatController } from '../src/ui/PostCombatController.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

const voices = {
  version: 1,
  primary: [
    {
      id: 'voices',
      kind: 'defeat',
      targets: ['voice_a', 'voice_b', 'voice_c'],
      label: 'the Voices',
    },
  ],
};
const voice = (id, name) => ({ authoredId: id, name, currentHP: 10, faction: 'enemy' });
const guard = (name = 'Guard') => ({ name, currentHP: 20, faction: 'enemy' });
const boss = (name = 'The Lieutenant') => ({ name, isBoss: true, currentHP: 40, faction: 'enemy' });

describe('the model and its legacy string', () => {
  it('a defeat model plays; its legacy family is rout', () => {
    const config = { objective: 'rout', objectives: voices };
    expect(objectivesOf(config)).toBe(voices);
    expect(legacyObjectiveKind(voices)).toBe('rout');
    expect(objectiveKindOf(config)).toBe('defeat');
  });

  it('a legacy map has no model and is played as its string', () => {
    for (const objective of ['rout', 'seize', 'escape']) {
      expect(objectivesOf({ objective })).toBeNull();
      expect(objectiveKindOf({ objective })).toBe(objective);
    }
  });

  it("a model this build can't play (a newer version or kind) falls back to the legacy string", () => {
    const newer = { ...voices, version: 2 };
    const escort = { version: 1, primary: [{ id: 'e', kind: 'escort', targets: ['x'] }] };
    expect(objectivesOf({ objective: 'rout', objectives: newer })).toBeNull();
    expect(objectivesOf({ objective: 'escape', objectives: escort })).toBeNull();
    expect(objectiveKindOf({ objective: 'escape', objectives: escort })).toBe('escape');
  });

  it.each([
    ['no primary', { version: 1, primary: [] }, /non-empty/],
    ['an empty target list', { version: 1, primary: [{ id: 'a', kind: 'defeat', targets: [] }] }, /at least one target/], // prettier-ignore
    ['a target twice', { version: 1, primary: [{ id: 'a', kind: 'defeat', targets: ['x', 'x'] }] }, /twice/], // prettier-ignore
    ['need past the targets', { version: 1, primary: [{ id: 'a', kind: 'defeat', targets: ['x'], need: 2 }] }, /need/], // prettier-ignore
    ['a bad id', { version: 1, primary: [{ id: 'A b', kind: 'defeat', targets: ['x'] }] }, /id must/], // prettier-ignore
    ['two objectives with one id', { version: 1, primary: [{ id: 'a', kind: 'defeat', targets: ['x'] }, { id: 'a', kind: 'defeat', targets: ['y'] }] }, /used twice/], // prettier-ignore
  ])('refuses %s', (_label, model, pattern) => {
    expect(objectivesShapeErrors(model).join('\n')).toMatch(pattern);
  });
});

describe('evaluateObjectives: defeat', () => {
  it('is won when the last target falls, with other foes still standing, and not before', () => {
    const a = voice('voice_a', 'Calling');
    const b = voice('voice_b', 'Binding');
    const c = voice('voice_c', 'Waking');
    const others = [guard('Warden'), guard('Blade')];
    expect(evaluateObjectives(voices, { enemyUnits: [a, b, c, ...others] }).outcome).toBeNull();
    expect(evaluateObjectives(voices, { enemyUnits: [b, c, ...others] }).outcome).toBeNull();
    expect(evaluateObjectives(voices, { enemyUnits: [c, ...others] }).outcome).toBeNull();
    const won = evaluateObjectives(voices, { enemyUnits: others });
    expect(won.outcome).toBe('victory');
    expect(won.primary[0]).toMatchObject({ slain: 3, need: 3, total: 3, done: true });
  });

  it('a target is down only while it is off the field: a stone-refilled bar is still standing', () => {
    // UnitHealth.absorbLethal refills the bar and the unit never leaves enemyUnits.
    const held = { ...voice('voice_a', 'Calling'), revivalStones: 0, revivalStonesMax: 1 };
    const field = { enemyUnits: [held] };
    expect(remainingTargets(voices.primary[0], field).map((t) => t.ref)).toEqual(['voice_a']);
  });

  it('`need` wins with that many down', () => {
    const model = { version: 1, primary: [{ ...voices.primary[0], need: 2 }] };
    const c = voice('voice_c', 'Waking');
    expect(evaluateObjectives(model, { enemyUnits: [voice('voice_b'), c] }).outcome).toBeNull();
    expect(evaluateObjectives(model, { enemyUnits: [c] }).outcome).toBe('victory');
  });

  it("'@boss' is every living boss: down when the last one is", () => {
    const model = { version: 1, primary: [{ id: 'gate', kind: 'defeat', targets: [BOSS_REF] }] };
    const one = boss('One');
    const two = boss('Two');
    expect(evaluateObjectives(model, { enemyUnits: [one, two, guard()] }).outcome).toBeNull();
    expect(evaluateObjectives(model, { enemyUnits: [two, guard()] }).outcome).toBeNull();
    expect(evaluateObjectives(model, { enemyUnits: [guard()] }).outcome).toBe('victory');
  });

  it('every primary must be done (AND)', () => {
    const model = {
      version: 1,
      primary: [
        { id: 'a', kind: 'defeat', targets: ['voice_a'] },
        { id: 'b', kind: 'defeat', targets: [BOSS_REF] },
      ],
    };
    expect(evaluateObjectives(model, { enemyUnits: [boss()] }).outcome).toBeNull();
    expect(evaluateObjectives(model, { enemyUnits: [voice('voice_a')] }).outcome).toBeNull();
    expect(evaluateObjectives(model, { enemyUnits: [] }).outcome).toBe('victory');
    expect(remainingObjectiveTargets({ objectives: model }, { enemyUnits: [boss()] })).toBe(1);
  });
});

describe('statusView: the strip words', () => {
  it('several targets: the label and the count; one target: its name', () => {
    const field = { enemyUnits: [voice('voice_b', 'Binding'), voice('voice_c', 'Waking')] };
    expect(statusView(voices, field).primary[0]).toMatchObject({
      compact: 'Defeat · the Voices (1/3)',
      text: 'Defeat the Voices. The rest need not fall.',
      tone: 'open',
      remaining: ['voice_b', 'voice_c'],
    });
    const gate = { version: 1, primary: [{ id: 'gate', kind: 'defeat', targets: [BOSS_REF] }] };
    expect(statusView(gate, { enemyUnits: [boss('Varro')] }).primary[0].compact).toBe(
      'Defeat · Varro',
    );
    // Fallen, the name comes from the config's spawns.
    const spawns = [{ isBoss: true, name: 'Varro' }];
    expect(statusView(gate, { enemyUnits: [], spawns }).primary[0]).toMatchObject({
      compact: 'Defeat · Varro',
      tone: 'good',
    });
    const unlabelled = { version: 1, primary: [{ ...voices.primary[0], label: undefined }] };
    expect(statusView(unlabelled, { enemyUnits: [] }).primary[0].compact).toBe(
      'Defeat · the targets (3/3)',
    );
  });
});

describe('par and words read the kind', () => {
  const plain = data.terrain.findIndex((t) => t.name === 'Plain');
  const map = {
    cols: 10,
    rows: 10,
    mapLayout: Array.from({ length: 10 }, () => Array(10).fill(plain)),
  };

  it("a defeat map is par'd from turnBonus.json's defeat entry (base 4, adjustment 1)", () => {
    const tb = data.turnBonus;
    expect(tb.objectiveBasePar.defeat).toBe(4);
    expect(tb.objectiveAdjustments.defeat).toBe(1);
    const enemyCount = 9;
    const params = (config) =>
      battleParMapParams(config, { enemyCount, terrainData: data.terrain });
    const defeat = calculatePar(params({ ...map, objective: 'rout', objectives: voices }), tb);
    const rout = calculatePar(params({ ...map, objective: 'rout' }), tb);
    // Independently: ceil((base + min(0.6n, 1.3 sqrt n) + 0.01 area + adj) * 0.8) + inflation.
    const enemies = Math.min(0.6 * enemyCount, 1.3 * Math.sqrt(enemyCount));
    const expected = (base, adj) =>
      Math.ceil((base + enemies + 100 * 0.01 + adj) * 0.8) + tb.parInflation;
    expect(defeat).toBe(expected(4, 1));
    expect(rout).toBe(expected(2, 0));
    expect(defeat).toBeGreaterThan(rout);
  });

  it('a kind turnBonus.json does not list falls back to the legacy string', () => {
    const tb = structuredClone(data.turnBonus);
    delete tb.objectiveBasePar.defeat;
    const params = battleParMapParams(
      { ...map, objective: 'rout', objectives: voices },
      { enemyCount: 4, terrainData: data.terrain },
    );
    expect(calculatePar(params, tb)).toBe(
      calculatePar({ ...params, objective: 'rout', legacyObjective: null }, tb),
    );
  });

  it('the victory word is SLAIN; the felled band shows only while targets remain', () => {
    const config = { objective: 'rout', objectives: voices };
    expect(objectiveWord(objectiveKindOf(config))).toBe('SLAIN');
    expect(victoryContent({ objective: objectiveKindOf(config), turn: 5 }).word).toBe('SLAIN');
    expect(objectiveWord('rout')).toBe('ROUTED');
    // The boss falls with foes standing: a rout says so, a defeat map with no target left wins.
    expect(shouldShowFelled({ objective: 'defeat', remaining: 3, remainingTargets: 0 })).toBe(
      false,
    );
    expect(shouldShowFelled({ objective: 'defeat', remaining: 3, remainingTargets: 1 })).toBe(true);
    expect(shouldShowFelled({ objective: 'rout', remaining: 3 })).toBe(true);
  });

  it("the victory band's context names the kind the battle was played as", () => {
    const band = (battleConfig) =>
      new PostCombatController({
        battleConfig,
        turnManager: { turnNumber: 4 },
      }).victoryBandContext().objective;
    expect(band({ objective: 'rout', objectives: voices })).toBe('defeat');
    expect(band({ objective: 'rout' })).toBe('rout');
    expect(band({ objective: 'seize' })).toBe('seize');
  });
});

// --- BattleScene.checkBattleEnd and HeadlessBattle._checkBattleEnd agree -------------------

const edric = () => ({
  name: 'Edric',
  isCommander: true,
  isLord: true,
  currentHP: 20,
  faction: 'player',
});

function sceneWith(state) {
  return Object.assign(Object.create(BattleScene.prototype), {
    battleState: 'PLAYER_IDLE',
    battleParams: {},
    gameData: data,
    npcUnits: [],
    escapedUnits: [],
    _zombieTombstones: [],
    _reinforcementsPendingThisTurn: false,
    onVictory: vi.fn(),
    onDefeat: vi.fn(),
    showLordDeathVisionPrompt: vi.fn(() => false),
    ...state,
  });
}

function harnessWith(state) {
  return Object.assign(Object.create(HeadlessBattle.prototype), {
    battleState: 'PLAYER_IDLE',
    battleParams: {},
    gameData: data,
    npcUnits: [],
    escapedUnits: [],
    _zombieTombstones: [],
    _reinforcementsPendingThisTurn: false,
    _onVictory: vi.fn(),
    _onDefeat: vi.fn(),
    ...state,
  });
}

describe('scene and harness agree on a defeat map', () => {
  const config = { objective: 'rout', objectives: voices, enemySpawns: [] };
  const a = () => voice('voice_a', 'Calling');
  const b = () => voice('voice_b', 'Binding');
  const c = () => voice('voice_c', 'Waking');
  const cases = [
    { label: 'all three stand', enemies: [a(), b(), c(), guard()], expect: 'none' },
    { label: 'one stands', enemies: [c(), guard(), guard()], expect: 'none' },
    { label: 'the last fell, guards stand', enemies: [guard(), guard()], expect: 'victory' },
    {
      label: 'the last fell inside the enemy phase',
      enemies: [guard()],
      pending: true,
      expect: 'none',
    },
    { label: 'the commander fell as the last target did', enemies: [], noCommander: true, expect: 'defeat' }, // prettier-ignore
    { label: 'a rout map with targets gone but foes standing', enemies: [guard()], legacy: true, expect: 'none' }, // prettier-ignore
  ];

  for (const testCase of cases) {
    it(testCase.label, () => {
      const players = testCase.noCommander ? [{ ...edric(), isCommander: false }] : [edric()];
      const battleConfig = testCase.legacy ? { objective: 'rout' } : config;
      const shared = {
        battleConfig,
        _reinforcementsPendingThisTurn: Boolean(testCase.pending),
      };
      const scene = sceneWith({
        ...shared,
        playerUnits: structuredClone(players),
        enemyUnits: structuredClone(testCase.enemies),
      });
      const harness = harnessWith({
        ...shared,
        playerUnits: structuredClone(players),
        enemyUnits: structuredClone(testCase.enemies),
      });
      const sceneEnded = scene.checkBattleEnd();
      const harnessEnded = harness._checkBattleEnd();
      const outcome = (victory, defeat) =>
        victory.mock.calls.length ? 'victory' : defeat.mock.calls.length ? 'defeat' : 'none';
      const sceneOutcome = outcome(scene.onVictory, scene.onDefeat);
      expect(sceneOutcome).toBe(testCase.expect);
      expect(outcome(harness._onVictory, harness._onDefeat)).toBe(sceneOutcome);
      expect(harnessEnded).toBe(sceneEnded);
      expect(scene.onVictory.mock.calls.length + scene.onDefeat.mock.calls.length).toBeLessThanOrEqual(1); // prettier-ignore
    });
  }
});
