// Great Sacrifice and Goddess Dance (docs/specs/phase3.md 3E): the rules in the engine and the
// two abilities through the battle scene's Ability menu and confirm prompt.
//
// Ways this goes wrong, each caught below:
//   Great Sacrifice  pays more than the user can spare (below 1 HP) or more than anyone can
//                    use; heals past max HP; mends a Wounded ally; reaches past 2 tiles or
//                    mends the user; is offered when it would only burn HP (the user at 1 HP,
//                    nobody hurt in range: it must never waste the turn); is usable twice in
//                    a battle, or shares one unit's limit with another
//   Goddess Dance    refreshes someone who has not acted, a dancer, or a diagonal neighbour;
//                    leaves a refreshed ally unable to move or act again; resets the ally's
//                    spent movement (Dance never did); skips the deed or the XP of an ally;
//                    differs from Dance's own rule (they share one)
//   model            a lent skill that does not work or show like a known one
// Expected values are worked out by hand from the spec, never by re-running the code under test.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { AbilityController } from '../src/ui/AbilityController.js';
import {
  abilityHasTargets,
  canUseAbility,
  findDanceRefreshTargets,
  getActionAbilities,
  markUsed,
  refreshActedAlly,
  sacrificeAmount,
  sacrificeTargets,
  settleGreatSacrifice,
} from '../src/engine/ActionAbilitySystem.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const skillById = new Map(data.skills.map((skill) => [skill.id, skill]));
const SACRIFICE = skillById.get('great_sacrifice').actionAbility;

function unit(name, col, row, extra = {}) {
  const { stats: overrides, ...rest } = extra;
  const stats = {
    HP: 24,
    STR: 8,
    MAG: 4,
    SKL: 6,
    SPD: 7,
    LCK: 3,
    DEF: 4,
    RES: 2,
    MOV: 5,
    ...overrides,
  };
  return {
    name,
    faction: 'player',
    col,
    row,
    currentHP: stats.HP,
    stats,
    mov: 5,
    moveType: 'Infantry',
    weapon: null,
    inventory: [],
    consumables: [],
    skills: [],
    proficiencies: [],
    _conditions: [],
    ...rest,
  };
}

// --- Great Sacrifice (the rules) -------------------------------------------------------

