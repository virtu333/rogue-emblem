// Phalanx Rite (`adjacent_ally_def_bonus`) and Duelist's Creed (`isolated_combat_bonus`)
// (docs/specs/blessings-v3.md §5.2): two blessings that read where a player unit stands among
// its own army. Both ride the one blessing combat read, `blessingCombatModsFor`, so the scene,
// the harness and the forecast cannot disagree.
//
// Ways this can fail, a test each:
//   - a diagonal ally counts as adjacent (Phalanx is cardinal);
//   - four neighbours pay more than the cap;
//   - foes, green NPC allies or the unit itself count (a foe is always adjacent in melee);
//   - a dead or off-map ally counts for or against a unit;
//   - the bonus lands on only one side of the exchange;
//   - Duelist's radius is off by one (an ally at 2 breaks it, at 3 does not);
//   - a foe within the radius breaks the duel;
//   - the scene and the harness read different allies for one board;
//   - the forecast shows a different number than the combat uses;
//   - the helper extraction changed the accessory conditions it was lifted from;
//   - a malformed boon ships doing nothing; a save loses or invents the bonus.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/LevelUpPopup.js', () => ({
  LevelUpPopup: class {
    async show() {}
  },
}));
vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => {}),
  showMinorHint: vi.fn(),
  showContextualHint: vi.fn(),
}));

import './harness/JourneyTestSetup.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { presentationFailureProxy as rendering } from './harness/PresentationFailureProxy.js';
import {
  applyBlessingCombatMods,
  blessingCombatModsFor,
} from '../src/engine/BlessingCombatMods.js';
import { validateBlessingsConfig } from '../src/engine/BlessingEngine.js';
import { getCombatForecast } from '../src/engine/Combat.js';
import {
  adjacentAllyDefBonus,
  isolatedCombatBonus,
  parseAdjacentAllyDefBonus,
  parseIsolatedCombatBonus,
} from '../src/engine/FormationBlessings.js';
import { RunManager } from '../src/engine/RunManager.js';
import {
  countAdjacentAllies,
  getSkillCombatMods,
  hasAllyWithin,
} from '../src/engine/SkillSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const realRandom = Math.random;
afterEach(() => {
  Math.random = realRandom;
  vi.restoreAllMocks();
});

const PHALANX = { perAlly: 1, max: 3 };
const DUELIST = { radius: 2, avoidBonus: 15, critBonus: 10 };
const PROFILE = {
  actHitBonus: 0,
  firstStrikeHitBonus: 0,
  stationary: { defBonus: 0, avoidBonus: 0 },
  adjacentAllyDef: [PHALANX],
  isolated: [DUELIST],
};
const PHALANX_ONLY = { ...PROFILE, isolated: [] };
const DUELIST_ONLY = { ...PROFILE, adjacentAllyDef: [] };

const at = (col, row, extra = {}) => ({
  name: `u${col}_${row}`,
  faction: 'player',
  col,
  row,
  currentHP: 10,
  ...extra,
});
const side = (unit, allies, extra = {}) => ({
  unit,
  foe: { faction: 'enemy' },
  initiating: false,
  turn: 1,
  terrain: { name: 'Plain' },
  allies,
  ...extra,
});

