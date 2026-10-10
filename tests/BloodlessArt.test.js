// Bloodless Art (docs/specs/blessings-v3.md §5.2): player units' weapon arts cost 1 less HP
// (never below 1) and get one more use per map. The boon is for the player's side only; the
// older price blessing "Weapon arts cost +N HP" still taxes every faction, enemies included.
//
// Ways this can fail, a test each:
//   1. the card ships with the wrong shape (tier, boon type, params, prices, lore);
//   2. the boon does nothing (no handler) or does not survive a save, or an old save crashes;
//   3. the discount reaches enemy arts, so the card makes foes cheaper to fight;
//   4. the discount takes an art below 1 HP, or stops stacking with the price delta and a
//      Blood Gem the way the sum always did;
//   5. the extra use reaches foes, or turns an unlimited art into a limited one, or is not
//      counted by the legality check (the menu offers a use the engine then refuses);
//   6. the menus show the old limit or the old cost while the engine allows the new one;
//   7. the price blessing's enemy tax is quietly lost when the helper replaces the raw read;
//   8. the discount works in the scene's path but not in the harness's (or the reverse).
import { describe, expect, it } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import {
  applyWeaponArtCost,
  canUseWeaponArt,
  getEffectiveWeaponArtHpCost,
  getEffectiveWeaponArtMapLimit,
  recordWeaponArtUse,
  weaponArtRunOptions,
} from '../src/engine/WeaponArtSystem.js';
import { weaponArtCostText, weaponArtUsesText } from '../src/ui/weaponArtDisplay.js';
import { WeaponArtController } from '../src/ui/WeaponArtController.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const card = data.blessings.blessings.find((b) => b.id === 'bloodless_art');

function runWith(blessingIds, seed = 31) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId: 'dusk', applyBlessingsAtStart: false });
  rm.activeBlessings = blessingIds.map((id) => ({ id, rolledCost: null }));
  rm._runStartBlessingsApplied = false;
  rm.applyRunStartBlessingEffects();
  return rm;
}
const reload = (rm) => RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);

const player = (extra = {}) => ({ name: 'Edric', faction: 'player', ...extra });
const enemy = (extra = {}) => ({ name: 'Bandit', faction: 'enemy', ...extra });
const BOON = { weaponArtHpCostDelta: 0, playerArtHpCostDelta: -1, playerArtMapUsesBonus: 1 };

describe('Bloodless Art: the card', () => {
  it('is a tier II card with the art boon, the two promised prices and its own lore', () => {
    expect(card.tier).toBe(2);
    expect(card.boons).toEqual([
      { type: 'player_weapon_art_boon', params: { hpCostDelta: -1, mapUsesBonus: 1 } },
    ]);
    expect(card.prices).toEqual(['staff_heal_down', 'debt_small']);
    expect(card.intrinsicPrice).toBeUndefined();
    expect(card.lore.length).toBeLessThanOrEqual(85);
    expect(card.lore).not.toBe(card.description);
  });

  it('was appended after the older cards, so lookups that take the first of a tier keep their answer', () => {
    // Later cards (Phalanx Rite, Duelist's Creed) follow it; none was inserted ahead of it.
    const ids = data.blessings.blessings.map((b) => b.id);
    expect(ids.indexOf('bloodless_art')).toBe(25);
    expect(ids.slice(26)).toEqual(['phalanx_rite', 'duelists_creed']);
  });
});

