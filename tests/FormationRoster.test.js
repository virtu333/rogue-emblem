// The Roster from the formation screen (src/ui/FormationRoster.js): gear, items,
// accessories and skills managed before turn 1, then back to placement with the
// army and its tiles as the player left them.
//
// Ways it can fail, one test each:
// - a Roster edit made under the battle flag is half-undone by Continue from Map
//   (an item taken from the convoy comes back to it while the unit keeps it);
// - closing the Roster returns to the old battle copies (the edit never reaches
//   the field), or loses who deployed, or the tiles they stood on;
// - a reclassed unit is put back on a tile it may no longer stand on;
// - the Roster is offered after turn 1 began, or in a scripted battle;
// - the re-entered battle asks the deploy question again or replays the boss card.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));

// The sheet is a DOM dialog: here it records how it was opened.
const sheets = [];
vi.mock('../src/ui/MobileRosterSheet.js', () => ({
  MobileRosterSheet: class {
    constructor(opts) {
      this.opts = opts;
      this.savedFlagAtOpen = opts.run?.battleInProgress ?? null;
      sheets.push(this);
    }
    destroy() {
      this.destroyed = true;
    }
  },
}));

vi.mock('../src/ui/BossPresenceController.js', () => ({
  BossPresenceController: class {
    create() {
      return this;
    }
    destroy() {}
  },
}));

const restarts = [];
let restartResult = true;
vi.mock('../src/utils/SceneRouter.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    restartScene: vi.fn((scene, data, opts) => {
      restarts.push({ data, opts, keepMusic: scene._keepMusicOnShutdown });
      return restartResult;
    }),
    transitionToSceneWithBlockedRetry: vi.fn(async () => ({
      status: actual.TRANSITION_RESULTS.STARTED,
    })),
  };
});

import { BattleScene } from '../src/scenes/BattleScene.js';
import { FormationController, FORMATION_STATE } from '../src/ui/FormationController.js';
import {
  canOpenFormationRoster,
  deployedFromMemory,
  formationMemory,
  openFormationRoster,
  restorePlacement,
} from '../src/ui/FormationRoster.js';
import { renderFormationPanel } from '../src/ui/FormationPanel.js';
import { RunManager } from '../src/engine/RunManager.js';
import { Grid } from '../src/engine/Grid.js';
import { unitIdentityKey } from '../src/engine/UnitIdentity.js';
import { TRANSITION_REASONS } from '../src/utils/SceneRouter.js';
import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const PLAIN = gameData.terrain.findIndex((t) => t.name === 'Plain');

beforeEach(() => {
  sheets.length = 0;
  restarts.length = 0;
  restartResult = true;
});

/** A run that has just entered its first battle, as BattleScene records it. */
function enteredRun() {
  const rm = new RunManager(gameData);
  rm.startRun();
  rm.ensureUnitUids();
  const nodeId = rm.nodeMap.startNodeId;
  rm.rngSeed = 1234;
  rm.beginBattleInProgress(nodeId, { battleParams: { act: 'act1' } });
  rm.rngSeed = 999; // the battle's RNG install moved it on
  return { rm, nodeId };
}

/** The formation screen over the run's battle copies, two of them placed. */
function formationScene({ rm, nodeId }) {
  const units = rm.getRoster();
  const scene = {
    _battleSession: 1,
    runManager: rm,
    nodeId,
    gameData,
    battleParams: { act: 'act1', objective: 'rout' },
    isBoss: false,
    isElite: false,
    registry: { get: () => null },
    sys: { isActive: () => true },
    input: { enabled: true },
    _persistBattleRunState: vi.fn(() => {
      scene._savedFlag = rm.battleInProgress;
    }),
    clearInspectionVisuals: vi.fn(),
    refreshEndTurnControl: vi.fn(),
  };
  const f = new FormationController(scene);
  f.units = units;
  f.tiles = [
    { col: 1, row: 1 },
    { col: 2, row: 1 },
    { col: 3, row: 1 },
  ];
  f.formation = { tiles: f.tiles, at: units.map((_, i) => (i === 0 ? 2 : i === 1 ? 0 : null)) };
  f.ready = true;
  f.active = true;
  f.drawMarkers = vi.fn();
  scene._formation = f;
  return { scene, formation: f, units };
}

