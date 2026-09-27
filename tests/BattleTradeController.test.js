// BattleTradeController: the one write path for battle trades
// (docs/specs/item-trade.md, "Battle"). A hand-built session: Edric has moved to
// (2,2) and trades with Sera at (2,3); both carry full bags. Every expected bag is
// derived by hand from the spec's apply rules (swap keeps slots, give appends,
// settleEquipped keeps / prefers the incoming / falls back to the first usable
// weapon, then moves the equipped weapon to slot 0).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { loadGameData } from './testData.js';
import { installFakeDom } from './helpers/fakeDom.js';
import {
  BATTLE_TRADE_CTX,
  BattleTradeController,
  TRADE_UNAVAILABLE,
  battleTradeController,
} from '../src/ui/BattleTradeController.js';
import { BattleTradeMenu } from '../src/ui/BattleTradeMenu.js';
import { TRADE_REASONS, unitHolder } from '../src/engine/ItemTrade.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { fingerprintChanges, rewindFingerprint } from '../src/ui/BattleTimelineRecorder.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';
import { BattleScene } from '../src/scenes/BattleScene.js';

const gameData = loadGameData();
const json = (value) => JSON.parse(JSON.stringify(value));

/** A catalog item as a carried instance with its own uid (and any instance fields). */
function item(name, uid, fields = {}) {
  const base =
    gameData.weapons.find((w) => w.name === name) ||
    gameData.consumables.find((c) => c.name === name);
  if (!base) throw new Error(`No item ${name}`);
  return { ...structuredClone(base), uid, ...fields };
}

function session() {
  // Edric's equipped Iron Sword carries every per-instance field a trade must keep.
  const ironSword = item('Iron Sword', 'uid-iron-sword', {
    name: 'Iron Sword +1',
    _baseName: 'Iron Sword',
    _forgeLevel: 1,
    _forgeBonuses: { might: 1, crit: 0, hit: 0, weight: 0 },
    _forgeHistory: ['might'],
    might: 6,
    _imbueId: 'ember',
    weaponArtIds: ['sword_wrath_strike'],
    weaponArtSources: ['meta_innate'],
  });
  const edricBag = [
    ironSword,
    item('Steel Sword', 'uid-steel-sword'),
    item('Rapier', 'uid-rapier'),
    item('Hand Axe', 'uid-hand-axe'),
    item('Javelin', 'uid-javelin'),
  ];
  const ironLance = item('Iron Lance', 'uid-iron-lance', { _usesSpent: 0 });
  const heal = item('Heal', 'uid-heal', { _usesSpent: 2 });
  const seraBag = [
    ironLance,
    item('Steel Lance', 'uid-steel-lance'),
    item('Keen Sword', 'uid-keen-sword'),
    heal,
    item('Spear', 'uid-spear'),
  ];
  const edric = {
    name: 'Edric',
    battleEntityId: 'u1',
    faction: 'player',
    col: 2,
    row: 2,
    hasMoved: true,
    hasActed: false,
    _movementSpent: 2,
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    inventory: edricBag,
    weapon: ironSword,
    consumables: [
      item('Vulnerary', 'uid-vul-1'),
      item('Elixir', 'uid-elixir'),
      item('Vulnerary', 'uid-vul-2'),
    ],
    stats: { HP: 22, MOV: 5 },
    currentHP: 22,
  };
  const sera = {
    name: 'Sera',
    battleEntityId: 'u2',
    faction: 'player',
    col: 2,
    row: 3,
    hasMoved: false,
    hasActed: false,
    _movementSpent: 0,
    proficiencies: [
      { type: 'Lance', rank: 'Prof' },
      { type: 'Sword', rank: 'Prof' },
      { type: 'Staff', rank: 'Prof' },
    ],
    inventory: seraBag,
    weapon: ironLance,
    consumables: [item('Herb', 'uid-herb')],
    stats: { HP: 18, MOV: 5 },
    currentHP: 18,
  };
  const scene = {
    battleState: 'TRADING',
    turnManager: { currentPhase: 'player' },
    selectedUnit: edric,
    playerUnits: [edric, sera],
    tradeMutatedThisSession: false,
    preMoveLoc: { col: 2, row: 1 },
    runManager: { battleInProgress: {} },
    grid: { fogEnabled: false },
    checkpoints: [],
  };
  scene.commitVisionSnapshotIfPending = vi.fn();
  // A checkpoint is what BattleUnitState serializes, across a JSON boundary.
  scene._captureSuspendCheckpoint = vi.fn(() =>
    scene.checkpoints.push(json({ playerUnits: scene.playerUnits.map(serializeBattleUnit) })),
  );
  const controller = new BattleTradeController(scene).create();
  const slot = (unit, bag, carried) => ({ holder: unitHolder(unit), bag, item: carried });
  return { scene, controller, edric, sera, ironSword, ironLance, heal, slot };
}

