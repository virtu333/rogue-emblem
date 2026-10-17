// Omens (engine/Omens.js, docs/specs/omens.md): opt-in challenge modifiers summed into Heat. Real
// RunManager on the shipped data; each test names the realistic failure it catches. Expected
// values are read from difficulty.json's rung and Omen entries, never from the code under test.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import {
  bestHeatOn,
  createOmensRecord,
  heatVictoryMilestone,
  runHeat,
  validateOmensConfig,
} from '../src/engine/Omens.js';
import { chooseRuinsPath, ruinsReviveBlock } from '../src/engine/RuinsCommands.js';
import { mergeRunRecords } from '../src/engine/RunRecords.js';

const data = loadGameData();
const omen = (id) => data.difficulty.omens.list.find((o) => o.id === id);
const rankEffects = (id, rank) => omen(id).ranks[rank - 1].effects;
const mode = (id) => data.difficulty.modes[id];

function run(omens, { difficultyId = 'lunatic', runSeed = 7 } = {}) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed, applyBlessingsAtStart: false, difficultyId, omens });
  return rm;
}
const battleNode = (rm, pick = (n) => n.type === 'battle') =>
  rm.nodeMap.nodes.find((n) => n.battleParams && pick(n));
const roundTrip = (rm) => RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);

describe('Omens data', () => {
  it('the shipped list validates, and every rank only ever makes the run harder', () => {
    // Failure: a data edit gives an Omen a boon (a gold rise, a stat cut) or breaks a rank.
    const result = validateOmensConfig(data.difficulty.omens);
    expect(result.errors).toEqual([]);
    expect(data.difficulty.omens.rungs).toEqual(['hard', 'lunatic']);
  });

  it('the validator refuses a boon, an unknown effect and a rank that costs no more heat', () => {
    // Failure: the validator waves through an Omen that helps the player.
    const base = (effects, heat = 1) => ({
      rungs: ['lunatic'],
      list: [{ id: 'x', name: 'X', ranks: [{ heat, text: 'X.', effects }] }],
    });
    expect(validateOmensConfig(base({ goldMultiplier: 1.2 })).valid).toBe(false);
    expect(validateOmensConfig(base({ enemyStatBonus: -1 })).valid).toBe(false);
    expect(validateOmensConfig(base({ visionDelta: 1 })).valid).toBe(false);
    expect(validateOmensConfig(base({ enemyHp: 3 })).valid).toBe(false);
    const flat = base({ enemyStatBonus: 1 });
    flat.list[0].ranks.push({ heat: 1, text: 'Y.', effects: { enemyStatBonus: 2 } });
    expect(validateOmensConfig(flat).valid).toBe(false);
    expect(validateOmensConfig(base({ enemyStatBonus: 1 })).valid).toBe(true);
  });
});

describe('Choosing Omens', () => {
  it('Heat is the sum of the chosen ranks’ heat; unknown ids and rank 0 drop out', () => {
    // Failure: Heat counts every rank up to the chosen one twice, or keeps a stale id.
    const record = createOmensRecord(
      { hardened: 2, iron_tide: 1, not_an_omen: 3, grave_road: 0 },
      data,
      'lunatic',
    );
    expect(record.ranks).toEqual({ hardened: 2, iron_tide: 1 });
    expect(record.heat).toBe(omen('hardened').ranks[1].heat + omen('iron_tide').ranks[0].heat);
    // A rank past the top is the top.
    expect(createOmensRecord({ hardened: 9 }, data, 'lunatic').ranks).toEqual({
      hardened: omen('hardened').ranks.length,
    });
  });

  it('Omens are only for Nightfall and Black Sun; an empty choice is no Omens', () => {
    // Failure: First Light or Dusk takes Omens (the picker is closed there), or {} reads as Heat 0.
    expect(run({ hardened: 1 }, { difficultyId: 'normal' }).omens).toBeNull();
    expect(run({ hardened: 1 }, { difficultyId: 'dusk' }).omens).toBeNull();
    expect(run({}).omens).toBeNull();
    expect(run({ hardened: 1 }, { difficultyId: 'hard' }).omens.heat).toBe(
      omen('hardened').ranks[0].heat,
    );
  });

  it('a run without Omens plays exactly as before', () => {
    // Failure: the overlay or the Heat params touch a run that chose none.
    const a = run(null);
    const b = run({});
    expect(a.difficultyModifiers).toEqual(b.difficultyModifiers);
    expect(a.getBattleParams(battleNode(a))).toEqual(b.getBattleParams(battleNode(b)));
    expect(a.toJSON().omens).toBeUndefined();
  });
});