describe('Bloodless Art: the boon lands on the run and survives a save', () => {
  it('applying the card sets both runtime fields and records no unhandled effect', () => {
    const rm = runWith(['bloodless_art']);
    expect(rm.blessingRuntimeModifiers.playerArtHpCostDelta).toBe(-1);
    expect(rm.blessingRuntimeModifiers.playerArtMapUsesBonus).toBe(1);
    expect(rm.blessingRuntimeModifiers.weaponArtHpCostDelta).toBe(0);
    expect(rm.blessingHistory.filter((r) => r.details?.reason === 'unhandled_effect_type')).toEqual(
      [],
    );
    expect(weaponArtRunOptions(rm)).toEqual(BOON);
  });

  it('a run without the card has no discount and no extra use', () => {
    const rm = runWith([]);
    expect(weaponArtRunOptions(rm)).toEqual({
      weaponArtHpCostDelta: 0,
      playerArtHpCostDelta: 0,
      playerArtMapUsesBonus: 0,
    });
  });

  it('a save and load keeps the boon', () => {
    const loaded = reload(runWith(['bloodless_art']));
    expect(weaponArtRunOptions(loaded)).toEqual(BOON);
  });

  it('a save from before the card loads with zeroes, and bad numbers are cleaned', () => {
    const saved = JSON.parse(JSON.stringify(runWith([]).toJSON()));
    delete saved.blessingRuntimeModifiers.playerArtHpCostDelta;
    delete saved.blessingRuntimeModifiers.playerArtMapUsesBonus;
    const old = RunManager.fromJSON(saved, data);
    expect(weaponArtRunOptions(old)).toMatchObject({
      playerArtHpCostDelta: 0,
      playerArtMapUsesBonus: 0,
    });
    saved.blessingRuntimeModifiers.playerArtHpCostDelta = 'x';
    saved.blessingRuntimeModifiers.playerArtMapUsesBonus = -3;
    const bad = RunManager.fromJSON(saved, data);
    expect(weaponArtRunOptions(bad)).toMatchObject({
      playerArtHpCostDelta: 0,
      playerArtMapUsesBonus: 0,
    });
  });

  it('a malformed boon applies nothing (no negative uses, no NaN cost)', () => {
    const rm = runWith([]);
    rm._applySingleRunStartBlessingEffect('bloodless_art', {
      type: 'player_weapon_art_boon',
      params: { hpCostDelta: 'lots', mapUsesBonus: -4 },
    });
    expect(weaponArtRunOptions(rm)).toMatchObject({
      playerArtHpCostDelta: 0,
      playerArtMapUsesBonus: 0,
    });
  });

  it('weaponArtRunOptions of no run (a test scene, the title) is all zeroes, never a throw', () => {
    expect(weaponArtRunOptions(null)).toEqual({
      weaponArtHpCostDelta: 0,
      playerArtHpCostDelta: 0,
      playerArtMapUsesBonus: 0,
    });
    expect(weaponArtRunOptions({})).toEqual(weaponArtRunOptions(undefined));
  });
});