describe('Great Sacrifice: the rules', () => {
  // User at (5,5). A is 1 tile away, B exactly 2, C 3 (out of range).
  const world = (userHP = 24) => {
    const user = unit('Hero', 5, 5, { currentHP: userHP, skills: ['great_sacrifice'] });
    const a = unit('A', 5, 6, { currentHP: 20 }); // missing 4
    const b = unit('B', 7, 5, { currentHP: 10, stats: { HP: 30 } }); // missing 20
    const c = unit('C', 8, 5, { currentHP: 9 }); // missing 15, out of range
    return { user, a, b, c, pool: [user, a, b, c] };
  };

  it('pays 10 HP (the cap) and heals each ally within 2 tiles by that much, capped at max HP', () => {
    const { user, a, b, c, pool } = world();
    const facts = settleGreatSacrifice(user, SACRIFICE, pool);
    expect(facts.amount).toBe(10);
    expect(facts.paid).toBe(10);
    expect(user.currentHP).toBe(14);
    // A is missing only 4: it tops out at its max (24), not 30.
    expect(a.currentHP).toBe(24);
    expect(b.currentHP).toBe(20);
    expect(c.currentHP).toBe(9);
    expect(facts.targets.map((t) => [t.unit.name, t.hpBefore, t.hpAfter, t.healed])).toEqual([
      ['A', 20, 24, 4],
      ['B', 10, 20, 10],
    ]);
  });

  it('pays only what the user can spare: never below 1 HP, and every ally gets that same amount', () => {
    const { user, a, b, pool } = world(6);
    const facts = settleGreatSacrifice(user, SACRIFICE, pool);
    expect(facts.paid).toBe(5);
    expect(user.currentHP).toBe(1);
    expect(a.currentHP).toBe(24); // +4 (it only missed 4 of the 5)
    expect(b.currentHP).toBe(15); // +5
  });

  it('pays no more than the most hurt ally can use', () => {
    const user = unit('Hero', 5, 5, { currentHP: 24 });
    const a = unit('A', 5, 6, { currentHP: 20 }); // missing 4
    expect(sacrificeAmount(user, SACRIFICE, [user, a])).toBe(4);
    const facts = settleGreatSacrifice(user, SACRIFICE, [user, a]);
    expect(facts.paid).toBe(4);
    expect(user.currentHP).toBe(20);
    expect(a.currentHP).toBe(24);
  });

  it('at 2 HP the user pays exactly 1 and stays on 1 HP', () => {
    const { user, a, pool } = world(2);
    const facts = settleGreatSacrifice(user, SACRIFICE, pool);
    expect(facts.paid).toBe(1);
    expect(user.currentHP).toBe(1);
    expect(a.currentHP).toBe(21);
  });

  it('is not usable at 1 HP, and settling it anyway changes nothing', () => {
    const { user, pool } = world(1);
    const skill = skillById.get('great_sacrifice');
    expect(sacrificeAmount(user, SACRIFICE, pool)).toBe(0);
    expect(abilityHasTargets(user, skill, { allies: pool })).toBe(false);
    const before = structuredClone(pool);
    const facts = settleGreatSacrifice(user, SACRIFICE, pool);
    expect(facts).toMatchObject({ amount: 0, paid: 0, targets: [] });
    expect(pool).toEqual(before);
  });

  it('is not usable when nobody in range is hurt (it never wastes the turn)', () => {
    const user = unit('Hero', 5, 5);
    const well = unit('Well', 5, 6);
    const hurtButFar = unit('Far', 8, 5, { currentHP: 3 });
    const pool = [user, well, hurtButFar];
    expect(abilityHasTargets(user, skillById.get('great_sacrifice'), { allies: pool })).toBe(false);
    // The user itself being hurt gives it no reason: it never mends its own wound.
    user.currentHP = 5;
    expect(abilityHasTargets(user, skillById.get('great_sacrifice'), { allies: pool })).toBe(false);
  });

  it('a Wounded ally heals nothing, and is never what the cost is sized for', () => {
    const user = unit('Hero', 5, 5);
    const wounded = unit('Wounded', 5, 6, { currentHP: 2 }); // missing 22
    applyCondition(wounded, 'wounded', 3);
    const lightly = unit('Light', 6, 5, { currentHP: 21 }); // missing 3
    const pool = [user, wounded, lightly];
    expect(sacrificeTargets(user, SACRIFICE, pool).map((u) => u.name)).toEqual(['Light']);
    expect(sacrificeAmount(user, SACRIFICE, pool)).toBe(3);
    settleGreatSacrifice(user, SACRIFICE, pool);
    expect(wounded.currentHP).toBe(2);
    expect(lightly.currentHP).toBe(24);
    expect(user.currentHP).toBe(21);
    // Nobody else hurt: a Wounded ally alone is not a reason to spend the use.
    expect(
      abilityHasTargets(user, skillById.get('great_sacrifice'), { allies: [user, wounded] }),
    ).toBe(false);
  });

  it('a unit that has fallen is no target', () => {
    const user = unit('Hero', 5, 5);
    const down = unit('Down', 5, 6, { currentHP: 0 });
    expect(sacrificeTargets(user, SACRIFICE, [user, down])).toEqual([]);
  });

  it('once per battle, and the limit belongs to the user', () => {
    const skill = skillById.get('great_sacrifice');
    const first = unit('First', 5, 5, { skills: ['great_sacrifice'] });
    const second = unit('Second', 1, 1, { skills: ['great_sacrifice'] });
    expect(canUseAbility(first, skill).ok).toBe(true);
    markUsed(first, 'great_sacrifice');
    expect(canUseAbility(first, skill)).toEqual({ ok: false, reason: 'per_map_limit' });
    expect(canUseAbility(second, skill).ok).toBe(true);
  });

  it('silence stops it (it is no bodily act)', () => {
    const silenced = unit('Hero', 5, 5);
    applyCondition(silenced, 'silence', 2);
    expect(canUseAbility(silenced, skillById.get('great_sacrifice'))).toEqual({
      ok: false,
      reason: 'silenced',
    });
  });
});