describe('Lever Omens reach the battle', () => {
  it('Hardened and Iron Tide add to the rung and to its Act I override', () => {
    // Failure: the overlay changes the rung's value but Black Sun's Act I override still wins.
    const rm = run({ hardened: 2, iron_tide: 2 });
    const stat = rankEffects('hardened', 2).enemyStatBonus;
    const count = rankEffects('iron_tide', 2).enemyCountBonus;
    const act1 = mode('lunatic').actOverrides.act1;
    const params = rm.getBattleParams(battleNode(rm));
    expect(params.enemyStatBonus).toBe(act1.enemyStatBonus + stat);
    expect(params.enemyCountBonus).toBe(act1.enemyCountBonus + count);
    // A later act reads the rung's own value plus the Omen.
    expect(rm.getBattleDifficultyModifier('enemyStatBonus', 'act2')).toBe(
      mode('lunatic').enemyStatBonus + stat,
    );
  });

  it('Keen Foes gives every foe a skill chance of 1, never above', () => {
    // Failure: the chance passes 1 (a sim or the draw reads > 100%).
    const params = run({ keen_foes: 1 }).getBattleParams(battleNode(run({ keen_foes: 1 })));
    expect(params.enemySkillChance).toBe(1);
  });

  it('Short Fuse shortens the par a new map locks; Lean Purse and Dear Market scale the rung', () => {
    // Failure: par inflation goes below zero, or the multipliers replace the rung's instead of scaling it.
    const rm = run({ short_fuse: 2, lean_purse: 2, dear_market: 2 });
    const params = rm.getBattleParams(battleNode(rm));
    expect(params.parInflation).toBe(
      Math.max(0, mode('lunatic').parInflation + rankEffects('short_fuse', 2).parInflation),
    );
    expect(params.goldMultiplier).toBeCloseTo(
      mode('lunatic').goldMultiplier * rankEffects('lean_purse', 2).goldMultiplier,
    );
    expect(rm.getDifficultyModifier('shopPriceMultiplier', 1)).toBeCloseTo(
      mode('lunatic').shopPriceMultiplier * rankEffects('dear_market', 2).shopPriceMultiplier,
    );
  });

  it('Stone-hearted adds a stone to every boss kind and elite captains', () => {
    // Failure: the elite captain is left out (Echo's rule), or the table is replaced.
    const rm = run({ stone_hearted: 1 });
    const add = rankEffects('stone_hearted', 1).bossStones;
    const table = mode('lunatic').revivalStones;
    expect(rm.getBattleParams(battleNode(rm)).revivalStones).toEqual({
      actBoss: table.actBoss + add,
      emperor: table.emperor + add,
      lieutenant: table.lieutenant + add,
      eliteCaptain: table.eliteCaptain + add,
    });
  });

  it('Thin Ranks takes a deploy slot', () => {
    // Failure: the lever is set on the run but nothing reads it.
    expect(run({ thin_ranks: 1 }).getDeployBonus() - run(null).getDeployBonus()).toBe(
      rankEffects('thin_ranks', 1).deployLimitBonus,
    );
  });
});