describe('Bloodless Art: the HP cost', () => {
  const art = { id: 'a', hpCost: 5 };

  it('a player unit pays 1 less; a foe pays the printed cost', () => {
    expect(getEffectiveWeaponArtHpCost(player(), art, BOON)).toBe(4);
    expect(getEffectiveWeaponArtHpCost(enemy(), art, BOON)).toBe(5);
  });

  it('an allied NPC is not a player unit and gets nothing', () => {
    expect(getEffectiveWeaponArtHpCost({ name: 'Sera', faction: 'npc' }, art, BOON)).toBe(5);
  });

  it('never takes a cost below 1, and a free art stays free', () => {
    expect(getEffectiveWeaponArtHpCost(player(), { id: 'b', hpCost: 1 }, BOON)).toBe(1);
    expect(getEffectiveWeaponArtHpCost(player(), { id: 'b', hpCost: 2 }, BOON)).toBe(1);
    expect(getEffectiveWeaponArtHpCost(player(), { id: 'c', hpCost: 0 }, BOON)).toBe(0);
    const gem = player({ accessory: { combatEffects: { bloodGem: true } } });
    expect(getEffectiveWeaponArtHpCost(gem, { id: 'd', hpCost: 6 }, BOON)).toBe(1);
  });

  it('stacks with the Blood Gem and with the price blessing in one sum', () => {
    const gem = player({ accessory: { combatEffects: { bloodGem: true } } });
    // 9 - 5 (gem) + 2 (price) - 1 (boon)
    expect(
      getEffectiveWeaponArtHpCost(
        gem,
        { id: 'e', hpCost: 9 },
        { ...BOON, weaponArtHpCostDelta: 2 },
      ),
    ).toBe(5);
  });

  it('the price blessing still taxes foes and players alike, boon or no boon (pinned)', () => {
    const taxed = { weaponArtHpCostDelta: 2, playerArtHpCostDelta: 0, playerArtMapUsesBonus: 0 };
    expect(getEffectiveWeaponArtHpCost(enemy(), art, taxed)).toBe(7);
    expect(getEffectiveWeaponArtHpCost(player(), art, taxed)).toBe(7);
    const both = { ...taxed, playerArtHpCostDelta: -1, playerArtMapUsesBonus: 1 };
    expect(getEffectiveWeaponArtHpCost(enemy(), art, both)).toBe(7);
    expect(getEffectiveWeaponArtHpCost(player(), art, both)).toBe(6);
  });

  it('the price card read through a real run still taxes the foe (the helper kept the tax)', () => {
    const rm = runWith([]);
    rm._applySingleRunStartBlessingEffect('iron_oath', {
      type: 'weapon_art_hp_cost_delta',
      params: { value: 2 },
    });
    expect(getEffectiveWeaponArtHpCost(enemy(), art, weaponArtRunOptions(rm))).toBe(7);
  });

  it('applyWeaponArtCost takes the reduced HP from a player and the full cost from a foe', () => {
    const hero = player({ currentHP: 20, stats: { HP: 20 } });
    const foe = enemy({ currentHP: 20, stats: { HP: 20 } });
    expect(applyWeaponArtCost(hero, art, BOON).cost).toBe(4);
    expect(hero.currentHP).toBe(16);
    expect(applyWeaponArtCost(foe, art, BOON).cost).toBe(5);
    expect(foe.currentHP).toBe(15);
  });
});

describe('Bloodless Art: the uses per map', () => {
  const limited = { id: 'l', hpCost: 3, perMapLimit: 2 };

  it('a player unit gets one more; a foe and an ally NPC do not', () => {
    expect(getEffectiveWeaponArtMapLimit(player(), limited, BOON)).toBe(3);
    expect(getEffectiveWeaponArtMapLimit(enemy(), limited, BOON)).toBe(2);
    expect(getEffectiveWeaponArtMapLimit({ faction: 'npc' }, limited, BOON)).toBe(2);
  });

  it('an art with no limit stays unlimited, not "1"', () => {
    expect(getEffectiveWeaponArtMapLimit(player(), { id: 'u', hpCost: 3 }, BOON)).toBe(0);
    expect(getEffectiveWeaponArtMapLimit(player(), { id: 'u', perMapLimit: 0 }, BOON)).toBe(0);
  });

  it('without the card the limit is the art’s own', () => {
    expect(getEffectiveWeaponArtMapLimit(player(), limited, {})).toBe(2);
    expect(getEffectiveWeaponArtMapLimit(player(), limited)).toBe(2);
  });

  describe('canUseWeaponArt counts the extra use', () => {
    const sword = data.weaponArts.arts.find((a) => a.id === 'sword_precise_cut');
    const weapon = { id: 'blade', name: 'Test Blade', type: 'Sword', weaponArtIds: [sword.id] };
    const mk = (faction) => ({
      name: faction,
      faction,
      currentHP: 40,
      stats: { HP: 40 },
      weapon,
      proficiencies: [{ type: 'Sword', rank: 'Mast' }],
      weaponRank: 'Mast',
      skills: [],
    });
    const ctx = { actorFaction: null, turnNumber: 1 };
    const limitOf = (unit) => getEffectiveWeaponArtMapLimit(unit, sword, BOON);
    const useUp = (unit, n) => {
      for (let i = 0; i < n; i++) recordWeaponArtUse(unit, sword, { turnNumber: 1 + i });
    };

    it('precondition: the art has a limit and a cost the test can pay', () => {
      expect(sword.perMapLimit).toBeGreaterThan(0);
      expect(sword.hpCost).toBeGreaterThan(0);
    });

    it('a player is stopped after limit+1 uses, a foe after limit', () => {
      const hero = mk('player');
      const foe = mk('enemy');
      const base = sword.perMapLimit;
      useUp(hero, base);
      useUp(foe, base);
      const turn = 99;
      const heroCtx = { ...ctx, actorFaction: 'player', turnNumber: turn, ...BOON };
      const foeCtx = { ...ctx, actorFaction: 'enemy', turnNumber: turn, ...BOON };
      expect(canUseWeaponArt(hero, weapon, sword, heroCtx), 'player at limit').toMatchObject({
        ok: true,
      });
      expect(canUseWeaponArt(foe, weapon, sword, foeCtx).reason, 'foe at limit').toBe(
        'per_map_limit',
      );
      useUp(hero, 1);
      expect(limitOf(hero)).toBe(base + 1);
      expect(canUseWeaponArt(hero, weapon, sword, heroCtx).reason, 'player over').toBe(
        'per_map_limit',
      );
    });

    it('without the card the player is stopped at the printed limit', () => {
      const hero = mk('player');
      useUp(hero, sword.perMapLimit);
      const result = canUseWeaponArt(hero, weapon, sword, {
        ...ctx,
        actorFaction: 'player',
        turnNumber: 99,
      });
      expect(result.reason).toBe('per_map_limit');
    });
  });
});