describe('Phalanx Rite: DEF per ally on a cardinal neighbour tile', () => {
  const me = at(3, 3);

  it('pays +1 DEF for each ally north, south, east or west', () => {
    for (const [dc, dr] of [
      [0, -1],
      [0, 1],
      [1, 0],
      [-1, 0],
    ]) {
      const mods = blessingCombatModsFor(PHALANX_ONLY, side(me, [me, at(3 + dc, 3 + dr)]));
      expect(mods.defBonus, `ally at ${dc},${dr}`).toBe(1);
    }
  });

  it('pays nothing for a diagonal ally (a bug that read Manhattan <= 2 would pay)', () => {
    const diagonals = [at(2, 2), at(4, 2), at(2, 4), at(4, 4)];
    expect(blessingCombatModsFor(PHALANX_ONLY, side(me, [me, ...diagonals])).defBonus).toBe(0);
  });

  it('pays nothing for an ally two tiles away', () => {
    expect(blessingCombatModsFor(PHALANX_ONLY, side(me, [me, at(5, 3), at(3, 1)])).defBonus).toBe(
      0,
    );
  });

  it('stacks per ally: two neighbours pay +2, three pay +3', () => {
    expect(blessingCombatModsFor(PHALANX_ONLY, side(me, [me, at(2, 3), at(4, 3)])).defBonus).toBe(
      2,
    );
    expect(
      blessingCombatModsFor(PHALANX_ONLY, side(me, [me, at(2, 3), at(4, 3), at(3, 2)])).defBonus,
    ).toBe(3);
  });

  it('caps at +3 with all four neighbours (the cap is the data, not the count)', () => {
    const four = [at(2, 3), at(4, 3), at(3, 2), at(3, 4)];
    expect(blessingCombatModsFor(PHALANX_ONLY, side(me, [me, ...four])).defBonus).toBe(3);
    const wide = { ...PHALANX_ONLY, adjacentAllyDef: [{ perAlly: 1, max: 4 }] };
    expect(blessingCombatModsFor(wide, side(me, [me, ...four])).defBonus).toBe(4);
    const double = { ...PHALANX_ONLY, adjacentAllyDef: [{ perAlly: 2, max: 3 }] };
    expect(blessingCombatModsFor(double, side(me, [me, at(2, 3), at(4, 3)])).defBonus).toBe(3);
  });

  it('does not count the unit itself, though it stands in its own side', () => {
    expect(blessingCombatModsFor(PHALANX_ONLY, side(me, [me])).defBonus).toBe(0);
    expect(blessingCombatModsFor(PHALANX_ONLY, side(me, [me, { ...me }])).defBonus).toBe(0);
  });

  it('does not count a fallen ally or one that is off the map', () => {
    const dead = at(2, 3, { currentHP: 0 });
    const offMap = at(undefined, undefined);
    const nullTile = at(null, null);
    const nan = at(Number.NaN, 3);
    expect(
      blessingCombatModsFor(PHALANX_ONLY, side(me, [me, dead, offMap, nullTile, nan])).defBonus,
    ).toBe(0);
  });

  it('gives enemies and NPC allies nothing, however many neighbours they have', () => {
    for (const faction of ['enemy', 'npc']) {
      const unit = at(3, 3, { faction });
      const crowd = [unit, at(2, 3, { faction }), at(4, 3, { faction }), at(3, 2, { faction })];
      expect(blessingCombatModsFor(PROFILE, side(unit, crowd))).toEqual({
        hitBonus: 0,
        avoidBonus: 0,
        defBonus: 0,
        critBonus: 0,
        firstStrikeHitBonus: 0,
      });
    }
  });

  it('a foe standing beside the unit is not an ally (melee always puts one there)', () => {
    // The scene hands a player its own army. A foe standing beside it is never in that list.
    expect(blessingCombatModsFor(PHALANX_ONLY, side(me, [me], { foe: at(4, 3) })).defBonus).toBe(0);
  });

  it('lands on the attacker and on the defender of one exchange', () => {
    const attacker = at(3, 3);
    const defender = at(7, 3);
    const attackerAllies = [attacker, at(3, 2), at(3, 4)];
    const defenderAllies = [defender, at(7, 2), at(7, 4), at(6, 3)];
    const atkMods = { hitBonus: 0, avoidBonus: 0, defBonus: 0, critBonus: 0 };
    const defMods = { hitBonus: 0, avoidBonus: 0, defBonus: 0, critBonus: 0 };
    applyBlessingCombatMods(atkMods, defMods, {
      profile: PHALANX_ONLY,
      attacker,
      defender,
      atkTerrain: null,
      defTerrain: null,
      turn: 1,
      alliesOf: (unit) => (unit === attacker ? attackerAllies : defenderAllies),
    });
    expect(atkMods.defBonus).toBe(2);
    expect(defMods.defBonus).toBe(3);
  });

  it('adds to what the mods already held (a skill bonus is not overwritten)', () => {
    const atk = { hitBonus: 0, avoidBonus: 0, defBonus: 2, critBonus: 0 };
    applyBlessingCombatMods(atk, atk, {
      profile: PHALANX_ONLY,
      attacker: me,
      defender: at(9, 9, { faction: 'enemy' }),
      turn: 1,
      alliesOf: (unit) => (unit === me ? [me, at(2, 3)] : []),
    });
    expect(atk.defBonus).toBe(3);
  });

  it('two grants add: the entries are independent', () => {
    const profile = { ...PHALANX_ONLY, adjacentAllyDef: [PHALANX, { perAlly: 2, max: 2 }] };
    expect(blessingCombatModsFor(profile, side(me, [me, at(2, 3)])).defBonus).toBe(1 + 2);
  });
});

