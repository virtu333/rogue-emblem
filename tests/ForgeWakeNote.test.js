// A forge on a weapon with no room left wakes a sleeping forge (ForgeSystem pull forward). The
// pickers say so in words, so a weapon reading "Fully forged 15/15" is never a surprise.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { applyForge, forgeWakeNote } from '../src/engine/ForgeSystem.js';
import { lullForges } from '../src/engine/KeptForges.js';
import { describeResult } from '../src/engine/EventResultWords.js';
import { applyStep } from '../src/engine/EventEffects.js';

const data = loadGameData();
const catalog = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const FULL = [
  ...Array(5).fill('might'),
  ...Array(4).fill('hit'),
  ...Array(4).fill('crit'),
  'weight',
  'weight',
];

function keptFull() {
  const sword = { ...catalog('Silver Sword'), uid: 'itm_kept' };
  for (const stat of FULL) applyForge(sword, stat, 0, { free: true });
  lullForges(sword, 2);
  return sword;
}

describe('forgeWakeNote', () => {
  it('names the stat and says the forge wakes a sleeping one', () => {
    // Failure: a full kept weapon's picker row shows only "Fully forged" with no hint that the
    // whetstone still works.
    const sword = keptFull();
    expect(forgeWakeNote(sword, 'hit')).toBe('Already 15/15 · wakes a sleeping Hit forge now');
  });

  it('names the stat when only that stat is full', () => {
    // Failure: a weapon with room overall is told it is "already 15/15".
    const sword = { ...catalog('Silver Sword'), uid: 'itm_stat' };
    for (let i = 0; i < 5; i++) applyForge(sword, 'might', 0, { free: true });
    lullForges(sword, 0);
    expect(forgeWakeNote(sword, 'might')).toBe(
      'Might already 5/5 · wakes a sleeping Might forge now',
    );
    expect(forgeWakeNote(sword, 'hit')).toBe('');
  });

  it('says nothing where the forge adds a new one', () => {
    // Failure: a plain weapon is told its forge "wakes" something.
    const sword = { ...catalog('Silver Sword'), uid: 'itm_plain' };
    expect(forgeWakeNote(sword, 'might')).toBe('');
    expect(forgeWakeNote(sword)).toBe('');
  });

  it('says nothing for a stat at its cap with nothing asleep', () => {
    // Failure: a refused forge is described as waking one.
    const sword = { ...catalog('Silver Sword'), uid: 'itm_m' };
    for (let i = 0; i < 5; i++) applyForge(sword, 'might', 0, { free: true });
    expect(forgeWakeNote(sword, 'might')).toBe('');
  });

  it('a choice stone on a full weapon says every pick wakes one; on a roomy weapon, nothing', () => {
    // Failure: the Silver Whetstone's weapon row hides that a full weapon still takes it.
    expect(forgeWakeNote(keptFull())).toMatch(
      /^Already 15\/15 · a forge wakes a sleeping one now$/,
    );
    const roomy = { ...catalog('Silver Sword'), uid: 'itm_roomy' };
    applyForge(roomy, 'might', 0, { free: true });
    lullForges(roomy, 0);
    expect(forgeWakeNote(roomy)).toBe('');
  });
});

describe('an event forge that wakes a sleeping forge', () => {
  it('records it and the result line says so', () => {
    // Failure: the event page says "is forged" for a forge that only woke an old one.
    const sword = keptFull();
    const unit = { name: 'Bjorn', inventory: [sword], weapon: sword };
    const [record] = applyStep({}, { type: 'forge', unit, weapon: sword, stat: 'hit' });
    expect(record.woke).toBe(true);
    const line = describeResult(record);
    expect(line.detail).toContain('wakes a sleeping forge early');
    expect(
      describeResult({ kind: 'forge', unit: 'B', weapon: 'S', name: 'S', stat: 'hit' }).detail,
    ).not.toContain('wakes');
  });
});