describe('FormationRoster: what the formation keeps', () => {
  it('remembers who deploys and where each placed unit stands, by identity', () => {
    const { formation, units } = formationScene(enteredRun());
    const memory = formationMemory(formation);
    expect(memory.deployed).toEqual(units.map((u) => u.unitUid));
    expect(memory.placed).toEqual([
      { key: units[0].unitUid, col: 3, row: 1 },
      { key: units[1].unitUid, col: 1, row: 1 },
    ]);
  });

  it('finds the same army again in roster order, or nothing when it is not whole', () => {
    const roster = [{ unitUid: 'ru1' }, { unitUid: 'ru2' }, { unitUid: 'ru3' }];
    const memory = { deployed: ['ru3', 'ru1'] };
    expect(deployedFromMemory(roster, memory)).toEqual([roster[0], roster[2]]);
    expect(deployedFromMemory(roster, { deployed: ['ru1', 'ru9'] })).toBeNull();
    expect(deployedFromMemory(roster, memory, { min: 3, max: 4 })).toBeNull();
    expect(deployedFromMemory(roster, memory, { min: 1, max: 1 })).toBeNull();
    expect(deployedFromMemory(roster, null)).toBeNull();
  });

  it('puts units back on their tiles, leaving one that may not stand there waiting', () => {
    const formation = {
      units: [{ unitUid: 'ru1' }, { unitUid: 'ru2' }, { unitUid: 'ru3' }],
      tiles: [
        { col: 0, row: 0 },
        { col: 0, row: 1 },
      ],
      formation: { at: [null, null, null] },
    };
    const memory = {
      placed: [
        { key: 'ru2', col: 0, row: 1 },
        { key: 'ru1', col: 0, row: 0 },
        { key: 'ru3', col: 5, row: 5 }, // a tile this map no longer offers
      ],
    };
    const place = (u, t) => {
      if (u === 0) return false; // reclassed: the tile refuses it
      formation.formation.at[u] = t;
      return true;
    };
    expect(restorePlacement(formation, memory, place)).toBe(1);
    expect(formation.formation.at).toEqual([null, 1, null]);
  });
});

describe('FormationRoster: opening', () => {
  it('leaves the battle as Back to map does before the sheet can change anything', () => {
    const entered = enteredRun();
    const { scene, formation, units } = formationScene(entered);
    const { rm } = entered;
    expect(openFormationRoster(scene, units[1])).toBe(true);
    expect(rm.battleInProgress).toBeNull();
    expect(rm.rngSeed).toBe(1234); // entry RNG refunded, as Back to map
    expect(scene._persistBattleRunState).toHaveBeenCalledTimes(1);
    expect(scene._savedFlag).toBeNull(); // the save says "on the map"
    expect(sheets).toHaveLength(1);
    const [sheet] = sheets;
    expect(sheet.savedFlagAtOpen).toBeNull();
    // The run's own units (the manage view), opened on the unit asked for.
    expect(sheet.opts.units).toBe(rm.roster);
    expect(sheet.opts.run).toBe(rm);
    expect(rm.roster[sheet.opts.index].unitUid).toBe(units[1].unitUid);
    // Placement waits underneath; a second open is refused.
    expect(formation.ready).toBe(false);
    expect(openFormationRoster(scene)).toBe(false);
    expect(sheets).toHaveLength(1);
  });

  it('is not offered once turn 1 began, in a scripted battle, or with a menu open', () => {
    const begun = formationScene(enteredRun());
    begun.scene.runManager.battleInProgress.checkpoint = { version: 2 };
    expect(canOpenFormationRoster(begun.scene)).toBe(false);
    expect(openFormationRoster(begun.scene)).toBe(false);
    expect(begun.scene.runManager.battleInProgress).not.toBeNull();

    const scripted = formationScene(enteredRun());
    scripted.scene.battleParams.prologueChapter = 'p4_quarry_gate';
    expect(canOpenFormationRoster(scripted.scene)).toBe(false);

    const picking = formationScene(enteredRun());
    picking.formation.picker = {};
    expect(canOpenFormationRoster(picking.scene)).toBe(false);

    const ok = formationScene(enteredRun());
    expect(canOpenFormationRoster(ok.scene)).toBe(true);
    expect(sheets).toHaveLength(0);
  });
});

