import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildRecruitNodeUnit,
  ensureRecruitPreviews,
  resolveRecruitNodeLevel,
  seasonedGrowthRanges,
  spawnTilesForDeployment,
  RECRUIT_PREVIEW_VERSION,
} from '../src/engine/RecruitNodeSystem.js';
import { RECRUIT_NODE_LORD_CHANCE } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

/** Units compared without their item uids (fresh per build, by design). */
function stripUids(value) {
  return JSON.parse(JSON.stringify(value, (key, v) => (key === 'uid' ? undefined : v)));
}

function lordRoster(availableLordName = null, level = 5, tier = 'base') {
  const names = ['Edric', 'Sera'];
  if (availableLordName) {
    for (const lord of gameData.lords) if (lord.name !== availableLordName) names.push(lord.name);
  } else {
    for (const lord of gameData.lords) if (!names.includes(lord.name)) names.push(lord.name);
  }
  return names.map((name, i) => ({
    name,
    className: 'Lord',
    isLord: true,
    isCommander: i === 0,
    level,
    tier,
    faction: 'player',
  }));
}

/** A scripted rng: returns `seq[i]` for the i-th draw, then `rest`. */
function scripted(seq, rest = 0.5) {
  let i = 0;
  return () => (i < seq.length ? seq[i++] : rest);
}

function build(overrides = {}) {
  return buildRecruitNodeUnit({
    preview: { className: 'Fighter', name: 'Test Recruit' },
    nodeId: 'act1_3_2',
    runSeed: 12345,
    act: 'act1',
    roster: [{ name: 'Edric', isLord: true, isCommander: true, level: 5, tier: 'base' }],
    gameData,
    ...overrides,
  });
}

afterEach(() => vi.restoreAllMocks());

describe('recruit previews', () => {
  const nodeMap = () => ({
    actId: 'act1',
    nodes: [
      { id: 'act1_0_2', type: 'battle', row: 0 },
      { id: 'act1_2_1', type: 'recruit', row: 2 },
      { id: 'act1_3_3', type: 'recruit', row: 3 },
      { id: 'act1_4_2', type: 'recruit', row: 4, completed: true },
      { id: 'act1_4_3', type: 'shop', row: 4 },
    ],
  });

  it('gives every open recruit node a class and name from the act pool, deterministically', () => {
    const a = nodeMap();
    const b = nodeMap();
    expect(ensureRecruitPreviews(a, { runSeed: 7, recruits: gameData.recruits })).toBe(2);
    ensureRecruitPreviews(b, { runSeed: 7, recruits: gameData.recruits });
    expect(a).toEqual(b);
    const pool = gameData.recruits.act1.classPool;
    for (const node of a.nodes.filter((n) => n.recruitPreview)) {
      expect(node.type).toBe('recruit');
      expect(node.recruitPreview.v).toBe(RECRUIT_PREVIEW_VERSION);
      expect(pool).toContain(node.recruitPreview.className);
      expect(gameData.recruits.namePool[node.recruitPreview.className]).toContain(
        node.recruitPreview.name,
      );
    }
    expect(a.nodes.find((n) => n.id === 'act1_4_2').recruitPreview).toBeUndefined();
    expect(a.nodes.find((n) => n.type !== 'recruit' && n.recruitPreview)).toBeUndefined();
  });

  it('is idempotent and never touches Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    const map = nodeMap();
    ensureRecruitPreviews(map, { runSeed: 9, recruits: gameData.recruits });
    const first = JSON.stringify(map);
    expect(ensureRecruitPreviews(map, { runSeed: 9, recruits: gameData.recruits })).toBe(0);
    expect(JSON.stringify(map)).toBe(first);
    expect(spy).not.toHaveBeenCalled();
  });

  it('avoids names already used in the run, on the roster, among the fallen and on other nodes', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const map = nodeMap();
      const taken = ['Galvin', 'Ren', 'Lira'];
      ensureRecruitPreviews(map, {
        runSeed: seed,
        recruits: gameData.recruits,
        usedRecruitNames: { Fighter: ['Galvin'] },
        roster: [{ name: 'Ren' }],
        fallenUnits: [{ name: 'Lira' }],
      });
      const names = map.nodes.filter((n) => n.recruitPreview).map((n) => n.recruitPreview.name);
      expect(new Set(names).size).toBe(names.length);
      for (const name of names) expect(taken).not.toContain(name);
    }
  });

  it('leaves a node that already has a preview alone', () => {
    const map = nodeMap();
    map.nodes[1].recruitPreview = { v: 1, className: 'Mage', name: 'Elara' };
    ensureRecruitPreviews(map, { runSeed: 3, recruits: gameData.recruits });
    expect(map.nodes[1].recruitPreview).toEqual({ v: 1, className: 'Mage', name: 'Elara' });
    expect(map.nodes[2].recruitPreview.name).not.toBe('Elara');
  });
});

