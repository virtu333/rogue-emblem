// A whole-save migration must mean the same thing for a rewind destination whether the
// timeline stored it in full or as a patch against an earlier keyframe.
//
// The case that broke: a build-37 save whose keyframe holds an old Oathblade (9 Mt, 0 Crit,
// "Attacks twice") in Edric's first slot, and a later destination where Edric and Wren have
// traded it for Wren's Iron Sword. The destination is a patch against the keyframe, and a
// field-level patch that turns the slot's Oathblade into an Iron Sword never mentions Crit
// (both were 0). Migrating the keyframe in place (Oathblade +6 Mt, +20 Crit) under that patch
// handed the Iron Sword 20 Crit and brought the old Oathblade back on Wren. RunManager.fromJSON
// now decodes every patch before its migrations walk the save and re-encodes it after.
//
// The fixture is a real save written by the build before the rework (#344); the trade is
// written into its timeline with that build's own encoder (diffBattleState), so the stored
// patch is the one an old client would have saved.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RunManager } from '../src/engine/RunManager.js';
import {
  getEntryState,
  expandTimelinePatches,
  collapseTimelinePatches,
} from '../src/engine/BattleTimeline.js';
import { diffBattleState } from '../src/engine/BattleStateDelta.js';
import { loadGameData } from './testData.js';

const FIXTURE = new URL('./fixtures/saves/pre344-five-abilities-midbattle.json', import.meta.url);
const data = loadGameData();
const catalog = (name) => structuredClone(data.weapons.find((w) => w.name === name));

// Oathblade as the build before the rework shipped it: the rework's frozen deltas undone
// (docs/specs/legendary-arts-rework.md §6: +6 Mt, +20 Crit, the double-strike special gone).
function oldOathblade() {
  const blade = catalog('Oathblade');
  blade.might -= 6;
  blade.crit -= 20;
  blade.special = 'Attacks twice consecutively';
  blade.uid = 'itm_oath_old';
  return blade;
}

function arm(unit, weapon) {
  unit.inventory[0] = weapon;
  unit.weapon = structuredClone(weapon);
  unit.equippedInventoryIndex = 0;
}

/** The fixture with Edric holding the old Oathblade at the keyframe and Wren at `s2`. */
function savedWithTrade({ alsoAtCheckpoint = false } = {}) {
  const saved = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const timeline = saved.battleInProgress.timeline;
  const keyframe = timeline.snapshots.s1;
  expect(timeline.snapshots.s2.base).toBe('s1');
  const [edric, wren] = keyframe.playerUnits;
  expect([edric.name, wren.name]).toEqual(['Edric', 'Wren']);
  const sword = structuredClone(wren.inventory[0]);
  expect(sword.name).toBe('Iron Sword');
  arm(edric, oldOathblade());

  // The destination after the trade: decoded from the stored patch, then traded.
  const traded = structuredClone(keyframe);
  traded.checkpointIndex += 1;
  arm(traded.playerUnits[0], sword);
  arm(traded.playerUnits[1], oldOathblade());
  timeline.snapshots.s2 = { base: 's1', patch: diffBattleState(keyframe, traded) };
  if (alsoAtCheckpoint) {
    arm(saved.battleInProgress.checkpoint.playerUnits[0], sword);
    arm(saved.battleInProgress.checkpoint.playerUnits[1], oldOathblade());
  }
  return { saved, ironSword: sword };
}

const weaponStats = (w) => ({ name: w.name, might: w.might, crit: w.crit, special: w.special });

describe('whole-save migrations and patched rewind destinations', () => {
  it('a traded old Oathblade migrates on the unit that holds it, never onto the Iron Sword', () => {
    const { saved, ironSword } = savedWithTrade();
    const run = RunManager.fromJSON(saved, data);
    const timeline = run.battleInProgress.timeline;
    expect(timeline).toBeTruthy();
    const newBlade = weaponStats(catalog('Oathblade'));

    const atKeyframe = getEntryState(timeline, 1);
    expect(weaponStats(atKeyframe.playerUnits[0].inventory[0])).toEqual(newBlade);
    expect(weaponStats(atKeyframe.playerUnits[1].inventory[0])).toEqual(weaponStats(ironSword));

    const afterTrade = getEntryState(timeline, 2);
    const [edric, wren] = afterTrade.playerUnits;
    expect(weaponStats(edric.inventory[0])).toEqual(weaponStats(ironSword));
    expect(weaponStats(edric.weapon)).toEqual(weaponStats(ironSword));
    expect(weaponStats(wren.inventory[0])).toEqual(newBlade);
    expect(weaponStats(wren.weapon)).toEqual(newBlade);
  });

  it('the destination is still stored as a patch, and a second load changes nothing', () => {
    const { saved } = savedWithTrade({ alsoAtCheckpoint: true });
    const run = RunManager.fromJSON(saved, data);
    const stored = run.battleInProgress.timeline.snapshots.s2;
    expect(stored.base).toBe('s1');
    const first = getEntryState(run.battleInProgress.timeline, 2);

    const again = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), data);
    expect(getEntryState(again.battleInProgress.timeline, 2)).toEqual(first);
    expect(weaponStats(again.battleInProgress.checkpoint.playerUnits[1].inventory[0])).toEqual(
      weaponStats(catalog('Oathblade')),
    );
  });

  it('a patch over a keyframe no migration touched is kept exactly as stored', () => {
    const timeline = JSON.parse(readFileSync(FIXTURE, 'utf8')).battleInProgress.timeline;
    const before = structuredClone(timeline.snapshots);
    const expanded = expandTimelinePatches(timeline);
    expect(expanded.payload.snapshots.s2.base).toBeUndefined();
    expect(timeline.snapshots).toEqual(before);
    const collapsed = collapseTimelinePatches(expanded.payload, expanded.expanded);
    expect(collapsed.snapshots).toEqual(before);
  });
});

