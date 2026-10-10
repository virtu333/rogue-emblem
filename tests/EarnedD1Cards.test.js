// PR D1's six earned blessings at work (docs/specs/blessings-v3.md §6.1): Standard of the Sun,
// Hollow Hourglass, Chronicle, Tithe Box (tests/OldSanctum.test.js), Lantern of the Road and Crest
// of the Road. Each card reaches its system through one shared engine path (BlessingCombatMods,
// ReinforcementSpawns, getXpMultiplierDelta, FogOpening, getEffectiveMetaEffects), so the scene
// and the headless harness cannot disagree.
//
// Each test names the realistic failure it catches.
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

import fs from 'node:fs';
import './harness/JourneyTestSetup.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { HeadlessGrid } from './harness/HeadlessGrid.js';
import { presentationFailureProxy as rendering } from './harness/PresentationFailureProxy.js';
import { blessingCombatModsFor, commanderAuraBonus } from '../src/engine/BlessingCombatMods.js';
import { RunManager } from '../src/engine/RunManager.js';
import { resolveBattleReinforcements } from '../src/engine/ReinforcementSpawns.js';
import { routLadderStatus } from '../src/engine/RoutLadder.js';
import { applyFogOpening, openingRevealTiles } from '../src/engine/FogOpening.js';
import { gridFogState, applyGridFogState } from '../src/ui/fogState.js';
import { buildRecruitNodeUnit } from '../src/engine/RecruitNodeSystem.js';
import { prepareBossRecruit } from '../src/engine/PendingBossRecruit.js';
import { generateMercenaryCandidates } from '../src/engine/ColosseumEngine.js';
import { chooseEventOption } from '../src/engine/EventCommands.js';
import { arriveAs, runWithEvents, soloEvent } from './eventKit.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const realRandom = Math.random;
afterEach(() => {
  Math.random = realRandom;
  vi.restoreAllMocks();
});

function runHolding(ids, { seed = 7, difficultyId = 'normal' } = {}) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false });
  for (const id of ids) expect(rm.addBlessingMidRun(id, { earned: true }), id).toBe(true);
  return rm;
}
const roundTrip = (rm) => RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), rm.gameData);

// ── Standard of the Sun ────────────────────────────────────────────────────