describe('FormationRoster: closing', () => {
  it('enters the same battle again with the edited roster, the army and its tiles', () => {
    const entered = enteredRun();
    const { scene, units } = formationScene(entered);
    const { rm } = entered;
    openFormationRoster(scene);
    // In the sheet: Edric takes a Vulnerary from the convoy.
    const vuln = structuredClone(gameData.consumables.find((c) => c.name === 'Vulnerary'));
    vuln.uid = 'itm_test_convoy';
    rm.convoy.consumables = [];
    const lord = rm.roster.find((u) => u.unitUid === units[0].unitUid);
    lord.consumables = [...(lord.consumables || []), vuln];
    sheets[0].opts.onClose();

    expect(sheets[0].destroyed).toBe(true);
    expect(restarts).toHaveLength(1);
    const { data, opts, keepMusic } = restarts[0];
    expect(opts.reason).toBe(TRANSITION_REASONS.CONTINUE);
    expect(keepMusic).toBe(true); // the battle's track plays on
    expect(data).toMatchObject({
      gameData,
      runManager: rm,
      battleParams: scene.battleParams,
      nodeId: scene.nodeId,
      isBoss: false,
      isElite: false,
    });
    // Fresh copies of the run's roster, carrying the edit (not the old battle copies).
    expect(data.roster).not.toBe(rm.roster);
    expect(data.roster.find((u) => u.unitUid === units[0].unitUid).consumables).toContainEqual(
      expect.objectContaining({ uid: 'itm_test_convoy' }),
    );
    expect(data.formationReturn).toEqual({
      deployed: units.map((u) => u.unitUid),
      placed: [
        { key: units[0].unitUid, col: 3, row: 1 },
        { key: units[1].unitUid, col: 1, row: 1 },
      ],
      changed: true,
    });
  });

  it('an edit made there is never half-undone by Continue from Map', () => {
    // Failure: the battle flag kept its entry convoy across the edit, so the app closed
    // with the sheet open and Continue from Map put the Vulnerary back in the convoy
    // while Edric still held it (a copy), or the re-entered battle did the same.
    for (const reenter of [false, true]) {
      const entered = enteredRun();
      const { scene } = formationScene(entered);
      const { rm, nodeId } = entered;
      const vuln = structuredClone(gameData.consumables.find((c) => c.name === 'Vulnerary'));
      vuln.uid = 'itm_dup_probe';
      rm.convoy.consumables.push(vuln);
      rm.beginBattleInProgress(nodeId, { battleParams: { act: 'act1' } }); // entered with it
      openFormationRoster(scene);
      // In the sheet: Edric takes it from the convoy (the sheet saves the run here).
      rm.convoy.consumables = rm.convoy.consumables.filter((i) => i.uid !== 'itm_dup_probe');
      rm.roster[0].consumables = [...(rm.roster[0].consumables || []), vuln];
      const saved = rm.toJSON();
      if (reenter) {
        sheets.at(-1).opts.onClose();
        rm.beginBattleInProgress(nodeId, { battleParams: { act: 'act1' } }); // the new entry
      } else {
        // The app closed with the sheet open: the save is what Continue loads.
        expect(saved.battleInProgress).toBeNull();
      }
      rm.revertBattleInProgressToEntry(); // Continue from Map
      const copies = [
        ...rm.convoy.consumables,
        ...rm.roster.flatMap((u) => u.consumables || []),
      ].filter((i) => i.uid === 'itm_dup_probe');
      expect(copies, reenter ? 're-entered' : 'closed with the sheet open').toHaveLength(1);
    }
  });

  it('says nothing changed when nothing did', () => {
    const entered = enteredRun();
    const { scene } = formationScene(entered);
    openFormationRoster(scene);
    sheets[0].opts.onClose();
    expect(restarts[0].data.formationReturn.changed).toBe(false);
  });

  it('goes to the route map when the battle cannot be re-opened (the save is there)', async () => {
    restartResult = false;
    const entered = enteredRun();
    const { scene } = formationScene(entered);
    openFormationRoster(scene);
    sheets[0].opts.onClose();
    await Promise.resolve();
    const { transitionToSceneWithBlockedRetry } = await import('../src/utils/SceneRouter.js');
    expect(transitionToSceneWithBlockedRetry).toHaveBeenCalledWith(
      scene,
      'NodeMap',
      { gameData, runManager: entered.rm },
      { reason: TRANSITION_REASONS.BACK },
    );
    expect(scene._keepMusicOnShutdown).toBe(false);
    expect(scene.input.enabled).toBe(true);
  });
});

