// Playtest round 3 (2026-09-26): at an Act 2 ruins market, Witchfire (the same
// might, hit and weight as the wielder's Wildfire, but +30 crit and the Mire
// weapon art) compared as only "Attack 20 → 20 · AS 3 → 3". The roster showed
// the crit. The shop, the reward screen and the roster now share one helper
// that adds a row for each meaningful difference, and only those.
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/serviceSave.js', () => ({ saveServiceRun: vi.fn(() => '') }));

import {
  equipmentComparison,
  weaponComparisonParts,
  weaponComparisonRows,
} from '../src/ui/equipmentComparison.js';
import { installFakeDom } from './helpers/fakeDom.js';
import { MobileRosterSheet } from '../src/ui/MobileRosterSheet.js';
import { RunManager } from '../src/engine/RunManager.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const arts = gameData.weaponArts.arts;
const weapon = (name, extra = {}) => ({
  ...structuredClone(gameData.weapons.find((w) => w.name === name)),
  ...extra,
});
// A Sage-like caster: MAG 10, SKL 10 (crit base 5), SPD 8, STR 0, LCK 3.
const caster = (equipped) => ({
  name: 'Ottoline',
  stats: { HP: 30, STR: 0, MAG: 10, SKL: 10, SPD: 8, LCK: 3, DEF: 5, RES: 8 },
  weapon: equipped,
});
// Parts keep their words together with no-break spaces; compare as plain text.
const plain = (text) => String(text).replace(/\u00a0/g, ' ');
const fighter = (equipped) => ({
  name: 'Brom',
  stats: { HP: 30, STR: 10, MAG: 0, SKL: 6, SPD: 7, LCK: 2, DEF: 6, RES: 1 },
  weapon: equipped,
});

describe('equipmentComparison (shop and reward screen)', () => {
  it('Witchfire over Wildfire shows the crit and the added Mire art', () => {
    const wildfire = weapon('Wildfire');
    const witchfire = weapon('Witchfire', { weaponArtIds: ['magic_mire'] });
    // Same might/hit/weight: data guard so the test keeps meaning what it says.
    for (const k of ['might', 'hit', 'weight', 'range'])
      expect(witchfire[k], k).toEqual(wildfire[k]);
    // Attack = MAG 10 + 7 might; AS = SPD 8 - (4 weight - STR 0 / 5);
    // Crit = SKL 10 / 2 + weapon crit (0, then 30).
    expect(plain(equipmentComparison(caster(wildfire), witchfire, undefined, { arts }))).toBe(
      'If equipped: Attack 17 → 17 · Attack speed 4 → 4 · Crit 5 → 35 · Art none → Mire',
    );
  });

  it('identical weapons add no extra rows', () => {
    const wildfire = weapon('Wildfire', { weaponArtIds: ['magic_mire'] });
    const copy = structuredClone(wildfire);
    expect(plain(equipmentComparison(caster(wildfire), copy, undefined, { arts }))).toBe(
      'If equipped: Attack 17 → 17 · Attack speed 4 → 4',
    );
  });

  it('names changes to hit, range, a different art and a special effect', () => {
    const blade = {
      name: 'Plain Blade',
      type: 'Sword',
      might: 5,
      hit: 90,
      crit: 0,
      weight: 5,
      range: '1',
      special: '',
      weaponArtIds: ['sword_hexblade'],
    };
    const venom = {
      ...blade,
      name: 'Venom Blade',
      hit: 80,
      range: '1-2',
      special: 'Poison: target loses 5 HP after combat',
      weaponArtIds: ['magic_mire'],
    };
    const hex = arts.find((a) => a.id === 'sword_hexblade').name;
    // Attack = STR 10 + 5; AS = SPD 7 - max(0, 5 - 10 / 5); Hit = hit + SKL*2 + LCK.
    expect(weaponComparisonParts(fighter(blade), venom, blade, { arts }).map(plain)).toEqual([
      'Attack 15 → 15',
      'Attack speed 4 → 4',
      'Hit 104 → 94',
      'Range 1 → 1-2',
      `Art ${hex} → Mire`,
      'Effect none → Poison 5',
    ]);
  });

  it('marks each number row better or worse, and leaves trade-offs unjudged', () => {
    const blade = {
      name: 'Plain Blade',
      type: 'Sword',
      might: 5,
      hit: 90,
      crit: 0,
      weight: 5,
      range: '1',
      special: '',
    };
    // Heavier (weight 9: AS 7 - (9 - 2) = 0), harder (might 8), less accurate, keener.
    const heavy = {
      ...blade,
      name: 'Heavy Blade',
      might: 8,
      weight: 9,
      hit: 70,
      crit: 10,
      range: '1-2',
    };
    const rows = weaponComparisonRows(fighter(blade), heavy, blade);
    expect(rows.map(({ id, from, to, delta, better }) => [id, from, to, delta, better])).toEqual([
      ['atk', 15, 18, 3, true],
      ['as', 4, 0, -4, false],
      ['hit', 104, 84, -20, false],
      ['crit', 3, 13, 10, true],
      ['range', '1', '1-2', null, null],
    ]);
    const same = weaponComparisonRows(fighter(blade), { ...blade }, blade);
    expect(same.map((r) => [r.id, r.delta, r.better])).toEqual([
      ['atk', 0, null],
      ['as', 0, null],
    ]);
  });

  it('keeps the staff line unchanged', () => {
    const heal = weapon('Heal');
    expect(equipmentComparison(caster(null), heal)).toMatch(/uses per map for Ottoline/);
  });
});

