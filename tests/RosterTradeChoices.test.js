// The roster's trade-partner picker lines (src/ui/rosterTradeChoices.js) and the
// reward screen's full-bag row (src/ui/rewardDisplay.js). Expected strings are
// written out by hand from the spec ("Roster": a full bag reads "Items 5/5 · full:
// pick an item to trade"; nothing is blocked) and from each unit's hand-set bags.
import { describe, expect, it } from 'vitest';
import {
  bagFillText,
  isConvoyChoice,
  partnerHolder,
  partnerLabel,
  rosterTradePartners,
  tradeBagFor,
  tradePartnerItemText,
  tradePartnerText,
} from '../src/ui/rosterTradeChoices.js';
import { CONVOY_HOLDER, unitHolder } from '../src/engine/ItemTrade.js';
import { REWARD_BAG_FULL_TEXT, rewardRecipientBlockText } from '../src/ui/rewardDisplay.js';

const sword = (name, extra = {}) => ({
  name,
  type: 'Sword',
  rankRequired: 'Prof',
  might: 5,
  hit: 90,
  crit: 0,
  weight: 5,
  range: '1',
  ...extra,
});
const supply = (name) => ({ name, type: 'Consumable', uses: 3 });

function unit(
  name,
  { prof = 'Sword', rank = 'Prof', inventory = [], consumables = [], SPD = 10 } = {},
) {
  return {
    name,
    proficiencies: prof ? [{ type: prof, rank }] : [],
    inventory,
    consumables,
    accessory: null,
    weapon: inventory[0] || null,
    stats: { HP: 20, STR: 5, MAG: 0, SKL: 5, SPD, LCK: 5, DEF: 5, RES: 5, MOV: 5 },
  };
}

/** A run stub: the convoy's live lists and capacities are all the helpers read. */
function runWith({ weapons = [], consumables = [], caps = { weapons: 3, consumables: 2 } } = {}) {
  return {
    convoy: { weapons, consumables },
    getConvoyCapacities: () => caps,
  };
}

describe('tradeBagFor', () => {
  it('maps item types to their trade bag', () => {
    expect(tradeBagFor({ type: 'Accessory' })).toBe('accessory');
    expect(tradeBagFor({ type: 'Consumable' })).toBe('consumables');
    expect(tradeBagFor({ type: 'Lance' })).toBe('inventory');
    expect(tradeBagFor({ type: 'Staff' })).toBe('inventory');
  });
});

describe('rosterTradePartners', () => {
  it('lists every other unit in roster order, then the convoy', () => {
    const [a, b, c] = [unit('Ana'), unit('Bo'), unit('Cy')];
    expect(rosterTradePartners([a, b, c], b)).toEqual([a, c, CONVOY_HOLDER]);
    expect(rosterTradePartners([a, b, c], b, 'inventory')).toEqual([a, c, CONVOY_HOLDER]);
  });
  it('an accessory lists units only', () => {
    const [a, b] = [unit('Ana'), unit('Bo')];
    expect(rosterTradePartners([a, b], a, 'accessory')).toEqual([b]);
    expect(rosterTradePartners([a], a, 'accessory')).toEqual([]);
  });
  it('tolerates a missing list', () => {
    expect(rosterTradePartners(null, null)).toEqual([CONVOY_HOLDER]);
  });
});

describe('partner labels and holders', () => {
  it('the convoy reads "Convoy" and is its own holder; a unit is wrapped', () => {
    const ana = unit('Ana');
    expect(partnerLabel(CONVOY_HOLDER)).toBe('Convoy');
    expect(partnerLabel(ana)).toBe('Ana');
    expect(isConvoyChoice(CONVOY_HOLDER)).toBe(true);
    expect(isConvoyChoice(ana)).toBe(false);
    expect(partnerHolder(CONVOY_HOLDER)).toBe(CONVOY_HOLDER);
    expect(partnerHolder(ana)).toEqual({ kind: 'unit', unit: ana });
  });
});

describe('bagFillText', () => {
  const ctx = (run) => ({ context: 'roster', run });
  it('counts a unit bag, and says what to do when it is full', () => {
    const run = runWith();
    const four = unit('Ana', { inventory: [1, 2, 3, 4].map((n) => sword(`S${n}`)) });
    expect(bagFillText(ctx(run), unitHolder(four), 'inventory')).toBe('Items 4/5');
    four.inventory.push(sword('S5'));
    expect(bagFillText(ctx(run), unitHolder(four), 'inventory')).toBe(
      'Items 5/5 · full: pick an item to trade',
    );
    expect(bagFillText(ctx(run), unitHolder(four), 'inventory', { fullHint: false })).toBe(
      'Items 5/5',
    );
    four.consumables = [supply('V1'), supply('V2'), supply('V3')];
    expect(bagFillText(ctx(run), unitHolder(four), 'consumables')).toBe(
      'Supplies 3/3 · full: pick an item to trade',
    );
  });
  it('counts the convoy against its capacity', () => {
    const run = runWith({ weapons: [sword('C1'), sword('C2'), sword('C3')], consumables: [] });
    expect(bagFillText(ctx(run), CONVOY_HOLDER, 'inventory')).toBe(
      'Weapons 3/3 · full: pick an item to trade',
    );
    expect(bagFillText(ctx(run), CONVOY_HOLDER, 'consumables')).toBe('Supplies 0/2');
  });
});

