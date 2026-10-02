// The Oct 2026 weapon-art tuning: art follow-ups, spawn tiers, scrolls in every act,
// Hollow Feast's draining splash, art effects that skip a plain follow-up, the four
// revived legacy arts, and Iron/Steel arts reachable without Iron Arms or Steel Arms.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import {
  actArtScrollPool,
  drawTierArtScrolls,
  generateShopInventory,
} from '../src/engine/LootSystem.js';
import { getCombatForecast } from '../src/engine/Combat.js';
import { getPostCombatPipelineSteps } from '../src/engine/WeaponArtPostCombat.js';
import { areaDamage } from '../src/engine/PostCombatEffects.js';
import { getWeaponArtArea, getWeaponArtCombatMods } from '../src/engine/WeaponArtSystem.js';
import { weaponArtDetailLines } from '../src/ui/weaponArtDisplay.js';

const data = loadGameData();
const arts = data.weaponArts.arts;
const art = (id) => arts.find((a) => a.id === id);

describe('weapon art data', () => {
  it('every area or reach art gives up its follow-up, and only those', () => {
    for (const a of arts) {
      const mods = a.combatMods || {};
      const reach = Boolean(a.area || mods.rangeBonus || mods.rangeOverride);
      expect(a.noFollowUp === true, a.name).toBe(reach);
      expect(getWeaponArtCombatMods(a).artNoFollowUp, a.name).toBe(reach);
    }
  });

  it('Grounder and Helm Splitter scrolls are on sale from Act 1 to Act 4', () => {
    for (const act of ['act1', 'act2', 'act3', 'act4']) {
      expect(data.lootTables[act].weaponArtScroll, act).toEqual(
        expect.arrayContaining(['Grounder Scroll', 'Helm Splitter Scroll']),
      );
    }
    // Act 1 sells them but never drops them.
    expect(data.lootTables.act1.weights.weaponArtScroll).toBe(0);
  });

  it('Hollow Feast strikes from two tiles and drains its splash', () => {
    const feast = art('legend_life_drain');
    expect(feast.name).toBe('Hollow Feast');
    expect(getWeaponArtCombatMods(feast).rangeOverride).toEqual({ min: 1, max: 2 });
    expect(getWeaponArtArea(feast).drainPercent).toBe(1);
    const text = weaponArtDetailLines(feast).join('\n');
    expect(text).toContain('heals you 100% of the area damage');
    expect(text).toContain('strikes once however fast you are');
  });
});

describe('art spawns by tier', () => {
  it('a shop Steel weapon can roll an Iron art listed for Steel in spawnTiers', () => {
    const lootTables = {
      act1: {
        weapons: ['Steel Sword'],
        healing: [],
        weights: { weapon: 100 },
      },
    };
    const catalog = [
      {
        id: 'iron_and_steel_art',
        weaponType: 'Sword',
        tierAffinity: 'Iron',
        spawnTiers: ['Iron', 'Steel'],
        unlockAct: 'act1',
      },
      { id: 'iron_only_art', weaponType: 'Sword', tierAffinity: 'Iron', unlockAct: 'act1' },
    ];
    const shop = generateShopInventory(
      'act1',
      lootTables,
      data.weapons,
      data.consumables,
      data.accessories,
      null,
      { weaponArtCatalog: catalog, steelArms: true },
    );
    const sword = shop.find((entry) => entry.item.name === 'Steel Sword')?.item;
    expect(sword?.weaponArtIds).toEqual(['iron_and_steel_art']);
  });
});