const beats = (scene) => (scene._historyBeats || []).filter((b) => b.type === 'traded with');
const uids = (list) => list.map((i) => i.uid);
/** Everything about a unit except its bags and equipped weapon. */
function standing(unit) {
  const { inventory: _i, consumables: _c, weapon: _w, ...rest } = unit;
  return structuredClone(rest);
}

describe('BattleTradeController.commit', () => {
  it('swaps equipped weapons between two full bags, re-equipping each side by the rules', () => {
    const { scene, controller, edric, sera, ironSword, ironLance, slot } = session();
    const result = controller.commit(
      edric,
      sera,
      slot(edric, 'inventory', ironSword),
      slot(sera, 'inventory', ironLance),
    );
    expect(result).toEqual({
      ok: true,
      kind: 'swap',
      detail: 'Iron Sword +1 for Iron Lance',
      warnings: [{ code: 'cannot_equip', unit: edric }],
    });
    // Edric: slot 0 took the Iron Lance (unusable); his first usable weapon, the
    // Steel Sword in slot 1, is equipped and moved to slot 0.
    expect(uids(edric.inventory)).toEqual([
      'uid-steel-sword',
      'uid-iron-lance',
      'uid-rapier',
      'uid-hand-axe',
      'uid-javelin',
    ]);
    expect(edric.weapon.uid).toBe('uid-steel-sword');
    // Sera: slot 0 took the Iron Sword +1, which she can use: the incoming item.
    expect(uids(sera.inventory)).toEqual([
      'uid-iron-sword',
      'uid-steel-lance',
      'uid-keen-sword',
      'uid-heal',
      'uid-spear',
    ]);
    expect(sera.weapon).toBe(ironSword);
    // Same instances, fields intact.
    expect(sera.inventory[0]).toBe(ironSword);
    expect(edric.inventory[1]).toBe(ironLance);
    expect(scene.battleState).toBe('TRADING');
  });

  it('locks in the move once per session; every commit records and checkpoints', () => {
    const { scene, controller, edric, sera, ironSword, ironLance, slot } = session();
    const [vulnerary] = edric.consumables;
    const herb = sera.consumables[0];
    expect(
      controller.commit(
        edric,
        sera,
        slot(edric, 'consumables', vulnerary),
        slot(sera, 'consumables', null),
      ).ok,
    ).toBe(true);
    expect(scene).toMatchObject({ tradeMutatedThisSession: true, preMoveLoc: null });
    expect(edric._movementCommitted).toBe(true);
    expect(scene.commitVisionSnapshotIfPending).toHaveBeenCalledOnce();
    // A later commit in the same session (from the partner's column) adds no second lock.
    scene.preMoveLoc = { col: 9, row: 9 }; // stale; only a first commit clears it
    expect(
      controller.commit(
        edric,
        sera,
        slot(sera, 'consumables', herb),
        slot(edric, 'consumables', null),
      ).ok,
    ).toBe(true);
    expect(
      controller.commit(
        edric,
        sera,
        slot(edric, 'inventory', ironSword),
        slot(sera, 'inventory', ironLance),
      ).ok,
    ).toBe(true);
    expect(scene.commitVisionSnapshotIfPending).toHaveBeenCalledOnce();
    expect(scene.preMoveLoc).toEqual({ col: 9, row: 9 });
    expect(scene._captureSuspendCheckpoint).toHaveBeenCalledTimes(3);
    // The acting unit is always the actor, whichever column the item left.
    expect(beats(scene).map((b) => b.label)).toEqual([
      'Edric traded with Sera · Vulnerary.',
      'Edric traded with Sera · Herb.',
      'Edric traded with Sera · Iron Sword +1 for Iron Lance.',
    ]);
    expect(beats(scene).every((b) => b.actorId === 'u1' && b.targetId === 'u2')).toBe(true);
    // A new session (the menu reopened) locks again on its first commit.
    scene.tradeMutatedThisSession = false;
    const [elixir] = edric.consumables.filter((c) => c.name === 'Elixir');
    controller.commit(
      edric,
      sera,
      slot(edric, 'consumables', elixir),
      slot(sera, 'consumables', null),
    );
    expect(scene.commitVisionSnapshotIfPending).toHaveBeenCalledTimes(2);
    expect(scene.preMoveLoc).toBeNull();
  });

  it('checkpoints after the write, with the history beat already recorded', () => {
    const { scene, controller, edric, sera, ironSword, ironLance, slot } = session();
    scene._captureSuspendCheckpoint.mockImplementation(() => {
      scene.checkpoints.push({
        edric: uids(edric.inventory),
        committed: edric._movementCommitted,
        beats: beats(scene).length,
      });
    });
    controller.commit(
      edric,
      sera,
      slot(edric, 'inventory', ironSword),
      slot(sera, 'inventory', ironLance),
    );
    expect(scene.checkpoints).toEqual([
      {
        edric: ['uid-steel-sword', 'uid-iron-lance', 'uid-rapier', 'uid-hand-axe', 'uid-javelin'],
        committed: true,
        beats: 1,
      },
    ]);
  });

  const guards = {
    'the scene left the trade session': (s) => (s.scene.battleState = 'UNIT_ACTION_MENU'),
    'the enemy phase': (s) => (s.scene.turnManager.currentPhase = 'enemy'),
    'another unit is selected': (s) => (s.scene.selectedUnit = s.sera),
    'nothing is selected': (s) => (s.scene.selectedUnit = null),
    'the acting unit has acted': (s) => (s.edric.hasActed = true),
    'the partner left the field': (s) => (s.scene.playerUnits = [s.edric]),
    'the acting unit left the field': (s) => (s.scene.playerUnits = [s.sera]),
    'the partner is two tiles away': (s) => (s.sera.row = 4),
    'the partner is diagonal': (s) => Object.assign(s.sera, { col: 3, row: 3 }),
    'a slot belongs to a third unit': (s) => {
      const third = { ...s.sera, name: 'Third', inventory: [...s.sera.inventory] };
      s.scene.playerUnits.push(third);
      s.to = s.slot(third, 'inventory', s.ironLance);
    },
    'both slots are the acting unit’s': (s) =>
      (s.to = s.slot(s.edric, 'inventory', s.edric.inventory[1])),
    'the controller was destroyed': (s) => s.controller.destroy(),
  };
  it.each(Object.keys(guards))('refuses without any change when %s', (name) => {
    const s = session();
    s.to = s.slot(s.sera, 'inventory', s.ironLance);
    guards[name](s);
    const bags = json([s.edric, s.sera].map((u) => [u.inventory, u.consumables, u.weapon]));
    const edricStanding = standing(s.edric);
    const result = s.controller.commit(
      s.edric,
      s.sera,
      s.slot(s.edric, 'inventory', s.ironSword),
      s.to,
    );
    expect(result).toEqual({ ok: false, reason: TRADE_UNAVAILABLE });
    expect(json([s.edric, s.sera].map((u) => [u.inventory, u.consumables, u.weapon]))).toEqual(
      bags,
    );
    expect(s.edric.weapon).toBe(s.ironSword);
    expect(standing(s.edric)).toEqual(edricStanding);
    expect(s.scene.tradeMutatedThisSession).toBe(false);
    expect(s.scene.preMoveLoc).toEqual({ col: 2, row: 1 });
    expect(s.scene.commitVisionSnapshotIfPending).not.toHaveBeenCalled();
    expect(s.scene._captureSuspendCheckpoint).not.toHaveBeenCalled();
    expect(beats(s.scene)).toEqual([]);
  });

  it.each([
    [
      'a give into a full bag',
      (s) => [s.slot(s.edric, 'inventory', s.ironSword), s.slot(s.sera, 'inventory', null)],
      TRADE_REASONS.bagFull,
    ],
    [
      'a weapon onto a supply',
      (s) => [
        s.slot(s.edric, 'inventory', s.ironSword),
        s.slot(s.sera, 'consumables', s.sera.consumables[0]),
      ],
      TRADE_REASONS.differentBags,
    ],
    [
      'an item that already left',
      (s) => [s.slot(s.edric, 'inventory', s.ironLance), s.slot(s.sera, 'inventory', s.heal)],
      TRADE_REASONS.stale,
    ],
  ])('a failed plan (%s) never commits movement', (_name, slots, reason) => {
    const s = session();
    const [from, to] = slots(s);
    const before = json([s.edric, s.sera]);
    const result = s.controller.commit(s.edric, s.sera, from, to);
    expect(result).toEqual({ ok: false, reason });
    expect(json([s.edric, s.sera])).toEqual(before);
    expect(s.edric._movementCommitted).toBeUndefined();
    expect(s.scene.tradeMutatedThisSession).toBe(false);
    expect(s.scene.preMoveLoc).toEqual({ col: 2, row: 1 });
    expect(s.scene.commitVisionSnapshotIfPending).not.toHaveBeenCalled();
    expect(s.scene._captureSuspendCheckpoint).not.toHaveBeenCalled();
    expect(beats(s.scene)).toEqual([]);
  });

  it.each([
    ['fresh', {}],
    [
      'already acted',
      { hasMoved: true, hasActed: true, _movementCommitted: false, _movementSpent: 4 },
    ],
    ['moved and committed', { hasMoved: true, _movementCommitted: true, _movementSpent: 3 }],
  ])('never touches the partner (%s)', (_name, partner) => {
    const s = session();
    Object.assign(s.sera, partner);
    const before = standing(s.sera);
    const [vulnerary] = s.edric.consumables;
    s.controller.commit(
      s.edric,
      s.sera,
      s.slot(s.edric, 'inventory', s.ironSword),
      s.slot(s.sera, 'inventory', s.ironLance),
    );
    s.controller.commit(
      s.edric,
      s.sera,
      s.slot(s.edric, 'consumables', vulnerary),
      s.slot(s.sera, 'consumables', null),
    );
    expect(standing(s.sera)).toEqual(before);
    expect(s.edric).toMatchObject({ hasActed: false, hasMoved: true, _movementCommitted: true });
  });

  it('the scene accessor makes one live controller and replaces a destroyed one', () => {
    const scene = {};
    const first = battleTradeController(scene);
    expect(battleTradeController(scene)).toBe(first);
    first.destroy();
    const second = battleTradeController(scene);
    expect(second).not.toBe(first);
    expect(second.destroyed).toBe(false);
    expect(BATTLE_TRADE_CTX).toEqual({ context: 'battle' });
  });
});

