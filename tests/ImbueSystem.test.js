import { describe, it, expect } from 'vitest';
import {
  IMBUE_CHOICE_ID,
  getImbueList,
  getImbueById,
  isImbued,
  canImbue,
  applyImbue,
  getImbueForWeapon,
  getImbueCombatMods,
  getImbuePostCombatPoison,
  getImbuePostCombatStatus,
  getImbueDisplayInfo,
  pickRandomImbue,
  isImbueStone,
  getImbueStoneItems,
  resolveStoneImbue,
  getImbueStoneDetailText,
} from '../src/engine/ImbueSystem.js';
import { applyForge, deforgeWeapon } from '../src/engine/ForgeSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const imbuesData = data.imbues;

function makeWeapon(overrides = {}) {
  return {
    name: 'Iron Sword',
    type: 'Sword',
    tier: 'Iron',
    might: 5,
    hit: 90,
    crit: 0,
    weight: 5,
    range: '1',
    price: 500,
    ...overrides,
  };
}

function getImbue(id) {
  return getImbueById(imbuesData, id);
}

describe('ImbueSystem — catalog', () => {
  it('exposes the six v1 imbues', () => {
    const ids = getImbueList(imbuesData).map((i) => i.id);
    expect(ids).toEqual(['vampiric', 'armorbane', 'keen', 'venom', 'binding', 'warded']);
  });

  it('getImbueList accepts a bare array or the file object', () => {
    expect(getImbueList(imbuesData.imbues)).toHaveLength(6);
    expect(getImbueList(imbuesData)).toHaveLength(6);
    expect(getImbueList(null)).toEqual([]);
    expect(getImbueList({})).toEqual([]);
  });

  it('getImbueById finds entries and returns null for unknown ids', () => {
    expect(getImbue('vampiric')?.adjective).toBe('Vampiric');
    expect(getImbue('nope')).toBeNull();
    expect(getImbueById(imbuesData, null)).toBeNull();
  });

  it('every imbue has the fields the UI relies on', () => {
    for (const imbue of getImbueList(imbuesData)) {
      expect(imbue.name).toBeTruthy();
      expect(imbue.adjective).toBeTruthy();
      expect(imbue.description).toBeTruthy();
      expect(imbue.stone?.name).toBeTruthy();
      expect(imbue.effect?.type).toBeTruthy();
    }
  });
});

describe('ImbueSystem — canImbue', () => {
  it('allows normal combat weapons', () => {
    expect(canImbue(makeWeapon())).toBe(true);
    expect(canImbue(makeWeapon({ type: 'Bow' }))).toBe(true);
    expect(canImbue(makeWeapon({ type: 'Tome' }))).toBe(true);
    expect(canImbue(makeWeapon({ tier: 'Legend' }))).toBe(true);
  });

  it('rejects excluded types (matches forge exclusions)', () => {
    for (const type of ['Staff', 'Scroll', 'Consumable', 'Accessory', 'Whetstone']) {
      expect(canImbue(makeWeapon({ type }))).toBe(false);
    }
  });

  it('rejects null/undefined/typeless items', () => {
    expect(canImbue(null)).toBe(false);
    expect(canImbue(undefined)).toBe(false);
    expect(canImbue({ name: 'Mystery' })).toBe(false);
  });

  it('enforces one imbue per weapon', () => {
    const weapon = makeWeapon();
    expect(applyImbue(weapon, getImbue('keen')).success).toBe(true);
    expect(canImbue(weapon)).toBe(false);
    expect(applyImbue(weapon, getImbue('vampiric')).success).toBe(false);
    expect(weapon._imbueId).toBe('keen');
  });
});

describe('ImbueSystem — applyImbue name composition', () => {
  it('prepends the adjective on an unforged weapon', () => {
    const weapon = makeWeapon();
    const result = applyImbue(weapon, getImbue('vampiric'));
    expect(result.success).toBe(true);
    expect(weapon._imbueId).toBe('vampiric');
    expect(weapon.name).toBe('Vampiric Iron Sword');
  });

  it('imbue-then-forge: forge picks up the imbued base name', () => {
    const weapon = makeWeapon();
    applyImbue(weapon, getImbue('vampiric'));
    applyForge(weapon, 'might');
    applyForge(weapon, 'crit');
    expect(weapon.name).toBe('Vampiric Iron Sword +2');
    expect(weapon._baseName).toBe('Vampiric Iron Sword');
  });

  it('forge-then-imbue: renames the forge base so "+N" is preserved', () => {
    const weapon = makeWeapon();
    applyForge(weapon, 'might');
    applyForge(weapon, 'crit');
    expect(weapon.name).toBe('Iron Sword +2');
    applyImbue(weapon, getImbue('vampiric'));
    expect(weapon.name).toBe('Vampiric Iron Sword +2');
    expect(weapon._baseName).toBe('Vampiric Iron Sword');
  });

  it('deforging to +0 keeps the imbued name', () => {
    const weapon = makeWeapon();
    applyForge(weapon, 'might');
    applyImbue(weapon, getImbue('keen'));
    expect(weapon.name).toBe('Keen Iron Sword +1');
    deforgeWeapon(weapon);
    expect(weapon.name).toBe('Keen Iron Sword');
    expect(weapon._imbueId).toBe('keen');
  });

  it('rejects invalid defs and the choice pseudo-id', () => {
    expect(applyImbue(makeWeapon(), null).success).toBe(false);
    expect(applyImbue(makeWeapon(), {}).success).toBe(false);
    expect(applyImbue(makeWeapon(), { id: IMBUE_CHOICE_ID, adjective: 'X' }).success).toBe(false);
    const weapon = makeWeapon();
    expect(isImbued(weapon)).toBe(false);
  });
});

