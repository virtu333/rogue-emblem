// Free-change fingerprint used to record an equip-then-set-aside as its own
// rewind point (review R1): items are fingerprinted by identity and instance
// fields, never by name, and run-only changes are reported explicitly.
import { describe, expect, it } from 'vitest';
import {
  fingerprintChanges,
  itemFingerprint,
  rewindFingerprint,
} from '../src/ui/BattleTimelineRecorder.js';
import { applyForge } from '../src/engine/ForgeSystem.js';
import { applyImbue } from '../src/engine/ImbueSystem.js';
import { equipAccessory, equipWeapon } from '../src/engine/UnitManager.js';
import { ensureItemUid } from '../src/utils/itemUid.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const catalog = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const newItem = (name) => ensureItemUid(catalog(name));

/** Two Iron Swords forged once each, one for might and one for hit. */
function twinForges({ legacy = false } = {}) {
  const might = newItem('Iron Sword');
  const hit = newItem('Iron Sword');
  if (legacy) {
    delete might.uid;
    delete hit.uid;
  }
  expect(applyForge(might, 'might').success).toBe(true);
  expect(applyForge(hit, 'hit').success).toBe(true);
  expect(might.name).toBe('Iron Sword +1');
  expect(hit.name).toBe(might.name);
  expect(hit.uses).toBe(might.uses);
  return { might, hit };
}

function swordsman(id, items) {
  return {
    battleEntityId: id,
    name: `Unit ${id}`,
    col: 2,
    row: 3,
    hasMoved: false,
    _movementCommitted: false,
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    stats: { HP: 20, STR: 6, MAG: 0, SKL: 6, SPD: 6, DEF: 4, RES: 1, LCK: 3, MOV: 5 },
    inventory: items,
    weapon: items[0] || null,
    consumables: [],
    accessory: null,
  };
}

function scene(units, run = {}) {
  return {
    playerUnits: units,
    runManager: {
      gold: 900,
      convoy: { weapons: [newItem('Steel Sword')], consumables: [] },
      accessories: [],
      ...run,
    },
  };
}

