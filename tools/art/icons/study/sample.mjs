// The shared 24-icon sample every direction is judged on (spans every category).
import fs from 'node:fs';
import * as G from '../lib/itemGrammar.mjs';

const read = (f) => JSON.parse(fs.readFileSync(`data/${f}.json`, 'utf8'));
export const DATA = {
  weapons: read('weapons'),
  consumables: read('consumables'),
  accessories: read('accessories'),
  whetstones: read('whetstones'),
  imbues: read('imbues'),
  blessings: read('blessings'),
  metaUpgrades: read('metaUpgrades'),
};
const W = (n) => DATA.weapons.find((w) => w.name === n);
const C = (n) => DATA.consumables.find((w) => w.name === n);
const A = (n) => DATA.accessories.find((w) => w.name === n);
const B = (id) => DATA.blessings.blessings.find((b) => b.id === id);
const U = (id) => DATA.metaUpgrades.upgrades.find((u) => u.id === id);

/** name, category, tier, plaque, spec (pixel grammar), prompt (for generated direction) */
export const SAMPLE = [
  { name: 'Iron Sword', cat: 'Weapon', tier: 'Iron', plaque: 'weapon', spec: G.weaponSpec(W('Iron Sword')), prompt: 'a plain iron sword, dull grey steel, leather-wrapped grip' },
  { name: 'Silver Sword', cat: 'Weapon', tier: 'Silver', plaque: 'weapon', spec: G.weaponSpec(W('Silver Sword')), prompt: 'a bright silver longsword with a silver crossguard' },
  { name: 'Ragnarok', cat: 'Weapon', tier: 'Legend', plaque: 'weapon', spec: G.weaponSpec(W('Ragnarok')), prompt: 'a legendary broadsword with a gilded guard and a glowing ember-gold core line down the blade' },
  { name: 'Killer Lance', cat: 'Weapon', tier: 'Silver', plaque: 'weapon', spec: G.weaponSpec(W('Killer Lance')), prompt: 'a barbed silver lance head on a dark wooden shaft with a crimson tassel' },
  { name: 'Hand Axe', cat: 'Weapon', tier: 'Iron', plaque: 'weapon', spec: G.weaponSpec(W('Hand Axe')), prompt: 'a small iron throwing hand axe with a short wooden haft' },
  { name: 'Longbow', cat: 'Weapon', tier: 'Steel', plaque: 'weapon', spec: G.weaponSpec(W('Longbow')), prompt: 'a tall dark wooden longbow with a steel-blue grip binding' },
  { name: 'Bolganone', cat: 'Tome', tier: 'Silver', plaque: 'weapon', spec: G.weaponSpec(W('Bolganone')), prompt: 'a crimson fire magic tome with a flame emblem on the cover and silver corner fittings' },
  { name: 'Shine', cat: 'Light', tier: 'Steel', plaque: 'weapon', spec: G.weaponSpec(W('Shine')), prompt: 'a pale ivory light-magic tome with a gold four-pointed star on the cover' },
  { name: 'Physic', cat: 'Staff', tier: 'Silver', plaque: 'weapon', spec: G.weaponSpec(W('Physic')), prompt: 'a healing staff with a silver ring head holding a green gem' },
  { name: 'Skill scroll', cat: 'Scroll', tier: 'Rare', plaque: 'supply', spec: G.weaponSpec(DATA.weapons.find((w) => w.type === 'Scroll' && !w.teachesWeaponArtId)), prompt: 'a rolled parchment scroll tied with a violet cord and a violet wax seal' },
  { name: 'Weapon-art scroll', cat: 'Scroll', tier: 'Rare', plaque: 'supply', spec: G.weaponSpec(DATA.weapons.find((w) => w.teachesWeaponArtId)), prompt: 'a rolled parchment scroll tied with an amber cord and a gold wax seal' },
  { name: 'Vulnerary', cat: 'Supply', tier: 'none', plaque: 'supply', spec: G.consumableSpec(C('Vulnerary')), prompt: 'a small glass vial of green herbal salve with a cork' },
  { name: 'Elixir', cat: 'Supply', tier: 'none', plaque: 'supply', spec: G.consumableSpec(C('Elixir')), prompt: 'a round glass flask of glowing golden elixir with a gold stopper' },
  { name: 'Master Seal', cat: 'Seal', tier: 'none', plaque: 'supply', spec: G.consumableSpec(C('Master Seal')), prompt: 'a crimson wax seal pressed with a gold star, on grey ribbons' },
  { name: 'Energy Drop', cat: 'Booster', tier: 'none', plaque: 'supply', spec: G.consumableSpec(C('Energy Drop')), prompt: 'a single crimson teardrop-shaped crystal of strength' },
  { name: 'Speedwing', cat: 'Booster', tier: 'none', plaque: 'supply', spec: G.consumableSpec(C('Speedwing')), prompt: 'a pale sky-blue pegasus feather' },
  { name: 'Power Ring', cat: 'Accessory', tier: 'none', plaque: 'accessory', spec: G.accessorySpec(A('Power Ring')), prompt: 'a gold ring set with a round crimson gem' },
  { name: "Gambler's Coin", cat: 'Accessory', tier: 'none', plaque: 'accessory', spec: G.accessorySpec(A("Gambler's Coin")), prompt: "a gambler's gold coin whose face is split, half sun and half violet moon" },
  { name: 'Phoenix Brooch', cat: 'Accessory', tier: 'none', plaque: 'accessory', spec: G.accessorySpec(A('Phoenix Brooch')), prompt: 'an amber phoenix-wing brooch set with a crimson gem, on a gold chain' },
  { name: 'Silver Whetstone', cat: 'Forge', tier: 'none', plaque: 'forge', spec: G.whetstoneSpec(DATA.whetstones[0]), prompt: 'a silver-veined sharpening whetstone bar' },
  { name: 'Vampiric Stone', cat: 'Imbue', tier: 'none', plaque: 'forge', spec: G.imbueStoneSpec(DATA.imbues.imbues[0]), prompt: 'a cluster of crimson crystals on a small stone base' },
  { name: 'Forbidden Tome', cat: 'Blessing', tier: 'none', plaque: 'blessing', spec: G.blessingSpec(B('forbidden_tome')), prompt: 'a violet forbidden tome inside a thin gold eclipse corona (black sun)' },
  { name: 'War Chest', cat: 'Upgrade', tier: 'none', plaque: 'upgrade', spec: G.upgradeSpec(U('starting_gold')), prompt: 'a wooden treasure chest bound in gold' },
  { name: 'Lord Might', cat: 'Upgrade', tier: 'none', plaque: 'upgrade', spec: G.upgradeSpec(U('lord_str_flat')), prompt: 'a gold crown set with a crimson gem, a small amber plus sign badge' },
];