describe('Standard of the Sun: +5 Hit and +5 Avoid within 2 tiles of the commander', () => {
  const body = { HP: 40, STR: 10, MAG: 0, SKL: 10, SPD: 10, DEF: 6, RES: 3, LCK: 5, MOV: 5 };
  const sword = () => ({
    name: 'Test Blade',
    type: 'Sword',
    might: 8,
    hit: 80,
    crit: 0,
    weight: 5,
    range: '1',
    special: '',
  });
  const makeUnit = (name, faction, col, row, extra = {}) => {
    const weapon = sword();
    return {
      name,
      level: 5,
      tier: 'base',
      faction,
      col,
      row,
      xp: 0,
      currentHP: 40,
      stats: { ...body },
      moveType: 'Infantry',
      className: 'Myrmidon',
      growths: {},
      weaponRank: 'Prof',
      weapon,
      inventory: [weapon],
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
      accessory: null,
      affixes: [],
      ...extra,
    };
  };
  const AURA = [{ radius: 2, hitBonus: 5, avoidBonus: 5 }];

  it('pays a unit 2 tiles off (a diagonal step counts: Manhattan), never at 3', () => {
    // Failure: the distance is Chebyshev or off by one (a diagonal at 2 missed, a tile at 3 paid).
    const edric = makeUnit('Edric', 'player', 3, 3, { isCommander: true });
    const near = makeUnit('Near', 'player', 4, 4); // diagonal: Manhattan 2
    const far = makeUnit('Far', 'player', 5, 4); // Manhattan 3
    const allies = [edric, near, far];
    expect(commanderAuraBonus(AURA, near, allies)).toEqual({ hitBonus: 5, avoidBonus: 5 });
    expect(commanderAuraBonus(AURA, far, allies)).toEqual({ hitBonus: 0, avoidBonus: 0 });
  });

  it('never the commander itself, a fallen commander, an NPC or a foe', () => {
    // Failure: the commander buffs itself, a fallen commander still lifts the line, or the
    // banner reaches a green ally or a foe beside him.
    const edric = makeUnit('Edric', 'player', 3, 3, { isCommander: true });
    const near = makeUnit('Near', 'player', 3, 4);
    const allies = [edric, near];
    expect(commanderAuraBonus(AURA, edric, allies)).toEqual({ hitBonus: 0, avoidBonus: 0 });
    const profile = { commanderAuras: AURA };
    const npc = makeUnit('Green', 'npc', 3, 2);
    expect(blessingCombatModsFor(profile, { unit: npc, allies: [npc] }).hitBonus).toBe(0);
    const foe = makeUnit('Foe', 'enemy', 4, 3);
    expect(blessingCombatModsFor(profile, { unit: foe, allies: [foe] }).hitBonus).toBe(0);
    edric.currentHP = 0;
    expect(commanderAuraBonus(AURA, near, allies)).toEqual({ hitBonus: 0, avoidBonus: 0 });
  });

  it("follows the flagged commander only: once Sera (commanding) escapes, Edric's side has no banner", () => {
    // Failure: the aura finds its commander by Edric's name when no unit carries the flag (the
    // commander escaped the map), so Edric, not commanding, lifts the line in her place.
    const sera = makeUnit('Sera', 'player', 0, 0, { isCommander: true });
    const edric = makeUnit('Edric', 'player', 3, 3, { isCommander: false });
    const near = makeUnit('Near', 'player', 3, 4);
    expect(commanderAuraBonus(AURA, near, [sera, edric, near])).toEqual({
      hitBonus: 0,
      avoidBonus: 0,
    });
    const seraNear = makeUnit('Sera', 'player', 3, 5, { isCommander: true });
    expect(commanderAuraBonus(AURA, near, [seraNear, edric, near])).toEqual({
      hitBonus: 5,
      avoidBonus: 5,
    });
    // Sera escaped: she is off the field, so no unit on it carries the flag.
    expect(commanderAuraBonus(AURA, near, [edric, near])).toEqual({ hitBonus: 0, avoidBonus: 0 });
    expect(
      blessingCombatModsFor({ commanderAuras: AURA }, { unit: near, allies: [edric, near] }),
    ).toMatchObject({ hitBonus: 0, avoidBonus: 0 });
  });

  it('the run records it and a save keeps it; a run without it holds none', () => {
    // Failure: the boon is lost on load (the aura vanishes after a refresh).
    const rm = runHolding(['standard_of_the_sun']);
    expect(rm.getBlessingCombatProfile().commanderAuras).toEqual(AURA);
    expect(roundTrip(rm).getBlessingCombatProfile().commanderAuras).toEqual(AURA);
    expect(runHolding([]).getBlessingCombatProfile().commanderAuras).toEqual([]);
  });

  function sceneCtx(run, units) {
    const scene = journeyBattleScene(run, data);
    scene.runManager = run;
    Math.random = () => 0.5;
    Object.assign(scene.grid, {
      fogEnabled: false,
      getMoveCost: () => 1,
      getTerrainAt: () => data.terrain.find((t) => t.name === 'Plain'),
    });
    scene.playerUnits = units.filter((u) => u.faction === 'player');
    scene.enemyUnits = units.filter((u) => u.faction === 'enemy');
    scene.npcUnits = units.filter((u) => u.faction === 'npc');
    rendering(scene, 0);
    return (a, d) => scene.buildSkillCtx(a, d);
  }
  function harnessCtx(run, units) {
    const battle = new HeadlessBattle(structuredClone(data), { act: 'act1', objective: 'rout' });
    battle.turnManager = { turnNumber: 1 };
    battle.runManager = run;
    battle.playerUnits = units.filter((u) => u.faction === 'player');
    battle.enemyUnits = units.filter((u) => u.faction === 'enemy');
    battle.npcUnits = units.filter((u) => u.faction === 'npc');
    battle.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      getTerrainAt: () => ({ name: 'Plain' }),
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    return (a, d) => battle._buildSkillCtx(a, d);
  }

  for (const [label, build] of [
    ['the scene', sceneCtx],
    ['the harness', harnessCtx],
  ]) {
    it(`${label}: an ally beside the commander attacks and defends with +5 Hit and +5 Avoid`, () => {
      // Failure: the scene and the harness read the aura differently (one forgets it).
      const edric = makeUnit('Edric', 'player', 3, 3, { isCommander: true });
      const ally = makeUnit('Ally', 'player', 3, 4);
      const foe = makeUnit('Foe', 'enemy', 4, 4);
      const units = [edric, ally, foe];
      const run = runHolding(['standard_of_the_sun']);
      const out = build(run, units)(ally, foe);
      expect([out.atkMods.hitBonus, out.atkMods.avoidBonus]).toEqual([5, 5]);
      expect([out.defMods.hitBonus, out.defMods.avoidBonus]).toEqual([0, 0]);
      const back = build(run, units)(foe, ally);
      expect([back.defMods.hitBonus, back.defMods.avoidBonus]).toEqual([5, 5]);
      const plain = build(runHolding([]), units)(ally, foe);
      expect([plain.atkMods.hitBonus, plain.atkMods.avoidBonus]).toEqual([0, 0]);
    });
  }
});

