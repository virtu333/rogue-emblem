// Gambler's Coins in saved runs take the catalog's odds (AccessoryCatalogMigration.js).
// The ways it can fail, each caught below:
//   - a place in the save is not walked (equipped, convoy, shop stock, pending reward,
//     fallen gear, the battle checkpoint, its entry state, a rewind timeline), so a
//     coin keeps the old +5 odds and text;
//   - the coin's instance fields (uid, forge/imbue-style state, HP debt) are lost or
//     replaced by catalog defaults;
//   - another accessory is changed, or a second load changes anything;
//   - a rewind patch that swaps the coin for another accessory leaves the migrated
//     `gambler` effect on the other accessory, or a patch that adds the coin brings
//     back the legacy flag;
//   - a save with no coin, or a catalog without a gambler config, is altered.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { migrateSavedGamblerCoins } from '../src/engine/AccessoryCatalogMigration.js';
import { applyAccessoryPhaseCombatMods } from '../src/engine/SkillSystem.js';
import { formatAccessoryCombatEffect } from '../src/utils/accessoryText.js';
import { applyBattleStatePatch, diffBattleState } from '../src/engine/BattleStateDelta.js';

const gameData = loadGameData();
const catalogCoin = gameData.accessories.find((a) => a.name === "Gambler's Coin");
const vanguard = () =>
  structuredClone(gameData.accessories.find((a) => a.name === 'Vanguard Crest'));

// A coin as a save from before the rebalance held it, with run state on it.
const legacyCoin = (extra = {}) => ({
  name: "Gambler's Coin",
  type: 'Accessory',
  effects: {},
  combatEffects: { gamblerCoin: true },
  price: 1500,
  lore: catalogCoin.lore,
  uid: 'itm_7_abcd',
  ...extra,
});

function legacySave() {
  const rm = new RunManager(gameData);
  rm.startRun();
  const saved = JSON.parse(JSON.stringify(rm.toJSON()));
  saved.roster[0].accessory = legacyCoin({ uid: 'itm_equipped', _custom: { keep: 1 } });
  saved.accessories = [legacyCoin({ uid: 'itm_convoy' }), vanguard()];
  saved.fallenUnits = [{ ...structuredClone(saved.roster[1]), accessory: legacyCoin() }];
  saved.shopStateByNodeId = {
    n1: { items: [{ item: legacyCoin({ uid: 'itm_shop' }), price: 1 }] },
  };
  saved.pendingBattleReward = {
    version: 1,
    choices: [{ type: 'accessory', item: legacyCoin({ uid: 'itm_reward' }) }],
  };
  return saved;
}

const hasFlag = (value) => JSON.stringify(value).includes('gamblerCoin');

describe('RunManager.fromJSON on a save with legacy Gambler coins', () => {
  it('an equipped coin and a convoy coin carry the catalog config, text and +8', () => {
    const rm = RunManager.fromJSON(legacySave(), gameData);
    const equipped = rm.roster[0].accessory;
    const convoy = rm.accessories[0];
    for (const coin of [equipped, convoy]) {
      expect(coin.combatEffects).toEqual({
        gambler: { winChance: 0.5, winAtkBonus: 8, lossAtkPenalty: -3 },
      });
      expect(formatAccessoryCombatEffect(coin)).toBe(
        'Gambler: 50%: +8 Attack, else −3. One flip per phase for all its combats.',
      );
    }
    // The combat mod on a winning flip.
    const mods = { atkBonus: 0, defBonus: 0 };
    applyAccessoryPhaseCombatMods(rm.roster[0], mods, {
      turnNumber: 1,
      rollSession: { gamblerAtkDeltaByUnit: new Map() },
      rng: () => 0,
    });
    expect(mods.atkBonus).toBe(8);
  });

  it('reaches every place a saved item lives', () => {
    const rm = RunManager.fromJSON(legacySave(), gameData);
    const json = JSON.parse(JSON.stringify(rm.toJSON()));
    expect(hasFlag(json)).toBe(false);
    expect(rm.fallenUnits[0].accessory.combatEffects.gambler.winAtkBonus).toBe(8);
    expect(rm.shopStateByNodeId.n1.items[0].item.combatEffects.gambler.winAtkBonus).toBe(8);
    expect(rm.pendingBattleReward.choices[0].item.combatEffects.gambler.winAtkBonus).toBe(8);
  });

  it('keeps instance fields and touches no other accessory', () => {
    const rm = RunManager.fromJSON(legacySave(), gameData);
    const equipped = rm.roster[0].accessory;
    expect(equipped.uid).toBe('itm_equipped');
    expect(equipped._custom).toEqual({ keep: 1 });
    expect(equipped.lore).toBe(catalogCoin.lore);
    expect(equipped.price).toBe(1500);
    expect(rm.accessories[0].uid).toBe('itm_convoy');
    expect(rm.accessories[1]).toEqual(expect.objectContaining(vanguard()));
  });

  it('loading twice is a no-op', () => {
    const once = RunManager.fromJSON(legacySave(), gameData);
    const first = JSON.parse(JSON.stringify(once.toJSON()));
    const snapshot = structuredClone(first);
    const twice = RunManager.fromJSON(first, gameData);
    expect(JSON.parse(JSON.stringify(twice.toJSON()))).toEqual(snapshot);
    expect(migrateSavedGamblerCoins(first, gameData)).toBe(0);
  });
});