describe('tradePartnerItemText (an item held)', () => {
  const ctx = { context: 'roster', run: runWith() };
  it('a weapon: the bag, then whether the partner can wield it (AS by hand)', () => {
    // AS = SPD - max(0, Wt - floor(STR / 5)): SPD 10, STR 5 → Wt 5 gives 6, Wt 8 gives 3.
    const kai = unit('Kai', { inventory: [sword('Iron Sword')] });
    expect(tradePartnerItemText(ctx, kai, sword('Steel Sword'))).toBe(
      'Items 1/5 · Can equip · AS 6 → 6 if equipped',
    );
    expect(tradePartnerItemText(ctx, kai, sword('Heavy Sword', { weight: 8 }))).toBe(
      'Items 1/5 · Can equip · AS 6 → 3 if equipped',
    );
    const lancer = unit('Lia', {
      prof: 'Lance',
      inventory: [1, 2, 3, 4, 5].map((n) => sword(`L${n}`, { type: 'Lance' })),
    });
    expect(tradePartnerItemText(ctx, lancer, sword('Iron Sword'))).toBe(
      'Items 5/5 · full: pick an item to trade · Needs Sword proficiency',
    );
    expect(tradePartnerItemText(ctx, kai, sword('Master Blade', { rankRequired: 'Mast' }))).toBe(
      'Items 1/5 · Needs Sword Master rank',
    );
  });
  it('a staff skips the AS line', () => {
    const cleric = unit('Mae', { prof: 'Staff' });
    expect(
      tradePartnerItemText(ctx, cleric, { name: 'Heal', type: 'Staff', rankRequired: 'Prof' }),
    ).toBe('Items 0/5 · Can equip');
  });
  it('a supply shows the supply bag only', () => {
    const kai = unit('Kai', { consumables: [supply('V1')] });
    expect(tradePartnerItemText(ctx, kai, supply('Elixir'))).toBe('Supplies 1/3');
  });
  it('an accessory names what the partner wears', () => {
    const kai = unit('Kai');
    expect(tradePartnerItemText(ctx, kai, { name: 'Power Ring', type: 'Accessory' })).toBe(
      'No accessory',
    );
    kai.accessory = { name: 'Speed Ring', type: 'Accessory' };
    expect(tradePartnerItemText(ctx, kai, { name: 'Power Ring', type: 'Accessory' })).toBe(
      'Wears Speed Ring',
    );
  });
  it('the convoy: its fill, or why it cannot store the item', () => {
    const run = runWith({ weapons: [sword('C1')], consumables: [supply('V1'), supply('V2')] });
    const withRun = { context: 'roster', run };
    expect(tradePartnerItemText(withRun, CONVOY_HOLDER, sword('Iron Sword'))).toBe('Weapons 1/3');
    expect(tradePartnerItemText(withRun, CONVOY_HOLDER, supply('Elixir'))).toBe(
      'Supplies 2/2 · full: pick an item to trade',
    );
    expect(
      tradePartnerItemText(withRun, CONVOY_HOLDER, { name: 'Fire Breath', type: 'Breath' }),
    ).toBe('The convoy cannot store this item.');
  });
});

describe('tradePartnerText (nothing held)', () => {
  it('both bags, without the full hint; a unit adds its accessory', () => {
    const run = runWith({ weapons: [sword('C1')], consumables: [] });
    const ctx = { context: 'roster', run };
    const kai = unit('Kai', {
      inventory: [1, 2, 3, 4, 5].map((n) => sword(`S${n}`)),
      consumables: [supply('V1')],
    });
    expect(tradePartnerText(ctx, kai)).toBe('Items 5/5 · Supplies 1/3');
    kai.accessory = { name: 'Power Ring', type: 'Accessory' };
    expect(tradePartnerText(ctx, kai)).toBe('Items 5/5 · Supplies 1/3 · Power Ring');
    expect(tradePartnerText(ctx, CONVOY_HOLDER)).toBe('Weapons 1/3 · Supplies 0/2');
  });
});

describe('reward recipient rows', () => {
  it('a full bag says where the reward can go instead; other reasons pass through', () => {
    expect(rewardRecipientBlockText('Bag full')).toBe(
      'Bag full: send to convoy, or trade in Roster',
    );
    expect(REWARD_BAG_FULL_TEXT).toBe('Bag full: send to convoy, or trade in Roster');
    expect(rewardRecipientBlockText('Convoy full')).toBe('Convoy full');
    expect(rewardRecipientBlockText('')).toBe('');
  });
});