// The migrations used to carry their own patch branches (AccessoryCatalogMigration's
// `{ $: true }` leaf and its `x`/`o` removal rule; ItemNameMigration's `{ name: { $ } }`
// leaf). fromJSON's decode-first step made them dead, and they are gone: these cases go
// through RunManager.fromJSON on real patches an old build's encoder wrote, and each one
// fails if the migrations ever see a patch again (the decode step removed, or skipped for
// a holder).
describe('migrations see whole states only', () => {
  const accessory = (name) => structuredClone(data.accessories.find((a) => a.name === name));
  const legacyCoin = (uid) => ({
    ...accessory("Gambler's Coin"),
    combatEffects: { gamblerCoin: true },
    uid,
  });

  /** Patch `s2` and `s3` from keyframe edits made by `edit(state, snapshotId)`. */
  function savedWithPatches(prepare) {
    const saved = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const timeline = saved.battleInProgress.timeline;
    const keyframe = timeline.snapshots.s1;
    const states = prepare(keyframe);
    for (const [id, state] of Object.entries(states)) {
      expect(timeline.snapshots[id].base).toBe('s1');
      timeline.snapshots[id] = { base: 's1', patch: diffBattleState(keyframe, state) };
    }
    return saved;
  }

  it("a Gambler's Coin patched in or out decodes to the catalog's coin, or none", () => {
    const vanguard = accessory('Vanguard Crest');
    const saved = savedWithPatches((keyframe) => {
      const [edric, wren] = keyframe.playerUnits;
      edric.accessory = legacyCoin('itm_coin_edric');
      wren.accessory = structuredClone(vanguard);
      // s2: Edric swaps his coin for a Crest. s3: Wren swaps her Crest for a coin.
      const s2 = structuredClone(keyframe);
      s2.checkpointIndex += 1;
      s2.playerUnits[0].accessory = structuredClone(vanguard);
      const s3 = structuredClone(keyframe);
      s3.checkpointIndex += 2;
      s3.playerUnits[1].accessory = legacyCoin('itm_coin_wren');
      return { s2, s3 };
    });
    const timeline = RunManager.fromJSON(saved, data).battleInProgress.timeline;
    expect(timeline).toBeTruthy();
    const coinEffects = accessory("Gambler's Coin").combatEffects;

    const atKeyframe = getEntryState(timeline, 1);
    expect(atKeyframe.playerUnits[0].accessory.combatEffects).toEqual(coinEffects);
    // The Crest that replaced the coin keeps no gambler effect.
    expect(getEntryState(timeline, 2).playerUnits[0].accessory).toEqual(vanguard);
    // The coin patched in takes the catalog's config, not the legacy flag.
    const swappedIn = getEntryState(timeline, 3).playerUnits[1].accessory;
    expect(swappedIn.combatEffects).toEqual(coinEffects);
    expect(swappedIn.uid).toBe('itm_coin_wren');
    expect(JSON.stringify(timeline)).not.toContain('gamblerCoin');
  });

  it('an old item name written by a patch takes its new name', () => {
    const saved = savedWithPatches((keyframe) => {
      const edric = keyframe.playerUnits[0];
      const edge = { ...catalog('Keen Sword'), name: 'Killing Edge', uid: 'itm_edge' };
      arm(edric, edge);
      // s2: the same blade forged once: the patch holds only `{ name: { $: '... +1' } }`
      // and the stat it raised.
      const s2 = structuredClone(keyframe);
      s2.checkpointIndex += 1;
      for (const w of [s2.playerUnits[0].inventory[0], s2.playerUnits[0].weapon]) {
        w.name = 'Killing Edge +1';
        w.might += 1;
      }
      return { s2 };
    });
    saved.itemNamesRevision = 0;
    const timeline = RunManager.fromJSON(saved, data).battleInProgress.timeline;
    expect(getEntryState(timeline, 1).playerUnits[0].inventory[0].name).toBe('Keen Sword');
    const forged = getEntryState(timeline, 2).playerUnits[0];
    expect(forged.inventory[0].name).toBe('Keen Sword +1');
    expect(forged.weapon.name).toBe('Keen Sword +1');
    expect(JSON.stringify(timeline)).not.toContain('Killing Edge');
  });
});
