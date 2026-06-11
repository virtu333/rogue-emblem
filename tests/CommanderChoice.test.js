import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { RunManager } from '../src/engine/RunManager.js';
import { LETHAL_ARMORY_WEAPONS } from '../src/engine/UnitManager.js';
import { generateThirdLordCandidates } from '../src/engine/BossRecruitSystem.js';
import { resolveStartingLordNames, defaultPartnerFor } from '../src/engine/Commander.js';
import { DEADLY_ARSENAL_SIGNATURE_WEAPONS } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const upgradesData = gameData.metaUpgrades;

// Mock localStorage (same pattern as MetaProgressionManager.test.js)
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] || null),
  setItem: vi.fn((key, val) => {
    store[key] = val;
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
};
vi.stubGlobal('localStorage', localStorageMock);

function clearStore() {
  for (const key of Object.keys(store)) delete store[key];
}

/** Manager with milestones + prerequisite chain purchased up to the given tier. */
function makeMeta(tier = 0) {
  const meta = new MetaProgressionManager(upgradesData);
  if (tier >= 1) {
    meta.milestones.add('beatHard');
    meta.purchasedUpgrades.legendary_heir = 1;
    meta.purchasedUpgrades.commander_choice = 1;
  }
  if (tier >= 2) meta.purchasedUpgrades.partner_choice = 1;
  return meta;
}

describe('commander choice upgrade data', () => {
  const commanderChoice = upgradesData.find((u) => u.id === 'commander_choice');
  const partnerChoice = upgradesData.find((u) => u.id === 'partner_choice');

  it('defines both upgrades in lord_bonuses (Valor)', () => {
    expect(commanderChoice).toBeTruthy();
    expect(partnerChoice).toBeTruthy();
    expect(commanderChoice.category).toBe('lord_bonuses');
    expect(partnerChoice.category).toBe('lord_bonuses');
    expect(commanderChoice.costs).toEqual([1500]);
    expect(partnerChoice.costs).toEqual([1000]);
  });

  it('chains: legendary_heir -> commander_choice -> partner_choice, both behind beatHard', () => {
    expect(commanderChoice.requires.upgrades).toEqual([{ id: 'legendary_heir', level: 1 }]);
    expect(commanderChoice.requires.milestones).toEqual(['beatHard']);
    expect(partnerChoice.requires.upgrades).toEqual([{ id: 'commander_choice', level: 1 }]);
    expect(partnerChoice.requires.milestones).toEqual(['beatHard']);
  });

  it('emits commanderChoiceTier 1 and 2', () => {
    expect(commanderChoice.effects[0].commanderChoiceTier).toBe(1);
    expect(partnerChoice.effects[0].commanderChoiceTier).toBe(2);
  });
});

describe('MetaProgressionManager lord selection', () => {
  beforeEach(() => clearStore());

  it('tier 0: selection is locked to the default pair', () => {
    const meta = makeMeta(0);
    expect(meta.getCommanderChoiceTier()).toBe(0);
    expect(meta.setCommander('Cael')).toBe(false);
    expect(meta.setPartner('Kira')).toBe(false);
    expect(meta.getLordSelection()).toEqual({ commander: 'Edric', partner: 'Sera' });
    expect(meta.getActiveEffects().startingLords).toBe(null);
    expect(meta.getActiveEffects().commanderChoiceTier).toBe(0);
  });

  it('tier 1: commander honored, partner forced to default', () => {
    const meta = makeMeta(1);
    expect(meta.getCommanderChoiceTier()).toBe(1);
    expect(meta.setCommander('Cael')).toBe(true);
    expect(meta.setPartner('Kira')).toBe(false); // partner needs tier 2
    expect(meta.getLordSelection()).toEqual({ commander: 'Cael', partner: 'Sera' });
    expect(meta.getActiveEffects().startingLords).toEqual({ commander: 'Cael', partner: 'Sera' });
  });

  it('tier 1: Sera as commander defaults the partner to Edric', () => {
    const meta = makeMeta(1);
    meta.setCommander('Sera');
    expect(meta.getLordSelection()).toEqual({ commander: 'Sera', partner: 'Edric' });
  });

  it('tier 2: both honored; collisions rejected or auto-swapped', () => {
    const meta = makeMeta(2);
    expect(meta.setCommander('Cael')).toBe(true);
    expect(meta.setPartner('Kira')).toBe(true);
    expect(meta.getLordSelection()).toEqual({ commander: 'Cael', partner: 'Kira' });

    // Partner == commander is rejected outright
    expect(meta.setPartner('Cael')).toBe(false);

    // Picking the current partner as commander auto-resets the partner
    expect(meta.setCommander('Kira')).toBe(true);
    expect(meta.getLordSelection()).toEqual({ commander: 'Kira', partner: 'Sera' });
  });

  it('refunding partner_choice resets the partner; commander refund resets everything', () => {
    const meta = makeMeta(2);
    meta.addValor(5000);
    meta.setCommander('Cael');
    meta.setPartner('Kira');

    // commander_choice is blocked while partner_choice is owned
    expect(meta.canRefund('commander_choice').success).toBe(false);

    expect(meta.refundUpgrade('partner_choice').success).toBe(true);
    expect(meta.getLordSelection()).toEqual({ commander: 'Cael', partner: 'Sera' });
    expect(meta.lordSelection.partner).toBe('Sera');

    expect(meta.refundUpgrade('commander_choice').success).toBe(true);
    expect(meta.getLordSelection()).toEqual({ commander: 'Edric', partner: 'Sera' });
    expect(meta.lordSelection).toEqual({ commander: 'Edric', partner: 'Sera' });
  });

  it('persists lordSelection in the save payload and reloads it', () => {
    const meta = makeMeta(2);
    meta.setCommander('Astrid');
    meta.setPartner('Rowan');

    const saved = JSON.parse(store['emblem_rogue_meta_save']);
    expect(saved.lordSelection).toEqual({ commander: 'Astrid', partner: 'Rowan' });

    const reloaded = new MetaProgressionManager(upgradesData);
    reloaded.milestones.add('beatHard');
    reloaded.purchasedUpgrades.legendary_heir = 1;
    reloaded.purchasedUpgrades.commander_choice = 1;
    reloaded.purchasedUpgrades.partner_choice = 1;
    expect(reloaded.getLordSelection()).toEqual({ commander: 'Astrid', partner: 'Rowan' });
  });

  it('normalizes malformed saved selections', () => {
    store['emblem_rogue_meta_save'] = JSON.stringify({
      totalValor: 0,
      totalSupply: 0,
      purchasedUpgrades: {},
      lordSelection: { commander: 42, partner: 'Edric' },
    });
    const meta = new MetaProgressionManager(upgradesData);
    expect(meta.lordSelection).toEqual({ commander: 'Edric', partner: 'Sera' });
  });

  it('reset() restores the default selection', () => {
    const meta = makeMeta(2);
    meta.setCommander('Voss');
    meta.reset();
    expect(meta.lordSelection).toEqual({ commander: 'Edric', partner: 'Sera' });
  });
});

describe('resolveStartingLordNames / defaultPartnerFor', () => {
  it('falls back to the default pair for null/invalid metaEffects', () => {
    expect(resolveStartingLordNames(null)).toEqual(['Edric', 'Sera']);
    expect(resolveStartingLordNames({})).toEqual(['Edric', 'Sera']);
    expect(
      resolveStartingLordNames({ startingLords: { commander: 'Cael', partner: 'Cael' } }),
    ).toEqual(['Edric', 'Sera']);
  });

  it('uses the selection when valid', () => {
    expect(
      resolveStartingLordNames({ startingLords: { commander: 'Cael', partner: 'Kira' } }),
    ).toEqual(['Cael', 'Kira']);
  });

  it('defaultPartnerFor is Sera unless Sera leads', () => {
    expect(defaultPartnerFor('Edric')).toBe('Sera');
    expect(defaultPartnerFor('Cael')).toBe('Sera');
    expect(defaultPartnerFor('Sera')).toBe('Edric');
  });
});

describe('createInitialRoster with chosen lords', () => {
  const findWeapon = (unit, name) => unit.inventory.find((w) => w?.name === name);

  it('default pair is unchanged: Edric commander kit + Sera healer kit', () => {
    const rm = new RunManager(gameData);
    const roster = rm.createInitialRoster();
    const [edric, sera] = roster;
    expect(edric.name).toBe('Edric');
    expect(edric.isCommander).toBe(true);
    expect(findWeapon(edric, 'Steel Sword')).toBeTruthy();
    expect(sera.name).toBe('Sera');
    expect(sera.isCommander).not.toBe(true);
    expect(sera.proficiencies.some((p) => p.type === 'Staff')).toBe(true);
    expect(findWeapon(sera, 'Heal')).toBeTruthy();
  });

  it('axe commander gets a Steel Axe; no staff without Sera', () => {
    const rm = new RunManager(gameData, {
      startingLords: { commander: 'Cael', partner: 'Kira' },
    });
    const roster = rm.createInitialRoster();
    const [cael, kira] = roster;
    expect(cael.name).toBe('Cael');
    expect(cael.isCommander).toBe(true);
    expect(findWeapon(cael, 'Steel Axe')).toBeTruthy();
    expect(kira.name).toBe('Kira');
    expect(findWeapon(kira, 'Steel Sword')).toBeFalsy(); // partner gets no extra weapon
    for (const unit of roster) {
      expect(unit.proficiencies.some((p) => p.type === 'Staff')).toBe(false);
      expect(unit.inventory.some((w) => w?.type === 'Staff')).toBe(false);
    }
  });

  it('Sera as commander gets both the commander kit and her healer kit', () => {
    const rm = new RunManager(gameData, {
      startingLords: { commander: 'Sera', partner: 'Edric' },
      extraVulnerary: 1,
      startingAccessoryTier: 1,
    });
    const roster = rm.createInitialRoster();
    const [sera, edric] = roster;
    expect(sera.name).toBe('Sera');
    expect(sera.isCommander).toBe(true);
    expect(findWeapon(sera, 'Shine')).toBeTruthy(); // Steel-tier Light
    expect(findWeapon(sera, 'Heal')).toBeTruthy();
    expect(sera.accessory?.name).toBe('Goddess Icon');
    expect(sera.consumables.filter((c) => c.name === 'Vulnerary')).toHaveLength(2);
    expect(edric.isCommander).not.toBe(true);
    expect(findWeapon(edric, 'Steel Sword')).toBeFalsy();
    expect(edric.consumables.filter((c) => c.name === 'Vulnerary')).toHaveLength(1);
  });

  it('Deadly Arsenal generalizes per primary type (tome commander -> Witchfire)', () => {
    const rm = new RunManager(gameData, {
      startingLords: { commander: 'Kira', partner: 'Sera' },
      deadlyArsenalTier: 1,
    });
    const [kira] = rm.createInitialRoster();
    expect(findWeapon(kira, 'Witchfire')).toBeTruthy();
    expect(findWeapon(kira, 'Elfire')).toBeFalsy(); // Steel slot replaced
  });

  it('Deadly Arsenal tier 2 adds and equips the silver weapon', () => {
    const rm = new RunManager(gameData, {
      startingLords: { commander: 'Rowan', partner: 'Sera' },
      deadlyArsenalTier: 2,
    });
    const [rowan] = rm.createInitialRoster();
    expect(findWeapon(rowan, 'Horseslayer')).toBeTruthy(); // lance signature
    expect(findWeapon(rowan, 'Steel Lance')).toBeFalsy();
    expect(findWeapon(rowan, 'Silver Lance')).toBeTruthy();
    expect(rowan.weapon?.name).toBe('Silver Lance');
  });

  it('sword-secondary Voss anchors on Swords (Rapier signature)', () => {
    const rm = new RunManager(gameData, {
      startingLords: { commander: 'Voss', partner: 'Sera' },
      deadlyArsenalTier: 1,
    });
    const [voss] = rm.createInitialRoster();
    expect(findWeapon(voss, 'Rapier')).toBeTruthy();
  });

  it('unknown lord names heal to the default pair', () => {
    const rm = new RunManager(gameData, {
      startingLords: { commander: 'Nonexistent', partner: 'AlsoFake' },
    });
    const roster = rm.createInitialRoster();
    expect(roster.map((u) => u.name)).toEqual(['Edric', 'Sera']);
    expect(roster[0].isCommander).toBe(true);
  });

  it('getStartingLordNames agrees with the healed roster for any stored names', () => {
    const cases = [
      { commander: 'Nonexistent', partner: 'AlsoFake' },
      { commander: 'Nonexistent', partner: 'Kira' },
      { commander: 'Cael', partner: 'Nonexistent' },
      { commander: 'Cael', partner: 'Kira' },
      { commander: 'Sera', partner: 'Nonexistent' },
    ];
    for (const startingLords of cases) {
      const rm = new RunManager(gameData, { startingLords });
      const roster = rm.createInitialRoster();
      expect(rm.getStartingLordNames()).toEqual(roster.map((u) => u.name));
    }
  });

  it('startRun roster + getStartingLordNames follow the selection', () => {
    const rm = new RunManager(gameData, {
      startingLords: { commander: 'Astrid', partner: 'Cael' },
    });
    rm.startRun();
    expect(rm.getCommanderName()).toBe('Astrid');
    expect(rm.getStartingLordNames()).toEqual(['Astrid', 'Cael']);
  });
});

describe('signature weapons and pools', () => {
  it('Witchfire and Sunflare exist as killer-line casters', () => {
    const witchfire = gameData.weapons.find((w) => w.name === 'Witchfire');
    const sunflare = gameData.weapons.find((w) => w.name === 'Sunflare');
    expect(witchfire).toMatchObject({ type: 'Tome', tier: 'Silver', crit: 30, price: 2300 });
    expect(sunflare).toMatchObject({ type: 'Light', tier: 'Silver', crit: 30, price: 2300 });
  });

  it('fills the Lethal Armory killer gaps for casters', () => {
    expect(LETHAL_ARMORY_WEAPONS.Tome.killer).toBe('Witchfire');
    expect(LETHAL_ARMORY_WEAPONS.Light.killer).toBe('Sunflare');
  });

  it('every signature and Lethal Armory weapon name resolves in weapons.json', () => {
    const names = new Set(gameData.weapons.map((w) => w.name));
    for (const weaponName of Object.values(DEADLY_ARSENAL_SIGNATURE_WEAPONS)) {
      expect(names.has(weaponName)).toBe(true);
    }
    for (const entry of Object.values(LETHAL_ARMORY_WEAPONS)) {
      for (const weaponName of [entry.steel, entry.killer, entry.silver]) {
        expect(names.has(weaponName)).toBe(true);
      }
    }
  });

  it('enters act2+ loot/shop pools alongside Killing Edge', () => {
    for (const act of ['act2', 'act3', 'act4']) {
      expect(gameData.lootTables[act].weapons).toContain('Witchfire');
      expect(gameData.lootTables[act].weapons).toContain('Sunflare');
    }
    expect(gameData.lootTables.act1.weapons).not.toContain('Witchfire');
  });
});

describe('mid-run lord pool with a custom starting pair', () => {
  it('Edric becomes a third-lord candidate when not chosen', () => {
    const metaEffects = { startingLords: { commander: 'Cael', partner: 'Sera' } };
    const roster = [
      { name: 'Cael', className: 'Sentinel', tier: 'base', level: 5, isLord: true },
      { name: 'Sera', className: 'Light Sage', tier: 'base', level: 4, isLord: true },
    ];
    const result = generateThirdLordCandidates(roster, gameData, metaEffects, [], 'pick_all');
    expect(result).toBeTruthy();
    const names = result.candidates.map((c) => c.unit.name);
    expect(names).toContain('Edric');
    expect(names).not.toContain('Cael');
    expect(names).not.toContain('Sera');
  });
});