describe('roster equipment comparison', () => {
  beforeEach(() => {
    installFakeDom(vi);
    _resetInputFocus();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetInputFocus();
  });

  it('says the same thing the shop says about a carried weapon', () => {
    const run = new RunManager(gameData);
    run.startRun();
    const mage = createRecruitUnit(
      { name: 'Ottoline', level: 3 },
      gameData.classes.find((c) => c.name === 'Mage'),
      gameData.weapons,
    );
    Object.assign(mage.stats, { STR: 0, MAG: 10, SKL: 10, SPD: 8, LCK: 3 });
    const wildfire = weapon('Wildfire');
    const witchfire = weapon('Witchfire', { weaponArtIds: ['magic_mire'] });
    mage.inventory = [wildfire, witchfire];
    mage.weapon = wildfire;
    run.roster.push(mage);
    const scene = {
      gameData,
      runManager: run,
      events: { once() {}, on() {}, off() {}, emit() {} },
      registry: { get: () => null },
      textures: { exists: () => false },
      sys: { settings: { key: 'NodeMap' } },
    };
    const sheet = new MobileRosterSheet({
      scene,
      units: run.roster,
      run,
      gameData,
      onClose: vi.fn(),
    });
    sheet.index = sheet.units.indexOf(mage);
    sheet.tab = 'gear';
    sheet.render();
    const boxes = sheet.root.querySelectorAll('.mr-compare');
    const box = boxes[0];
    const title = box?.querySelector('.mr-compare-title')?.textContent;
    const terms = box?.querySelectorAll('dt').map((n) => plain(n.textContent)) || [];
    const values = box
      ?.querySelectorAll('dd')
      .map((n) => n.children.map((c) => plain(c.textContent)));
    const deltas = box
      ?.querySelectorAll('.mr-compare-delta')
      .map((n) => [n.textContent, n.className]);
    // It sits above the art and lore disclosures, not under them.
    const card = box?.parentNode;
    const order = card?.children.map((n) => n.tagName) || [];
    sheet.destroy();
    expect(boxes.length).toBe(1);
    expect(title).toBe('Compared with Wildfire');
    // Crit 5 → 35 (SKL 10 / 2, plus Witchfire's 30) and the Mire art it adds.
    expect(terms).toEqual(['Attack', 'Attack speed', 'Crit', 'Weapon art']);
    expect(values).toEqual([
      ['17', 'same'],
      ['4', 'same'],
      ['5', '→', '35', '+30'],
      ['none', '→', 'Mire'],
    ]);
    expect(deltas).toEqual([['+30', 'mr-compare-delta mr-up']]);
    expect(order.indexOf('SECTION')).toBeLessThan(order.indexOf('DETAILS'));
    // The shop's line says the same changes.
    const shop = plain(equipmentComparison(mage, witchfire, wildfire, { arts }));
    expect(shop).toBe(
      'If equipped: Attack 17 → 17 · Attack speed 4 → 4 · Crit 5 → 35 · Art none → Mire',
    );
  });
});
