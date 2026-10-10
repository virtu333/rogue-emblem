// Steal in the battle scene: the Ability row and its words, the target step in
// SELECTING_ABILITY_TILE, the one action (the item into the bag or the convoy, the carrier's
// pip), the history beat a rewind row reads, what the carrier's lines say, and what the fog
// may show. The rules are in tests/Steal.test.js; the checkpoint, resume and rewind of the
// transfer are in tests/RewindSteal.test.js.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { Grid } from '../src/engine/Grid.js';
import { AbilityController } from '../src/ui/AbilityController.js';
import { RunManager } from '../src/engine/RunManager.js';
import { carriedItemInfo, carrierPipShown } from '../src/engine/BattleInformation.js';
import { summarizeActionFact, describeBefore } from '../src/engine/RewindDestinations.js';
import { makeGoldPouch } from '../src/engine/GoldPouch.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const steal = gameData.skills.find((s) => s.id === 'steal');
const catalog = (name) => structuredClone(gameData.consumables.find((c) => c.name === name));
const T = Object.fromEntries(gameData.terrain.map((t, i) => [t.name, i]));

function unit(name, col, row, extra = {}) {
  const stats = { HP: 24, STR: 4, MAG: 0, SKL: 7, SPD: 9, LCK: 7, DEF: 2, RES: 2, MOV: 5 };
  return {
    name,
    faction: 'player',
    col,
    row,
    currentHP: 24,
    stats,
    mov: 5,
    moveType: 'Infantry',
    weapon: null,
    inventory: [],
    consumables: [],
    skills: [],
    proficiencies: [],
    _conditions: [],
    ...extra,
  };
}
const carrier = (name, col, row, item = 'Vulnerary', extra = {}) =>
  unit(name, col, row, {
    faction: 'enemy',
    carriedItem: { ...catalog(item), uid: `itm_${name}` },
    ...extra,
  });

function stubGrid() {
  return {
    cols: 12,
    rows: 12,
    fogEnabled: false,
    getMoveCost: () => 1,
    gridToPixel: (col, row) => ({ x: col * 32, y: row * 32 }),
    showAttackRange: vi.fn(),
    clearAttackHighlights: vi.fn(),
    clearHighlights: vi.fn(),
  };
}

function sceneWith({ players, enemies = [], run = null }) {
  const scene = new BattleScene();
  Object.assign(scene, {
    _battleSession: 1,
    gameData: { skills: gameData.skills, affixes: gameData.affixes, classes: [], lords: [] },
    turnManager: { turnNumber: 1, currentPhase: 'player' },
    grid: stubGrid(),
    playerUnits: players,
    enemyUnits: enemies,
    npcUnits: [],
    registry: { get: vi.fn(() => null) },
    runManager: run,
    updateHPBar: vi.fn(),
    updateAffixPips: vi.fn(),
    showMinorHintAt: vi.fn(),
    updateUnitPosition: vi.fn(),
    commitVisionSnapshotIfPending: vi.fn(),
    finishUnitAction: vi.fn(),
    _refreshPostCombatMovementState: vi.fn(),
    _combatFx: { playBuff: vi.fn(), playHeal: vi.fn(), playStatus: vi.fn() },
    _awaitSceneTween: vi.fn(async () => {}),
    hideActionMenu: vi.fn(() => {
      scene.actionMenu = [];
    }),
    showActionMenu: vi.fn(),
    selectedUnit: players[0],
  });
  scene._abilityController = new AbilityController(scene);
  return scene;
}

const entryOf = (scene, thief) => {
  const [entry] = scene._abilityController._getAbilityEntries(thief);
  return [entry, scene._abilityController._statusLine(thief, entry)];
};
const fullBag = () => [catalog('Herb'), catalog('Herb'), catalog('Herb')];