describe('BattleScene.findTradeTargets', () => {
  const targets = (scene, unit) =>
    BattleScene.prototype.findTradeTargets.call(scene, unit).map((t) => t.ally.name);

  it('offers a neighbour even when both bags are full (a swap needs no room)', () => {
    const { scene, edric } = session();
    edric.consumables.push(item('Herb', 'uid-herb-2')); // over-full supplies change nothing
    expect(targets(scene, edric)).toEqual(['Sera']);
  });

  it('needs an item on either side, and only orthogonal neighbours', () => {
    const { scene, edric, sera } = session();
    const bare = { ...sera, name: 'Bare', col: 1, row: 2, inventory: [], consumables: [] };
    const far = { ...sera, name: 'Far', col: 4, row: 2 };
    const diagonal = { ...sera, name: 'Diagonal', col: 3, row: 3 };
    scene.playerUnits.push(bare, far, diagonal);
    // Edric carries items, so the empty-handed Bare can still receive one.
    expect(targets(scene, edric)).toEqual(['Sera', 'Bare']);
    edric.inventory = [];
    edric.consumables = [];
    edric.weapon = null;
    expect(targets(scene, edric)).toEqual(['Sera']);
  });
});

describe('a swap survives the checkpoint and the rewind fingerprint', () => {
  function restoreScene() {
    return {
      playerUnits: [],
      enemyUnits: [],
      npcUnits: [],
      addUnitGraphic: vi.fn(),
      dimUnit: vi.fn(),
    };
  }

  it('serialize → JSON → resume restores bags, uids, instance fields and the equipped slot', () => {
    const { scene, controller, edric, sera, ironSword, ironLance, slot } = session();
    controller.commit(
      edric,
      sera,
      slot(edric, 'inventory', ironSword),
      slot(sera, 'inventory', ironLance),
    );
    const [checkpoint] = scene.checkpoints;
    expect(checkpoint.playerUnits.map((u) => u.equippedInventoryIndex)).toEqual([0, 0]);
    const restored = restoreScene();
    new BattleSuspendController(restored).applyUnits({ ...checkpoint, nextEntityId: 3 });
    const [e, s] = restored.playerUnits;
    expect(e.battleEntityId).toBe('u1');
    expect(uids(e.inventory)).toEqual(uids(edric.inventory));
    expect(uids(s.inventory)).toEqual(uids(sera.inventory));
    // Full instance data, field for field (forge, imbue, arts, spent staff uses).
    expect(e.inventory).toEqual(json(edric.inventory));
    expect(s.inventory).toEqual(json(sera.inventory));
    expect(s.inventory[0]).toMatchObject({
      _forgeLevel: 1,
      _imbueId: 'ember',
      weaponArtIds: ['sword_wrath_strike'],
      weaponArtSources: ['meta_innate'],
    });
    expect(s.inventory[3]).toMatchObject({ uid: 'uid-heal', _usesSpent: 2 });
    // The equipped weapon is the carried instance again, not a detached copy.
    expect(e.weapon).toBe(e.inventory[0]);
    expect(e.weapon.uid).toBe('uid-steel-sword');
    expect(s.weapon).toBe(s.inventory[0]);
    expect(s.weapon.uid).toBe('uid-iron-sword');
    expect(e._movementCommitted).toBe(true);
    expect(s._movementCommitted).toBe(false);
    expect('equippedInventoryIndex' in e).toBe(false);
  });

  it('the fingerprint sees a swap on both units, even between identical-looking items', () => {
    const { scene, controller, edric, sera, slot } = session();
    // Two Iron Swords that differ only by uid, both equipped in slot 0.
    const mine = item('Iron Sword', 'uid-sword-a');
    const theirs = item('Iron Sword', 'uid-sword-b');
    edric.inventory[0] = mine;
    edric.weapon = mine;
    sera.inventory[0] = theirs;
    sera.weapon = theirs;
    const before = rewindFingerprint(scene);
    expect(fingerprintChanges(scene, before)).toEqual({ units: [], run: false, changed: false });
    controller.commit(edric, sera, slot(edric, 'inventory', mine), slot(sera, 'inventory', theirs));
    // Each kept its slot-0 equipped sword by name; only the instances moved.
    expect([edric.weapon.name, sera.weapon.name]).toEqual(['Iron Sword', 'Iron Sword']);
    expect([edric.weapon.uid, sera.weapon.uid]).toEqual(['uid-sword-b', 'uid-sword-a']);
    const changes = fingerprintChanges(scene, before);
    expect(changes.changed).toBe(true);
    expect([...changes.units].sort()).toEqual(['u1', 'u2']);
    expect(changes.run).toBe(false);
  });
});