describe('Bloodless Art: what the menus say', () => {
  const art = { id: 'm', name: 'Marked Cut', hpCost: 5, perMapLimit: 2, perTurnLimit: 1 };

  it('the uses line shows the real limit for a player, the printed one for a foe', () => {
    const hero = player();
    expect(weaponArtUsesText(hero, art, 1, BOON)).toBe('3/3 map uses left · 1/1 turn uses left');
    hero._battleWeaponArtUsage = { map: { m: 2 }, turn: {}, turnKey: '1' };
    expect(weaponArtUsesText(hero, art, 1, BOON)).toBe('1/3 map uses left · 1/1 turn uses left');
    expect(weaponArtUsesText(enemy(), art, 1, BOON)).toBe('2/2 map uses left · 1/1 turn uses left');
    // Old callers pass no options and read the printed limit.
    expect(weaponArtUsesText(player(), art, 1)).toBe('2/2 map uses left · 1/1 turn uses left');
  });

  it('an unlimited art still says "No usage limit"', () => {
    expect(weaponArtUsesText(player(), { id: 'u', hpCost: 3 }, 1, BOON)).toBe('No usage limit');
  });

  it('the roster cost line shows the reduced cost against the base', () => {
    expect(weaponArtCostText(player(), art, BOON)).toBe('HP cost 4 (base 5)');
    expect(weaponArtCostText(enemy(), art, BOON)).toBe('HP cost 5');
  });

  it('the battle menu status line (WeaponArtController) reads the run for cost and uses', () => {
    const scene = { runManager: runWith(['bloodless_art']), turnManager: { turnNumber: 1 } };
    const controller = new WeaponArtController(scene);
    const hero = player({ currentHP: 20, stats: { HP: 20 } });
    expect(controller._formatWeaponArtCostLabel(hero, art)).toBe('4 (base 5)');
    expect(controller._getWeaponArtHpAfterCost(hero, art)).toBe(16);
    const line = controller._getWeaponArtStatusLine(hero, art, { ok: true });
    expect(line).toBe('HP-4 (base 5) (20->16) · 3/3 map uses left · 1/1 turn uses left');
    // The same art on a foe, in the same scene: the printed cost and limit.
    const foe = enemy({ currentHP: 20, stats: { HP: 20 } });
    expect(controller._formatWeaponArtCostLabel(foe, art)).toBe('5');
    expect(controller._getWeaponArtStatusLine(foe, art, { ok: true })).toBe(
      'HP-5 (20->15) · 2/2 map uses left · 1/1 turn uses left',
    );
  });
});

