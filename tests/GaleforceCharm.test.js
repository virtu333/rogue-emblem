// The Galeforce Charm (engine/GaleforceCharm.js): a kill its wearer makes on its own attack may
// (SKL % chance) let it act again, at most twice a battle.
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { resetUnitForBattle } from '../src/scenes/BattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { loadFixture } from './fixtures/battles/index.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { serializeUnit } from '../src/engine/UnitSerialization.js';
import { consumeGaleforce, galeforceChance, rollGaleforce } from '../src/engine/GaleforceCharm.js';
import { completeBattleAction } from '../src/ui/BattleActionCompletion.js';
import { formatAccessoryDetail } from '../src/utils/accessoryText.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const charm = () => structuredClone(data.accessories.find((a) => a.name === 'Galeforce Charm'));
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

afterEach(() => vi.restoreAllMocks());

const wearer = (skl = 30, extra = {}) => ({
  name: 'Cael',
  faction: 'player',
  stats: { HP: 40, SKL: skl },
  currentHP: 40,
  accessory: charm(),
  hasActed: false,
  hasMoved: false,
  ...extra,
});

describe('the catalog row', () => {
  it('is a legendary Act IV accessory and says what it does', () => {
    const row = charm();
    expect(row.legendary).toBe(true);
    const acts = ['act1', 'act2', 'act3', 'act4'].filter((act) =>
      data.lootTables[act].accessories.includes('Galeforce Charm'),
    );
    expect(acts).toEqual(['act4']);
    expect(formatAccessoryDetail(row)).toContain(
      'Kill a foe you attacked: SKL% chance to act again (twice a map)',
    );
  });
});

describe('the roll', () => {
  it('procs at the wearer’s SKL %', () => {
    const u = wearer(30);
    expect(galeforceChance(u)).toBe(30);
    expect(rollGaleforce(u, () => 0.31)).toBe(false); // 31 is not below 30
    expect(rollGaleforce(u, () => 0.29)).toBe(true);
    expect(u._galeforceUses).toBe(1);
  });

  it('twice a battle, then never again; nothing is drawn once spent', () => {
    const u = wearer(30);
    const random = vi.fn(() => 0);
    expect(rollGaleforce(u, random) && consumeGaleforce(u)).toBe(true);
    expect(rollGaleforce(u, random) && consumeGaleforce(u)).toBe(true);
    expect(galeforceChance(u)).toBe(0);
    expect(rollGaleforce(u, random)).toBe(false);
    expect(random).toHaveBeenCalledTimes(2);
  });

  it('only a player wearer; no charm, no roll', () => {
    expect(galeforceChance({ ...wearer(), faction: 'enemy' })).toBe(0);
    expect(galeforceChance({ ...wearer(), accessory: null })).toBe(0);
  });

  it('the new action starts with no movement spent (Ride Down reads only its own walk)', () => {
    const u = wearer(100, { hasActed: true, hasMoved: true, _movementSpent: 4 });
    rollGaleforce(u, () => 0);
    expect(consumeGaleforce(u)).toBe(true);
    expect(u._movementSpent).toBe(0);
  });

  it('consuming refreshes the unit once; a fallen wearer stays down', () => {
    const u = wearer(100, { hasActed: true, hasMoved: true });
    rollGaleforce(u, () => 0);
    expect(consumeGaleforce(u)).toBe(true);
    expect([u.hasActed, u.hasMoved, u._galeforceReady]).toEqual([false, false, undefined]);
    expect(consumeGaleforce(u)).toBe(false);
    const dead = wearer(100, { hasActed: true, currentHP: 0 });
    rollGaleforce(dead, () => 0);
    expect(consumeGaleforce(dead)).toBe(false);
    expect(dead.hasActed).toBe(true);
  });
});

