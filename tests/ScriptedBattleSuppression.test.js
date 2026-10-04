// The suppress list (docs/specs/prologue-chapter.md §8): every run-layer system the old
// practice tutorial switched off reads engine/ScriptedBattle.isScriptedBattle, so a
// prologue chapter (battleParams.prologueChapter, no tutorialMode flag anywhere) keeps
// them all off. Table-driven: one row per reader, each driven with the prologue's params.
import { describe, expect, it, vi } from 'vitest';

// Some readers import Phaser-backed modules; the suppress list needs none of Phaser.
vi.mock('phaser', () => ({ default: { Scene: class {}, GameObjects: {}, Math: {} } }));
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { loadGameData } from './testData.js';
import {
  isScriptedBattle,
  prologueBattleParams,
  prologueChapterOf,
} from '../src/engine/ScriptedBattle.js';
import { GuidanceController } from '../src/ui/GuidanceController.js';
import { claimContextualHint, showContextualHint } from '../src/ui/HintDisplay.js';
import { BattleBeatsController } from '../src/ui/BattleBeatsController.js';
import { DeedController } from '../src/ui/DeedController.js';
import { isEclipseClock, projectedShadow } from '../src/ui/EclipseHudController.js';
import { FormationController } from '../src/ui/FormationController.js';
import { rollCaravanSpawn } from '../src/engine/CaravanSystem.js';
import { rollVillageSpawn } from '../src/engine/VillageSystem.js';
import { battleMusicContext } from '../src/engine/BattleMusicSelection.js';
import { atmosphereContextFromScene } from '../src/ui/AtmosphereController.js';
import { resolveAtmosphere, ATMOSPHERE_GRADES } from '../src/art/atmosphereConfig.js';
import { AreaTargetingController } from '../src/ui/AreaTargetingController.js';

const data = loadGameData();
const chapter = data.prologue.chapters[0];
const PARAMS = prologueBattleParams(chapter, { seed: data.prologue.seed });

// A run manager that would fire every run-layer system if a reader forgot the predicate.
const liveRun = () => ({
  battleInProgress: { nodeId: 'n1', checkpoint: null },
  isEclipseActive: () => true,
  projectShadowGain: () => 9,
  pickNarrativeLine: (pool) => pool[0],
  roster: [],
});

describe('isScriptedBattle', () => {
  it('is the chapter id and nothing else', () => {
    expect(isScriptedBattle(PARAMS)).toBe(true);
    expect(PARAMS).not.toHaveProperty('tutorialMode');
    expect(isScriptedBattle({ act: 'act1' })).toBe(false);
    expect(isScriptedBattle({ tutorialMode: true })).toBe(false);
    expect(isScriptedBattle(null)).toBe(false);
    expect(prologueChapterOf(PARAMS, data)).toBe(chapter);
    expect(prologueChapterOf({ prologueChapter: 'nope' }, data)).toBeNull();
  });
});