// --- Goddess Dance (the rules) ---------------------------------------------------------

describe('Goddess Dance: the rules', () => {
  const acted = (name, col, row, extra = {}) =>
    unit(name, col, row, {
      hasActed: true,
      hasMoved: true,
      _movementCommitted: true,
      _movementSpent: 3,
      ...extra,
    });

  it('targets the four neighbours that have acted, in the order up, down, left, right', () => {
    const bard = unit('Bard', 5, 5);
    const up = acted('Up', 5, 4);
    const down = acted('Down', 5, 6);
    const left = acted('Left', 4, 5);
    const right = acted('Right', 6, 5);
    const diagonal = acted('Diag', 6, 6);
    const far = acted('Far', 5, 8);
    expect(
      findDanceRefreshTargets(bard, [bard, right, left, down, up, diagonal, far]).map(
        (u) => u.name,
      ),
    ).toEqual(['Up', 'Down', 'Left', 'Right']);
  });

  it('skips allies who have not acted and other dancers', () => {
    const bard = unit('Bard', 5, 5);
    const fresh = unit('Fresh', 5, 4); // has not acted
    const dancer = acted('Dancer', 5, 6, { skills: ['dance'] });
    const lentDancer = acted('Lent', 4, 5, { accessory: { _boundSkill: 'dance' } });
    const spent = acted('Spent', 6, 5);
    expect(
      findDanceRefreshTargets(bard, [bard, fresh, dancer, lentDancer, spent]).map((u) => u.name),
    ).toEqual(['Spent']);
  });

  it('never lists the dancer itself, and a benched Dance does not make a dancer', () => {
    const bard = acted('Bard', 5, 5);
    const benched = acted('Benched', 5, 6, { benchedSkills: ['dance'] });
    expect(findDanceRefreshTargets(bard, [bard, benched]).map((u) => u.name)).toEqual(['Benched']);
  });

  it('the refresh lets the ally move and act again, and leaves its spent movement alone', () => {
    const ally = acted('Ally', 5, 4);
    refreshActedAlly(ally);
    expect(ally.hasActed).toBe(false);
    expect(ally.hasMoved).toBe(false);
    expect(ally._movementCommitted).toBe(false);
    // As Dance: Gambit and Galeforce reset it, Dance does not.
    expect(ally._movementSpent).toBe(3);
  });

  it('is offered only with a refresh to give', () => {
    const skill = skillById.get('goddess_dance');
    const bard = unit('Bard', 5, 5, { skills: ['goddess_dance'] });
    expect(abilityHasTargets(bard, skill, { allies: [bard, unit('Fresh', 5, 4)] })).toBe(false);
    expect(abilityHasTargets(bard, skill, { allies: [bard, acted('Spent', 5, 4)] })).toBe(true);
  });

  it('works while silenced (a dance is no spell), once per battle', () => {
    const skill = skillById.get('goddess_dance');
    const bard = unit('Bard', 5, 5);
    applyCondition(bard, 'silence', 2);
    expect(canUseAbility(bard, skill).ok).toBe(true);
    markUsed(bard, 'goddess_dance');
    expect(canUseAbility(bard, skill)).toEqual({ ok: false, reason: 'per_map_limit' });
  });
});

// --- In the battle scene ---------------------------------------------------------------

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

