// BattleScene wiring for recruit battles. The NPC's build (lord roll, promotion,
// growths, traits, meta outfitting) is covered in RecruitNodeSystem.test.js; this file
// checks the scene spawns exactly the unit the run previews, where the map put it,
// and seats a lord on the spawn nearest the recruit.
import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

vi.mock('../src/engine/Grid.js', () => ({
  Grid: class {
    constructor() {
      this.fogEnabled = false;
      this.gridToPixel = (col, row) => ({ x: col * 16, y: row * 16 });
      this.updateFogOfWar = vi.fn();
      this.clearHighlights = vi.fn();
    }
  },
  computeEffectivePath: vi.fn(),
}));

vi.mock('../src/engine/TurnManager.js', () => ({
  TurnManager: vi.fn(function () {
    this.init = vi.fn();
    this.startBattle = vi.fn();
  }),
}));

vi.mock('../src/engine/AIController.js', () => ({
  AIController: vi.fn(function () {}),
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { RunManager } from '../src/engine/RunManager.js';
import { createLordUnit } from '../src/engine/UnitManager.js';
import { loadGameData } from './testData.js';

// A permissive Phaser display object: every method exists and chains, so the HUD
// controllers beginBattle builds (Eclipse, beacon, objective) run to completion.
function makeDisplayObject() {
  const fns = new Map();
  const target = { visible: true, text: '' };
  const proxy = new Proxy(target, {
    get(obj, key) {
      if (key in obj) return obj[key];
      if (key === 'then') return undefined;
      if (!fns.has(key))
        fns.set(
          key,
          vi.fn((...args) => {
            if (key === 'setText') obj.text = args[0];
            if (key === 'setVisible') obj.visible = args[0];
            return proxy;
          }),
        );
      return fns.get(key);
    },
  });
  return proxy;
}

function makeScene({ runManager, deployed, npcSpawn }) {
  const gameData = loadGameData();
  const scene = new BattleScene();
  const battleConfig = {
    cols: 6,
    rows: 4,
    mapLayout: Array.from({ length: 4 }, () => Array(6).fill(0)),
    // Ordered nearest-first to the recruit, as MapGenerator hands them over.
    playerSpawns: [
      { col: 1, row: 2 },
      { col: 0, row: 0 },
      { col: 0, row: 3 },
    ],
    enemySpawns: [],
    npcSpawn,
    objective: 'rout',
  };
  runManager.getLockedBattleConfig = vi.fn(() => battleConfig);
  scene.gameData = gameData;
  scene.runManager = runManager;
  scene.battleParams = {
    act: 'act1',
    tutorialMode: false,
    fogEnabled: false,
    isRecruitBattle: true,
  };
  scene.nodeId = 'act1_3_3';
  scene.roster = deployed;
  scene.registry = {
    get: (key) => {
      if (key === 'startupFlags') return { isMobile: false };
      if (key === 'hints') return { shouldShow: () => false };
      return null;
    },
  };
  scene.events = { once: vi.fn() };
  scene.input = {
    mouse: { disableContextMenu: vi.fn() },
    on: vi.fn(),
    keyboard: { on: vi.fn(), addKey: vi.fn(() => ({ on: vi.fn() })) },
  };
  scene.cameras = { main: { width: 640, height: 480 } };
  scene.game = { events: { on: vi.fn(), off: vi.fn() } };
  scene.time = { delayedCall: vi.fn() };
  scene.tweens = { add: vi.fn() };
  scene.add = {
    rectangle: vi.fn(() => makeDisplayObject()),
    text: vi.fn(() => makeDisplayObject()),
  };
  for (const name of [
    'initializeAntiTurtleState',
    'initializeVisionState',
    'installBattleRng',
    'addUnitGraphic',
    'addEnemyFromSpawn',
    'updateObjectiveText',
    'updateTopLeftHudLayout',
    'updateEnemyVisibility',
    'updateVisionHud',
    '_clearTutorialGuideHighlights',
    'cancelTouchInspectHold',
    '_hideMenuTooltip',
    '_restoreBattleRng',
    '_onDangerClick',
    '_onRosterClick',
    'forceEndTurn',
    'requestCancel',
    'requestVisionRewind',
    'refreshEndTurnControl',
    'openUnitDetailOverlay',
    'showLootRoster',
    'hideLootRoster',
    '_cycleForecastWeapon',
  ])
    scene[name] = vi.fn();
  scene._reduceMotion = vi.fn(() => true);
  return scene;
}

function realRun() {
  const gameData = loadGameData();
  const rm = new RunManager(gameData, null);
  rm.startRun({ runSeed: 4242, autoSelectBlessing: false });
  // Put a recruit node on the map at a known id with a known preview.
  const node = rm.nodeMap.nodes.find((n) => n.type === 'recruit');
  node.id = 'act1_3_3';
  node.recruitPreview = { v: 1, className: 'Archer', name: 'Wren' };
  return rm;
}

describe('BattleScene · recruit battles', () => {
  it('spawns exactly the unit the run previews for the node, on the npc tile', () => {
    const rm = realRun();
    const node = rm.nodeMap.nodes.find((n) => n.id === 'act1_3_3');
    const expected = rm.getRecruitNodeUnit(node).unit;
    const deployed = rm.roster.map((u) => structuredClone(u));
    const scene = makeScene({
      runManager: rm,
      deployed,
      npcSpawn: { className: 'Archer', name: 'Wren', col: 3, row: 2, level: 1 },
    });
    BattleScene.prototype.beginBattle.call(scene, deployed);
    expect(scene.npcUnits).toHaveLength(1);
    const npc = scene.npcUnits[0];
    expect(npc.name).toBe(expected.name);
    expect(npc.className).toBe(expected.className);
    expect(npc.level).toBe(expected.level);
    expect(npc.stats).toEqual(expected.stats);
    expect(npc.growths).toEqual(expected.growths);
    expect(npc.traits).toEqual(expected.traits);
    expect([npc.col, npc.row]).toEqual([3, 2]);
    expect(npc.faction).toBe('npc');
  });

  it('builds the NPC without consuming the battle RNG', () => {
    // Count the scene's Math.random draws with the real build and with a prebuilt
    // unit handed back instantly: equal counts mean the build drew nothing from it.
    const drawsWith = (prebuilt) => {
      const rm = realRun();
      const deployed = rm.roster.map((u) => structuredClone(u));
      const scene = makeScene({
        runManager: rm,
        deployed,
        npcSpawn: { className: 'Archer', name: 'Wren', col: 3, row: 2, level: 1 },
      });
      if (prebuilt) rm.getRecruitNodeUnit = vi.fn(() => prebuilt);
      let draws = 0;
      const prev = Math.random;
      Math.random = () => {
        draws++;
        return 0.5;
      };
      try {
        BattleScene.prototype.beginBattle.call(scene, deployed);
      } finally {
        Math.random = prev;
      }
      return { draws, npc: scene.npcUnits[0] };
    };
    const real = drawsWith(null);
    const rm = realRun();
    const node = rm.nodeMap.nodes.find((n) => n.id === 'act1_3_3');
    const stub = drawsWith(rm.getRecruitNodeUnit(node));
    expect(real.npc).toBeTruthy();
    expect(real.draws).toBe(stub.draws);
  });

  it('seats a lord on the spawn nearest the recruit', () => {
    const rm = realRun();
    const recruit = {
      name: 'Galvin',
      className: 'Fighter',
      isLord: false,
      level: 2,
      stats: { HP: 20, MOV: 5 },
      currentHP: 20,
      inventory: [],
      skills: [],
    };
    const deployed = [recruit, ...rm.roster.map((u) => structuredClone(u))];
    const scene = makeScene({
      runManager: rm,
      deployed,
      npcSpawn: { className: 'Archer', name: 'Wren', col: 3, row: 2, level: 1 },
    });
    BattleScene.prototype.beginBattle.call(scene, deployed);
    const firstLord = scene.playerUnits.find((u) => u.isLord);
    expect([firstLord.col, firstLord.row]).toEqual([1, 2]);
    const galvin = scene.playerUnits.find((u) => u.name === 'Galvin');
    expect([galvin.col, galvin.row]).not.toEqual([1, 2]);
    // Unit order is untouched; only the tiles move.
    expect(scene.playerUnits[0].name).toBe('Galvin');
  });

  it('gives the recruit a run identity at spawn (a namesake can never stand in for it)', () => {
    const rm = realRun();
    const deployed = rm.roster.map((u) => structuredClone(u));
    const scene = makeScene({
      runManager: rm,
      deployed,
      npcSpawn: { className: 'Archer', name: 'Wren', col: 3, row: 2, level: 1 },
    });
    BattleScene.prototype.beginBattle.call(scene, deployed);
    const npc = scene.npcUnits[0];
    expect(npc.unitUid).toMatch(/^ru[1-9]\d*$/);
    expect(rm.roster.map((u) => u.unitUid)).not.toContain(npc.unitUid);
  });

  it('re-seats a lord recruit whose tile its class cannot stand on, without battle RNG', () => {
    const gameData = loadGameData();
    const rowanDef = gameData.lords.find((l) => l.name === 'Rowan');
    const rowanClass = gameData.classes.find((c) => c.name === rowanDef.class);
    expect(rowanClass.moveType).toBe('Cavalry');
    const swamp = gameData.terrain.findIndex((t) => t.name === 'Swamp');
    const spawnWith = (layoutTile) => {
      const rm = realRun();
      const deployed = rm.roster.map((u) => structuredClone(u));
      const rowan = createLordUnit(rowanDef, rowanClass, gameData.weapons);
      rowan.faction = 'npc';
      rm.getRecruitNodeUnit = vi.fn(() => ({ unit: rowan, isLord: true, level: rowan.level }));
      const scene = makeScene({
        runManager: rm,
        deployed,
        npcSpawn: { className: 'Myrmidon', name: 'Kenji', col: 3, row: 2, level: 1 },
      });
      const bc = rm.getLockedBattleConfig();
      bc.cols = 10;
      bc.rows = 6;
      bc.mapLayout = Array.from({ length: 6 }, () => Array(10).fill(0));
      bc.mapLayout[2][3] = layoutTile;
      let draws = 0;
      const prev = Math.random;
      Math.random = () => {
        draws++;
        return 0.5;
      };
      try {
        BattleScene.prototype.beginBattle.call(scene, deployed);
      } finally {
        Math.random = prev;
      }
      return { npc: scene.npcUnits[0], draws, bc };
    };
    const plain = spawnWith(0);
    expect([plain.npc.col, plain.npc.row]).toEqual([3, 2]);
    const moved = spawnWith(swamp);
    expect([moved.npc.col, moved.npc.row]).not.toEqual([3, 2]);
    expect(moved.bc.mapLayout[moved.npc.row][moved.npc.col]).toBe(0);
    expect(moved.draws).toBe(plain.draws);
  });

  it('a benched unit that shares a deployed unit’s name still comes back on victory', () => {
    const rm = realRun();
    const [edric] = rm.roster;
    const twin = { ...structuredClone(rm.roster[1]), name: 'Wren', unitUid: 'ru90' };
    const other = { ...structuredClone(rm.roster[1]), name: 'Wren', unitUid: 'ru91' };
    const roster = [structuredClone(edric), twin, other];
    const deployed = [roster[0], roster[1]];
    const scene = makeScene({
      runManager: rm,
      deployed,
      npcSpawn: { className: 'Archer', name: 'Wren', col: 3, row: 2, level: 1 },
    });
    scene.roster = roster;
    BattleScene.prototype.beginBattle.call(scene, deployed);
    expect(scene.nonDeployedUnits.map((u) => u.unitUid)).toEqual(['ru91']);
  });

  it('falls back to a standalone build when the node is not on the run map', () => {
    const rm = { roster: [], fallenUnits: [] };
    const deployed = [
      {
        name: 'Edric',
        className: 'Lord',
        isLord: true,
        level: 3,
        stats: { HP: 20 },
        inventory: [],
      },
    ];
    const scene = makeScene({
      runManager: rm,
      deployed,
      npcSpawn: { className: 'Fighter', name: 'Bram', col: 3, row: 1, level: 1 },
    });
    // A run manager with no node map (lab fixtures) takes the standalone build.
    BattleScene.prototype.beginBattle.call(scene, deployed);
    expect(scene.npcUnits[0]?.className).toBe('Fighter');
    expect(scene.npcUnits[0]?.name).toBe('Bram');
  });
});