describe('every former tutorialMode reader honours the prologue params', () => {
  const rows = [
    [
      'Guidance notes are off',
      () => {
        const scene = {
          battleParams: PARAMS,
          registry: { get: () => ({ getHints: () => true, getGuidance: () => 'full' }) },
        };
        return new GuidanceController(scene).level();
      },
      'off',
    ],
    [
      'contextual hints (battle_par, battle_danger_zone...) never show',
      () => {
        const hints = { hasSeen: () => false, shouldShow: () => true, markSeen: vi.fn() };
        const scene = {
          battleParams: PARAMS,
          registry: { get: (k) => (k === 'hints' ? hints : null) },
          runManager: liveRun(),
        };
        return [
          showContextualHint(scene, 'battle_par', 'x'),
          claimContextualHint(scene, 'battle_par'),
        ];
      },
      [false, false],
    ],
    [
      'no lord answers an ally fall (story beats)',
      () => {
        const lord = {
          name: 'Kira',
          isLord: true,
          faction: 'player',
          currentHP: 10,
          col: 1,
          row: 0,
        };
        const scene = {
          _battleSession: 1,
          battleParams: PARAMS,
          playerUnits: [lord],
          gameData: data,
          time: { now: 0 },
          runManager: liveRun(),
        };
        return new BattleBeatsController(scene, () => 0).onAllyFall({
          name: 'Bob',
          faction: 'player',
          col: 0,
          row: 0,
        });
      },
      null,
    ],
    [
      'deeds record nothing, and a fall leaves no fallen record',
      () => {
        const scene = {
          battleParams: PARAMS,
          runManager: liveRun(),
          gameData: data,
          _fallenBattleRecords: [],
        };
        const deeds = new DeedController(scene);
        deeds.onUnitRemoved({ name: 'Bob', inventory: [], consumables: [] }, null);
        return [deeds.active(), scene._fallenBattleRecords];
      },
      [false, []],
    ],
    [
      'the Eclipse clock is off (no shadow projection)',
      () => {
        const scene = {
          battleParams: PARAMS,
          runManager: liveRun(),
          turnManager: { turnNumber: 9 },
          turnPar: 5,
        };
        return [isEclipseClock(scene), projectedShadow(scene)];
      },
      [false, null],
    ],
    [
      'formation placement never opens, and Back to Map is refused',
      () => {
        const scene = {
          battleParams: PARAMS,
          runManager: liveRun(),
          nodeId: 'n1',
          playerUnits: [{}, {}, {}, {}],
          battleConfig: { playerSpawns: [{}, {}, {}, {}] },
          _resumeCheckpoint: null,
        };
        const formation = new FormationController(scene);
        formation.ready = true;
        return [FormationController.shouldRun(scene), formation.canReturnToMap()];
      },
      [false, false],
    ],
    [
      'no caravan and no village roll',
      () => [
        rollCaravanSpawn({ ...PARAMS, act: 'act1' }, 0, () => 0),
        rollVillageSpawn({ ...PARAMS, act: 'act1' }, () => 0),
      ],
      [false, false],
    ],
    [
      'the first-battle theme plays',
      () => battleMusicContext({ battleParams: PARAMS }).firstBattle,
      true,
    ],
    [
      'the atmosphere is the plain Act I dusk, whatever the Eclipse phase',
      () => {
        const ctx = atmosphereContextFromScene({
          battleParams: { ...PARAMS, eclipsePhaseIndex: 4 },
          battleConfig: { biome: 'tundra' },
        });
        const mood = resolveAtmosphere(ctx);
        return [ctx.isScripted, mood.gradeKey, mood.grade];
      },
      [true, 'act1', { ...ATMOSPHERE_GRADES.act1 }],
    ],
    [
      'an area strike commits no intent (no checkpoint to replay from)',
      () => {
        const scene = {
          battleParams: PARAMS,
          runManager: liveRun(),
          turnManager: { currentPhase: 'player' },
          _battleSession: 1,
          _pendingCommittedAction: { stale: true },
        };
        const unit = { faction: 'player', battleEntityId: 'u1', inventory: [] };
        new AreaTargetingController(scene).commitIntent(unit, {}, { id: 'x' }, { col: 0, row: 0 });
        return scene._pendingCommittedAction;
      },
      null,
    ],
  ];

  it.each(rows)('%s', (_label, read, expected) => {
    expect(read()).toEqual(expected);
  });
});

describe('no reader keeps its own flag', () => {
  function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, out);
      else if (/\.(js|mjs)$/.test(name)) out.push(path);
    }
    return out;
  }

  it('no source file reads battleParams.tutorialMode or sets tutorialMode on a battle', () => {
    const offenders = [];
    for (const file of walk('src')) {
      const text = readFileSync(file, 'utf8');
      if (/battleParams\??\.tutorialMode|params\.tutorialMode|tutorialMode:\s*true/.test(text))
        offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