describe('migrateSavedGamblerCoins', () => {
  it('is idempotent and counts what it changed', () => {
    const tree = { a: [legacyCoin(), legacyCoin()], b: { accessory: vanguard() } };
    expect(migrateSavedGamblerCoins(tree, gameData)).toBe(2);
    expect(migrateSavedGamblerCoins(tree, gameData)).toBe(0);
    expect(tree.b.accessory).toEqual(vanguard());
  });

  it('leaves current coins, other accessories and unflagged saves alone', () => {
    const tree = { coin: structuredClone(catalogCoin), other: vanguard(), n: 3 };
    const copy = structuredClone(tree);
    expect(migrateSavedGamblerCoins(tree, gameData)).toBe(0);
    expect(tree).toEqual(copy);
  });

  it('does nothing when the catalog gives the coin no gambler config', () => {
    const tree = { coin: legacyCoin() };
    const stale = {
      accessories: [{ name: "Gambler's Coin", combatEffects: { gamblerCoin: true } }],
    };
    expect(migrateSavedGamblerCoins(tree, stale)).toBe(0);
    expect(migrateSavedGamblerCoins(tree, null)).toBe(0);
    expect(tree.coin.combatEffects).toEqual({ gamblerCoin: true });
  });

  it('migrates the battle checkpoint, entry state and rewind keyframes', () => {
    const save = {
      battleInProgress: {
        entryBattleState: { accessories: [legacyCoin()] },
        checkpoint: { playerUnits: [{ name: 'Edric', accessory: legacyCoin() }] },
        timeline: { snapshots: { s0: { playerUnits: [{ accessory: legacyCoin() }] } } },
      },
    };
    expect(migrateSavedGamblerCoins(save, gameData)).toBe(3);
    expect(hasFlag(save)).toBe(false);
    expect(save.battleInProgress.checkpoint.playerUnits[0].accessory.uid).toBe('itm_7_abcd');
  });

  it('keeps rewind patches consistent with a migrated keyframe', () => {
    // Real patches written by an old build: the coin is swapped for a Vanguard Crest,
    // and (against a keyframe holding the Crest) the coin is swapped in.
    const stateWith = (accessory) => ({ playerUnits: [{ battleEntityId: 'p1', accessory }] });
    const withCoin = stateWith(legacyCoin());
    const withOther = stateWith(vanguard());
    const save = {
      snapshots: {
        a: structuredClone(withCoin),
        b: { base: 'a', patch: diffBattleState(withCoin, withOther) },
        c: structuredClone(withOther),
        d: { base: 'c', patch: diffBattleState(withOther, withCoin) },
      },
    };
    expect(migrateSavedGamblerCoins(save, gameData)).toBeGreaterThan(0);
    const swappedOut = applyBattleStatePatch(save.snapshots.a, save.snapshots.b.patch);
    // The Crest replaces the coin: no leftover gambler effect.
    expect(swappedOut.playerUnits[0].accessory).toEqual(vanguard());
    const swappedIn = applyBattleStatePatch(save.snapshots.c, save.snapshots.d.patch);
    expect(swappedIn.playerUnits[0].accessory.combatEffects).toEqual(catalogCoin.combatEffects);
    expect(swappedIn.playerUnits[0].accessory.name).toBe("Gambler's Coin");
    expect(migrateSavedGamblerCoins(save, gameData)).toBe(0);
  });
});