describe('buildRecruitNodeUnit', () => {
  it('is deterministic for the same run state and never consumes the caller Math.random', () => {
    const counting = vi.fn(() => 0.42);
    const prev = Math.random;
    Math.random = counting;
    try {
      const a = build();
      const b = build();
      expect(stripUids(a.unit)).toEqual(stripUids(b.unit));
      expect(counting).not.toHaveBeenCalled();
      expect(Math.random).toBe(counting);
    } finally {
      Math.random = prev;
    }
  });

  it('differs between nodes and runs', () => {
    const a = build({ nodeId: 'act1_3_2' }).unit;
    const b = build({ nodeId: 'act1_5_1' }).unit;
    const c = build({ runSeed: 999 }).unit;
    expect(
      JSON.stringify(a.growths) === JSON.stringify(b.growths) &&
        JSON.stringify(a.growths) === JSON.stringify(c.growths),
    ).toBe(false);
  });

  it('keeps the preview class and name', () => {
    const { unit, isLord } = build({ gameData: { ...gameData, lords: [] } });
    expect(isLord).toBe(false);
    expect(unit.className).toBe('Fighter');
    expect(unit.name).toBe('Test Recruit');
    expect(unit.faction).toBe('npc');
  });

  it('seasoned recruits roll growths in the upper half and carry at least one trait', () => {
    const fighter = gameData.classes.find((c) => c.name === 'Fighter');
    const upper = seasonedGrowthRanges(fighter.growthRanges);
    for (let seed = 1; seed <= 60; seed++) {
      const { unit } = build({ runSeed: seed, gameData: { ...gameData, lords: [] } });
      expect(unit.traits.length).toBeGreaterThanOrEqual(1);
      // Trait growth mods can add on top; the rolled base is never below the midpoint.
      for (const [stat, range] of Object.entries(upper)) {
        const [lo] = range.split('-').map(Number);
        expect(unit.growths[stat]).toBeGreaterThanOrEqual(lo);
      }
    }
  });

  it('seasoned=false keeps the full growth range', () => {
    const fighter = gameData.classes.find((c) => c.name === 'Fighter');
    let belowMid = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { unit } = build({
        runSeed: seed,
        seasoned: false,
        gameData: { ...gameData, lords: [], traits: null },
      });
      const [lo, hi] = fighter.growthRanges.HP.split('-').map(Number);
      if (unit.growths.HP < Math.ceil((lo + hi) / 2)) belowMid++;
    }
    expect(belowMid).toBeGreaterThan(0);
  });

  it('upper half of a range', () => {
    expect(seasonedGrowthRanges({ HP: '40-70', STR: '5-5', LCK: 'x' })).toEqual({
      HP: '55-70',
      STR: '5-5',
      LCK: 'x',
    });
  });
});

describe('recruit level', () => {
  it('averages the strongest deploy-cap squad, promoted units counting 10 + level', () => {
    const roster = [
      { level: 9 },
      { level: 8 },
      { level: 7 },
      { level: 6 },
      { level: 1 },
      { level: 1 },
    ];
    // act1 cap 4: (9+8+7+6)/4 = 7
    expect(resolveRecruitNodeLevel({ roster, act: 'act1', enemies: gameData.enemies })).toBe(7);
    // deploy bonus widens the squad: (9+8+7+6+1)/5 = 6.2 → 6
    expect(
      resolveRecruitNodeLevel({ roster, act: 'act1', enemies: gameData.enemies, deployBonus: 1 }),
    ).toBe(6);
    const promoted = [{ level: 2, tier: 'promoted' }, { level: 10 }];
    expect(
      resolveRecruitNodeLevel({ roster: promoted, act: 'act2', enemies: gameData.enemies }),
    ).toBe(11);
  });

  it('adds the recruit level bonus and never drops below the act minimum', () => {
    expect(
      resolveRecruitNodeLevel({
        roster: [{ level: 3 }],
        act: 'act1',
        enemies: gameData.enemies,
        recruitLevelBonus: 1,
      }),
    ).toBe(4);
    const act4Min = gameData.enemies.pools.act4.levelRange[0];
    expect(
      resolveRecruitNodeLevel({ roster: [{ level: 2 }], act: 'act4', enemies: gameData.enemies }),
    ).toBe(act4Min);
  });
});