describe('the Steal row', () => {
  it('is offered beside a carrier: unlimited uses, ends the action', () => {
    const t = unit('Thief', 5, 5, { skills: ['steal'] });
    const scene = sceneWith({ players: [t], enemies: [carrier('Brigand', 6, 5)], run: new RunManager(gameData) }); // prettier-ignore
    const [entry, line] = entryOf(scene, t);
    expect(entry).toMatchObject({ canUse: true, hasTargets: true, stealReason: null });
    expect(line).toBe('Unlimited uses · Ends unit action');
  });

  it('says "Too slow" beside a faster carrier, and "No valid targets" beside nothing', () => {
    const t = unit('Thief', 5, 5, { skills: ['steal'] });
    const quick = carrier('Quick', 6, 5, 'Vulnerary', { stats: { ...t.stats, SPD: 12 } });
    const scene = sceneWith({ players: [t], enemies: [quick], run: new RunManager(gameData) });
    expect(entryOf(scene, t)[1]).toBe('Unlimited uses · Too slow');
    scene.enemyUnits = [];
    expect(entryOf(scene, t)[1]).toBe('Unlimited uses · No valid targets');
    scene.enemyUnits = [unit('Plain', 6, 5, { faction: 'enemy' })];
    expect(entryOf(scene, t)[1]).toBe('Unlimited uses · No valid targets');
  });

  it('says "Bag and convoy full" when there is nowhere to put it', () => {
    const t = unit('Thief', 5, 5, { skills: ['steal'], consumables: fullBag() });
    const run = new RunManager(gameData);
    while (run.addToConvoy(catalog('Herb')));
    const scene = sceneWith({ players: [t], enemies: [carrier('Brigand', 6, 5)], run });
    const [entry, line] = entryOf(scene, t);
    expect(entry.hasTargets).toBe(false);
    expect(line).toBe('Unlimited uses · Bag and convoy full');
  });

  it('with a free convoy slot the same thief steals: the convoy is the second room', () => {
    const t = unit('Thief', 5, 5, { skills: ['steal'], consumables: fullBag() });
    const scene = sceneWith({ players: [t], enemies: [carrier('Brigand', 6, 5)], run: new RunManager(gameData) }); // prettier-ignore
    expect(entryOf(scene, t)[0].hasTargets).toBe(true);
  });
});

describe('Steal in the battle scene', () => {
  const setup = (extra = {}) => {
    const t = unit('Thief', 5, 5, { skills: ['steal'], ...extra });
    const brigand = carrier('Brigand', 6, 5);
    const bystander = carrier('Bystander', 5, 4);
    const run = new RunManager(gameData);
    const scene = sceneWith({ players: [t], enemies: [brigand, bystander], run });
    return { scene, t, brigand, bystander, run };
  };

  it('aiming highlights every robbable carrier in the foe colour and waits for a tap', () => {
    const { scene, t } = setup();
    scene._abilityController._selectAbility(t, steal);
    expect(scene.battleState).toBe('SELECTING_ABILITY_TILE');
    expect(scene.abilityTiles).toEqual([
      { col: 5, row: 4 },
      { col: 6, row: 5 },
    ]);
    expect(scene._pendingAbility).toEqual({ unitName: 'Thief', skillId: 'steal' });
    expect(scene.grid.showAttackRange.mock.calls.at(-1)[1]).toBe(0xe8a44a);
  });

  it('a tap elsewhere does nothing; a tap on a carrier takes its item into the bag and ends the action', async () => {
    // prettier-ignore
    const { scene, t, brigand, bystander } = setup();
    scene._abilityController._selectAbility(t, steal);
    scene.handleAbilityTileClick({ col: 9, row: 9 });
    expect(brigand.carriedItem).toBeTruthy();
    expect(scene.finishUnitAction).not.toHaveBeenCalled();

    const item = brigand.carriedItem;
    scene.handleAbilityTileClick({ col: 6, row: 5 });
    await vi.waitFor(() => expect(scene.finishUnitAction).toHaveBeenCalled());
    expect(t.consumables).toEqual([item]);
    expect(t.consumables[0]).toBe(item);
    expect(brigand.carriedItem).toBeUndefined();
    expect(bystander.carriedItem?.uid).toBe('itm_Bystander'); // another carrier is untouched
    expect(scene._pendingAbility).toBeNull();
    expect(scene.abilityTiles).toEqual([]);
    expect(scene.finishUnitAction).toHaveBeenCalledWith(t, { session: 1 });
    // The carrier's sack pip is redrawn without the sack, and the thief is told.
    expect(scene.updateAffixPips).toHaveBeenCalledWith(brigand);
    expect(scene.showMinorHintAt.mock.calls.map((c) => c[2])).toEqual(['Stole Vulnerary']);
    expect(t._battleAbilityUsage).toBeUndefined(); // no per-battle limit
  });

  it('into the convoy: the item is in the run, once, under its own uid', async () => {
    const { scene, t, brigand, run } = setup({ consumables: fullBag() });
    scene._abilityController._selectAbility(t, steal);
    scene.handleAbilityTileClick({ col: 6, row: 5 });
    await vi.waitFor(() => expect(scene.finishUnitAction).toHaveBeenCalled());
    expect(run.convoy.consumables.map((i) => i.uid)).toEqual(['itm_Brigand']);
    expect(t.consumables).toHaveLength(3);
    expect(brigand.carriedItem).toBeUndefined();
    expect(scene.showMinorHintAt.mock.calls.map((c) => c[2])).toEqual(['Stole Vulnerary (convoy)']);
  });

  it('a tap that is stale by then (the bag and convoy filled) says why and changes nothing', async () => {
    // prettier-ignore
    const { scene, t, brigand, run } = setup({ consumables: fullBag() });
    scene._abilityController._selectAbility(t, steal);
    // Between aiming and the tap the convoy fills (a trade, a village reward...).
    while (run.addToConvoy(catalog('Herb')));
    const before = structuredClone({ t, brigand, convoy: run.convoy });
    scene.handleAbilityTileClick({ col: 6, row: 5 });
    expect(scene.showMinorHintAt.mock.calls.map((c) => c[2])).toEqual(['Bag and convoy full']);
    expect(scene.finishUnitAction).not.toHaveBeenCalled();
    expect(structuredClone({ t, brigand, convoy: run.convoy })).toEqual(before);
    expect(brigand.carriedItem.uid).toBe('itm_Brigand');
  });

  it('the action itself re-checks: a target no longer legal is refused with nothing moved', async () => {
    // prettier-ignore
    const { scene, t, brigand, run } = setup({ consumables: fullBag() });
    const target = scene._abilityController._targeting().find(t, steal)[0];
    while (run.addToConvoy(catalog('Herb')));
    const before = structuredClone({ t, brigand, convoy: run.convoy });
    expect(await scene._abilityController._targeting().execute(t, steal, target)).toBe(false);
    expect(scene.finishUnitAction).not.toHaveBeenCalled();
    expect(scene.showActionMenu).toHaveBeenCalledWith(t);
    expect(structuredClone({ t, brigand, convoy: run.convoy })).toEqual(before);
  });

  it('Back out of aiming returns to the action menu and clears the highlight', () => {
    const { scene, t, brigand } = setup();
    scene._abilityController._selectAbility(t, steal);
    scene.handleCancel();
    expect(scene.grid.clearAttackHighlights).toHaveBeenCalled();
    expect(scene.abilityTiles).toEqual([]);
    expect(scene._pendingAbility).toBeNull();
    expect(scene.showActionMenu).toHaveBeenCalledWith(t);
    expect(brigand.carriedItem).toBeTruthy();
  });

  it('records a history beat a rewind row can name: "Before Thief’s steal on Brigand"', async () => {
    const { scene, t, brigand } = setup();
    let beats;
    scene.runManager.battleInProgress = true;
    scene._captureSuspendCheckpoint = vi.fn(() => {
      beats = structuredClone(scene._historyBeats);
      return true;
    });
    t.battleEntityId = 'u1';
    brigand.battleEntityId = 'u2';
    scene._abilityController._selectAbility(t, steal);
    scene.handleAbilityTileClick({ col: 6, row: 5 });
    await vi.waitFor(() => expect(scene.finishUnitAction).toHaveBeenCalled());
    const fact = summarizeActionFact(beats, 'u1', (id) => ({ u1: t, u2: brigand })[id]);
    expect(fact).toMatchObject({ verb: 'steal', target: 'Brigand' });
    expect(describeBefore(fact)).toBe('Before Thief’s steal on Brigand');
  });
});

