// Item keyword tags and base lines (src/engine/ItemKeywords.js). The tags put a
// weapon's rules beside its name, so the ways they can fail are all ways of
// telling the player something combat doesn't do: a reaver naming the wrong
// victim, an effectiveness tag with the wrong target or multiplier, a special
// combat reads but no tag shows, or a base line that repeats or misnames the item.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import {
  itemKeywords,
  itemBaseLine,
  itemBaseLineFor,
  reaverBeats,
} from '../src/engine/ItemKeywords.js';
import { getEffectivenessMultiplier, getWeaponTriangleBonus } from '../src/engine/Combat.js';

const { weapons, consumables, accessories } = loadGameData();
const weapon = (name) => weapons.find((w) => w.name === name);
const texts = (item) => itemKeywords(item).map((t) => t.text);

describe('reversed-triangle weapons name the type they beat', () => {
  // Our triangle: swords beat axes, axes beat lances, lances beat swords.
  // Reversed, each weapon beats the type that normally beats it.
  it.each([
    ['Lancehook', 'Lance', 'Beats Lances'],
    ['Axehook', 'Axe', 'Beats Axes'],
    ['Bladehook', 'Sword', 'Beats Swords'],
  ])('%s', (name, victimType, text) => {
    const reaver = weapon(name);
    expect(reaverBeats(reaver)).toBe(victimType);
    expect(texts(reaver)).toContain(text);
    // And combat agrees: against a plain weapon of that type it has the advantage.
    const victim = { type: victimType, special: '' };
    expect(getWeaponTriangleBonus(reaver, victim).hit).toBeGreaterThan(0);
  });

  it('only triangle-reversing weapons get a Beats tag', () => {
    const tagged = weapons.filter((w) => itemKeywords(w).some((t) => t.id === 'reaver'));
    expect(tagged.map((w) => w.name).sort()).toEqual(['Axehook', 'Bladehook', 'Lancehook']);
  });
});

describe('effectiveness tags match the combat multiplier', () => {
  const effective = weapons.filter((w) => itemKeywords(w).some((t) => t.id === 'effective'));

  it('covers every weapon combat treats as effective', () => {
    expect(effective.map((w) => w.name).sort()).toEqual([
      'Endword',
      'Firstwind',
      'Hammer',
      'Horsebane',
      'Mailbane',
      'Rapier',
    ]);
  });

  it.each(effective.map((w) => [w.name]))('%s', (name) => {
    const w = weapon(name);
    const tag = itemKeywords(w).find((t) => t.id === 'effective');
    const [, mult, targets] = tag.text.match(/^x(\d+) vs (.+)$/);
    for (const target of targets.split(', ')) {
      const defender =
        target === 'Dark' ? { className: 'Warlock', moveType: 'Infantry' } : { moveType: target };
      expect(getEffectivenessMultiplier(w, defender)).toBe(Number(mult));
    }
    // Infantry is never a target of these specials: the tag must not overpromise.
    expect(getEffectivenessMultiplier(w, { moveType: 'Infantry', className: 'Fighter' })).toBe(1);
  });
});

