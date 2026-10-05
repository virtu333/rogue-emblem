import { describe, expect, it } from 'vitest';
import {
  THEME_SHARE,
  battleMusicContext,
  orderPool,
  selectBattleMusic,
} from '../src/engine/BattleMusicSelection.js';

const TABLE = {
  battle: {
    act1: ['a1_1', 'a1_2', 'a1_3', 'a1_4'],
    act2: ['a2_1', 'a2_2', 'a2_3'],
    act4: ['a4_1', 'a4_2'],
  },
  escape: 'escape',
  battleBiome: { castle: 'castle', swamp: 'swamp', tundra: 'tundra', volcano: 'volcano' },
  battleSituation: {
    eclipsed: 'eclipsed',
    village: 'village',
    rescue: 'rescue',
    elite: { act1: 'elite', act2: 'elite2', act4: ['elite4a', 'elite4b'] },
    caravan: 'caravan',
    fog: 'fog',
  },
};

const pick = (ctx) => selectBattleMusic({ seed: 7, act: 'act2', row: 0, ...ctx }, TABLE);

describe('battle music selection', () => {
  it('answers the most specific thing true of the battle', () => {
    expect(pick({ objective: 'escape', isEclipsed: true, isElite: true }).key).toBe('escape');
    expect(pick({ isEclipsed: true, isAmbush: true, isElite: true }).key).toBe('eclipsed');
    expect(pick({ isAmbush: true, isRecruitBattle: true }).key).toBe('village');
    expect(pick({ isRecruitBattle: true, isElite: true, biome: 'swamp' }).key).toBe('rescue');
    expect(pick({ isElite: true, biome: 'swamp' }).key).toBe('elite2');
    expect(pick({ biome: 'swamp' })).toEqual({ key: 'swamp', reason: 'biome:swamp' });
    expect(pick({ biome: 'tundra', act: 'act4' }).key).toBe('tundra');
    expect(pick({ biome: 'grassland' }).reason).toBe('act');
  });

  it('gives each act its own elite company, and an act without one the first', () => {
    expect(pick({ isElite: true, act: 'act1' }).key).toBe('elite');
    expect(pick({ isElite: true, act: 'act2' }).key).toBe('elite2');
    // no act3 entry: the table's first
    expect(pick({ isElite: true, act: 'act3' }).key).toBe('elite');
    // a pool is walked by the node's hash, the same pick every time
    const heard = new Set();
    for (let seed = 0; seed < 60; seed++) {
      const r = pick({ isElite: true, act: 'act4', seed, nodeKey: `n${seed}` });
      expect(pick({ isElite: true, act: 'act4', seed, nodeKey: `n${seed}` })).toEqual(r);
      expect(r.reason).toBe('elite');
      heard.add(r.key);
    }
    expect([...heard].sort()).toEqual(['elite4a', 'elite4b']);
  });

  it('caravans, village raids and fog each take a share, after the place', () => {
    const rate = (ctx, key) => {
      let hits = 0;
      for (let seed = 0; seed < 600; seed++) {
        const r = pick({ ...ctx, seed, nodeKey: `n${seed}` });
        expect(pick({ ...ctx, seed, nodeKey: `n${seed}` })).toEqual(r);
        if (r.key === key) hits++;
        else expect(r.reason).toBe('act');
      }
      return hits / 600;
    };
    expect(rate({ hasCaravan: true }, 'caravan')).toBeGreaterThan(THEME_SHARE.caravan - 0.08);
    expect(rate({ hasCaravan: true }, 'caravan')).toBeLessThan(THEME_SHARE.caravan + 0.08);
    expect(rate({ isFog: true }, 'fog')).toBeGreaterThan(THEME_SHARE.fog - 0.08);
    expect(rate({ isFog: true }, 'fog')).toBeLessThan(THEME_SHARE.fog + 0.08);
    // the place outranks the fog; a situation outranks both
    expect(pick({ isFog: true, biome: 'swamp' }).key).toBe('swamp');
    expect(pick({ isFog: true, isElite: true }).key).toBe('elite2');
    expect(pick({ isFog: true, isRecruitBattle: true }).key).toBe('rescue');
    // a caravan the share passes over can still be a fog map
    let fogAfterCaravan = 0;
    for (let seed = 0; seed < 200; seed++) {
      const r = pick({ hasCaravan: true, isFog: true, seed, nodeKey: `n${seed}` });
      if (r.key === 'fog') fogAfterCaravan++;
    }
    expect(fogAfterCaravan).toBeGreaterThan(0);
  });

  it('falls through when a theme is missing from the table', () => {
    const bare = { battle: TABLE.battle };
    const r = selectBattleMusic(
      { seed: 1, act: 'act2', row: 0, isElite: true, biome: 'castle', objective: 'escape' },
      bare,
    );
    expect(r.reason).toBe('act');
    expect(TABLE.battle.act2).toContain(r.key);
  });

  it('gives castles and village raids only a share, the same share every time', () => {
    const castle = [];
    const raid = [];
    for (let seed = 0; seed < 600; seed++) {
      const c = pick({ seed, biome: 'castle', nodeKey: `n${seed}` });
      expect(pick({ seed, biome: 'castle', nodeKey: `n${seed}` })).toEqual(c);
      castle.push(c.key === 'castle');
      raid.push(pick({ seed, hasVillage: true, nodeKey: `n${seed}` }).key === 'village');
    }
    const rate = (xs) => xs.filter(Boolean).length / xs.length;
    expect(rate(castle)).toBeGreaterThan(THEME_SHARE.castle - 0.08);
    expect(rate(castle)).toBeLessThan(THEME_SHARE.castle + 0.08);
    expect(rate(raid)).toBeGreaterThan(THEME_SHARE.villageRaid - 0.08);
    expect(rate(raid)).toBeLessThan(THEME_SHARE.villageRaid + 0.08);
  });

  it('lets escapes and places choose by act, from a key, a pool or a table', () => {
    const table = {
      ...TABLE,
      escape: { act1: 'esc1', act2: ['esc1', 'esc2'], act4: 'esc2' },
      battleBiome: { ...TABLE.battleBiome, castle: { act2: 'castle1', act4: 'castle2' } },
    };
    const at = (ctx) => selectBattleMusic({ seed: 7, row: 0, ...ctx }, table);
    expect(at({ act: 'act1', objective: 'escape' })).toEqual({ key: 'esc1', reason: 'escape' });
    expect(at({ act: 'act4', objective: 'escape' }).key).toBe('esc2');
    // an act the table doesn't list takes its first entry
    expect(at({ act: 'act3', objective: 'escape' }).key).toBe('esc1');
    // THEME_SHARE still gates the place; the act decides which castle theme
    const castles = new Set();
    for (let seed = 0; seed < 200; seed++) {
      for (const act of ['act2', 'act4']) {
        const r = at({ act, seed, biome: 'castle', nodeKey: `n${seed}` });
        if (r.reason === 'biome:castle') castles.add(`${act}:${r.key}`);
        else expect(r.reason).toBe('act');
      }
    }
    expect([...castles].sort()).toEqual(['act2:castle1', 'act4:castle2']);
    // a pool plays both, and a resumed battle hears the same one
    const heard = new Set();
    for (let seed = 0; seed < 40; seed++) {
      const r = at({ act: 'act2', objective: 'escape', seed, nodeKey: `n${seed}` });
      expect(at({ act: 'act2', objective: 'escape', seed, nodeKey: `n${seed}` })).toEqual(r);
      heard.add(r.key);
    }
    expect([...heard].sort()).toEqual(['esc1', 'esc2']);
  });

  it('walks a situation pool along a path: consecutive rows hear different themes', () => {
    const table = { ...TABLE, battleSituation: { ...TABLE.battleSituation, rescue: ['r1', 'r2'] } };
    for (let seed = 0; seed < 50; seed++) {
      const at = (row, nodeKey) =>
        selectBattleMusic({ seed, act: 'act2', row, nodeKey, isRecruitBattle: true }, table).key;
      expect(at(3, 'a')).not.toBe(at(4, 'b'));
      // the row decides, not the node: the pick survives a changed node key
      expect(at(3, 'a')).toBe(at(3, 'c'));
      expect(at(5, 'a')).toBe(at(3, 'a'));
    }
    // each run orders the pool its own way
    const openers = new Set();
    for (let seed = 0; seed < 40; seed++) {
      openers.add(
        selectBattleMusic({ seed, act: 'act2', row: 0, isRecruitBattle: true }, table).key,
      );
    }
    expect([...openers].sort()).toEqual(['r1', 'r2']);
    // without a row the node's own hash picks, stably
    const noRow = { seed: 3, act: 'act2', row: null, nodeKey: 'x', isRecruitBattle: true };
    expect(['r1', 'r2']).toContain(selectBattleMusic(noRow, table).key);
    expect(selectBattleMusic(noRow, table)).toEqual(selectBattleMusic(noRow, table));
  });

  it('never repeats an act theme along a path until the pool is spent', () => {
    for (let seed = 0; seed < 50; seed++) {
      const heard = [0, 1, 2].map((row) => pick({ seed, row }).key);
      expect(new Set(heard).size).toBe(3);
      // the walk wraps once the pool is spent
      expect(pick({ seed, row: 3 }).key).toBe(heard[0]);
    }
  });

  it('opens every run on Ember Dusk and keeps it from repeating later in Act I', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(orderPool(TABLE.battle.act1, seed, 'act1')[0]).toBe('a1_1');
      expect(pick({ seed, act: 'act1', row: 0 }).key).toBe('a1_1');
      expect(pick({ seed, act: 'act1', row: 1 }).key).not.toBe('a1_1');
      expect(pick({ seed, act: 'act1', row: 5, firstBattle: true })).toEqual({
        key: 'a1_1',
        reason: 'first',
      });
    }
  });

  it('varies the order between runs', () => {
    const orders = new Set();
    for (let seed = 0; seed < 40; seed++)
      orders.add(orderPool(TABLE.battle.act2, seed, 'act2').join());
    expect(orders.size).toBeGreaterThan(3);
  });

  it('plays the act-one pool for an unknown act, and nothing for an empty table', () => {
    expect(TABLE.battle.act1).toContain(pick({ act: 'act9' }).key);
    expect(selectBattleMusic({ act: 'act1' }, { battle: {} })).toEqual({
      key: null,
      reason: 'none',
    });
  });

  it('reads the context from battle params and config', () => {
    const ctx = battleMusicContext({
      battleParams: {
        act: 'act3',
        row: 2,
        battleSeed: 99,
        isAmbush: true,
        hasVillage: true,
        isRecruitBattle: false,
        isEclipsed: true,
        hasCaravan: true,
        fogEnabled: true,
      },
      battleConfig: { objective: 'rout', biome: 'castle', caravanSpawn: { col: 5, row: 1 } },
      runSeed: 1234,
      isElite: true,
    });
    expect(ctx).toMatchObject({
      act: 'act3',
      objective: 'rout',
      biome: 'castle',
      row: 2,
      seed: 1234,
      firstBattle: false,
      isElite: true,
      isAmbush: true,
      hasVillage: true,
      isRecruitBattle: false,
      isEclipsed: true,
      hasCaravan: true,
      isFog: true,
    });
    // The roll promised a caravan, but its map had no safe tile: no caravan theme.
    expect(
      battleMusicContext({
        battleParams: { hasCaravan: true },
        battleConfig: { objective: 'rout' },
      }).hasCaravan,
    ).toBe(false);
    expect(battleMusicContext().isFog).toBe(false);
    // no run seed: the node's own battle seed still makes the pick stable
    expect(battleMusicContext({ battleParams: { battleSeed: 99 } }).seed).toBe(99);
    expect(
      battleMusicContext({ battleParams: { prologueChapter: 'p1_banner_at_dawn' } }).firstBattle,
    ).toBe(true);
    expect(battleMusicContext().act).toBe('act1');
  });
});