function sceneWith({ players, npcs = [] }) {
  const scene = new BattleScene();
  Object.assign(scene, {
    _battleSession: 1,
    gameData: { skills: data.skills, affixes: data.affixes, classes: [], lords: [] },
    turnManager: { turnNumber: 1, currentPhase: 'player' },
    grid: stubGrid(),
    playerUnits: players,
    enemyUnits: [],
    npcUnits: npcs,
    registry: { get: vi.fn(() => null) },
    updateHPBar: vi.fn(),
    showMinorHintAt: vi.fn(),
    updateUnitPosition: vi.fn(),
    undimUnit: vi.fn(),
    commitVisionSnapshotIfPending: vi.fn(),
    finishUnitAction: vi.fn(),
    awardScaledXP: vi.fn(() => 20),
    _deedController: { onHeal: vi.fn(), onRefresh: vi.fn() },
    _refreshPostCombatMovementState: vi.fn(),
    _combatFx: { playBuff: vi.fn(), playHeal: vi.fn(), playStatus: vi.fn() },
    _awaitSceneTween: vi.fn(async () => {}),
    hideActionMenu: vi.fn(() => {
      scene.actionMenu = [];
    }),
    showActionMenu: vi.fn(),
    _reduceMotion: () => true,
    time: { delayedCall: vi.fn() },
    add: { circle: vi.fn(() => ({ setDepth: () => ({ destroy() {} }) })) },
    selectedUnit: players[0],
  });
  scene._abilityController = new AbilityController(scene);
  return scene;
}

describe('Great Sacrifice in the battle scene', () => {
  const setup = (userHP = 24) => {
    const user = unit('Hero', 5, 5, { currentHP: userHP, skills: ['great_sacrifice'] });
    const hurt = unit('Hurt', 5, 6, { currentHP: 12 });
    const scene = sceneWith({ players: [user, hurt] });
    return { scene, user, hurt };
  };
  const skill = skillById.get('great_sacrifice');

  it('is listed in the Ability menu with its status, and greyed with a reason when it would waste the turn', () => {
    const { scene, user, hurt } = setup();
    const ctrl = scene._abilityController;
    let [entry] = ctrl._getAbilityEntries(user);
    expect(entry).toMatchObject({ canUse: true, hasTargets: true });
    expect(ctrl._statusLine(user, entry)).toBe('1/1 uses left · Ends unit action');
    hurt.currentHP = hurt.stats.HP;
    [entry] = ctrl._getAbilityEntries(user);
    expect(entry.hasTargets).toBe(false);
    expect(ctrl._statusLine(user, entry)).toBe('1/1 uses left · No valid targets');
    user.currentHP = 1;
    hurt.currentHP = 5;
    [entry] = ctrl._getAbilityEntries(user);
    expect(ctrl._statusLine(user, entry)).toBe('1/1 uses left · Too little HP');
  });

  it('is the ability picker row of a unit that knows it', () => {
    const { user } = setup();
    expect(getActionAbilities(user, data.skills).map((s) => s.id)).toEqual(['great_sacrifice']);
  });

  it('the confirm prompt names the cost and who is mended, and highlights them', () => {
    const { scene, user, hurt } = setup();
    scene.registry = { get: vi.fn(() => null) };
    scene._makeMenuTextButton = vi.fn(() => ({}));
    scene._pinToScreen = vi.fn();
    scene._registerActionMenu = vi.fn();
    scene._clampMenuPosition = vi.fn((x, y) => ({ x, y }));
    scene.add = {
      rectangle: vi.fn(() => ({ setDepth: () => ({ setStrokeStyle: () => ({}) }) })),
    };
    scene._abilityController._selectAbility(user, skill);
    expect(scene._makeMenuTextButton.mock.calls[0][2]).toBe('Use Great Sacrifice (-10 HP, 1 ally)');
    const [tiles] = scene.grid.showAttackRange.mock.calls.at(-1);
    expect(tiles).toEqual([{ col: hurt.col, row: hurt.row }]);
  });

  it('confirming pays, heals, records history and deeds, spends the use and ends the action', async () => {
    const { scene, user, hurt } = setup();
    scene.runManager = { battleInProgress: true };
    user.battleEntityId = 'u1';
    hurt.battleEntityId = 'u2';
    let beats;
    scene._captureSuspendCheckpoint = vi.fn(() => {
      beats = structuredClone(scene._historyBeats);
      return true;
    });
    await scene._abilityController.executeSelfCentered(user, skill);
    expect(user.currentHP).toBe(14); // 24 - min(10 cap, 23 spare, 12 missing)
    expect(hurt.currentHP).toBe(22);
    expect(user._battleAbilityUsage.map.great_sacrifice).toBe(1);
    expect(scene._deedController.onHeal).toHaveBeenCalledTimes(1);
    expect(scene._deedController.onHeal).toHaveBeenCalledWith(user, hurt, 12);
    expect(beats.map((b) => [b.type, b.outcome?.amount])).toEqual([['healed', 10]]);
    expect(scene.finishUnitAction).toHaveBeenCalledWith(user, { session: 1 });
    expect(scene.updateHPBar).toHaveBeenCalledWith(user);
    expect(scene.updateHPBar).toHaveBeenCalledWith(hurt);
    // Used up: no second sacrifice in this battle.
    expect(canUseAbility(user, skill).ok).toBe(false);
  });

  it('the checkpoint a settlement saves already holds the paid HP and the healed ally', async () => {
    const { scene, user, hurt } = setup();
    let saved;
    scene._captureSuspendCheckpoint = vi.fn(() => {
      saved = { user: user.currentHP, hurt: hurt.currentHP, used: user._battleAbilityUsage };
      return true;
    });
    scene.runManager = { battleInProgress: true };
    await scene._abilityController.executeSelfCentered(user, skill);
    expect(saved).toEqual({ user: 14, hurt: 22, used: { map: { great_sacrifice: 1 } } });
  });

  it('mends the NPC allies the caster can see, as Healing Circle does', async () => {
    const user = unit('Hero', 5, 5, { skills: ['great_sacrifice'] });
    const caravan = unit('Caravan', 5, 6, { faction: 'npc', currentHP: 10 });
    const scene = sceneWith({ players: [user], npcs: [caravan] });
    const [entry] = scene._abilityController._getAbilityEntries(user);
    expect(entry.hasTargets).toBe(true);
    await scene._abilityController.executeSelfCentered(user, skillById.get('great_sacrifice'));
    // Missing 14 of 24: the cost is the 10 cap, and the caravan gets all of it.
    expect(caravan.currentHP).toBe(20);
    expect(user.currentHP).toBe(14);
  });

  it('a stale confirm after the use is spent does nothing', async () => {
    const { scene, user, hurt } = setup();
    markUsed(user, 'great_sacrifice');
    const result = await scene._abilityController.executeSelfCentered(user, skill);
    expect(result).toBe(false);
    expect([user.currentHP, hurt.currentHP]).toEqual([24, 12]);
  });
});