describe('Run Omens', () => {
  it('Hunting Party hunts every battle but a boss’s', () => {
    // Failure: the wave lands on a boss map (a burden never does), or on nothing.
    const rm = run({ hunting_party: 1 });
    const wave = rankEffects('hunting_party', 1).huntedWave;
    expect(rm.getBattleParams(battleNode(rm)).huntedWave).toEqual(wave);
    const boss = rm.nodeMap.nodes.find((n) => n.type === 'boss');
    expect(rm.getBattleParams(boss).huntedWave).toBeUndefined();
    expect(run(null).getBattleParams(battleNode(run(null))).huntedWave).toBeUndefined();
  });

  it('Marked Foes raises the affix chance and the most affixes a foe may carry', () => {
    // Failure: the extra affix slot never reaches AffixEngine (it reads eclipseAffix).
    const rm = run({ marked_foes: 2 });
    const effects = rankEffects('marked_foes', 2);
    const params = rm.getBattleParams(battleNode(rm));
    expect(params.affixChanceMultiplier).toBe(effects.affixChanceMultiplier);
    expect(params.eclipseAffix.extraMaxAffixes).toBe(effects.affixMaxBonus);
    expect(params.eclipseAffix.guaranteedCount).toBe(0);
  });

  it('Spent Thread starts the run with fewer Vision charges, never below 0', () => {
    // Failure: the cut is applied to every act's grant, or goes negative.
    const plain = run(null).visionChargesRemaining;
    for (const rank of [1, 2, 3]) {
      const rm = run({ spent_thread: rank });
      expect(rm.visionChargesRemaining).toBe(
        Math.max(0, plain + rankEffects('spent_thread', rank).visionDelta),
      );
    }
  });

  it('Long Night makes each victory’s shadow grow, and the carry survives a reload', () => {
    // Failure: the faster Eclipse is lost on load (the run's carry is zeroed with no blessing).
    const rm = run({ long_night: 2 });
    const share = rankEffects('long_night', 2).shadowGainDelta;
    expect(rm._scaledShadowGain(8).gain).toBe(8 * (1 + share));
    const back = roundTrip(rm);
    expect(back._scaledShadowGain(8).gain).toBe(8 * (1 + share));
  });

  it('Grave Road closes the Ruins’ revive', () => {
    // Failure: the Ruins still hand back the fallen.
    const rm = run({ grave_road: 1 });
    const ruinsId = rm.nodeMap.nodes.find((n) => n.type === 'ruins').id;
    chooseRuinsPath(rm, ruinsId, 'rest');
    const fallen = { ...rm.roster[1] };
    expect(ruinsReviveBlock(rm, ruinsId, fallen)).toMatch(/Grave Road/);
  });

  it('The Rite Listens starts the Rite higher', () => {
    // Failure: the delta is read from the wrong key and the Rite starts where it would.
    const plain = run(null)._riteStart();
    expect(run({ rite_listens: 1 })._riteStart() - plain).toBe(
      rankEffects('rite_listens', 1).riteStartDelta,
    );
  });
});

describe('Saving and records', () => {
  it('a save keeps the Omens, its modifiers and Heat, and is held from older clients', () => {
    // Failure: a reload drops run.omens (Grave Road reopens) or an older client loads it.
    const rm = run({ hardened: 1, grave_road: 1, hunting_party: 1 });
    const saved = rm.toJSON();
    expect(saved.requiresCapabilities).toContain('omens');
    const back = roundTrip(rm);
    expect(back.omens).toEqual(rm.omens);
    expect(back.difficultyModifiers).toEqual(rm.difficultyModifiers);
    expect(runHeat(back)).toBe(rm.omens.heat);
  });

  it('a won run’s Heat becomes a milestone; the best per rung is read back', () => {
    // Failure: a loss records Heat, or another rung's record counts.
    const rm = run({ hardened: 3 });
    const heat = omen('hardened').ranks[2].heat;
    expect(heatVictoryMilestone(rm, { result: 'defeat' })).toBeNull();
    expect(heatVictoryMilestone(run(null), { result: 'victory' })).toBeNull();
    const mark = heatVictoryMilestone(rm, { result: 'victory' });
    expect(mark).toBe(`heat:lunatic:${heat}`);
    expect(bestHeatOn([mark, 'heat:lunatic:2', 'heat:hard:40', 'beatGame'], 'lunatic')).toBe(heat);
    expect(bestHeatOn([], 'lunatic')).toBe(0);
  });

  it('a victory record keeps its Heat through the archive merge', () => {
    // Failure: cleanRecord strips the new field, so the record forgets the Heat.
    const record = { v: 2, id: 'r1', endedAt: 1, difficulty: 'lunatic', roster: [], heat: 9 };
    expect(mergeRunRecords([record])[0].heat).toBe(9);
    expect(mergeRunRecords([{ ...record, heat: undefined }])[0].heat).toBeUndefined();
  });
});