describe("Duelist's Creed: Avoid and Crit with no ally within the radius", () => {
  const me = at(3, 3);
  const mods = (allies, profile = DUELIST_ONLY) =>
    blessingCombatModsFor(profile, side(me, [me, ...allies]));

  it('pays +15 Avoid and +10 Crit to a unit with no ally in range', () => {
    expect(mods([])).toMatchObject({ avoidBonus: 15, critBonus: 10 });
    expect(mods([at(0, 0), at(7, 7)])).toMatchObject({ avoidBonus: 15, critBonus: 10 });
  });

  it('a lone unit that is its own only ally is isolated', () => {
    expect(blessingCombatModsFor(DUELIST_ONLY, side(me, [me]))).toMatchObject({
      avoidBonus: 15,
      critBonus: 10,
    });
  });

  it('an ally two tiles away breaks it, one three tiles away does not', () => {
    for (const near of [at(5, 3), at(1, 3), at(3, 5), at(3, 1)]) {
      expect(mods([near]), `ally at ${near.col},${near.row}`).toMatchObject({
        avoidBonus: 0,
        critBonus: 0,
      });
    }
    for (const far of [at(6, 3), at(0, 3), at(3, 6), at(3, 0)]) {
      expect(mods([far]), `ally at ${far.col},${far.row}`).toMatchObject({
        avoidBonus: 15,
        critBonus: 10,
      });
    }
  });

  it('a diagonal neighbour (distance 2) and an adjacent ally both break it', () => {
    expect(mods([at(4, 4)])).toMatchObject({ avoidBonus: 0, critBonus: 0 });
    expect(mods([at(3, 4)])).toMatchObject({ avoidBonus: 0, critBonus: 0 });
  });

  it('a knight at distance 3 by Manhattan counts as far even when it is close on the diagonal', () => {
    // (4,5) is 1 across and 2 down: Manhattan 3.
    expect(mods([at(4, 5)])).toMatchObject({ avoidBonus: 15, critBonus: 10 });
  });

  it('a foe within the radius does not break it (the duel is the point)', () => {
    const foe = at(4, 3, { faction: 'enemy' });
    const npc = at(2, 3, { faction: 'npc' });
    // The caller hands the unit's own side only; a foe or an NPC is never in it.
    expect(mods([])).toMatchObject({ avoidBonus: 15 });
    expect(blessingCombatModsFor(DUELIST_ONLY, side(me, [me], { foe }))).toMatchObject({
      avoidBonus: 15,
      critBonus: 10,
    });
    expect(blessingCombatModsFor(DUELIST_ONLY, side(me, [me], { foe: npc }))).toMatchObject({
      avoidBonus: 15,
    });
  });

  it('a fallen or off-map ally does not break it', () => {
    const dead = at(4, 3, { currentHP: 0 });
    const offMap = at(undefined, undefined);
    expect(mods([dead, offMap])).toMatchObject({ avoidBonus: 15, critBonus: 10 });
  });

  it('applies when the unit attacks and when it defends', () => {
    const attacker = at(3, 3);
    const defender = at(4, 3);
    const atkMods = { hitBonus: 0, avoidBonus: 0, defBonus: 0, critBonus: 0 };
    const defMods = { hitBonus: 0, avoidBonus: 0, defBonus: 0, critBonus: 0 };
    applyBlessingCombatMods(atkMods, defMods, {
      profile: DUELIST_ONLY,
      attacker,
      defender,
      turn: 1,
      alliesOf: (unit) => [unit],
    });
    expect([atkMods.avoidBonus, atkMods.critBonus]).toEqual([15, 10]);
    expect([defMods.avoidBonus, defMods.critBonus]).toEqual([15, 10]);
  });

  it('gives enemies and NPC allies nothing even when alone', () => {
    for (const faction of ['enemy', 'npc']) {
      const unit = at(3, 3, { faction });
      expect(blessingCombatModsFor(DUELIST_ONLY, side(unit, [unit]))).toMatchObject({
        avoidBonus: 0,
        critBonus: 0,
      });
    }
  });

  it('pays only the stat the data names, and leaves DEF and Hit alone', () => {
    const critOnly = { ...PROFILE, adjacentAllyDef: [], isolated: [{ radius: 2, critBonus: 7 }] };
    expect(blessingCombatModsFor(critOnly, side(me, [me]))).toEqual({
      hitBonus: 0,
      avoidBonus: 0,
      defBonus: 0,
      critBonus: 7,
      firstStrikeHitBonus: 0,
    });
  });

  it('a wider radius reads the data: radius 3 is broken by an ally at 3', () => {
    const wide = { ...DUELIST_ONLY, isolated: [{ ...DUELIST, radius: 3 }] };
    expect(mods([at(6, 3)], wide)).toMatchObject({ avoidBonus: 0 });
    expect(mods([at(7, 3)], wide)).toMatchObject({ avoidBonus: 15 });
  });
});