describe('FormationRoster: the re-opened battle', () => {
  function sceneForCreate(roster, formationReturn, { max = 2 } = {}) {
    const scene = Object.create(BattleScene.prototype);
    Object.assign(scene, {
      battleParams: { act: 'act1', objective: 'rout' },
      gameData,
      roster,
      runManager: { getDeployBonus: () => 0, getLockedSpawnCount: () => max },
      nodeId: 'n1',
      _resumeCheckpoint: null,
      _formationReturn: formationReturn,
      _registerSceneShutdownCleanup: () => {},
      _setupGamepadInput: () => {},
      beginBattle: vi.fn(),
      showDeployScreen: vi.fn(),
      scene: { get: () => null },
      sys: { game: { scene: { getScene: () => null } } },
    });
    return scene;
  }

  it('deploys the remembered army without asking again', () => {
    const roster = [{ unitUid: 'ru1' }, { unitUid: 'ru2' }, { unitUid: 'ru3' }];
    const scene = sceneForCreate(roster, { deployed: ['ru3', 'ru1'], placed: [] });
    try {
      scene.create();
    } catch {
      // ensureSceneLoaded may need a real scene manager; the branch ran before it.
    }
    expect(scene.showDeployScreen).not.toHaveBeenCalled();
    expect(scene.beginBattle).toHaveBeenCalledWith([roster[0], roster[2]]);
  });

  it('asks again when the remembered army cannot be found whole', () => {
    const roster = [{ unitUid: 'ru1' }, { unitUid: 'ru2' }, { unitUid: 'ru3' }];
    const scene = sceneForCreate(roster, { deployed: ['ru1', 'ru9'], placed: [] });
    try {
      scene.create();
    } catch {
      // as above
    }
    expect(scene.beginBattle).not.toHaveBeenCalled();
    expect(scene.showDeployScreen).toHaveBeenCalledTimes(1);
  });

  it('does not show the boss card a second time', async () => {
    const showBossIntro = vi.fn(async () => {});
    const scene = Object.assign(Object.create(BattleScene.prototype), {
      _resumeCheckpoint: null,
      isBoss: true,
      _bossName: 'Bandit King',
      runManager: {},
      battleParams: { act: 'act1' },
      enemyUnits: [],
      _getCeremonies: () => ({ showBossIntro }),
    });
    await scene._presentBossEncounter();
    expect(showBossIntro).toHaveBeenCalledTimes(1); // a fresh entry shows it
    scene._formationReturn = { deployed: ['ru1'], placed: [] };
    await scene._presentBossEncounter();
    expect(showBossIntro).toHaveBeenCalledTimes(1); // the return does not
  });
});