describe('across a battle', () => {
  it('the checkpoint keeps the uses; the run save and a new battle clear them', () => {
    const u = wearer(100);
    rollGaleforce(u, () => 0);
    expect(serializeBattleUnit(u)).toMatchObject({ _galeforceUses: 1, _galeforceReady: true });
    const saved = serializeUnit({ ...u, stats: { HP: 40, SKL: 100 }, skills: [] });
    expect('_galeforceUses' in saved || '_galeforceReady' in saved).toBe(false);
    consumeGaleforce(u);
    rollGaleforce(u, () => 0); // the second use: spent for this battle
    expect(galeforceChance(u)).toBe(0);
    resetUnitForBattle(u);
    expect(galeforceChance(u)).toBe(100);
    expect(u._galeforceReady).toBeUndefined();
  });

  it('the action completion refreshes a readied unit and keeps the turn going', () => {
    const u = wearer(100, { battleEntityId: 'u1' });
    const other = wearer(100, { name: 'Ana', battleEntityId: 'u2' });
    const turnManager = { unitActed: vi.fn(), checkPlayerPhaseComplete: vi.fn() };
    let savedActed = null;
    const scene = {
      _battleSession: 1,
      playerUnits: [u, other],
      turnManager,
      grid: {},
      _historyBeats: [],
      dimUnit: vi.fn(),
      undimUnit: vi.fn(),
      _captureSuspendCheckpoint: () => {
        savedActed = u.hasActed;
        return true;
      },
    };
    rollGaleforce(u, () => 0);
    completeBattleAction(scene, u, { session: 1 });
    expect(u.hasActed).toBe(false);
    expect(savedActed).toBe(false); // the checkpoint holds the refreshed unit
    expect(turnManager.unitActed).not.toHaveBeenCalled();
    expect(scene.dimUnit).not.toHaveBeenCalled();
    // Its next action ends as any other.
    completeBattleAction(scene, u, { session: 1 });
    expect(u.hasActed).toBe(true);
    expect(turnManager.unitActed).toHaveBeenCalledWith(u);
  });
});

describe('in a battle (the harness drives the real action flow)', () => {
  function duel(skl) {
    const fixture = loadFixture('act1_rout_basic');
    const battle = new HeadlessBattle(
      data,
      { ...fixture.battleParams, act: 'act4' },
      fixture.buildRoster(data),
    );
    battle.init();
    const rows = battle.battleConfig.mapLayout.length;
    const cols = battle.battleConfig.mapLayout[0].length;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) battle.battleConfig.mapLayout[r][c] = 0;
    battle.grid.mapLayout = battle.battleConfig.mapLayout;
    const hero = battle.playerUnits[0];
    battle.playerUnits = [hero];
    const sword = weapon('Iron Sword');
    Object.assign(hero, { col: 0, row: 1, hasMoved: false, hasActed: false, accessory: charm() });
    Object.assign(hero.stats, { HP: 99, STR: 30, SKL: skl, SPD: 30, DEF: 40, RES: 40, MOV: 6 });
    hero.mov = 6;
    hero.currentHP = 99;
    hero.proficiencies = [{ type: 'Sword', rank: 'Mast' }];
    hero.inventory = [sword];
    hero.weapon = sword;
    const foe = (name, col) => ({
      name,
      faction: 'enemy',
      className: 'Fighter',
      level: 1,
      col,
      row: 0,
      stats: { HP: 1, STR: 1, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0, MOV: 4 },
      currentHP: 1,
      mov: 4,
      moveType: 'Infantry',
      skills: [],
      weapon: weapon('Iron Axe'),
      inventory: [weapon('Iron Axe')],
      proficiencies: [{ type: 'Axe', rank: 'Prof' }],
    });
    battle.enemyUnits = [foe('A', 0), foe('B', 1), foe('C', 2), foe('D', 5)];
    return { battle, hero };
  }

  function strike(battle, hero, target) {
    const foe = battle.enemyUnits.find((u) => u.name === target);
    battle.selectUnit(hero.name);
    battle.moveTo(foe.col, 1);
    battle.chooseAction('Attack');
    battle.chooseAttackTarget(target);
  }

  it('two kills ready it twice; the third ends its turn', () => {
    const { battle, hero } = duel(100);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    strike(battle, hero, 'A');
    expect(battle.enemyUnits.map((u) => u.name)).not.toContain('A');
    expect(hero.hasActed).toBe(false);
    strike(battle, hero, 'B');
    expect(hero.hasActed).toBe(false);
    expect(hero._galeforceUses).toBe(2);
    strike(battle, hero, 'C');
    expect(hero.hasActed).toBe(true);
    expect(hero._galeforceUses).toBe(2);
  });

  it('a roll that misses its SKL % ends the turn as usual', () => {
    const { battle, hero } = duel(0);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    strike(battle, hero, 'A');
    expect(hero.hasActed).toBe(true);
    expect(hero._galeforceUses).toBeUndefined();
  });
});