// ── Hollow Hourglass ───────────────────────────────────────────────────────

describe('Hollow Hourglass: every reinforcement a turn later', () => {
  const W = 10;
  const plainIndex = data.terrain.findIndex((t) => t.name === 'Plain');
  const config = (reinforcements) => ({
    mapLayout: Array.from({ length: W }, () => Array(W).fill(plainIndex)),
    reinforcements,
  });
  const dueTurns = (battleConfig, battleParams) => {
    const turns = new Map();
    for (let turn = 1; turn <= 9; turn++) {
      const result = resolveBattleReinforcements({
        turn,
        seed: 11,
        battleConfig,
        battleParams,
        gameData: data,
        templates: [{ className: 'Fighter' }],
        playerUnits: [{ col: 5, row: 5, faction: 'player' }],
      });
      for (const wave of result.dueWaves || []) {
        const kind = wave.waveType;
        if (!turns.has(kind)) turns.set(kind, []);
        turns.get(kind).push(turn);
      }
    }
    return Object.fromEntries(turns);
  };
  const everyKind = config({
    spawnEdges: ['top'],
    waves: [{ turn: 3, count: [1, 1] }],
    scriptedWaves: [{ turn: 4, spawns: [{ col: 0, row: 0, className: 'Fighter' }] }],
    repeatingWaves: [{ startTurn: 2, every: 3, count: [1, 1], edges: ['left'] }],
    ladder: {
      front: 'top',
      minPlayerDistance: 1,
      waves: [{ turn: 5, edge: 'top', count: [1, 1] }],
    },
    hunted: { turn: 3, count: [1, 1], edges: ['bottom'], xpMultiplier: 0.5 },
  });

  it('moves every kind of wave a turn later: template, scripted, pursuit, ladder and Hunted', () => {
    // Failure: the delay rides only the difficulty offset (which the ladder and the Hunted wave
    // ignore), or the escape pursuit arrives on time.
    const base = { difficultyId: 'normal' };
    const before = dueTurns(everyKind, base);
    expect(before).toEqual({
      procedural: [3],
      scripted: [4],
      repeating: [2, 5, 8],
      ladder: [5],
      hunted: [3],
    });
    const after = dueTurns(everyKind, { ...base, reinforcementDelay: 1 });
    expect(after).toEqual({
      procedural: [4],
      scripted: [5],
      repeating: [3, 6, 9],
      ladder: [6],
      hunted: [4],
    });
  });

  it('a wave the rung pulls to turn 1 still comes a turn later: the delay is added after the clamp', () => {
    // Failure: the delay is folded into the difficulty offset, so the turn-1 clamp swallows it
    // where Black Sun (or Nightfall's late acts) pulls a wave below turn 1 (frozen_pass on Black
    // Sun: turn 3, template offset -3, jitter -1..+1, so the first wave lands on turn 1 whatever
    // the jitter; with the Hourglass on turn 2, never turn 1).
    const all = Object.values(data.mapTemplates).filter(Array.isArray).flat();
    const frozen = all.find((t) => t.id === 'frozen_pass');
    expect(frozen.reinforcements.turnOffsetByDifficulty.lunatic).toBe(-3);
    expect(frozen.reinforcements.turnJitter).toEqual([-1, 1]);
    expect(frozen.reinforcements.waves[0].turn).toBe(3);
    const firstWaveTurn = (seed, battleParams) => {
      for (let turn = 1; turn <= 6; turn++) {
        const result = resolveBattleReinforcements({
          turn,
          seed,
          battleConfig: config(structuredClone(frozen.reinforcements)),
          battleParams,
          gameData: data,
          templates: [{ className: 'Fighter' }],
          playerUnits: [{ col: 5, row: 5, faction: 'player' }],
        });
        if ((result.dueWaves || []).some((w) => w.waveType === 'procedural' && w.waveIndex === 0))
          return turn;
      }
      return null;
    };
    for (let seed = 1; seed <= 12; seed++) {
      expect(firstWaveTurn(seed, { difficultyId: 'lunatic' }), `seed ${seed}`).toBe(1);
      expect(
        firstWaveTurn(seed, { difficultyId: 'lunatic', reinforcementDelay: 1 }),
        `seed ${seed}`,
      ).toBe(2);
    }
    // The scripted and pursuit clamps the same way: pulled to turn 1 by the rung, then delayed.
    const pulled = config({
      spawnEdges: ['top'],
      difficultyScaling: true,
      turnOffsetByDifficulty: { lunatic: -3 },
      waves: [],
      scriptedWaves: [{ turn: 2, spawns: [{ col: 0, row: 0, className: 'Fighter' }] }],
      repeatingWaves: [{ startTurn: 2, every: 3, count: [1, 1], edges: ['left'] }],
    });
    expect(dueTurns(pulled, { difficultyId: 'lunatic' })).toEqual({
      scripted: [1],
      repeating: [1, 4, 7],
    });
    expect(dueTurns(pulled, { difficultyId: 'lunatic', reinforcementDelay: 1 })).toEqual({
      scripted: [2],
      repeating: [2, 5, 8],
    });
  });

  it('the run writes the delay into the params once (saved with a battle, so a resume keeps it)', () => {
    // Failure: the delay is applied twice (params and offset both), lost on a resumed battle (the
    // saved params lack it), or a run without it gains a key.
    const rm = runHolding(['hollow_hourglass']);
    const node = rm.nodeMap.nodes.find((n) => n.type === 'battle');
    const params = rm.getBattleParams(node);
    expect(params.reinforcementDelay).toBe(1);
    expect(params.reinforcementTurnOffset).toBe(
      rm.getDifficultyModifier('reinforcementTurnOffset', 0),
    );
    rm.beginBattleInProgress(node.id, { battleParams: params });
    // The save holds the battle's own params; a resume starts from them (SlotPickerScene).
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    expect(saved.battleInProgress.battleParams.reinforcementDelay).toBe(1);
    const plain = runHolding([]).getBattleParams(node);
    expect('reinforcementDelay' in plain).toBe(false);
  });

  it("the ladder's objective line names the turn the wave now arrives", () => {
    // Failure: the line promises T5 and the wave comes on T6.
    const status = (delay, through) =>
      routLadderStatus(everyKind.reinforcements, {
        resolvedThroughTurn: through,
        turnDelay: delay,
      });
    expect(status(0, 0).next.turn).toBe(5);
    expect(status(1, 0).next.turn).toBe(6);
    expect(status(1, 5)).toMatchObject({ resolved: 0, next: { turn: 6 } });
    expect(status(1, 6)).toMatchObject({ resolved: 1, next: null });
    const scene = fs.readFileSync('src/scenes/BattleScene.js', 'utf8');
    expect(scene).toMatch(
      /routLadderStatus\([^)]*turnDelay: this\.battleParams\?\.reinforcementDelay/s,
    );
  });
});

