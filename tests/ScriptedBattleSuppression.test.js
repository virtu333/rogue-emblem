// The suppress list (docs/specs/prologue-chapter.md §8) in both of a chapter's modes:
// standalone (the title's replay: no RunManager) and the prologue run (a RunManager in
// mode 'prologue', the battle flag set). Every teaching suppression reads
// engine/ScriptedBattle.isScriptedBattle and holds in BOTH modes; the persistence
// readers (checkpoints, intents) read isStandaloneScriptedBattle and are OFF only
// standalone; the run layer's own switches read isPrologueRun. Table-driven: one row
// per reader, each driven in both modes. No reader keeps a flag of its own.
import { describe, expect, it, vi } from 'vitest';

// Some readers import Phaser-backed modules; the suppress list needs none of Phaser.
vi.mock('phaser', () => ({ default: { Scene: class {}, GameObjects: {}, Math: {} } }));
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { loadGameData } from './testData.js';
import {
  isScriptedBattle,
  isStandaloneScriptedBattle,
  isPrologueRun,
  prologueBattleParams,
  prologueChapterOf,
  PROLOGUE_RUN_MODE,
  STANDARD_RUN_MODE,
  RUN_MODES,
} from '../src/engine/ScriptedBattle.js';
import { GuidanceController } from '../src/ui/GuidanceController.js';
import { claimContextualHint, showContextualHint } from '../src/ui/HintDisplay.js';
import { BattleBeatsController } from '../src/ui/BattleBeatsController.js';
import { DeedController } from '../src/ui/DeedController.js';
import { isEclipseClock, projectedShadow } from '../src/ui/EclipseHudController.js';
import { FormationController } from '../src/ui/FormationController.js';
import { rollCaravanSpawn } from '../src/engine/CaravanSystem.js';
import { rollVillageSpawn, villageObjectiveLine } from '../src/engine/VillageSystem.js';
import { battleMusicContext } from '../src/engine/BattleMusicSelection.js';
import { atmosphereContextFromScene } from '../src/ui/AtmosphereController.js';
import { resolveAtmosphere, ATMOSPHERE_GRADES } from '../src/art/atmosphereConfig.js';
import { AreaTargetingController } from '../src/ui/AreaTargetingController.js';
import { RunManager } from '../src/engine/RunManager.js';
import { loomHeader } from '../src/ui/loomModel.js';

const data = loadGameData();
const chapter = data.prologue.chapters[0];
const PARAMS = prologueBattleParams(chapter, { seed: data.prologue.seed });

// A run manager that would fire every run-layer system if a reader forgot the predicate.
const liveRun = (mode = STANDARD_RUN_MODE) => ({
  mode,
  battleInProgress: { nodeId: 'n1', checkpoint: null },
  isEclipseActive: () => true,
  projectShadowGain: () => 9,
  pickNarrativeLine: (pool) => pool[0],
  roster: [],
});

// The two modes a chapter plays in: standalone (no run) and the prologue run.
const MODES = [
  ['standalone', () => null],
  ['prologue run', () => liveRun(PROLOGUE_RUN_MODE)],
];

describe('the predicates', () => {
  it('isScriptedBattle is the chapter id and nothing else', () => {
    expect(isScriptedBattle(PARAMS)).toBe(true);
    expect(PARAMS).not.toHaveProperty('tutorialMode');
    expect(isScriptedBattle({ act: 'act1' })).toBe(false);
    expect(isScriptedBattle({ tutorialMode: true })).toBe(false);
    expect(isScriptedBattle(null)).toBe(false);
    expect(prologueChapterOf(PARAMS, data)).toBe(chapter);
    expect(prologueChapterOf({ prologueChapter: 'nope' }, data)).toBeNull();
  });

  it('standalone is a scripted battle with no run; the prologue run is a run in that mode', () => {
    expect(isStandaloneScriptedBattle(PARAMS, null)).toBe(true);
    expect(isStandaloneScriptedBattle(PARAMS, liveRun(PROLOGUE_RUN_MODE))).toBe(false);
    expect(isStandaloneScriptedBattle({ act: 'act1' }, null)).toBe(false);
    expect(isPrologueRun(liveRun(PROLOGUE_RUN_MODE))).toBe(true);
    expect(isPrologueRun(liveRun())).toBe(false);
    expect(isPrologueRun(null)).toBe(false);
    expect(RUN_MODES).toEqual([STANDARD_RUN_MODE, PROLOGUE_RUN_MODE]);
  });
});