// Ported from BattleSceneRecruitLord.test.js: the NPC build moved into RecruitNodeSystem.
describe('recruit-node lords and promotions', () => {
  it('uses the tuned recruit-node base lord chance', () => {
    expect(RECRUIT_NODE_LORD_CHANCE).toBe(0.15);
  });

  it('lordRecruitChanceBonus increases recruit-node lord chance', () => {
    const roster = lordRoster('Kira');
    const withBonus = build({
      roster,
      rng: scripted([0.3]),
      metaEffects: { lordRecruitChanceBonus: 0.16 },
    });
    expect(withBonus.isLord).toBe(true);
    const without = build({
      roster,
      rng: scripted([0.3]),
      metaEffects: { lordRecruitChanceBonus: 0 },
    });
    expect(without.isLord).toBe(false);
  });

  it('promotes recruit-node lords when the act pool has a promoted class', () => {
    const { unit, isLord } = build({
      act: 'act4',
      preview: { className: 'Hero', name: 'Test Recruit' },
      roster: lordRoster('Voss'),
      rng: () => 0,
    });
    expect(isLord).toBe(true);
    expect(unit.name).toBe('Voss');
    expect(unit.tier).toBe('promoted');
    expect(unit.className).toBe('Vanguard');
  });

  it('a regular promoted recruit stays promoted on a low roll and drops to base on a high one', () => {
    const roster = lordRoster(null);
    const high = build({
      act: 'act4',
      preview: { className: 'Hero', name: 'Test Recruit' },
      roster,
      rng: scripted([0.99, 0.99, 0.99, 0.1], 0.1),
    });
    expect(high.unit.className).toBe('Hero');
    expect(high.unit.tier).toBe('promoted');
    const low = build({
      act: 'act1',
      preview: { className: 'Hero', name: 'Test Recruit' },
      roster: [{ name: 'Edric', isLord: true, isCommander: true, level: 5 }],
      rng: scripted([0.99, 0.99, 0.99, 0.95], 0.95),
    });
    expect(low.unit.className).toBe('Mercenary');
    expect(low.unit.tier).toBe('base');
    expect(low.unit.level).toBe(4);
  });

  it('a recruit-node lord stays at full level on a failed promotion roll', () => {
    const { unit, isLord } = build({
      act: 'act4',
      preview: { className: 'Hero', name: 'Test Recruit' },
      roster: lordRoster('Voss'),
      rng: scripted([0, 0, 0.95], 0),
    });
    expect(isLord).toBe(true);
    expect(unit.className).toBe('Ranger');
    expect(unit.tier).toBe('base');
    // Base lords cap at the dynamic promotion level (10 with an unpromoted commander).
    expect(unit.level).toBe(10);
  });

  it('recruitPromotionChanceBonus raises the regular promotion chance', () => {
    const args = {
      act: 'act4',
      preview: { className: 'Hero', name: 'Test Recruit' },
      roster: lordRoster(null),
    };
    const a = build({ ...args, rng: scripted([0.99, 0.99, 0.99, 0.55]) });
    expect(a.unit.tier).toBe('base');
    const b = build({
      ...args,
      rng: scripted([0.99, 0.99, 0.99, 0.55]),
      metaEffects: { recruitPromotionChanceBonus: 0.2 },
    });
    expect(b.unit.tier).toBe('promoted');
    expect(b.unit.className).toBe('Hero');
  });

  it('lord and regular promoted recruits share the promoted-level target', () => {
    const commander = {
      name: 'Edric',
      isLord: true,
      isCommander: true,
      level: 4,
      tier: 'promoted',
    };
    const regular = build({
      act: 'act4',
      preview: { className: 'Hero', name: 'Test Recruit' },
      roster: [commander, ...lordRoster(null).slice(1)],
      rng: scripted([0.99, 0.99, 0.99, 0.1], 0.1),
    });
    const lord = build({
      act: 'act4',
      preview: { className: 'Hero', name: 'Test Recruit' },
      roster: [commander, ...lordRoster('Voss').slice(1)],
      rng: scripted([0, 0, 0.1], 0.1),
    });
    expect(lord.isLord).toBe(true);
    expect(regular.unit.level).toBe(4);
    expect(lord.unit.level).toBe(regular.unit.level);
  });

  it.each([false, true])('adds the Act 3 readiness package once (lord=%s)', (isLordSlot) => {
    const spawn = (act) =>
      build({
        act,
        preview: { className: 'Hero', name: 'Test Recruit' },
        roster: [
          { name: 'Edric', isLord: true, isCommander: true, tier: 'promoted', level: 6 },
          ...lordRoster('Kira', 6, 'promoted').slice(1),
        ],
        rng: scripted([isLordSlot ? 0 : 0.99, 0, 0.99, 0.99], 0.99),
        seasoned: false,
        gameData: { ...gameData, traits: null },
      }).unit;
    const boosted = spawn('act3');
    const baseline = spawn('act4');
    expect(boosted.tier).toBe('base');
    expect(boosted.isLord).toBe(isLordSlot);
    expect(boosted.className).toBe(baseline.className);
    expect(boosted.stats.HP - baseline.stats.HP).toBe(2);
    expect(boosted.stats.SPD - baseline.stats.SPD).toBe(1);
    const attack = isLordSlot ? 'MAG' : 'STR';
    expect(boosted.stats[attack] - baseline.stats[attack]).toBe(2);
    expect(boosted.stats.DEF + boosted.stats.RES - baseline.stats.DEF - baseline.stats.RES).toBe(1);
  });
});