// ── Chronicle ──────────────────────────────────────────────────────────────

describe('Chronicle: +5% XP for each act cleared', () => {
  it('counts the acts already cleared, the act it was taken in once, from the next act on', () => {
    // Failure: taken at Act II's boss it pays in Act III as one act (or as three: the take's act
    // counted twice).
    const rm = runHolding([], { difficultyId: 'dusk' });
    rm.actIndex = 1;
    expect(rm.addBlessingMidRun('chronicle', { earned: true })).toBe(true);
    expect(rm.getXpMultiplierDelta()).toBeCloseTo(0.05);
    rm.advanceAct();
    expect(rm.currentAct).toBe('act3');
    expect(rm.getXpMultiplierDelta()).toBeCloseTo(0.1);
    rm.advanceAct();
    expect(rm.getXpMultiplierDelta()).toBeCloseTo(0.15);
    expect(roundTrip(rm).getXpMultiplierDelta()).toBeCloseTo(0.15);
  });

  it('adds to the other XP blessings, and is nothing without it', () => {
    const rm = runHolding([]);
    rm.actIndex = 2;
    rm.blessingRuntimeModifiers.xpMultiplierDelta = 0.1;
    expect(rm.getXpMultiplierDelta()).toBeCloseTo(0.1);
    rm.addBlessingMidRun('chronicle', { earned: true });
    expect(rm.getXpMultiplierDelta()).toBeCloseTo(0.2);
  });

  it('the battle XP readers (scene, harness, sim driver) all take it through getXpMultiplierDelta; the arena never does', () => {
    // Failure: a reader keeps its own copy of the old delta (the sim driver's blessingXpDelta
    // diverges from the scene's), or arena bouts start paying it.
    const scene = fs.readFileSync('src/scenes/BattleScene.js', 'utf8');
    const driver = fs.readFileSync('tests/sim/RunSimulationDriver.js', 'utf8');
    expect(scene).toMatch(/blessingXpDelta: this\.runManager\?\.getXpMultiplierDelta\?\.\(\)/);
    expect(driver).toMatch(/blessingXpDelta = this\.runManager\.getXpMultiplierDelta\?\.\(\)/);
    for (const file of [
      'src/engine/ArenaBout.js',
      'src/engine/ColosseumEngine.js',
      'src/ui/ColosseumOverlay.js',
    ])
      expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(
        /getXpMultiplierDelta|xpPerActCleared/,
      );
  });
});