describe('ImbueSystem — effect accessors', () => {
  it('getImbueCombatMods returns mods for combatMods imbues', () => {
    const weapon = makeWeapon();
    applyImbue(weapon, getImbue('vampiric'));
    const mods = getImbueCombatMods(weapon, imbuesData);
    expect(mods.drainPercent).toBeCloseTo(0.3);
    expect(mods.activated).toEqual([{ id: 'imbue_vampiric', name: 'Vampiric' }]);
  });

  it('getImbueCombatMods covers keen, warded, and armorbane shapes', () => {
    const keen = makeWeapon();
    applyImbue(keen, getImbue('keen'));
    expect(getImbueCombatMods(keen, imbuesData)).toMatchObject({ critBonus: 10, hitBonus: 5 });

    const warded = makeWeapon();
    applyImbue(warded, getImbue('warded'));
    expect(getImbueCombatMods(warded, imbuesData)).toMatchObject({ defBonus: 2, resBonus: 2 });

    const bane = makeWeapon();
    applyImbue(bane, getImbue('armorbane'));
    expect(getImbueCombatMods(bane, imbuesData).effectiveness).toEqual({
      moveTypes: ['Armored'],
      multiplier: 2,
    });
  });

  it('getImbueCombatMods returns null for post-combat imbues and unimbued weapons', () => {
    const venom = makeWeapon();
    applyImbue(venom, getImbue('venom'));
    expect(getImbueCombatMods(venom, imbuesData)).toBeNull();
    expect(getImbueCombatMods(makeWeapon(), imbuesData)).toBeNull();
    expect(getImbueCombatMods(null, imbuesData)).toBeNull();
  });

  it('getImbuePostCombatPoison returns venom damage and 0 otherwise', () => {
    const venom = makeWeapon();
    applyImbue(venom, getImbue('venom'));
    expect(getImbuePostCombatPoison(venom, imbuesData)).toBe(5);
    const keen = makeWeapon();
    applyImbue(keen, getImbue('keen'));
    expect(getImbuePostCombatPoison(keen, imbuesData)).toBe(0);
    expect(getImbuePostCombatPoison(makeWeapon(), imbuesData)).toBe(0);
  });

  it('getImbuePostCombatStatus returns the binding proc definition', () => {
    const binding = makeWeapon();
    applyImbue(binding, getImbue('binding'));
    expect(getImbuePostCombatStatus(binding, imbuesData)).toEqual({
      status: 'root',
      chance: 30,
      durationPhases: 1,
    });
    expect(getImbuePostCombatStatus(makeWeapon(), imbuesData)).toBeNull();
  });

  it('accessors are safe when the catalog is missing', () => {
    const weapon = makeWeapon();
    applyImbue(weapon, getImbue('vampiric'));
    expect(getImbueForWeapon(weapon, null)).toBeNull();
    expect(getImbueCombatMods(weapon, null)).toBeNull();
    expect(getImbuePostCombatPoison(weapon, null)).toBe(0);
    expect(getImbuePostCombatStatus(weapon, null)).toBeNull();
  });
});

describe('ImbueSystem — display info', () => {
  it('returns catalog-backed display info for imbued weapons', () => {
    const weapon = makeWeapon();
    applyImbue(weapon, getImbue('warded'));
    expect(getImbueDisplayInfo(weapon, imbuesData)).toEqual({
      id: 'warded',
      name: 'Warded',
      adjective: 'Warded',
      description: '+2 DEF, +2 RES while wielding',
      lore: getImbue('warded').lore,
    });
  });

  it('returns null for unimbued weapons and a raw-id fallback for stale ids', () => {
    expect(getImbueDisplayInfo(makeWeapon(), imbuesData)).toBeNull();
    const stale = makeWeapon({ _imbueId: 'removed_imbue' });
    expect(getImbueDisplayInfo(stale, imbuesData)).toMatchObject({
      id: 'removed_imbue',
      name: 'removed_imbue',
    });
  });
});

