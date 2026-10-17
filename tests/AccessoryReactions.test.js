// The Briar Cloak, the Anchor Stone and the Grudge Locket (engine/AccessoryReactions.js).
//
// Numbers worked by hand (CLAUDE.md's formulas; Math.random() = 0 lands every strike, and
// SKL 0 / LCK 0 with an Iron Sword's 0 Crit makes none crit):
//   the brigand: STR 14 + Might 5 - Sera's DEF 10 = 9 a blow; attack speed 20 - (3 - 2) = 19
//   against Sera's 8: it doubles. Sera: STR 10 + 5 - DEF 5 = 10 a counter.
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { BattleScene } from '../src/scenes/BattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { HeadlessGrid } from './harness/HeadlessGrid.js';
import { getCombatForecast, resolveCombat } from '../src/engine/Combat.js';
import {
  getSkillCombatMods,
  rollDefenseSkills,
  rollStrikeSkills,
} from '../src/engine/SkillSystem.js';
import { equipAccessory, unequipAccessory } from '../src/engine/UnitManager.js';
import { isDisplacementImmune } from '../src/engine/AffixSystem.js';
import { displacementBlockReason, findShoveTargets } from '../src/engine/ForcedMovement.js';
import { resolvePostCombatMove } from '../src/engine/WeaponArtPostCombat.js';
import { entityKitAfterCombat } from '../src/engine/EntityKit.js';
import { playerAlliesLost } from '../src/engine/AccessoryReactions.js';
import { forecastNotes, forecastProjection } from '../src/ui/forecastDisplay.js';
import { fxForActivation, splitStrikeActivations } from '../src/ui/ProcVisualTheme.js';
import { formatAccessoryDetail } from '../src/utils/accessoryText.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const accessory = (name) => structuredClone(gameData.accessories.find((a) => a.name === name));
const weapon = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));

afterEach(() => vi.restoreAllMocks());

const BASE = { HP: 30, STR: 10, MAG: 0, SKL: 0, SPD: 8, DEF: 4, RES: 3, LCK: 0, MOV: 5 };
function unit(name, faction, stats = {}, extra = {}) {
  const full = { ...BASE, ...stats };
  return {
    name,
    faction,
    level: 5,
    skills: [],
    stats: full,
    currentHP: full.HP,
    col: 0,
    row: 0,
    moveType: 'Infantry',
    weaponRank: 'Prof',
    weapon: weapon('Iron Sword'),
    accessory: null,
    _conditions: [],
    ...extra,
  };
}

const ctx = (a, d, context = null) => {
  const args = (x, y, init) => [x, y, [x], [y], gameData.skills, null, init, null, context];
  return {
    skillsData: gameData.skills,
    rollStrikeSkills,
    rollDefenseSkills,
    atkMods: getSkillCombatMods(...args(a, d, true)),
    defMods: getSkillCombatMods(...args(d, a, false)),
  };
};

function fight(attacker, defender, distance = 1, random = 0) {
  vi.spyOn(Math, 'random').mockReturnValue(random);
  const result = resolveCombat(
    attacker,
    attacker.weapon,
    defender,
    defender.weapon,
    distance,
    null,
    null,
    ctx(attacker, defender),
  );
  vi.restoreAllMocks();
  return result;
}