// ── Lantern of the Road ────────────────────────────────────────────────────

describe('Lantern of the Road: a fog map opens revealed within 4 tiles of each ally', () => {
  const plainIndex = data.terrain.findIndex((t) => t.name === 'Plain');
  const layout = (n) => Array.from({ length: n }, () => Array(n).fill(plainIndex));
  const army = [
    { name: 'A', col: 2, row: 2, currentHP: 20, moveType: 'Infantry' },
    { name: 'B', col: 3, row: 2, currentHP: 20, moveType: 'Infantry' },
  ];

  it('reveals the Manhattan diamond of radius 4 around each living unit, never beyond', () => {
    // Failure: the reveal is a square (corners at 5+), counts a fallen unit, or leaves the board.
    const tiles = openingRevealTiles(army, 4, { cols: 12, rows: 12 });
    const keys = new Set(tiles.map((t) => `${t.col},${t.row}`));
    expect(keys.has('6,2')).toBe(true); // A + 4 east
    expect(keys.has('7,2')).toBe(true); // B + 4 east
    expect(keys.has('8,2')).toBe(false); // 5 from B
    expect(keys.has('5,5')).toBe(false); // corner: Manhattan 6 from A, 5 from B
    expect([...keys].every((k) => k.split(',').every((v) => Number(v) >= 0))).toBe(true);
    const fallen = openingRevealTiles([{ ...army[0], currentHP: 0 }], 4, { cols: 12, rows: 12 });
    expect(fallen).toEqual([]);
  });

  it('shows the tiles on turn 1 only: gone when the enemy phase starts (contacts), saved with the fog', () => {
    // Failure: the reveal persists into turn 2 (permanent fog clearing), is lost on a resume, or
    // applies on a map with no fog.
    const grid = new HeadlessGrid(12, 12, data.terrain, layout(12), true);
    expect(applyFogOpening(grid, army, 4)).toBe(true);
    grid.updateFogOfWar(army);
    expect(grid.isVisible(7, 2)).toBe(true); // 4 from B: past an infantry unit's own vision
    const saved = gridFogState(grid);
    expect(saved.contacts).toContain('7,2');
    const resumed = new HeadlessGrid(12, 12, data.terrain, layout(12), true);
    resumed.fogOverlays = [];
    applyGridFogState(resumed, saved);
    expect(resumed.contactSet.has('7,2')).toBe(true);
    expect(grid.clearContacts()).toBe(true);
    grid.updateFogOfWar(army);
    expect(grid.isVisible(7, 2)).toBe(false);
    const clear = new HeadlessGrid(12, 12, data.terrain, layout(12), false);
    expect(applyFogOpening(clear, army, 4)).toBe(false);
    expect(applyFogOpening(new HeadlessGrid(12, 12, data.terrain, layout(12), true), army, 0)).toBe(
      false,
    );
  });

  it('the run writes the radius into the params only while held', () => {
    const rm = runHolding(['lantern_of_the_road']);
    const node = rm.nodeMap.nodes.find((n) => n.type === 'battle');
    expect(rm.getBattleParams(node).fogOpeningRadius).toBe(4);
    expect('fogOpeningRadius' in runHolding([]).getBattleParams(node)).toBe(false);
  });

  it('the harness reveals at a fresh start and clears it as the enemy phase starts', async () => {
    // Failure: the harness never reveals (the sims and the scene disagree), or keeps it.
    const battle = new HeadlessBattle(structuredClone(data), {
      act: 'act1',
      objective: 'rout',
      fogEnabled: true,
      fogOpeningRadius: 4,
    });
    battle.init();
    const unit = battle.playerUnits[0];
    const far = openingRevealTiles([unit], 4, battle.grid).find(
      (t) => Math.abs(t.col - unit.col) + Math.abs(t.row - unit.row) === 4,
    );
    expect(battle.grid.isVisible(far.col, far.row)).toBe(true);
    expect(battle.grid.contactSet.size).toBeGreaterThan(0);
    battle._onPhaseChange('enemy', 1);
    expect(battle.grid.contactSet.size).toBe(0);
  });

  it('BattleScene applies it in the fresh-start branch only, never on a resume', () => {
    // Failure: a resumed battle reveals again (the checkpoint's fog is the battle's own).
    const src = fs.readFileSync('src/scenes/BattleScene.js', 'utf8');
    const calls = src.match(/applyFogOpening\(/g) || [];
    expect(calls).toHaveLength(1);
    const call = src.indexOf('applyFogOpening(');
    const resumeBranch = src.lastIndexOf('if (this._resumeCheckpoint) {', call);
    const elseBranch = src.indexOf('} else {', resumeBranch);
    expect(resumeBranch).toBeGreaterThan(0);
    expect(src.slice(resumeBranch, elseBranch)).toMatch(/finalizeResume/);
    expect(elseBranch).toBeLessThan(call);
    expect(src.slice(elseBranch, call)).not.toMatch(/\n {6}\}/);
  });

  it('BattleScene reveals after formation places the army, never over the empty field', () => {
    // Failure: the reveal runs before formation (FormationController.lift has emptied
    // scene.playerUnits, and the army is placed only once `_formation.run()` settles), so it
    // reveals around nobody, or around the tiles the army stood on before it was lifted.
    const src = fs.readFileSync('src/scenes/BattleScene.js', 'utf8');
    const call = src.indexOf('applyFogOpening(');
    const lift = src.indexOf('this._formation.lift();');
    const run = src.indexOf('await this._formation.run();');
    expect(lift).toBeGreaterThan(0);
    expect(run).toBeGreaterThan(lift);
    expect(call).toBeGreaterThan(run);
    // Lifted, the army is off the board: a reveal then has nothing to stand on.
    const lifted = [];
    expect(
      applyFogOpening(new HeadlessGrid(12, 12, data.terrain, layout(12), true), lifted, 4),
    ).toBe(false);
  });
});