describe('what a carrier shows', () => {
  it('"Carrying: Vulnerary"; a Gold Pouch adds its gold; a unit with nothing shows nothing', () => {
    expect(carriedItemInfo(carrier('A', 1, 1))).toMatchObject({ text: 'Carrying: Vulnerary' });
    const pouch = unit('B', 1, 1, { faction: 'enemy', carriedItem: makeGoldPouch(catalog('Gold Pouch'), 500) }); // prettier-ignore
    expect(carriedItemInfo(pouch).text).toBe('Carrying: Gold Pouch (500 G)');
    expect(carriedItemInfo(unit('C', 1, 1, { faction: 'enemy' }))).toBeNull();
    // Only a foe wears it: the same field on a player unit reads as nothing.
    expect(carriedItemInfo(unit('D', 1, 1, { carriedItem: catalog('Vulnerary') }))).toBeNull();
  });

  it('the detail overlay, the inspection panel and the phone HUD all read the same line', () => {
    // One source: carriedItemInfo. Each surface imports it (a surface that rebuilt the text
    // could say something else), so hold the import, not the pixels.
    for (const name of [
      'UnitDetailOverlay',
      'UnitInspectionPanel',
      'MobileBattleHUD',
      'MobileRosterSheet',
    ]) {
      const source = readFileSync(new URL(`../src/ui/${name}.js`, import.meta.url), 'utf8');
      expect(source, name).toMatch(/carriedItemInfo\(/);
    }
  });
});

function mockGfx() {
  const stub = new Proxy({}, { get: (t, p) => (p === 'destroy' ? () => {} : () => stub) });
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
    textures: { exists: () => false },
  };
}
function fogRow(width, hidden) {
  const map = [Array(width).fill(T.Plain)];
  const grid = new Grid(mockGfx(), width, 1, gameData.terrain, map, true);
  grid.isVisible = (col, row) => !hidden.has(`${col},${row}`);
  return grid;
}