describe('tags', () => {
  it('reads the rules players need from each family', () => {
    expect(texts(weapon('Keen Sword'))).toEqual(['Crit 30']);
    expect(texts(weapon('Oathlance'))).toEqual(['Strikes twice']);
    expect(texts(weapon('Adder Blade'))).toEqual(['Poison 5']);
    expect(texts(weapon('Namethief'))).toEqual(['Drains HP']);
    expect(texts(weapon('Javelin'))).toEqual(['Thrown']);
    expect(texts(weapon('Gust Blade'))).toEqual(['Wind gust']);
    expect(texts(weapon('Thunderbrand'))).toEqual(['Uses MAG']);
    expect(texts(weapon('Sunder Axe'))).toEqual(['Halves DEF']);
    expect(texts(weapon('Tidebreaker'))).toEqual(['+5 DEF', '+5 RES']);
    expect(texts(weapon('Gae Bolg'))).toEqual(['+5 STR on counter']);
    expect(texts(weapon("Hermit's Bow"))).toEqual(['Alone: +4 STR, +4 SPD']);
    expect(texts(weapon('Longbow'))).toEqual(['Range 2-3']);
  });

  it('every combat weapon whose special changes play shows at least one tag', () => {
    // "Lightest magic" is flavour (its weight already says it); everything else
    // with a special is a rule the player should see without opening the card.
    const untagged = weapons.filter(
      (w) =>
        ['Sword', 'Lance', 'Axe', 'Bow', 'Tome', 'Light', 'Breath'].includes(w.type) &&
        w.special &&
        w.special !== 'Lightest magic' &&
        itemKeywords(w).length === 0,
    );
    expect(untagged.map((w) => `${w.name}: ${w.special}`)).toEqual([]);
  });

  it('plain weapons, staves, scrolls, supplies and accessories have no tags', () => {
    expect(itemKeywords(weapon('Iron Sword'))).toEqual([]);
    expect(itemKeywords(weapon('Heal'))).toEqual([]);
    expect(itemKeywords(weapon('Reclaim Scroll'))).toEqual([]);
    expect(itemKeywords(consumables[0])).toEqual([]);
    expect(itemKeywords(accessories[0])).toEqual([]);
    expect(itemKeywords(null)).toEqual([]);
  });

  it('a stat booster says which stat it raises, and nothing else does', () => {
    // The booster names are lore objects that only point at their stat.
    const booster = (stat) => consumables.find((c) => c.effect === 'statBoost' && c.stat === stat);
    expect(texts(booster('STR'))).toEqual(['+2 STR']);
    expect(texts(booster('HP'))).toEqual(['+5 HP']);
    expect(texts(booster('MOV'))).toEqual(['+1 MOV']);
    const boosters = consumables.filter((c) => c.effect === 'statBoost');
    expect(boosters.length).toBeGreaterThanOrEqual(8);
    for (const c of boosters) expect(itemKeywords(c), c.name).toHaveLength(1);
    const others = consumables.filter((c) => c.effect !== 'statBoost');
    expect(others.filter((c) => itemKeywords(c).length).map((c) => c.name)).toEqual([]);
  });

  it('every tag carries its full rule for the tooltip', () => {
    for (const w of weapons)
      for (const tag of itemKeywords(w)) {
        expect(tag.title, `${w.name} ${tag.text}`).toMatch(/\S/);
        expect(tag.tone, `${w.name} ${tag.text}`).toMatch(/^[a-z]+$/);
      }
  });
});

describe('base line', () => {
  it('says what the item is', () => {
    expect(itemBaseLine(weapon('Keen Sword'))).toBe('Silver Sword');
    expect(itemBaseLine(weapon('Axehook'))).toBe('Steel Lance');
    expect(itemBaseLine(weapon('Twinsworn'))).toBe('Legend Sword');
    expect(itemBaseLine(weapon('Sunder Bow'))).toBe('Rare Bow');
    expect(itemBaseLine(weapon('Conflagration'))).toBe('Tome');
    expect(itemBaseLine(weapon('Endword'))).toBe('Legend Light Tome');
    expect(itemBaseLine(weapon('Solace'))).toBe('Staff');
  });

  it('is left out when the name already says it', () => {
    expect(itemBaseLineFor(weapon('Silver Sword'))).toBeNull();
    expect(itemBaseLineFor(weapon('Iron Sword'), 'Iron Sword +2')).toBeNull();
    expect(itemBaseLineFor(weapon('Steel Axe'), 'Vampiric Steel Axe')).toBeNull();
    expect(itemBaseLineFor(weapon('Jian'))).toBe('Steel Sword');
  });

  it('supplies, scrolls and accessories have none', () => {
    expect(itemBaseLine(consumables[0])).toBeNull();
    expect(itemBaseLine(accessories[0])).toBeNull();
    expect(itemBaseLine(weapon('Reclaim Scroll'))).toBeNull();
  });
});