describe('art effects skip a plain follow-up', () => {
  const attacker = { name: 'A', currentHP: 30, stats: { HP: 30 } };
  const defender = { name: 'D', currentHP: 30, stats: { HP: 30 } };
  const strike = (side, miss, artFollowUp = false) => ({
    type: 'strike',
    attackerSide: side,
    attacker: side === 'attacker' ? 'A' : 'D',
    miss,
    damage: miss ? 0 : 5,
    ...(artFollowUp ? { artFollowUp: true } : {}),
  });
  const steps = (artId, events) =>
    getPostCombatPipelineSteps({
      attacker,
      defender,
      attackerWeaponArt: art(artId),
      result: { events, strikeMods: { attacker: null, defender: null } },
    });

  it('All or Nothing recoils only for its own missed strikes', () => {
    const recoil = (events) =>
      steps('bow_all_or_nothing', events).find((s) => s.type === 'art_miss_self_damage');
    expect(recoil([strike('attacker', true), strike('attacker', true, true)])?.amount).toBe(5);
    expect(recoil([strike('attacker', false), strike('attacker', true, true)])).toBeUndefined();
  });

  it("an on-hit art effect needs the art's own strike to land", () => {
    const rooted = (events) => steps('bow_encloser', events).some((s) => s.type === 'tier2_status');
    expect(rooted([strike('attacker', true), strike('attacker', false, true)])).toBe(false);
    expect(rooted([strike('attacker', false), strike('attacker', true, true)])).toBe(true);
  });

  it('a per-hit line area counts only art strikes', () => {
    const line = steps('lance_skewer', [
      strike('attacker', false),
      strike('attacker', false, true),
    ]).find((s) => s.type === 'area_damage');
    expect(line?.blows).toBe(1);
  });
});

describe('draining area blows', () => {
  it('heal the user by the share of the damage the blows dealt', () => {
    const source = {
      name: 'S',
      faction: 'player',
      col: 0,
      row: 0,
      currentHP: 10,
      stats: { HP: 40 },
    };
    const foes = [
      { name: 'F1', faction: 'enemy', col: 5, row: 5, currentHP: 3, stats: { HP: 20 } },
      { name: 'F2', faction: 'enemy', col: 5, row: 6, currentHP: 20, stats: { HP: 20 } },
    ];
    const world = { cols: 10, rows: 10, hostilesOf: () => foes };
    const step = {
      area: getWeaponArtArea({
        area: {
          shape: 'radius',
          radius: 1,
          drainPercent: 0.5,
          damage: { kind: 'fixed', amount: 6 },
        },
      }),
      center: { col: 5, row: 5 },
      blows: 1,
      requiresLiveSource: true,
    };
    // F1 has 3 HP left, so the blows deal 3 + 6 = 9; half of that (4) heals.
    const beats = [...areaDamage(step, source, null, world, null)];
    expect(foes.map((f) => f.currentHP)).toEqual([0, 14]);
    expect(source.currentHP).toBe(14);
    expect(beats.some((b) => b.kind === 'hint' && b.text === 'Drain +4')).toBe(true);
  });

  it('heal nothing without drainPercent', () => {
    const source = {
      name: 'S',
      faction: 'player',
      col: 0,
      row: 0,
      currentHP: 10,
      stats: { HP: 40 },
    };
    const foes = [
      { name: 'F', faction: 'enemy', col: 5, row: 5, currentHP: 20, stats: { HP: 20 } },
    ];
    const step = {
      area: getWeaponArtArea({
        area: { shape: 'radius', radius: 1, damage: { kind: 'fixed', amount: 6 } },
      }),
      center: { col: 5, row: 5 },
      blows: 1,
    };
    [...areaDamage(step, source, null, { cols: 10, rows: 10, hostilesOf: () => foes }, null)];
    expect(foes[0].currentHP).toBe(14);
    expect(source.currentHP).toBe(10);
  });
});