describe('Goddess Dance in the battle scene', () => {
  const skill = skillById.get('goddess_dance');
  const setup = () => {
    const bard = unit('Bard', 5, 5, { skills: ['dance', 'goddess_dance'] });
    const a = unit('A', 5, 4, { hasActed: true, hasMoved: true, _movementCommitted: true, _movementSpent: 2 }); // prettier-ignore
    const b = unit('B', 6, 5, { hasActed: true, hasMoved: true, _movementCommitted: true, _movementSpent: 4 }); // prettier-ignore
    const fresh = unit('Fresh', 4, 5);
    const scene = sceneWith({ players: [bard, a, b, fresh] });
    return { scene, bard, a, b, fresh };
  };

  it('is offered with its status; greyed when no neighbour has acted', () => {
    const { scene, bard, a, b } = setup();
    const ctrl = scene._abilityController;
    let [entry] = ctrl._getAbilityEntries(bard);
    expect(entry).toMatchObject({ canUse: true, hasTargets: true });
    a.hasActed = false;
    b.hasActed = false;
    [entry] = ctrl._getAbilityEntries(bard);
    expect(ctrl._statusLine(bard, entry)).toBe('1/1 uses left · No valid targets');
  });

  it('refreshes every adjacent ally who has acted, with a deed and Dance XP each, and ends the action', async () => {
    const { scene, bard, a, b, fresh } = setup();
    await scene._abilityController.executeSelfCentered(bard, skill);
    for (const ally of [a, b]) {
      expect(ally.hasActed).toBe(false);
      expect(ally.hasMoved).toBe(false);
      expect(ally._movementCommitted).toBe(false);
    }
    // As Dance: the spent movement stays.
    expect([a._movementSpent, b._movementSpent]).toEqual([2, 4]);
    expect(fresh.hasActed).toBeFalsy();
    expect(scene._deedController.onRefresh).toHaveBeenCalledTimes(2);
    expect(scene._deedController.onRefresh).toHaveBeenCalledWith(bard);
    // XP_BASE_DANCE (20) per refreshed ally, queued (not drawn) for the settlement.
    expect(scene.awardScaledXP).toHaveBeenCalledTimes(2);
    expect(scene.awardScaledXP).toHaveBeenCalledWith(bard, 20, { present: false });
    expect(scene.undimUnit).toHaveBeenCalledTimes(2);
    expect(bard._battleAbilityUsage.map.goddess_dance).toBe(1);
    expect(scene.finishUnitAction).toHaveBeenCalledWith(bard, { session: 1 });
  });

  it('refreshed allies can act again: the army sees them as ready', async () => {
    const { scene, bard, a, b } = setup();
    expect([a, b].every((u) => u.hasActed)).toBe(true);
    await scene._abilityController.executeSelfCentered(bard, skill);
    expect(scene.playerUnits.filter((u) => u !== bard).every((u) => !u.hasActed)).toBe(true);
  });

  it('is once per battle, and a second try changes nothing', async () => {
    const { scene, bard, a } = setup();
    await scene._abilityController.executeSelfCentered(bard, skill);
    a.hasActed = true; // acts again
    scene.finishUnitAction.mockClear();
    const again = await scene._abilityController.executeSelfCentered(bard, skill);
    expect(again).toBe(false);
    expect(a.hasActed).toBe(true);
    expect(scene.finishUnitAction).not.toHaveBeenCalled();
  });

  it('records one history beat per ally, named by the skill', async () => {
    const { scene, bard, a, b } = setup();
    scene.runManager = { battleInProgress: true };
    bard.battleEntityId = 'u1';
    a.battleEntityId = 'u2';
    b.battleEntityId = 'u3';
    let beats;
    scene._captureSuspendCheckpoint = vi.fn(() => {
      beats = structuredClone(scene._historyBeats);
      return true;
    });
    await scene._abilityController.executeSelfCentered(bard, skill);
    expect(beats.map((x) => [x.type, x.targetId])).toEqual([
      ['danced for', 'u2'],
      ['danced for', 'u3'],
    ]);
  });

  it('Dance and Goddess Dance read one rule: the scene’s Dance targets are the engine’s', () => {
    const { scene, bard, a, b } = setup();
    expect(scene.findDanceTargets(bard).map((t) => t.ally)).toEqual(
      findDanceRefreshTargets(bard, scene.playerUnits),
    );
    expect(scene.findDanceTargets(bard).map((t) => t.ally.name)).toEqual(['A', 'B']);
    expect([a, b].length).toBe(2);
  });
});

describe('the one effective-skill model', () => {
  it('a Great Sacrifice or Goddess Dance an accessory lends is listed, usable and limited like a known one', () => {
    const lent = unit('Lent', 5, 5, { accessory: { _boundSkill: 'great_sacrifice' } });
    const known = unit('Known', 5, 5, { skills: ['great_sacrifice'] });
    expect(getActionAbilities(lent, data.skills).map((s) => s.id)).toEqual(['great_sacrifice']);
    expect(getActionAbilities(known, data.skills).map((s) => s.id)).toEqual(['great_sacrifice']);
    markUsed(lent, 'great_sacrifice');
    // The limit is the unit's, not the ring's: taking the ring off does not refill it.
    lent.accessory = null;
    expect(getActionAbilities(lent, data.skills)).toEqual([]);
    lent.accessory = { _boundSkill: 'great_sacrifice' };
    expect(canUseAbility(lent, skillById.get('great_sacrifice')).ok).toBe(false);
    // A second unit that receives the ring has its own count.
    const other = unit('Other', 1, 1, { accessory: lent.accessory });
    expect(canUseAbility(other, skillById.get('great_sacrifice')).ok).toBe(true);
  });
});