describe('both cards together read one board', () => {
  it('a unit beside an ally gets Phalanx DEF and no Duelist bonus; a lone one the reverse', () => {
    const me = at(3, 3);
    const beside = blessingCombatModsFor(PROFILE, side(me, [me, at(3, 4)]));
    expect(beside).toMatchObject({ defBonus: 1, avoidBonus: 0, critBonus: 0 });
    const alone = blessingCombatModsFor(PROFILE, side(me, [me, at(7, 7)]));
    expect(alone).toMatchObject({ defBonus: 0, avoidBonus: 15, critBonus: 10 });
  });
});

describe('the board helpers and the accessory conditions they were lifted from', () => {
  it('countAdjacentAllies and hasAllyWithin skip self, the fallen and off-map units', () => {
    const me = at(4, 4);
    const allies = [me, at(4, 5), at(5, 5), at(4, 6), at(3, 4, { currentHP: 0 }), at(null, null)];
    expect(countAdjacentAllies(me, allies)).toBe(1);
    expect(hasAllyWithin(me, allies, 1)).toBe(true);
    expect(hasAllyWithin(me, [me, at(4, 6)], 1)).toBe(false);
    expect(hasAllyWithin(me, [me, at(4, 6)], 2)).toBe(true);
    expect(hasAllyWithin(me, [me, at(3, 4, { currentHP: 0 })], 3)).toBe(false);
    expect(countAdjacentAllies(me, undefined)).toBe(0);
    expect(hasAllyWithin(me, undefined, 2)).toBe(false);
  });

  // The accessory conditions go through the same helpers; pin their behaviour on the cases a
  // careless extraction changes (diagonal, exactly 2, exactly 3, the fallen, off the map, self).
  describe('isAccessoryConditionMet through getSkillCombatMods', () => {
    const base = (extra = {}) => ({
      name: 'Hero',
      faction: 'player',
      col: 4,
      row: 4,
      currentHP: 20,
      stats: { HP: 20, STR: 10, MAG: 0, SKL: 8, SPD: 8, DEF: 6, RES: 4, LCK: 5 },
      weapon: null,
      skills: [],
      ...extra,
    });
    const foe = base({ name: 'Foe', faction: 'enemy', col: 5, row: 4 });
    const mods = (condition, allies) => {
      const unit = base({ accessory: { combatEffects: { atkBonus: 3, condition } } });
      return getSkillCombatMods(unit, foe, [unit, ...allies], [foe], [], { name: 'Plain' }, true)
        .atkBonus;
    };

    it('adjacent_ally: cardinal only, living, on the map', () => {
      expect(mods('adjacent_ally', [base({ name: 'N', col: 4, row: 3 })])).toBe(3);
      expect(mods('adjacent_ally', [base({ name: 'D', col: 5, row: 5 })])).toBe(0);
      expect(mods('adjacent_ally', [base({ name: 'Far', col: 4, row: 6 })])).toBe(0);
      expect(mods('adjacent_ally', [base({ name: 'X', col: 4, row: 3, currentHP: 0 })])).toBe(0);
      expect(mods('adjacent_ally', [base({ name: 'Off', col: undefined, row: undefined })])).toBe(
        0,
      );
      expect(mods('adjacent_ally', [])).toBe(0);
    });

    it('no_ally_within_2: Manhattan 2 breaks it, 3 does not, the fallen and absent do not', () => {
      expect(mods('no_ally_within_2', [])).toBe(3);
      expect(mods('no_ally_within_2', [base({ name: 'Two', col: 4, row: 6 })])).toBe(0);
      expect(mods('no_ally_within_2', [base({ name: 'Diag', col: 5, row: 5 })])).toBe(0);
      expect(mods('no_ally_within_2', [base({ name: 'Three', col: 4, row: 7 })])).toBe(3);
      expect(mods('no_ally_within_2', [base({ name: 'Knight', col: 5, row: 6 })])).toBe(3);
      expect(mods('no_ally_within_2', [base({ name: 'D', col: 4, row: 5, currentHP: 0 })])).toBe(3);
      expect(mods('no_ally_within_2', [base({ name: 'Off', col: null, row: null })])).toBe(3);
    });
  });
});