describe('the fog', () => {
  it('the sack pip is shown only while its carrier is in view', () => {
    const foe = carrier('Foe', 6, 0);
    expect(carrierPipShown(fogRow(12, new Set()), foe)).toBe(true);
    expect(carrierPipShown(fogRow(12, new Set(['6,0'])), foe)).toBe(false);
    expect(carrierPipShown(fogRow(12, new Set(['6,0'])), { ...foe, col: 7 })).toBe(true); // moved to a seen tile // prettier-ignore
    expect(carrierPipShown(fogRow(12, new Set()), { ...foe, currentHP: 0 })).toBe(false);
    expect(carrierPipShown(fogRow(12, new Set()), unit('Plain', 6, 0, { faction: 'enemy' }))).toBe(false); // prettier-ignore
  });

  it('the scene draws the sack beside the affix pips, hidden in fog and shown in view', () => {
    const drawn = [];
    const rect = (x, y, w, h, color) => {
      const pip = { x, y, w, h, color, visible: true, destroyed: false };
      const chain = {
        setStrokeStyle: () => chain,
        setDepth: () => chain,
        setVisible: (v) => {
          pip.visible = v;
          return chain;
        },
        destroy: () => {
          pip.destroyed = true;
        },
        pip,
      };
      drawn.push(chain);
      return chain;
    };
    const build = (hidden) => {
      const scene = Object.create(BattleScene.prototype);
      Object.assign(scene, {
        grid: Object.assign(fogRow(12, hidden), { gridToPixel: (c, r) => ({ x: c * 32, y: r * 32 }) }), // prettier-ignore
        gameData: { affixes: gameData.affixes },
        add: { rectangle: rect },
      });
      return scene;
    };
    const foe = carrier('Foe', 6, 0, 'Vulnerary', { affixes: [gameData.affixes.affixes[0].id] });
    drawn.length = 0;
    const seen = build(new Set());
    seen.updateAffixPips.call(seen, foe);
    expect(foe.affixPips).toHaveLength(2); // one affix, one sack
    expect(foe.affixPips.map((p) => p.pip.visible)).toEqual([true, true]);
    const sack = foe.affixPips.at(-1).pip;
    expect(sack.x).toBeGreaterThan(foe.affixPips[0].pip.x); // after the affixes

    const dark = build(new Set(['6,0']));
    dark.updateAffixPips.call(dark, foe);
    expect(foe.affixPips.at(-1).pip.visible).toBe(false); // never drawn in fog

    // After the steal the sack is gone and the affix pip stays.
    delete foe.carriedItem;
    seen.updateAffixPips.call(seen, foe);
    expect(foe.affixPips).toHaveLength(1);
    // A carrier with no affix still gets its one pip.
    const plain = carrier('Plain', 3, 0);
    seen.updateAffixPips.call(seen, plain);
    expect(plain.affixPips).toHaveLength(1);
  });

  it('a carrier standing in fog is not offered and changes nothing the player sees', () => {
    const worlds = [false, true].map((withCarrier) => {
      const t = unit('Thief', 4, 0, { skills: ['steal'] });
      const enemies = withCarrier ? [carrier('Lurker', 5, 0)] : [];
      const scene = sceneWith({ players: [t], enemies, run: new RunManager(gameData) });
      scene.grid = fogRow(12, new Set(['5,0']));
      scene.grid.showAttackRange = vi.fn();
      scene._abilityController = new AbilityController(scene);
      const [entry, line] = entryOf(scene, t);
      scene._abilityController._selectAbility(t, steal);
      return {
        hasTargets: entry.hasTargets,
        reason: entry.stealReason,
        line,
        tiles: scene.abilityTiles,
        shown: scene.grid.showAttackRange.mock.calls.map(([tiles]) => tiles),
        found: scene._abilityController._targeting().find(t, steal).length,
      };
    });
    expect(worlds[1]).toEqual(worlds[0]);
    expect(worlds[0]).toMatchObject({ hasTargets: false, reason: null, found: 0 });
    expect(worlds[0].line).toBe('Unlimited uses · No valid targets');
  });

  it('control: once the tile is seen, the carrier is offered', () => {
    const t = unit('Thief', 4, 0, { skills: ['steal'] });
    const scene = sceneWith({ players: [t], enemies: [carrier('Lurker', 5, 0)], run: new RunManager(gameData) }); // prettier-ignore
    scene.grid = fogRow(12, new Set());
    scene._abilityController = new AbilityController(scene);
    expect(entryOf(scene, t)[0].hasTargets).toBe(true);
  });
});
