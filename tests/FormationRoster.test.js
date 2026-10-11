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
// - the re-entered battle asks the deploy question again or replays the boss card;
// - the device refuses the save that leaves the battle and the sheet opens anyway, over
//   a run that says "on the map" while the save still says "in battle" (or the run is
//   left half-reverted: the battle's RNG or Vision refunded with the battle going on);
// - the refusal is silent, or offers no way to try again;
// - the re-entered battle's save is refused and the formation still says "Roster saved".
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

import { EventEmitter } from 'node:events';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { FormationController, FORMATION_STATE } from '../src/ui/FormationController.js';
import {
  canOpenFormationRoster,
  deployedFromMemory,
  formationMemory,
  openFormationRoster,
  restorePlacement,
  ROSTER_SAVE_REFUSED_COPY,
} from '../src/ui/FormationRoster.js';
import { renderFormationPanel } from '../src/ui/FormationPanel.js';
import { RunManager } from '../src/engine/RunManager.js';
import { getRunKey } from '../src/engine/SlotManager.js';
import { createUnit, equipAccessory } from '../src/engine/UnitManager.js';
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
      return { ok: true };
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
      // Rebuilt as the route map builds them on entry, after the edit.
      battleParams: rm.getBattleParams(rm.nodeMap.nodes.find((n) => n.id === scene.nodeId)),
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

  it("re-reads the params: a unit put in the air there takes Cavalier's Hour's Move, not DEF", () => {
    // Failure: the restart reused the first entry's params, so the Fighter who put on Mercury
    // Sandals in the Roster kept infantry's +1 DEF (and the battle flag saved it for a resume).
    const rm = new RunManager(gameData);
    rm.startRun({ runSeed: 515, applyBlessingsAtStart: false });
    rm.activeBlessings = [{ id: 'cavaliers_hour', rolledCost: null }];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    rm.ensureUnitUids();
    const fighter = createUnit(
      gameData.classes.find((c) => c.name === 'Fighter'),
      5,
      gameData.weapons,
      { name: 'Shod' },
    );
    rm.assignUnitUid(fighter);
    rm.roster.push(fighter);
    const node = rm.nodeMap.nodes.find((n) => n.type === 'battle');
    const deltaOf = (params) =>
      params.battleDebuffs.filter((d) => d.unitUid === fighter.unitUid).map((d) => d.stat);
    const entryParams = rm.getBattleParams(node);
    expect(deltaOf(entryParams)).toEqual(['DEF']);
    rm.beginBattleInProgress(node.id, { battleParams: entryParams });
    const { scene } = formationScene({ rm, nodeId: node.id });
    scene.battleParams = entryParams;
    expect(openFormationRoster(scene)).toBe(true);
    // In the sheet: the Fighter puts on Mercury Sandals.
    const sandals = structuredClone(gameData.accessories.find((a) => a.name === 'Mercury Sandals'));
    equipAccessory(fighter, sandals);
    expect(fighter.moveType).toBe('Flying');
    sheets[0].opts.onClose();
    expect(deltaOf(restarts[0].data.battleParams)).toEqual(['MOV']);
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

  it('names a unit the Roster changed so it can no longer stand on its tile', () => {
    // Failure: the notice says "as you left it" while a reclassed unit is back to waiting.
    vi.useFakeTimers();
    const units = [unit('ru1', { name: 'Rider', moveType: 'Cavalry' }), unit('ru2'), unit('ru3')];
    const scene = liftScene(units, {
      deployed: ['ru1', 'ru2', 'ru3'],
      placed: [
        { key: 'ru1', col: 0, row: 2 },
        { key: 'ru2', col: 0, row: 0 },
      ],
      changed: true,
    });
    const mountain = gameData.terrain.findIndex((t) => t.name === 'Mountain');
    expect(gameData.terrain[mountain].moveCost.Cavalry).not.toBeTypeOf('number');
    scene.grid.mapLayout[2][0] = mountain;
    const f = new FormationController(scene);
    f.lift();
    expect(f.formation.at[0]).toBeNull();
    expect(f.tiles[f.formation.at[1]]).toEqual({ col: 0, row: 0 });
    expect(f.notice).toBe("Roster saved. Rider waits: it can't stand on that tile now.");
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

describe('FormationRoster: turning the phone while the Roster is open', () => {
  it('waits for the re-opened battle instead of locking the board for good', async () => {
    // Failure: with no battle flag, check() locked the board and said it keeps its
    // orientation for this battle, though the battle re-opens in the phone's orientation.
    const { PortraitBattleController } = await import('../src/ui/PortraitBattleController.js');
    const scene = { _formationRoster: { closed: false } };
    const c = new PortraitBattleController(scene);
    c.mismatch = () => true;
    c._lock = vi.fn();
    expect(c.check()).toBe(false);
    expect(c._lock).not.toHaveBeenCalled();
    expect(c.locked).toBe(false);
  });
});

/** localStorage that can refuse writes, as a full or locked-down device does. */
class RefusingStorage {
  constructor() {
    this.map = new Map();
    this.refuse = null; // null | 'quota' | 'write_error'
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    if (this.refuse) {
      const error = new Error('refused');
      if (this.refuse === 'quota') error.name = 'QuotaExceededError';
      throw error;
    }
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

describe('FormationRoster: the device refuses the save', () => {
  let storage;
  beforeEach(() => {
    storage = new RefusingStorage();
    vi.stubGlobal('localStorage', storage);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** The stored run save of slot 1, as a reload reads it. */
  const stored = () => JSON.parse(storage.getItem(getRunKey(1)));

  /**
   * A run in its first battle with a real save behind it: slot 1 holds the battle flag,
   * written at entry; the battle's RNG install and a Watcher's Grace charge have moved
   * the run on since (both are what Continue from Map refunds).
   */
  function savedScene() {
    storage.refuse = null;
    const entered = enteredRun();
    const { rm } = entered;
    rm.visionChargesRemaining = 1;
    rm.rngSeed = 1234;
    rm.beginBattleInProgress(entered.nodeId, { battleParams: { act: 'act1' } });
    rm.rngSeed = 999;
    rm.visionChargesRemaining = 2; // the boss map's grace, granted after the entry snapshot
    rm.battleInProgress.bossVisionGranted = 1;
    const built = formationScene(entered);
    const { scene } = built;
    scene.registry = { get: (key) => (key === 'activeSlot' ? 1 : null) };
    scene.events = new EventEmitter();
    scene._persistBattleRunState = BattleScene.prototype._persistBattleRunState;
    expect(scene._persistBattleRunState(null, { session: 1 }).ok).toBe(true); // the entry save
    expect(stored().battleInProgress).not.toBeNull();
    return { ...entered, ...built };
  }

  it('keeps the sheet shut and the run in the battle the save still holds', () => {
    // Failure: the sheet opened over a run reverted to the map while the save still said
    // "in battle" (the battle's RNG and the grace charge refunded with the battle on).
    for (const reason of ['quota', 'write_error']) {
      const { rm, scene, formation, units } = savedScene();
      const flag = rm.battleInProgress;
      const convoy = rm.convoy;
      const run = JSON.stringify(rm.toJSON());
      const save = storage.getItem(getRunKey(1));
      storage.refuse = reason;
      sheets.length = 0;

      expect(openFormationRoster(scene, units[1]), reason).toBe(false);
      expect(sheets, reason).toHaveLength(0);
      // In memory: the battle, exactly as before (the same flag and convoy objects).
      expect(rm.battleInProgress).toBe(flag);
      expect(rm.convoy).toBe(convoy);
      expect(rm.rngSeed).toBe(999);
      expect(rm.visionChargesRemaining).toBe(2);
      expect(JSON.stringify(rm.toJSON())).toBe(run);
      // On the device: untouched, and it agrees with memory.
      expect(storage.getItem(getRunKey(1))).toBe(save);
      expect(stored().battleInProgress.nodeId).toBe(flag.nodeId);
      // Placement goes on, and the player is told.
      expect(formation.ready).toBe(true);
      expect(scene._formationRoster).toBeFalsy();
      expect(formation.notice).toBe(ROSTER_SAVE_REFUSED_COPY.notice);
    }
  });

  it('a route with no slot has nothing to keep: the Roster opens', () => {
    const { rm, scene } = savedScene();
    scene.registry = { get: () => null };
    storage.refuse = 'quota';
    expect(openFormationRoster(scene)).toBe(true);
    expect(sheets).toHaveLength(1);
    expect(rm.battleInProgress).toBeNull();
  });

  describe('the prompt', () => {
    let dom;
    beforeEach(() => {
      dom = installFakeDom(vi);
    });

    // The fake DOM reads tags and classes, not attributes: find them by dataset.
    const prompt = () =>
      [...dom.doc.querySelectorAll('section')].find((el) => el.dataset.rosterSave === 'refused') ||
      null;
    const action = (name) =>
      [...(prompt()?.querySelectorAll('button') || [])].find(
        (b) => b.dataset.rosterSaveAction === name,
      ) || null;
    const text = () => prompt()?.textContent || '';

    it('says why, that nothing changed, and offers Retry and Back over the formation', () => {
      const { scene, formation } = savedScene();
      storage.refuse = 'quota';
      openFormationRoster(scene);
      expect(prompt()).toBeTruthy();
      expect(text()).toContain("This device's storage is full.");
      expect(text()).toContain(ROSTER_SAVE_REFUSED_COPY.unchanged);
      expect(text()).toContain('Free space on this device, then Retry.');
      expect(action('retry')).toBeTruthy();
      expect(action('back')).toBeTruthy();
      // While it is up, no Roster under it; Back returns to placement and offers it again.
      expect(canOpenFormationRoster(scene)).toBe(false);
      action('back').click();
      expect(prompt()).toBeNull();
      expect(formation.menu).toBeNull();
      expect(canOpenFormationRoster(scene)).toBe(true);
      expect(sheets).toHaveLength(0);
    });

    it('Retry tries the save again: still refused it says so, accepted the Roster opens', () => {
      const { rm, scene, units } = savedScene();
      storage.refuse = 'write_error';
      openFormationRoster(scene, units[1]);
      expect(text()).toContain('This device refused the save.');
      expect(text()).not.toContain('Free space');
      action('retry').click();
      expect(sheets).toHaveLength(0);
      expect(text()).toContain('Still not saved. Tries: 1');
      expect(rm.battleInProgress).not.toBeNull();

      storage.refuse = null;
      action('retry').click();
      expect(prompt()).toBeNull();
      expect(sheets).toHaveLength(1);
      expect(rm.roster[sheets[0].opts.index].unitUid).toBe(units[1].unitUid);
      // Now the save says "on the map", as memory does.
      expect(rm.battleInProgress).toBeNull();
      expect(stored().battleInProgress).toBeNull();
      expect(stored().rngSeed).toBe(1234);
    });
  });

  it('the return says "Roster saved" only when the re-entered battle was saved', () => {
    // Failure: the re-entered battle's entry save was refused and the formation still said
    // "Roster saved" though a close now loses the edit.
    const units = [
      { unitUid: 'ru1', name: 'ru1', faction: 'player', moveType: 'Infantry', stats: { MOV: 4 } },
    ];
    const memory = { deployed: ['ru1'], placed: [{ key: 'ru1', col: 0, row: 0 }], changed: true };
    const notice = (entrySave) => {
      const scene = {
        _battleSession: 1,
        gameData,
        battleParams: { act: 'act1', objective: 'rout' },
        battleConfig: { playerSpawns: [{ col: 0, row: 0 }], formationSpares: [] },
        playerUnits: units.map((u) => Object.assign({ ...u }, { col: 0, row: 0 })),
        enemyUnits: [],
        npcUnits: [],
        updateUnitPosition: vi.fn(),
        _formationReturn: memory,
        _battleEntrySave: entrySave,
      };
      const map = [[PLAIN, PLAIN]];
      const stub = () => {
        const o = { setDepth: () => o, setStrokeStyle: () => o, setAlpha: () => o };
        o.setOrigin = () => o;
        o.destroy = () => {};
        return o;
      };
      scene.add = { rectangle: stub, text: stub };
      scene.grid = new Grid(
        {
          cameras: { main: { width: 640, height: 480 } },
          add: { rectangle: stub, image: stub, text: stub, container: stub },
          textures: { exists: () => false },
        },
        2,
        1,
        gameData.terrain,
        map,
        false,
      );
      const f = new FormationController(scene);
      f.lift();
      clearTimeout(f._noticeTimer);
      return f.notice;
    };
    expect(notice({ ok: true })).toBe('Roster saved. Your formation is as you left it.');
    expect(notice({ ok: false, reason: 'missing_slot' })).toMatch(/^Roster saved/);
    expect(notice({ ok: false, reason: 'quota' })).toBe(ROSTER_SAVE_REFUSED_COPY.unsaved);
    expect(notice({ ok: false, reason: 'write_error' })).not.toMatch(/Roster saved/);
  });
});

describe('RunManager.revertBattleInProgressToEntryUndoable', () => {
  it('puts back every field the revert wrote, so the run is the battle it was', () => {
    // Failure: a field the entry revert writes (RNG, Vision, rerolls, the convoy, gold...)
    // was left reverted after a refused save, so the battle went on with refunded values.
    const { rm, nodeId } = enteredRun();
    rm.visionChargesRemaining = 1;
    rm.visionCount = 0;
    rm.rewardRerollsSpent = 0;
    rm.prologueVisionGranted = false;
    rm.beginBattleInProgress(nodeId, { battleParams: { act: 'act1' } });
    rm.battleInProgress.prologueVisionGrantedAtEntry = false;
    // The battle moves every one of them on.
    rm.rngSeed = 777;
    rm.visionChargesRemaining = 3;
    rm.visionCount = 2;
    rm.rewardRerollsSpent = 1;
    rm.prologueVisionGranted = true;
    rm.gold += 250;
    rm.convoy = { weapons: [], consumables: [{ name: 'Vulnerary', uid: 'itm_mid' }] };
    rm.accessories = [{ name: 'Power Ring', uid: 'itm_ring' }];
    const before = JSON.stringify(rm.toJSON());
    const flag = rm.battleInProgress;

    const undo = rm.revertBattleInProgressToEntryUndoable();
    expect(typeof undo).toBe('function');
    expect(rm.battleInProgress).toBeNull();
    expect(rm.rngSeed).toBe(999); // the entry's, recorded when the battle began
    expect(rm.visionChargesRemaining).toBe(1);
    undo();
    expect(rm.battleInProgress).toBe(flag);
    expect(JSON.stringify(rm.toJSON())).toBe(before);
  });

  it('undoes a legacy convoy scrub from a copy, and does nothing with no battle', () => {
    const { rm } = enteredRun();
    rm.battleInProgress.entryBattleState = null; // a pre-v2 flag
    rm.battleInProgress.checkpoint = { villageState: { rewardItemUid: 'itm_village' } };
    rm.convoy.consumables.push({ name: 'Vulnerary', uid: 'itm_village' });
    const before = JSON.stringify(rm.toJSON());
    const undo = rm.revertBattleInProgressToEntryUndoable();
    expect(rm.convoy.consumables.some((i) => i.uid === 'itm_village')).toBe(false);
    undo();
    expect(JSON.stringify(rm.toJSON())).toBe(before);

    rm.battleInProgress = null;
    expect(rm.revertBattleInProgressToEntryUndoable()).toBeNull();
  });
});