describe('parsers and the validator', () => {
  it('parse the shipped params and drop do-nothing ones', () => {
    expect(parseAdjacentAllyDefBonus(PHALANX)).toEqual(PHALANX);
    expect(parseIsolatedCombatBonus(DUELIST)).toEqual(DUELIST);
    expect(parseIsolatedCombatBonus({ radius: 2, critBonus: 5 })).toEqual({
      radius: 2,
      avoidBonus: 0,
      critBonus: 5,
    });
    for (const bad of [
      null,
      [],
      {},
      { perAlly: 0, max: 3 },
      { perAlly: 1, max: 0 },
      { perAlly: -1, max: 3 },
      { perAlly: 1.5, max: 3 },
      { perAlly: '1', max: 3 },
      { perAlly: 2, max: 1 },
    ])
      expect(parseAdjacentAllyDefBonus(bad), JSON.stringify(bad)).toBeNull();
    for (const bad of [
      null,
      {},
      { radius: 0, avoidBonus: 15 },
      { radius: 2 },
      { radius: 2, avoidBonus: 0, critBonus: 0 },
      { radius: 2, avoidBonus: -5, critBonus: 10 },
      { radius: 2.5, avoidBonus: 5 },
      { radius: 2, avoidBonus: 'x' },
    ])
      expect(parseIsolatedCombatBonus(bad), JSON.stringify(bad)).toBeNull();
  });

  it('the readers ignore a hand-edited entry rather than paying it', () => {
    const me = at(3, 3);
    expect(adjacentAllyDefBonus([{ perAlly: -1, max: 3 }, { perAlly: 1 }], me, [at(2, 3)])).toBe(0);
    expect(isolatedCombatBonus([{ radius: 0, avoidBonus: 9 }], me, [])).toEqual({
      avoidBonus: 0,
      critBonus: 0,
    });
    expect(adjacentAllyDefBonus(undefined, me, [at(2, 3)])).toBe(0);
    expect(isolatedCombatBonus(undefined, me, [])).toEqual({ avoidBonus: 0, critBonus: 0 });
  });

  function withBoon(type, params) {
    const config = structuredClone(data.blessings);
    const row = config.blessings.find((b) => b.id === 'iron_oath');
    row.boons = [{ type, params }];
    return validateBlessingsConfig(config);
  }

  it('the shipped cards validate', () => {
    expect(validateBlessingsConfig(data.blessings).errors).toEqual([]);
    const ids = data.blessings.blessings.map((b) => b.id);
    expect(ids.slice(-2)).toEqual(['phalanx_rite', 'duelists_creed']);
  });

  it('the validator refuses a Phalanx Rite that would do nothing', () => {
    expect(withBoon('adjacent_ally_def_bonus', PHALANX).errors).toEqual([]);
    for (const bad of [
      { perAlly: 0, max: 3 },
      { perAlly: 1, max: 0 },
      { perAlly: 1 },
      { perAlly: 1.5, max: 3 },
      { perAlly: 3, max: 2 },
    ])
      expect(withBoon('adjacent_ally_def_bonus', bad).valid, JSON.stringify(bad)).toBe(false);
  });

  it("the validator refuses a Duelist's Creed that would do nothing", () => {
    expect(withBoon('isolated_combat_bonus', DUELIST).errors).toEqual([]);
    for (const bad of [
      { radius: 0, avoidBonus: 15, critBonus: 10 },
      { radius: 2 },
      { radius: 2, avoidBonus: 0, critBonus: 0 },
      { radius: 2, avoidBonus: -1, critBonus: 10 },
      { radius: 1.5, avoidBonus: 15 },
    ])
      expect(withBoon('isolated_combat_bonus', bad).valid, JSON.stringify(bad)).toBe(false);
  });
});