describe('rewind fingerprint: item identity (R1)', () => {
  it('equipping the other equally named forge is a change of that unit', () => {
    const { might, hit } = twinForges();
    const unit = swordsman('u1', [might, hit]);
    const other = swordsman('u2', [newItem('Iron Sword')]);
    const s = scene([unit, other]);
    equipWeapon(unit, might);
    const before = rewindFingerprint(s);
    equipWeapon(unit, hit);
    // Equipped weapon is always first: the index alone cannot tell them apart.
    expect(unit.inventory.indexOf(unit.weapon)).toBe(0);
    expect(fingerprintChanges(s, before)).toEqual({ units: ['u1'], run: false, changed: true });
    // Switching back is again a change relative to the new baseline.
    const afterHit = rewindFingerprint(s);
    equipWeapon(unit, might);
    expect(fingerprintChanges(s, afterHit).units).toEqual(['u1']);
    // ...and restores the original fingerprint exactly (same board).
    expect(fingerprintChanges(s, before)).toEqual({ units: [], run: false, changed: false });
  });

  it('legacy items without uids are told apart by their forged fields, deterministically', () => {
    const { might, hit } = twinForges({ legacy: true });
    const unit = swordsman('u1', [might, hit]);
    const s = scene([unit]);
    const before = rewindFingerprint(s);
    equipWeapon(unit, hit);
    expect(fingerprintChanges(s, before).units).toEqual(['u1']);
    expect('uid' in might || 'uid' in hit).toBe(false); // never allocates ids
    // The same content always fingerprints the same, including the structured
    // clone a checkpoint or rewind hands back (and a JSON save round trip).
    expect(itemFingerprint(structuredClone(might))).toBe(itemFingerprint(might));
    expect(itemFingerprint(JSON.parse(JSON.stringify(might)))).toBe(itemFingerprint(might));
    const restored = { playerUnits: [structuredClone(unit)], runManager: s.runManager };
    expect(fingerprintChanges(restored, rewindFingerprint(s)).changed).toBe(false);
    expect(itemFingerprint(might)).not.toBe(itemFingerprint(hit));
  });

  it('two indistinguishable legacy copies swap without a false change', () => {
    const a = catalog('Iron Sword');
    const b = catalog('Iron Sword');
    const unit = swordsman('u1', [a, b]);
    const s = scene([unit]);
    const before = rewindFingerprint(s);
    equipWeapon(unit, b);
    // Same content, same position, same combat setup: nothing to record.
    expect(fingerprintChanges(s, before).changed).toBe(false);
  });

  it('in-place instance changes count: forge, imbue, uses, _usesSpent', () => {
    const sword = newItem('Iron Sword');
    const unit = swordsman('u1', [sword]);
    const s = scene([unit]);
    const mutations = [
      () => applyForge(sword, 'crit'),
      () => applyImbue(sword, data.imbues.imbues[0]),
      () => (sword.uses -= 1),
      () => (sword._usesSpent = (sword._usesSpent || 0) + 1),
    ];
    for (const mutate of mutations) {
      const before = rewindFingerprint(s);
      mutate();
      expect(fingerprintChanges(s, before).units).toEqual(['u1']);
    }
  });

  it('accessories and consumables by instance, not by name', () => {
    const ringA = ensureItemUid(structuredClone(data.accessories[0]));
    const ringB = ensureItemUid(structuredClone(data.accessories[0]));
    const potionA = ensureItemUid(structuredClone(data.consumables[0]));
    const potionB = ensureItemUid(structuredClone(data.consumables[0]));
    const unit = swordsman('u1', [newItem('Iron Sword')]);
    unit.consumables = [potionA];
    equipAccessory(unit, ringA);
    const s = scene([unit]);
    let before = rewindFingerprint(s);
    equipAccessory(unit, ringB);
    expect(fingerprintChanges(s, before).units).toEqual(['u1']);
    before = rewindFingerprint(s);
    unit.consumables = [potionB];
    expect(fingerprintChanges(s, before).units).toEqual(['u1']);
  });

  it('run-only free changes are reported explicitly (no longer an empty list)', () => {
    const unit = swordsman('u1', [newItem('Iron Sword')]);
    const s = scene([unit]);
    let before = rewindFingerprint(s);
    s.runManager.gold += 100;
    expect(fingerprintChanges(s, before)).toEqual({ units: [], run: true, changed: true });
    // Convoy exchange that keeps the count: identity, not length.
    before = rewindFingerprint(s);
    s.runManager.convoy.weapons = [newItem('Steel Sword')];
    expect(fingerprintChanges(s, before)).toEqual({ units: [], run: true, changed: true });
    before = rewindFingerprint(s);
    s.runManager.accessories = [ensureItemUid(structuredClone(data.accessories[1]))];
    expect(fingerprintChanges(s, before).run).toBe(true);
  });

  it('no false positives: re-fingerprinting an unchanged board, and unknown baselines', () => {
    const { might, hit } = twinForges();
    const unit = swordsman('u1', [might, hit]);
    const s = scene([unit, swordsman('u2', [newItem('Iron Lance')])]);
    const before = rewindFingerprint(s);
    expect(rewindFingerprint(s)).toEqual(before);
    // Reading presentation helpers or cloning the board does not change it.
    structuredClone(s.playerUnits);
    expect(fingerprintChanges(s, before)).toEqual({ units: [], run: false, changed: false });
    expect(fingerprintChanges(s, null)).toBeNull();
    expect(fingerprintChanges(s, {})).toBeNull();
  });

  it('a unit that leaves or appears is a change', () => {
    const a = swordsman('u1', [newItem('Iron Sword')]);
    const b = swordsman('u2', [newItem('Iron Sword')]);
    const s = scene([a, b]);
    const before = rewindFingerprint(s);
    s.playerUnits = [a];
    expect(fingerprintChanges(s, before).units).toEqual(['u2']);
    s.playerUnits = [a, b, swordsman('u3', [])];
    expect(fingerprintChanges(s, before).units).toEqual(['u3']);
  });
});