// Seeded Math.random so the rates below are exact replays, not flaky samples.
function seedRandom(seed) {
  let a = seed >>> 0;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

describe('revived legacy arts', () => {
  afterEach(() => vi.restoreAllMocks());
  const terrain = (name) => data.terrain.find((t) => t.name === name);
  const unit = (weaponName, faction, stats = {}) => ({
    name: faction,
    className: 'Test',
    tier: 'base',
    level: 1,
    isLord: false,
    stats: { HP: 30, STR: 8, MAG: 0, SKL: 10, SPD: 8, DEF: 5, RES: 3, LCK: 5, ...stats },
    currentHP: 30,
    faction,
    weapon: data.weapons.find((w) => w.name === weaponName),
    inventory: [],
    proficiencies: ['Sword', 'Lance', 'Axe', 'Bow'].map((type) => ({ type, rank: 'Prof' })),
    skills: [],
    moveType: 'Infantry',
  });
  // A fast foe (avoid 45 on a plain) keeps every hit below the 100 cap.
  const strike = (artId, weaponName, foeWeapon, foeTerrain, distance = 1) => {
    const attacker = unit(weaponName, 'player');
    const foe = unit(foeWeapon, 'enemy', { SPD: 20 });
    const mods = artId ? { atkWeaponArtMods: getWeaponArtCombatMods(art(artId)) } : null;
    return getCombatForecast(
      attacker,
      attacker.weapon,
      foe,
      foe.weapon,
      distance,
      terrain('Plain'),
      terrain(foeTerrain),
      mods,
    ).attacker;
  };

  it('spawn again, and the four that duplicate live arts stay retired', () => {
    for (const id of [
      'sword_precise_cut',
      'lance_piercing_drive',
      'lance_vaulting_thrust',
      'bow_longshot',
    ])
      expect(art(id).legacy, id).toBeUndefined();
    for (const id of [
      'sword_comet_edge',
      'axe_wild_swing',
      'axe_rending_cleave',
      'bow_hunters_focus',
    ])
      expect(art(id).legacy, id).toBe(true);
  });

  it("Precise Cut and Longshot ignore the foe's cover", () => {
    // A forest's 20 avoid costs a plain strike 20 hit and these arts none.
    expect(
      strike(null, 'Iron Sword', 'Iron Sword', 'Plain').hit -
        strike(null, 'Iron Sword', 'Iron Sword', 'Forest').hit,
    ).toBe(20);
    for (const [id, weapon, distance] of [
      ['sword_precise_cut', 'Iron Sword', 1],
      ['bow_longshot', 'Iron Bow', 2],
    ]) {
      const open = strike(id, weapon, 'Iron Sword', 'Plain', distance);
      expect(open.hit, id).toBeLessThan(100);
      expect(strike(id, weapon, 'Iron Sword', 'Forest', distance).hit, id).toBe(open.hit);
    }
    // Longshot's +4 rides the strike: Iron Bow vs DEF 5 deals 4 more than a plain shot.
    expect(strike('bow_longshot', 'Iron Bow', 'Iron Sword', 'Plain', 2).damage).toBe(
      strike(null, 'Iron Bow', 'Iron Sword', 'Plain', 2).damage + 4,
    );
  });

  it('Piercing Drive takes no triangle penalty against an axe', () => {
    // Plain: a lance hits an axe-wielder for 1 less than a bow-wielder (triangle disadvantage).
    const vsAxe = strike(null, 'Iron Lance', 'Iron Axe', 'Plain');
    const vsBow = strike(null, 'Iron Lance', 'Iron Bow', 'Plain');
    expect(vsBow.damage - vsAxe.damage).toBe(1);
    const drive = strike('lance_piercing_drive', 'Iron Lance', 'Iron Axe', 'Plain');
    expect(drive.damage).toBe(vsBow.damage + 3);
    expect(drive.hit).toBe(strike('lance_piercing_drive', 'Iron Lance', 'Iron Bow', 'Plain').hit);
  });
});

describe('Iron and Steel arts without Iron Arms or Steel Arms', () => {
  afterEach(() => vi.restoreAllMocks());
  const acts = ['act1', 'act2', 'act3', 'act4'];
  const tierOf = (scrollName) =>
    art(data.weapons.find((w) => w.name === scrollName).teachesWeaponArtId).tierAffinity;

  it('every live Iron or Steel art has a scroll some act offers', () => {
    const offered = new Set(
      acts.flatMap((act) => actArtScrollPool(data.lootTables[act], data.weapons, arts)),
    );
    const live = arts.filter(
      (a) => ['Iron', 'Steel'].includes(a.tierAffinity) && !a.legacy && !a.scrollOnly,
    );
    expect(live.length).toBe(40);
    for (const a of live) {
      const scroll = data.weapons.find((w) => w.teachesWeaponArtId === a.id);
      expect(scroll?.name, a.name).toBe(`${a.name} Scroll`);
      expect(offered.has(scroll.name), a.name).toBe(true);
    }
  });

  it("each roll draws the act's scroll slots: distinct, of that tier, never a listed one", () => {
    seedRandom(7);
    for (const act of acts) {
      const table = data.lootTables[act];
      for (let roll = 0; roll < 20; roll++) {
        const drawn = drawTierArtScrolls(table, data.weapons, arts);
        expect(new Set(drawn).size, act).toBe(drawn.length);
        for (const tier of ['Iron', 'Steel'])
          expect(drawn.filter((n) => tierOf(n) === tier).length, `${act} ${tier}`).toBe(
            table.artTiers.scrollSlots[tier],
          );
        for (const name of drawn) expect(table.weaponArtScroll, act).not.toContain(name);
      }
    }
  });

  it('Iron scrolls thin out after Act 2 and Steel scrolls peak in Acts 2-3', () => {
    const slots = (tier) => acts.map((act) => data.lootTables[act].artTiers.scrollSlots[tier]);
    const [i1, i2, i3, i4] = slots('Iron');
    expect(i3).toBeLessThan(i2);
    expect(i4).toBeLessThanOrEqual(i3);
    const [s1, s2, s3, s4] = slots('Steel');
    expect(Math.min(s2, s3)).toBeGreaterThan(Math.max(s1, s4));
    expect(i1).toBeGreaterThan(0);
  });

  it('a roster draws only scrolls it can use', () => {
    seedRandom(11);
    const drawn = drawTierArtScrolls(data.lootTables.act2, data.weapons, arts, {
      rosterTypes: new Set(['Sword']),
    });
    expect(drawn.length).toBeGreaterThan(0);
    for (const name of drawn)
      expect(data.weapons.find((w) => w.name === name).allowedWeaponTypes, name).toContain('Sword');
  });

  const ironSwordShops = (chance, spawnConfig, shops = 400) => {
    const lootTables = {
      act1: {
        weapons: ['Iron Sword'],
        healing: [],
        weaponArtScroll: [],
        artTiers: { innateChance: { Iron: chance } },
      },
    };
    const swords = [];
    for (let i = 0; i < shops; i++) {
      const shop = generateShopInventory(
        'act1',
        lootTables,
        data.weapons,
        data.consumables,
        data.accessories,
        null,
        { weaponArtCatalog: arts, ...spawnConfig },
      );
      swords.push(shop.find((entry) => entry.item.name === 'Iron Sword').item);
    }
    return swords;
  };

  it("an Iron weapon carries an art at the act's base chance, marked innate", () => {
    seedRandom(3);
    const swords = ironSwordShops(0.3, {});
    const withArt = swords.filter((s) => s.weaponArtIds?.length);
    // 400 seeded shops at 30%: 120 expected, sd about 9.
    expect(withArt.length).toBeGreaterThan(90);
    expect(withArt.length).toBeLessThan(150);
    for (const s of withArt) {
      expect(s.weaponArtSource).toBe('innate');
      expect(art(s.weaponArtId).tierAffinity).toBe('Iron');
    }
    expect(ironSwordShops(0, {}, 50).every((s) => !s.weaponArtIds?.length)).toBe(true);
  });

  it('Iron Arms still puts an art on every Iron weapon', () => {
    seedRandom(5);
    const swords = ironSwordShops(0.3, { ironArms: true }, 50);
    expect(swords.every((s) => s.weaponArtIds?.length === 1)).toBe(true);
    expect(swords.every((s) => s.weaponArtSource === 'meta_innate')).toBe(true);
  });

  it('the base chance fades for Iron and peaks mid-run for Steel', () => {
    const chance = (tier) => acts.map((act) => data.lootTables[act].artTiers.innateChance[tier]);
    const iron = chance('Iron');
    for (let i = 1; i < iron.length; i++) expect(iron[i]).toBeLessThanOrEqual(iron[i - 1]);
    const [s1, s2, s3, s4] = chance('Steel');
    expect(Math.min(s2, s3)).toBeGreaterThan(Math.max(s1, s4));
    for (const act of acts)
      for (const tier of ['Iron', 'Steel'])
        expect(data.lootTables[act].artTiers.innateChance[tier]).toBeLessThan(1);
  });
});