describe('the run holds the cards', () => {
  function runWith(ids) {
    const rm = new RunManager(loadGameData());
    rm.startRun();
    rm.activeBlessings = ids;
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    return rm;
  }

  it('a run with neither card has empty lists in its profile', () => {
    const profile = runWith([]).getBlessingCombatProfile();
    expect(profile.adjacentAllyDef).toEqual([]);
    expect(profile.isolated).toEqual([]);
  });

  it('reads both cards from the data rows', () => {
    const profile = runWith(['phalanx_rite', 'duelists_creed']).getBlessingCombatProfile();
    expect(profile.adjacentAllyDef).toEqual([PHALANX]);
    expect(profile.isolated).toEqual([DUELIST]);
  });

  it('keeps them through a save and load, and still pays after it', () => {
    const rm = runWith(['phalanx_rite', 'duelists_creed']);
    const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), loadGameData());
    expect(restored.blessingRuntimeModifiers.adjacentAllyDefBonuses).toEqual([PHALANX]);
    expect(restored.blessingRuntimeModifiers.isolatedCombatBonuses).toEqual([DUELIST]);
    const me = at(3, 3);
    const mods = blessingCombatModsFor(
      restored.getBlessingCombatProfile(),
      side(me, [me, at(3, 4)]),
    );
    expect(mods.defBonus).toBe(1);
    const lone = blessingCombatModsFor(restored.getBlessingCombatProfile(), side(me, [me]));
    expect([lone.avoidBonus, lone.critBonus]).toEqual([15, 10]);
  });

  it('a save from before the cards loads with empty lists, and a damaged one drops its junk', () => {
    const rm = runWith([]);
    const json = rm.toJSON();
    delete json.blessingRuntimeModifiers.adjacentAllyDefBonuses;
    delete json.blessingRuntimeModifiers.isolatedCombatBonuses;
    const old = RunManager.fromJSON(json, loadGameData());
    expect(old.blessingRuntimeModifiers.adjacentAllyDefBonuses).toEqual([]);
    expect(old.blessingRuntimeModifiers.isolatedCombatBonuses).toEqual([]);

    const damaged = rm.toJSON();
    damaged.blessingRuntimeModifiers.adjacentAllyDefBonuses = [
      PHALANX,
      { perAlly: 'x', max: 3 },
      null,
    ];
    damaged.blessingRuntimeModifiers.isolatedCombatBonuses = 'oops';
    const restored = RunManager.fromJSON(damaged, loadGameData());
    expect(restored.blessingRuntimeModifiers.adjacentAllyDefBonuses).toEqual([PHALANX]);
    expect(restored.blessingRuntimeModifiers.isolatedCombatBonuses).toEqual([]);
  });

  it('the handler skips malformed params and records why (the card is not silently half-applied)', () => {
    const rm = runWith([]);
    rm.blessingHistory = [];
    rm._applySingleRunStartBlessingEffect('x', { type: 'adjacent_ally_def_bonus', params: {} });
    rm._applySingleRunStartBlessingEffect('x', {
      type: 'isolated_combat_bonus',
      params: { radius: 2 },
    });
    expect(rm.blessingRuntimeModifiers.adjacentAllyDefBonuses).toEqual([]);
    expect(rm.blessingRuntimeModifiers.isolatedCombatBonuses).toEqual([]);
    expect(rm.blessingHistory.map((r) => r.details?.reason)).toEqual([
      'invalid_adjacent_ally_def_bonus_params',
      'invalid_isolated_combat_bonus_params',
    ]);
  });

  it('taking a card twice (a second grant) adds a second entry', () => {
    const rm = runWith(['phalanx_rite']);
    rm._applySingleRunStartBlessingEffect('phalanx_rite', {
      type: 'adjacent_ally_def_bonus',
      params: PHALANX,
    });
    expect(rm.getBlessingCombatProfile().adjacentAllyDef).toEqual([PHALANX, PHALANX]);
  });
});