describe('Briar Cloak', () => {
  const sera = (extra = {}) =>
    unit('Sera', 'player', { DEF: 10 }, { accessory: accessory('Briar Cloak'), ...extra });
  const brigand = (extra = {}) => unit('Brigand', 'enemy', { STR: 14, SPD: 20, DEF: 5 }, extra);

  it('drops in Acts II and III and says what it does', () => {
    const acts = ['act1', 'act2', 'act3', 'act4'].filter((act) =>
      gameData.lootTables[act].accessories.includes('Briar Cloak'),
    );
    expect(acts).toEqual(['act2', 'act3']);
    expect(formatAccessoryDetail(accessory('Briar Cloak'))).toContain(
      'A foe that hits you from beside you takes 5 damage',
    );
  });

  it('each landed melee blow pricks its striker for 5', () => {
    const b = brigand();
    const r = fight(b, sera());
    // Brigand hits (30 -> 25 from the cloak), Sera counters (25 -> 15), brigand hits (15 -> 10).
    expect(r.attackerHP).toBe(10);
    expect(r.defenderHP).toBe(30 - 9 - 9);
    const onSera = r.events.filter((e) => e.type === 'strike' && e.target === 'Sera');
    expect(onSera.map((e) => e.reflectTaken)).toEqual([5, 5]);
    // Without the cloak the brigand only takes Sera's counter.
    expect(fight(brigand(), sera({ accessory: null })).attackerHP).toBe(20);
  });

  it('never takes the striker’s last HP', () => {
    const b = brigand();
    b.currentHP = 3;
    const r = fight(b, sera({ weapon: null }));
    expect(r.attackerHP).toBe(1);
    const strikes = r.events.filter((e) => e.type === 'strike');
    expect(strikes.map((e) => e.reflectTaken)).toEqual([2, 0]);
    // A prick that took nothing is no proc: no banner for it.
    expect(strikes[1].skillActivations.map((a) => a.id)).not.toContain('briar_cloak');
  });

  it('a blow from range, or a miss, is not pricked', () => {
    const archer = brigand({ weapon: weapon('Iron Bow') });
    expect(fight(archer, sera(), 2).attackerHP).toBe(30);
    expect(fight(brigand(), sera(), 1, 0.999).attackerHP).toBe(30);
  });

  it('carries its proc to the banner and the striker-side flash', () => {
    const first = fight(brigand(), sera()).events.find(
      (e) => e.type === 'strike' && e.target === 'Sera',
    );
    const { target } = splitStrikeActivations(first.skillActivations, gameData.skills);
    const briar = target.find((a) => a.id === 'briar_cloak');
    expect(briar).toBeTruthy();
    expect(fxForActivation(briar)).toEqual({ key: 'fx_pierce', at: 'striker' });
  });

  it('the forecast projects it and names it', () => {
    const b = brigand();
    const s = sera();
    const f = getCombatForecast(b, b.weapon, s, s.weapon, 1, null, null, ctx(b, s));
    expect(f.attacker.thornsReflect).toBe(5);
    expect(forecastProjection(f)).toMatchObject({ attackerHP: 10, defenderHP: 12 });
    const notes = forecastNotes(f, true, 30).join('\n');
    expect(notes).toContain('Briar Cloak: −5 HP per hit landed');
    expect(notes).not.toContain('Thorns');
    const archer = brigand({ weapon: weapon('Iron Bow') });
    const g = getCombatForecast(archer, archer.weapon, s, s.weapon, 2, null, null, ctx(archer, s));
    expect(g.attacker.thornsReflect).toBe(0);
  });
});

describe('Anchor Stone', () => {
  const stone = () => accessory('Anchor Stone');

  it('drops in Acts III and IV and says what it does', () => {
    const acts = ['act1', 'act2', 'act3', 'act4'].filter((act) =>
      gameData.lootTables[act].accessories.includes('Anchor Stone'),
    );
    expect(acts).toEqual(['act3', 'act4']);
    const text = formatAccessoryDetail(stone());
    for (const part of ['+5 HP', '-1 MOV', '+2 Atk', "Can't be shoved, pulled, swapped"])
      expect(text).toContain(part);
  });

  it('+5 HP and -1 MOV on equip, given back on unequip', () => {
    const u = unit('Cael', 'player', { MOV: 5 }, { mov: 5 });
    equipAccessory(u, stone());
    expect([u.stats.HP, u.currentHP, u.stats.MOV, u.mov]).toEqual([35, 35, 4, 4]);
    unequipAccessory(u);
    expect([u.stats.HP, u.currentHP, u.stats.MOV, u.mov]).toEqual([30, 30, 5, 5]);
  });

  it('+2 Atk in combat: 2 more damage a blow', () => {
    const plain = unit('Cael', 'player');
    const anchored = unit('Cael', 'player', {}, { accessory: stone() });
    const foe = unit('Brigand', 'enemy');
    const dmg = (u) => getCombatForecast(u, u.weapon, foe, foe.weapon, 1, null, null, ctx(u, foe));
    // STR 10 + 5 - DEF 4 = 11, and 13 with the stone.
    expect([dmg(plain).attacker.damage, dmg(anchored).attacker.damage]).toEqual([11, 13]);
  });

  it('holds against every displacement rule: affix data or none', () => {
    const u = unit('Cael', 'player', {}, { accessory: stone() });
    expect(isDisplacementImmune(u, null)).toBe(true);
    expect(isDisplacementImmune(u, gameData.affixes)).toBe(true);
    expect(displacementBlockReason(u, gameData.affixes)).toBe('anchored');
    expect(isDisplacementImmune(unit('Ana', 'player'), gameData.affixes)).toBe(false);
  });

  it('is never Shoved', () => {
    const grid = new HeadlessGrid(5, 1, gameData.terrain, [[0, 0, 0, 0, 0]]);
    const shover = unit('Ana', 'player', {}, { col: 0, row: 0 });
    const pushed = unit('Cael', 'player', {}, { col: 1, row: 0 });
    const at = (c, r) => [shover, pushed].find((u) => u.col === c && u.row === r) || null;
    const shove = () => findShoveTargets(shover, { grid, allies: [shover, pushed], getUnitAt: at });
    expect(shove()).toHaveLength(1);
    pushed.accessory = stone();
    expect(shove()).toHaveLength(0);
  });

  it('is never Pulled or Swapped, and its wearer swaps with no one', () => {
    const a = unit('Ana', 'player', {}, { col: 2, row: 2 });
    const c = unit('Cael', 'player', {}, { col: 2, row: 3 });
    const scene = {
      playerUnits: [a, c],
      grid: { cols: 6, rows: 6, getMoveCost: () => 1 },
      _seenTileOccupant: () => null,
    };
    const pull = (u) => BattleScene.prototype.findPullTargets.call(scene, u);
    const swap = (u) => BattleScene.prototype.findSwapTargets.call(scene, u);
    expect([pull(a).length, swap(a).length, swap(c).length]).toEqual([1, 1, 1]);
    c.accessory = stone();
    expect([pull(a).length, swap(a).length, swap(c).length]).toEqual([0, 0, 0]);
    // The wearer still moves itself: it can Pull another back with it.
    expect(pull(c)).toHaveLength(1);
  });

  it("an art's push holds, and the Entity's Undertow does not drag it", () => {
    const grid = new HeadlessGrid(5, 1, gameData.terrain, [[0, 0, 0, 0, 0]]);
    const src = unit('Ana', 'enemy', {}, { col: 0, row: 0 });
    const tgt = unit('Cael', 'player', {}, { col: 1, row: 0, accessory: stone() });
    const at = (c, r) => [src, tgt].find((u) => u.col === c && u.row === r) || null;
    const move = resolvePostCombatMove({
      sourceUnit: src,
      targetUnit: tgt,
      mode: 'push',
      distance: 1,
      cols: 5,
      rows: 1,
      getMoveCost: (c, r, t) => grid.getMoveCost(c, r, t),
      getUnitAt: at,
      isImmovable: (u) => isDisplacementImmune(u, gameData.affixes),
    });
    expect(move).toMatchObject({ ok: false, reason: 'immovable' });
    expect([tgt.col, tgt.row]).toEqual([1, 0]);

    const entity = { name: 'The Entity', faction: 'enemy', isEntity: true, currentHP: 99 };
    const striker = unit('Cael', 'player', {}, { col: 4, row: 0, accessory: stone() });
    const result = {
      events: [{ type: 'strike', attacker: 'The Entity', target: 'Cael', miss: false }],
    };
    const beats = [
      ...entityKitAfterCombat(
        { attacker: striker, defender: entity, result, strikeTile: { col: 4, row: 0 } },
        { entityKit: { limbs: null, undertow: true }, affixes: gameData.affixes },
      ),
    ];
    expect(beats.some((b) => b.kind === 'moved')).toBe(false);
    expect([striker.col, striker.row]).toEqual([4, 0]);
  });
});