describe('Bloodless Art: the harness pays what the menu shows', () => {
  const art = data.weaponArts.arts.find((a) => a.id === 'sword_poison_strike');
  const weapon = () => ({
    id: 'test_blade',
    name: 'Test Blade',
    type: 'Sword',
    might: 8,
    hit: 100,
    crit: 0,
    weight: 5,
    range: '1',
    special: '',
    weaponArtIds: [art.id],
    weaponArtSources: ['scroll'],
  });
  const fighter = (faction, col) => {
    const w = weapon();
    return {
      name: faction === 'player' ? 'Edric' : 'Raider',
      faction,
      col,
      row: 0,
      moveType: 'Infantry',
      currentHP: 40,
      stats: { HP: 40, STR: 12, MAG: 0, SKL: 9, SPD: 9, DEF: 7, RES: 3, LCK: 5, MOV: 5 },
      weaponRank: 'Mast',
      weapon: w,
      inventory: [w],
      proficiencies: [{ type: 'Sword', rank: 'Mast' }],
      skills: [],
      accessory: null,
      _gambitUsedThisTurn: true,
    };
  };
  function battleFor(rm, attacker, defender) {
    const battle = new HeadlessBattle(data, { act: 'act1', objective: 'rout' });
    battle.turnManager = { turnNumber: 1, unitActed() {} };
    battle.battleConfig = { objective: 'rout' };
    battle.gameData = data;
    battle.runManager = rm;
    battle.playerUnits = attacker.faction === 'player' ? [attacker] : [defender];
    battle.enemyUnits = attacker.faction === 'player' ? [defender] : [attacker];
    battle.npcUnits = [];
    battle.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      getTerrainAt: () => ({}),
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    return battle;
  }
  /** The attacker's HP lost to the art alone: a defender too tough to counter hurts nothing. */
  function playerArtCost(rm) {
    const attacker = fighter('player', 0);
    const defender = fighter('enemy', 1);
    defender.stats.STR = 0;
    defender.weapon = null;
    defender.inventory = [];
    const battle = battleFor(rm, attacker, defender);
    battle.selectedUnit = attacker;
    battle._setSelectedWeaponArt(attacker, art.id, attacker.weapon);
    battle._executeCombat(attacker, defender);
    expect(attacker._battleWeaponArtUsage?.map?.[art.id], 'the art was used').toBe(1);
    return 40 - attacker.currentHP;
  }

  it('a player art costs 1 HP less with the card than without', () => {
    expect(art.hpCost).toBe(5);
    const without = playerArtCost(runWith([]));
    const withCard = playerArtCost(runWith(['bloodless_art']));
    expect(without).toBe(5);
    expect(withCard).toBe(4);
  });

  it('an enemy art costs the same HP with the card as without', () => {
    const lost = (rm) => {
      const attacker = fighter('enemy', 1);
      const defender = fighter('player', 0);
      defender.stats.STR = 0;
      defender.weapon = null;
      defender.inventory = [];
      const battle = battleFor(rm, attacker, defender);
      const picked = battle._selectEnemyWeaponArt(attacker, defender);
      if (!picked) return null;
      battle._executeEnemyCombat(attacker, defender);
      expect(attacker._battleWeaponArtUsage?.map?.[art.id], 'the foe used the art').toBe(1);
      return 40 - attacker.currentHP;
    };
    const without = lost(runWith([]));
    const withCard = lost(runWith(['bloodless_art']));
    expect(without).not.toBeNull();
    expect(withCard).toBe(without);
    expect(withCard).toBe(5);
  });
});