describe('every teaching suppression holds in both modes', () => {
  // A plain run battle: the control. Every reader must be ON for it, so a row that
  // passed only because the reader is broken for everyone fails here.
  const STANDARD = { act: 'act1', objective: 'rout', battleSeed: 7, fogEnabled: false };
  const CONTROL = {
    'Guidance notes are off': 'full',
    'contextual hints (battle_par, battle_danger_zone...) never show': [true, true],
    'no lord answers an ally fall (story beats)': { speaker: 'Kira', line: 'Bob fell.' },
    'deeds record nothing, and a fall leaves no fallen record': [
      true,
      [{ name: 'Bob', unitUid: 'ru9', bags: { inventory: [], consumables: [], weapon: null } }],
    ],
    'the Eclipse clock is off (no shadow projection)': [true, 9],
    'formation placement never opens, and Back to Map is refused': [true, true],
    'no caravan and no village roll (an authored village is carried by the config instead)': [true, true, "Village: end a unit's action on it to visit"], // prettier-ignore
    'the first-battle theme plays': false,
  };
  const rows = [
    [
      'Guidance notes are off',
      (run, P = PARAMS) => {
        const scene = {
          battleParams: P,
          runManager: run,
          registry: { get: () => ({ getHints: () => true, getGuidance: () => 'full' }) },
        };
        return new GuidanceController(scene).level();
      },
      'off',
    ],
    [
      'contextual hints (battle_par, battle_danger_zone...) never show',
      (run, P = PARAMS) => {
        const hints = { hasSeen: () => false, shouldShow: () => true, markSeen: vi.fn() };
        const scene = {
          battleParams: P,
          registry: { get: (k) => (k === 'hints' ? hints : null) },
          runManager: run,
          // A standard battle's hint waits for an idle moment (never comes here).
          events: { on: vi.fn(), once: vi.fn(), off: vi.fn() },
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
      (run, P = PARAMS) => {
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
          battleParams: P,
          playerUnits: [lord],
          gameData: { ...data, dialogue: { lordQuips: { onAllyFall: { Kira: ['{fallen} fell.'] } } } }, // prettier-ignore
          time: { now: 0 },
          runManager: run,
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
      (run, P = PARAMS) => {
        const scene = {
          battleParams: P,
          runManager: run,
          gameData: data,
          _fallenBattleRecords: [],
        };
        const deeds = new DeedController(scene);
        deeds.onUnitRemoved(
          { name: 'Bob', faction: 'player', unitUid: 'ru9', inventory: [], consumables: [] },
          null,
        );
        return [deeds.active(), scene._fallenBattleRecords];
      },
      [false, []],
    ],
    [
      'the Eclipse clock is off (no shadow projection)',
      (run, P = PARAMS) => {
        const scene = {
          battleParams: P,
          runManager: run,
          turnManager: { turnNumber: 9 },
          turnPar: 5,
        };
        return [isEclipseClock(scene), projectedShadow(scene)];
      },
      [false, null],
    ],
    [
      'formation placement never opens, and Back to Map is refused',
      (run, P = PARAMS) => {
        const scene = {
          battleParams: P,
          runManager: run,
          nodeId: 'n1',
          playerUnits: [{}, {}, {}, {}],
          battleConfig: { playerSpawns: [{}, {}, {}, {}] },
          _resumeCheckpoint: null,
        };
        const formation = new FormationController(scene);
        formation.ready = true;
        // Placement is a screen: give the reader a document, as a browser would.
        vi.stubGlobal('document', {});
        try {
          return [FormationController.shouldRun(scene), formation.canReturnToMap()];
        } finally {
          vi.unstubAllGlobals();
        }
      },
      [false, false],
    ],
    [
      'no caravan and no village roll (an authored village is carried by the config instead)',
      (run, P = PARAMS) => [
        rollCaravanSpawn({ ...P, act: 'act2' }, 0, () => 0),
        rollVillageSpawn({ ...P, act: 'act1' }, () => 0),
        villageObjectiveLine({ col: 3, row: 4, uncontested: true }),
      ],
      [false, false, "Village: end a unit's action on it to visit"],
    ],
    [
      'the first-battle theme plays',
      (run, P = PARAMS) => battleMusicContext({ battleParams: P, runManager: run }).firstBattle,
      true,
    ],
    [
      'the atmosphere is the plain Act I dusk, whatever the Eclipse phase',
      (run, P = PARAMS) => {
        const ctx = atmosphereContextFromScene({
          battleParams: { ...P, eclipsePhaseIndex: 4 },
          battleConfig: { biome: 'tundra' },
        });
        const mood = resolveAtmosphere(ctx);
        return [ctx.isScripted, mood.gradeKey, mood.grade];
      },
      [true, 'act1', { ...ATMOSPHERE_GRADES.act1 }],
    ],
  ];

  for (const [label, makeRun] of MODES) {
    describe(label, () => {
      it.each(rows)('%s', (_label, read, expected) => {
        expect(read(makeRun())).toEqual(expected);
      });
    });
  }

  describe('control: a standard battle of a standard run has every system on', () => {
    it.each(rows)('%s', (rowLabel, read, suppressed) => {
      const live = read(liveRun(STANDARD_RUN_MODE), STANDARD);
      expect(live, rowLabel).not.toEqual(suppressed);
      if (rowLabel in CONTROL) expect(live, rowLabel).toEqual(CONTROL[rowLabel]);
    });
  });
});

describe('persistence follows the run, not the chapter', () => {
  const areaIntent = (run) => {
    const scene = {
      battleParams: PARAMS,
      runManager: run,
      turnManager: { currentPhase: 'player' },
      _battleSession: 1,
      _pendingCommittedAction: { stale: true },
    };
    const unit = { faction: 'player', battleEntityId: 'u1', inventory: [] };
    new AreaTargetingController(scene).commitIntent(unit, {}, { id: 'x' }, { col: 0, row: 0 });
    return scene._pendingCommittedAction;
  };

  it('standalone: an area strike commits no intent (no checkpoint to replay from)', () => {
    expect(areaIntent(null)).toBeNull();
  });

  it('the prologue run: an area strike commits its intent like any run battle', () => {
    expect(areaIntent(liveRun(PROLOGUE_RUN_MODE))).toMatchObject({ kind: 'area_strike' });
  });
});

describe('the run layer in the prologue run', () => {
  const prologueRun = () => {
    const rm = new RunManager(data, null);
    rm.startPrologue(data, data.prologue);
    return rm;
  };

  it('is the prologue mode on a literal route, Act 1 on Normal, no Vision, Eclipse off', () => {
    const rm = prologueRun();
    expect(isPrologueRun(rm)).toBe(true);
    expect(rm.currentAct).toBe('act1');
    expect(rm.difficultyId).toBe('normal');
    expect(rm.visionChargesRemaining).toBe(0);
    expect(rm.isEclipseActive()).toBe(false);
    expect(rm.metaEffects).toBeNull();
    expect(rm.nodeMap.nodes.map((n) => n.battleParams?.prologueChapter)).toEqual(
      data.prologue.route.nodes.map((n) => n.chapter),
    );
    expect(rm.hasShownDialogue('runStart')).toBe(true); // no cold open on its route map
  });

  it('never brings the third lord, and the last chapter grants no Vision', () => {
    const rm = prologueRun();
    expect(rm.shouldTriggerThirdLord()).toBe(false);
    const last = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.bossNodeId);
    for (const node of rm.nodeMap.nodes) node.completed = node.id !== last.id;
    rm.currentNodeId = rm.nodeMap.nodes[0].id;
    expect(rm.completeBattle(rm.roster, last.id, 0)).toBe(true);
    expect(rm.visionChargesRemaining).toBe(0);
    expect(rm.pendingThirdLord).toBeNull();
    expect(rm.isPrologueComplete()).toBe(true);
  });

  it('the route map header is the prologue road, not Act I', () => {
    expect(loomHeader({ actIndex: 0, actName: 'Border Marches', rows: 2, frontierRow: 0, act: 'Prologue', title: 'The Quarry Road' })) // prettier-ignore
      .toEqual({ act: 'Prologue', title: 'The Quarry Road', sub: 'ROW 2 OF 2' });
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

  it('no source file compares a run mode itself: only ScriptedBattle.js knows the strings', () => {
    const offenders = [];
    for (const file of walk('src')) {
      if (file.endsWith('ScriptedBattle.js')) continue;
      const text = readFileSync(file, 'utf8');
      // RunManager serializes the mode through the exported constants only.
      const literal = /\.mode\s*[!=]==?\s*['"](prologue|standard)['"]/.test(text);
      const constant =
        !file.endsWith('RunManager.js') &&
        /\.mode\s*[!=]==?\s*(PROLOGUE|STANDARD)_RUN_MODE/.test(text);
      if (literal || constant) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