describe('Grudge Locket', () => {
  const locket = () => accessory('Grudge Locket');
  const atk = (u, lost) => {
    const foe = unit('Brigand', 'enemy');
    return getSkillCombatMods(u, foe, [u], [foe], gameData.skills, null, true, null, {
      playerAlliesLost: lost,
    });
  };

  it('drops in Acts III and IV and says what it does', () => {
    const acts = ['act1', 'act2', 'act3', 'act4'].filter((act) =>
      gameData.lootTables[act].accessories.includes('Grudge Locket'),
    );
    expect(acts).toEqual(['act3', 'act4']);
    expect(formatAccessoryDetail(locket())).toContain('+2 Atk for each ally lost this run');
  });

  it('+2 Atk per ally lost, with no cap', () => {
    const u = unit('Cael', 'player', {}, { accessory: locket() });
    expect([0, 1, 3, 9].map((n) => atk(u, n).atkBonus)).toEqual([0, 2, 6, 18]);
    expect(atk(u, 2).activated.map((a) => a.id)).toContain('grudge_locket');
    expect(atk(u, 0).activated.map((a) => a.id)).not.toContain('grudge_locket');
    // No locket, no bonus; a foe's locket has no run's dead to count.
    expect(atk(unit('Ana', 'player'), 5).atkBonus).toBe(0);
    expect(atk(unit('Foe', 'enemy', {}, { accessory: locket() }), 5).atkBonus).toBe(0);
  });

  it("counts the run's fallen and laid to rest, then this battle's", () => {
    const run = { fallenUnits: [{ name: 'A' }, { name: 'B' }], laidToRest: [{ name: 'C' }] };
    expect(playerAlliesLost(run, 0)).toBe(3);
    expect(playerAlliesLost(run, 2)).toBe(5);
    expect(playerAlliesLost(null, 1)).toBe(1);
  });

  it('in a battle, an ally who falls raises it at once (the harness, as the scene)', () => {
    const wearer = unit('Cael', 'player', {}, { accessory: locket() });
    const friend = unit('Ana', 'player');
    const runManager = { fallenUnits: [{ name: 'Old' }], laidToRest: [] };
    const battle = new HeadlessBattle(
      gameData,
      { act: 'act3', objective: 'rout' },
      [wearer, friend],
      { runManager },
    );
    battle.init();
    const foe = battle.enemyUnits[0];
    const bonus = () => battle._buildSkillCtx(wearer, foe).atkMods.atkBonus;
    const before = bonus();
    battle._removeUnit(friend);
    expect(bonus() - before).toBe(2);
  });
});