// ── Crest of the Road ──────────────────────────────────────────────────────

describe('Crest of the Road: every recruit bears a Mark', () => {
  const crest = (seed = 17) => {
    const rm = runHolding(['crest_of_the_road'], { seed });
    rm.metaEffects = { ...(rm.metaEffects || {}), markChance: 0 };
    return rm;
  };

  it('the run reads it into the Mark chance every source rolls at; nothing without it', () => {
    expect(crest().getEffectiveMetaEffects().markChance).toBe(1);
    const plain = runHolding([]);
    plain.metaEffects = { ...(plain.metaEffects || {}), markChance: 0 };
    expect(plain.getEffectiveMetaEffects().markChance).toBe(0);
    expect(roundTrip(crest()).getEffectiveMetaEffects().markChance).toBe(1);
  });

  it('a recruit node, a boss recruit and an event join all bear one', () => {
    // Failure: a source reads the meta snapshot (`run.metaEffects`) instead of the run's
    // effective effects, so the crest never reaches it.
    for (let seed = 1; seed <= 8; seed++) {
      const rm = crest(seed);
      const ctx = rm.getRecruitBattleContext({ id: 'n1' });
      const node = buildRecruitNodeUnit({
        ...ctx,
        nodeId: 'n1',
        preview: { className: 'Archer', name: `Probe${seed}` },
        gameData: { ...rm.gameData, lords: [] },
      });
      expect(node.unit.markId, `recruit node ${seed}`).toEqual(expect.any(String));
      vi.spyOn(Math, 'random').mockImplementation(() => 0.37);
      const boss = prepareBossRecruit(rm, { ...rm.gameData, lords: [] });
      vi.restoreAllMocks();
      for (const { unit } of boss)
        expect(unit.markId, `boss ${unit.name}`).toEqual(expect.any(String));
    }
    const run = runWithEvents([soloEvent([{ type: 'join', class: 'Archer' }])], { seed: 3 });
    run.metaEffects = { ...(run.metaEffects || {}), markChance: 0 };
    run.addBlessingMidRun('crest_of_the_road', { earned: true });
    const node = arriveAs(run, 'solo');
    const before = run.roster.length;
    expect(chooseEventOption(run, node.id, 'go').ok).toBe(true);
    expect(run.roster.slice(before)[0].markId).toEqual(expect.any(String));
  });

  it('a mercenary and a Vanguard Cadre starter bear one too', () => {
    const rm = crest(5);
    const board = generateMercenaryCandidates(
      'act2',
      8,
      data.recruits,
      data.classes,
      data.weapons,
      data.skills,
      'normal',
      data.colosseum,
      () => 0.42,
      data.traits,
      [],
      rm.getEffectiveMetaEffects(),
      { runSeed: rm.runSeed, marksData: data.marks },
    );
    expect(board.length).toBeGreaterThan(0);
    for (const { unit } of board) expect(unit.markId, unit.name).toEqual(expect.any(String));
    // The overlay hands the board the run's effective effects (the one place the crest is read).
    expect(fs.readFileSync('src/ui/ColosseumOverlay.js', 'utf8')).toMatch(
      /this\.runManager\.getEffectiveMetaEffects\?\.\(\)/,
    );
    const cadre = rm._createExtraStartingUnit('Fighter');
    expect(cadre.markId).toEqual(expect.any(String));
  });

  it("the unit is the same with or without it, apart from its Mark (the stream's two draws kept)", () => {
    // Failure: the crest skips the Mark stream's first draw, so the pick (and every later Mark)
    // shifts, or it touches the recruit's own stream.
    const build = (rm) => {
      const ctx = rm.getRecruitBattleContext({ id: 'n2' });
      return buildRecruitNodeUnit({
        ...ctx,
        nodeId: 'n2',
        preview: { className: 'Fighter', name: 'Brannoc' },
        gameData: { ...rm.gameData, lords: [] },
      }).unit;
    };
    const withCrest = build(crest(9));
    const always = runHolding([], { seed: 9 });
    always.metaEffects = { ...(always.metaEffects || {}), markChance: 1 };
    const atOne = build(always);
    expect(withCrest.markId).toBe(atOne.markId);
    const strip = (u) => {
      const copy = structuredClone(u);
      delete copy.markId;
      return JSON.stringify(copy, (k, v) => (k === 'uid' ? undefined : v));
    };
    expect(strip(withCrest)).toBe(strip(atOne));
  });
});