// Ported from BattleSceneRecruitOutfitting.test.js.
describe('recruit-node outfitting meta upgrades', () => {
  const noLords = { ...gameData, lords: [] };

  it('forges the join weapon when recruitWeaponForge is active', () => {
    const { unit } = build({
      gameData: noLords,
      metaEffects: { recruitWeaponForge: 2 },
      rng: () => 0,
    });
    expect(unit.inventory).toHaveLength(2);
    expect(unit.inventory.find((w) => w.name.startsWith('Hand Axe'))._forgeLevel).toBe(2);
    expect(unit.weapon._forgeLevel).toBe(2);
    expect(unit.weapon.name).toMatch(/\+2$/);
    expect(unit.weapon).toBe(unit.inventory[0]);
  });

  it('forges the Lethal Armory grant too when both upgrades are active', () => {
    const { unit } = build({
      gameData: noLords,
      metaEffects: { lethalArmoryTier: 2, recruitWeaponForge: 1 },
      rng: () => 0,
    });
    expect(unit.inventory).toHaveLength(3);
    for (const weapon of unit.inventory) {
      expect(weapon._forgeLevel).toBe(1);
      expect(weapon.name).toMatch(/\+1$/);
    }
    expect(unit.inventory.some((w) => w.name.startsWith('Steel Axe'))).toBe(true);
  });

  it('leaves weapons unforged without recruitWeaponForge', () => {
    const { unit } = build({ gameData: noLords, rng: () => 0.25 });
    for (const weapon of unit.inventory) expect(weapon._forgeLevel || 0).toBe(0);
  });

  it('equips a stat accessory when recruitStartingAccessory is active', () => {
    const { unit } = build({
      gameData: noLords,
      metaEffects: { recruitStartingAccessory: 1 },
      rng: () => 0,
    });
    expect(unit.accessory?.name).toBe('Power Ring');
    expect(typeof unit.accessory.uid).toBe('string');
  });

  it('grants no accessory without recruitStartingAccessory', () => {
    const { unit } = build({ gameData: noLords, rng: () => 0.25 });
    expect(unit.accessory).toBeNull();
  });

  it('adds a Vulnerary when recruitStartingVulnerary is active', () => {
    const { unit } = build({ gameData: noLords, metaEffects: { recruitStartingVulnerary: true } });
    expect(unit.consumables.some((c) => c.name === 'Vulnerary')).toBe(true);
  });
});

describe('spawnTilesForDeployment', () => {
  const units = [
    { name: 'A' },
    { name: 'Edric', isLord: true },
    { name: 'B' },
    { name: 'Sera', isLord: true },
  ];
  const tiles = [{ col: 1 }, { col: 2 }, { col: 3 }, { col: 4 }];

  it('keeps deployment order outside recruit battles', () => {
    expect(spawnTilesForDeployment(units, tiles).map((t) => t.col)).toEqual([1, 2, 3, 4]);
  });

  it('gives lords the first (nearest) tiles in a recruit battle', () => {
    expect(spawnTilesForDeployment(units, tiles, { lordsFirst: true }).map((t) => t.col)).toEqual([
      3, 1, 4, 2,
    ]);
  });

  it('returns null for units beyond the available tiles', () => {
    expect(spawnTilesForDeployment(units, tiles.slice(0, 2), { lordsFirst: true })).toEqual([
      null,
      { col: 1 },
      null,
      { col: 2 },
    ]);
  });
});