describe('the scene, the harness and the forecast read one board', () => {
  const body = { HP: 40, STR: 12, MAG: 0, SKL: 9, SPD: 9, DEF: 7, RES: 3, LCK: 5, MOV: 5 };
  const sword = () => ({
    name: 'Test Blade',
    type: 'Sword',
    might: 8,
    hit: 80,
    crit: 0,
    weight: 5,
    range: '1',
    special: '',
  });
  const makeUnit = (name, faction, col, row) => {
    const weapon = sword();
    return {
      name,
      level: 5,
      tier: 'base',
      faction,
      col,
      row,
      xp: 0,
      currentHP: 40,
      stats: { ...body },
      moveType: 'Infantry',
      className: 'Myrmidon',
      growths: {},
      weaponRank: 'Prof',
      weapon,
      inventory: [weapon],
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
      accessory: null,
      affixes: [],
    };
  };

  function runWith(ids) {
    const rm = new RunManager(loadGameData());
    rm.startRun();
    rm.activeBlessings = ids;
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    return rm;
  }

  function sceneCtx(run, units) {
    const scene = journeyBattleScene(run, data);
    scene.runManager = run;
    Math.random = () => 0.5;
    Object.assign(scene.grid, {
      fogEnabled: false,
      getMoveCost: () => 1,
      getTerrainAt: () => data.terrain.find((t) => t.name === 'Plain'),
    });
    scene.playerUnits = units.filter((u) => u.faction === 'player');
    scene.enemyUnits = units.filter((u) => u.faction === 'enemy');
    scene.npcUnits = units.filter((u) => u.faction === 'npc');
    rendering(scene, 0);
    return (a, d) => scene.buildSkillCtx(a, d);
  }

  function harnessCtx(run, units) {
    const battle = new HeadlessBattle(structuredClone(data), { act: 'act1', objective: 'rout' });
    battle.turnManager = { turnNumber: 1 };
    battle.runManager = run;
    battle.playerUnits = units.filter((u) => u.faction === 'player');
    battle.enemyUnits = units.filter((u) => u.faction === 'enemy');
    battle.npcUnits = units.filter((u) => u.faction === 'npc');
    battle.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      getTerrainAt: () => ({ name: 'Plain' }),
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    return (a, d) => battle._buildSkillCtx(a, d);
  }

  const pick = (mods) => ({
    avoid: mods.avoidBonus,
    def: mods.defBonus,
    crit: mods.critBonus,
  });

  // One board: Edric at (3,3) fights the foe at (4,3), the foe beside him (a melee foe always is).
  // His army: north, south and west of him (three cardinal neighbours) plus one on a diagonal.
  const phalanxBoard = () => {
    const edric = makeUnit('Edric', 'player', 3, 3);
    const foe = makeUnit('Foe', 'enemy', 4, 3);
    const guards = [
      makeUnit('North', 'player', 3, 2),
      makeUnit('South', 'player', 3, 4),
      makeUnit('West', 'player', 2, 3),
      makeUnit('Diagonal', 'player', 2, 2),
    ];
    return { edric, foe, units: [edric, foe, ...guards] };
  };
  // Edric alone at (3,3): the only ally is three tiles off, a foe stands beside him.
  const duelBoard = () => {
    const edric = makeUnit('Edric', 'player', 3, 3);
    const foe = makeUnit('Foe', 'enemy', 4, 3);
    const second = makeUnit('Second', 'enemy', 3, 2);
    const ally = makeUnit('Far', 'player', 6, 3);
    return { edric, foe, units: [edric, foe, second, ally] };
  };

  for (const [label, build] of [
    ['the scene', sceneCtx],
    ['the harness', harnessCtx],
  ]) {
    it(`${label}: Phalanx Rite pays +3 to an attacker with three neighbours, not four (diagonal and foe uncounted)`, () => {
      const { edric, foe, units } = phalanxBoard();
      const ctx = build(runWith(['phalanx_rite']), units)(edric, foe);
      expect(pick(ctx.atkMods)).toEqual({ avoid: 0, def: 3, crit: 0 });
      expect(pick(ctx.defMods)).toEqual({ avoid: 0, def: 0, crit: 0 });
    });

    it(`${label}: Phalanx Rite pays the defender too`, () => {
      const { edric, foe, units } = phalanxBoard();
      const ctx = build(runWith(['phalanx_rite']), units)(foe, edric);
      expect(pick(ctx.atkMods)).toEqual({ avoid: 0, def: 0, crit: 0 });
      expect(pick(ctx.defMods)).toEqual({ avoid: 0, def: 3, crit: 0 });
    });

    it(`${label}: a fallen neighbour stops paying`, () => {
      const { edric, foe, units } = phalanxBoard();
      units.find((u) => u.name === 'North').currentHP = 0;
      const ctx = build(runWith(['phalanx_rite']), units)(edric, foe);
      expect(ctx.atkMods.defBonus).toBe(2);
    });

    it(`${label}: Duelist's Creed pays a unit whose nearest ally is three tiles away, with foes at its elbow`, () => {
      const { edric, foe, units } = duelBoard();
      const ctx = build(runWith(['duelists_creed']), units)(edric, foe);
      expect(pick(ctx.atkMods)).toEqual({ avoid: 15, def: 0, crit: 10 });
      const back = build(runWith(['duelists_creed']), units)(foe, edric);
      expect(pick(back.defMods)).toEqual({ avoid: 15, def: 0, crit: 10 });
      expect(pick(back.atkMods)).toEqual({ avoid: 0, def: 0, crit: 0 });
    });

    it(`${label}: Duelist's Creed stops when the ally steps to two tiles`, () => {
      const { edric, foe, units } = duelBoard();
      units.find((u) => u.name === 'Far').col = 5;
      const ctx = build(runWith(['duelists_creed']), units)(edric, foe);
      expect(pick(ctx.atkMods)).toEqual({ avoid: 0, def: 0, crit: 0 });
    });

    it(`${label}: a green NPC ally beside the unit neither pays Phalanx nor breaks the duel`, () => {
      const edric = makeUnit('Edric', 'player', 3, 3);
      const foe = makeUnit('Foe', 'enemy', 4, 3);
      const villager = makeUnit('Villager', 'npc', 3, 4);
      const ctx = build(runWith(['phalanx_rite', 'duelists_creed']), [edric, foe, villager])(
        edric,
        foe,
      );
      expect(pick(ctx.atkMods)).toEqual({ avoid: 15, def: 0, crit: 10 });
    });

    it(`${label}: an enemy gets nothing from either card, crowded or alone`, () => {
      const { edric, foe, units } = phalanxBoard();
      units.push(makeUnit('Foe2', 'enemy', 5, 3), makeUnit('Foe3', 'enemy', 4, 2));
      const ctx = build(runWith(['phalanx_rite', 'duelists_creed']), units)(foe, edric);
      expect(pick(ctx.atkMods)).toEqual({ avoid: 0, def: 0, crit: 0 });
    });
  }

  it('the scene and the harness give identical mods for the same boards', () => {
    for (const board of [phalanxBoard, duelBoard]) {
      const ids = ['phalanx_rite', 'duelists_creed'];
      const a = board();
      const b = board();
      const scene = sceneCtx(runWith(ids), a.units)(a.edric, a.foe);
      const harness = harnessCtx(runWith(ids), b.units)(b.edric, b.foe);
      expect(pick(scene.atkMods)).toEqual(pick(harness.atkMods));
      expect(pick(scene.defMods)).toEqual(pick(harness.defMods));
    }
  });

  it('the forecast shows the bonus the combat uses: foe damage down by the DEF, its hit down by the Avoid, Crit up', () => {
    const forecastFrom = (ids, board) => {
      const { edric, foe, units } = board();
      const ctx = sceneCtx(runWith(ids), units)(edric, foe);
      return getCombatForecast(edric, edric.weapon, foe, foe.weapon, 1, null, null, ctx);
    };

    const plain = forecastFrom([], phalanxBoard);
    const phalanx = forecastFrom(['phalanx_rite'], phalanxBoard);
    // The foe's counter against Edric loses exactly the three DEF.
    expect(plain.defender.damage - phalanx.defender.damage).toBe(3);
    expect(phalanx.attacker.damage).toBe(plain.attacker.damage);

    const duelPlain = forecastFrom([], duelBoard);
    const duel = forecastFrom(['duelists_creed'], duelBoard);
    expect(duelPlain.defender.hit - duel.defender.hit).toBe(15);
    expect(duel.attacker.crit - duelPlain.attacker.crit).toBe(10);
    expect(duel.attacker.hit).toBe(duelPlain.attacker.hit);
  });

  it('the forecast damage matches the hand figure: STR + Might against DEF plus Phalanx', () => {
    const { edric, foe, units } = phalanxBoard();
    const ctx = sceneCtx(runWith(['phalanx_rite']), units)(edric, foe);
    const forecast = getCombatForecast(edric, edric.weapon, foe, foe.weapon, 1, null, null, ctx);
    // 40 HP, the foe's STR 12 + Might 8 against DEF 7 + 3 = 10 per hit.
    expect(forecast.defender.damage).toBe(12 + 8 - (7 + 3));
  });
});