describe('BattleTradeMenu over the controller', () => {
  beforeEach(() => {
    installFakeDom(vi);
    _resetInputFocus();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetInputFocus();
  });

  function eventsFor() {
    const handlers = new Map();
    const listeners = (name) => handlers.get(name) || handlers.set(name, new Set()).get(name);
    return {
      once: (name, fn) => listeners(name).add(fn),
      on: (name, fn) => listeners(name).add(fn),
      off: (name, fn) => listeners(name).delete(fn),
      emit: (name) => [...listeners(name)].forEach((fn) => fn()),
    };
  }

  function openMenu() {
    const s = session();
    Object.assign(s.scene, {
      events: eventsFor(),
      cleanupTradeUI: vi.fn(() => {
        s.scene.battleTradeMenu?.destroy();
        s.scene.battleTradeMenu = null;
      }),
      // As BattleScene.showActionMenu: the flag restarts from the unit's commitment.
      showActionMenu: vi.fn((unit) => {
        s.scene.battleState = 'UNIT_ACTION_MENU';
        s.scene.tradeMutatedThisSession = false;
        s.scene.lastMenuUnit = unit;
      }),
    });
    s.scene.battleTradeMenu = new BattleTradeMenu(s.scene, s.edric, s.sera, s.controller);
    const root = s.scene.battleTradeMenu.menu.surface.root;
    const row = (side, index) =>
      root
        .querySelectorAll('.tm-row')
        .find((el) => el.dataset.side === side && el.dataset.index === String(index));
    return { ...s, root, row };
  }

  it('two taps swap the equipped weapons of two full bags; Done keeps the lock', () => {
    const s = openMenu();
    expect(s.root.querySelectorAll('.tm-tab').map((t) => t.textContent)).toEqual([
      'Weapons 5/5 · 5/5',
      'Supplies 3/3 · 1/3',
    ]);
    expect(s.root.querySelector('.tm-notice').textContent).toBe("Trading locks in Edric's move.");
    s.row('left', 0).click();
    expect(s.row('right', 0).getAttribute('aria-label')).toBe('Trade Iron Sword +1 for Iron Lance');
    expect(s.row('right', 0).getAttribute('aria-disabled')).toBeNull();
    s.row('right', 0).click();
    expect(uids(s.sera.inventory)[0]).toBe('uid-iron-sword');
    expect(s.edric.weapon.uid).toBe('uid-steel-sword');
    expect(s.edric._movementCommitted).toBe(true);
    expect(s.root.querySelector('.tm-notice').hidden).toBe(true);
    expect(s.root.querySelector('.tm-status').textContent).toBe(
      'Traded Iron Sword +1 for Iron Lance.',
    );
    s.root.querySelector('.tm-done').click();
    expect(s.scene.cleanupTradeUI).toHaveBeenCalledOnce();
    expect(s.scene.lastMenuUnit).toBe(s.edric);
    expect(s.scene.tradeMutatedThisSession).toBe(true);
    expect(s.scene.battleTradeMenu).toBeNull();
  });

  it('a refused commit leaves the bags and the lock alone and says why', () => {
    const s = openMenu();
    s.row('left', 0).click();
    s.scene.selectedUnit = null; // the session moved on under the open menu
    s.row('right', 0).click();
    expect(s.edric.inventory[0]).toBe(s.ironSword);
    expect(s.edric._movementCommitted).toBeUndefined();
    expect(s.root.querySelector('.tm-status').textContent).toBe(TRADE_UNAVAILABLE);
  });

  it('teardown (rewind, suspend, shutdown) never returns to the action menu', () => {
    const s = openMenu();
    s.scene.cleanupTradeUI();
    expect(s.scene.showActionMenu).not.toHaveBeenCalled();
    expect(s.root.isConnected).toBe(false);
  });
});