describe('ImbueSystem — pickRandomImbue', () => {
  it('picks deterministically with a seeded rng and always returns an entry', () => {
    expect(pickRandomImbue(imbuesData, () => 0).id).toBe('vampiric');
    expect(pickRandomImbue(imbuesData, () => 0.999999).id).toBe('warded');
    expect(pickRandomImbue({ imbues: [] })).toBeNull();
  });
});

describe('ImbueSystem — imbuing stones', () => {
  it('builds one stone per imbue plus the Prismatic Stone', () => {
    const stones = getImbueStoneItems(imbuesData);
    expect(stones).toHaveLength(7);
    expect(stones.map((s) => s.name)).toEqual([
      'Vampiric Imbuing Stone',
      'Sundering Imbuing Stone',
      'Keen Imbuing Stone',
      'Venomous Imbuing Stone',
      'Binding Imbuing Stone',
      'Warded Imbuing Stone',
      'Prismatic Stone',
    ]);
    for (const stone of stones) {
      expect(stone.type).toBe('Whetstone');
      expect(isImbueStone(stone)).toBe(true);
      // Whetstone-typed stones can never themselves be imbued or forged
      expect(canImbue(stone)).toBe(false);
    }
    expect(getImbueStoneItems(null)).toEqual([]);
  });

  it('isImbueStone distinguishes stones from forge whetstones', () => {
    const silver = data.whetstones.find((w) => w.name === 'Silver Whetstone');
    expect(isImbueStone(silver)).toBe(false);
    expect(isImbueStone(null)).toBe(false);
    expect(isImbueStone({ type: 'Whetstone', imbueId: 'vampiric' })).toBe(true);
  });

  it('resolveStoneImbue maps a stone to its imbue def (null for prismatic)', () => {
    const stones = getImbueStoneItems(imbuesData);
    const vampStone = stones.find((s) => s.name === 'Vampiric Imbuing Stone');
    const prismatic = stones.find((s) => s.name === 'Prismatic Stone');
    expect(resolveStoneImbue(vampStone, imbuesData)?.id).toBe('vampiric');
    expect(prismatic.imbueId).toBe(IMBUE_CHOICE_ID);
    expect(resolveStoneImbue(prismatic, imbuesData)).toBeNull();
    expect(resolveStoneImbue(null, imbuesData)).toBeNull();
  });

  it('getImbueStoneDetailText produces card/tooltip text', () => {
    const stones = getImbueStoneItems(imbuesData);
    const keenStone = stones.find((s) => s.name === 'Keen Imbuing Stone');
    const prismatic = stones.find((s) => s.name === 'Prismatic Stone');
    expect(getImbueStoneDetailText(keenStone, imbuesData)).toBe('Imbue: +10 Crit, +5 Hit');
    expect(getImbueStoneDetailText(prismatic, imbuesData)).toBe('Imbue: choose a blessing');
    expect(getImbueStoneDetailText({ type: 'Whetstone' }, imbuesData)).toBe('');
  });

  it('loot tables only reference real stones, act2+ only', () => {
    const stoneNames = new Set(getImbueStoneItems(imbuesData).map((s) => s.name));
    const whetstoneNames = new Set(data.whetstones.map((w) => w.name));
    for (const [actId, table] of Object.entries(data.lootTables)) {
      for (const name of table.forge || []) {
        expect(
          stoneNames.has(name) || whetstoneNames.has(name),
          `${actId}.forge has unknown "${name}"`,
        ).toBe(true);
      }
    }
    for (const name of data.lootTables.act1.forge || []) {
      expect(stoneNames.has(name)).toBe(false);
    }
    // Every stone is reachable somewhere in act2+
    const act234 = new Set([
      ...(data.lootTables.act2.forge || []),
      ...(data.lootTables.act3.forge || []),
      ...(data.lootTables.act4.forge || []),
    ]);
    for (const name of stoneNames) {
      expect(act234.has(name), `stone "${name}" unreachable in loot`).toBe(true);
    }
  });

  it('stones are roughly half as common as the Silver Whetstone in each act pool', () => {
    for (const actId of ['act2', 'act3', 'act4']) {
      const pool = data.lootTables[actId].forge;
      const silverCount = pool.filter((n) => n === 'Silver Whetstone').length;
      const stoneNames = new Set(getImbueStoneItems(imbuesData).map((s) => s.name));
      for (const name of pool) {
        if (stoneNames.has(name)) {
          const count = pool.filter((n) => n === name).length;
          expect(count * 2).toBeLessThanOrEqual(silverCount * 2); // each stone listed once
          expect(count).toBe(1);
        }
      }
      expect(silverCount).toBe(2);
    }
  });
});