describe('FormationRoster: placement restored on the re-opened screen', () => {
  function chain() {
    const obj = {
      setDepth: () => obj,
      setStrokeStyle: () => obj,
      setAlpha: () => obj,
      setOrigin: () => obj,
      destroy: () => {},
    };
    return obj;
  }

  function liftScene(units, formationReturn) {
    const map = Array.from({ length: 5 }, () => Array(7).fill(PLAIN));
    const spawns = [
      { col: 0, row: 0 },
      { col: 0, row: 1 },
      { col: 0, row: 2 },
    ];
    const scene = {
      _battleSession: 1,
      gameData,
      battleParams: { act: 'act1', objective: 'rout' },
      battleConfig: { playerSpawns: spawns, formationSpares: [] },
      playerUnits: units.map((u, i) => Object.assign(u, spawns[i])),
      enemyUnits: [],
      npcUnits: [],
      add: { rectangle: chain, text: chain },
      updateUnitPosition: vi.fn(),
      _formationReturn: formationReturn,
    };
    scene.grid = new Grid(
      {
        cameras: { main: { width: 640, height: 480 } },
        add: { rectangle: chain, image: chain, text: chain, container: chain },
        textures: { exists: () => false },
      },
      7,
      5,
      gameData.terrain,
      map,
      false,
    );
    return scene;
  }

  const unit = (unitUid, extra = {}) => ({
    unitUid,
    name: unitUid,
    faction: 'player',
    moveType: 'Infantry',
    stats: { MOV: 4 },
    ...extra,
  });

  afterEach(() => vi.useRealTimers());

  it('stands each unit where it stood, shows them, and says the roster was saved', () => {
    vi.useFakeTimers();
    const units = [unit('ru1'), unit('ru2'), unit('ru3')];
    const scene = liftScene(units, {
      deployed: ['ru1', 'ru2', 'ru3'],
      placed: [
        { key: 'ru1', col: 0, row: 2 },
        { key: 'ru3', col: 0, row: 0 },
      ],
      changed: true,
    });
    const f = new FormationController(scene);
    f.lift();
    expect(f.active).toBe(true);
    expect(scene.battleState).toBe(FORMATION_STATE);
    const tileOf = (u) => f.tiles[f.formation.at[u]] ?? null;
    expect(tileOf(0)).toEqual({ col: 0, row: 2 });
    expect(tileOf(1)).toBeNull(); // waited before, waits now
    expect(tileOf(2)).toEqual({ col: 0, row: 0 });
    expect(scene.playerUnits.map((u) => u.unitUid).sort()).toEqual(['ru1', 'ru3']);
    expect(units[0]).toMatchObject({ col: 0, row: 2 });
    expect(f.notice).toMatch(/Roster saved/);
  });

  it('a fresh battle (no memory) starts with everyone waiting and no notice', () => {
    const units = [unit('ru1'), unit('ru2'), unit('ru3')];
    const f = new FormationController(liftScene(units, null));
    f.lift();
    expect(f.placed()).toBe(0);
    expect(f.notice).toBeUndefined();
  });
});

describe('FormationRoster: the entry points', () => {
  let dom;
  beforeEach(() => {
    dom = installFakeDom(vi);
  });
  afterEach(() => vi.unstubAllGlobals());

  function render(formation) {
    const host = document.createElement('div');
    const make = (label, action, cls = '') => {
      const b = document.createElement('button');
      b.className = `re-btn ${cls}`;
      b.textContent = label;
      b.addEventListener('click', action);
      return b;
    };
    renderFormationPanel(host, formation, make);
    return host;
  }

  it('the panel offers Roster while it can open, and it opens the sheet', () => {
    const { scene, formation } = formationScene(enteredRun());
    scene.gameData = gameData;
    const host = render(formation);
    const button = host.querySelector('.fm-roster');
    expect(button?.textContent).toBe('Roster');
    button.click();
    expect(sheets).toHaveLength(1);
    expect(dom).toBeTruthy();
  });

  it('no Roster once the battle has a checkpoint', () => {
    const entered = enteredRun();
    entered.rm.battleInProgress.checkpoint = { version: 2 };
    const { formation } = formationScene(entered);
    expect(render(formation).querySelector('.fm-roster')).toBeNull();
  });

  it('the O key / pad Roster during placement opens it, not the battle sheet', () => {
    const { scene } = formationScene(enteredRun());
    const battle = Object.assign(Object.create(BattleScene.prototype), scene, {
      battleState: FORMATION_STATE,
      isStoryInputLocked: () => false,
      unitDetailOverlay: { show: vi.fn(), visible: false },
    });
    battle._formation.scene = battle;
    battle._onRosterClick();
    expect(sheets).toHaveLength(1);
    expect(battle.unitDetailOverlay.show).not.toHaveBeenCalled();
    expect(unitIdentityKey(sheets[0].opts.units[0])).toBeTruthy();
  });
});
