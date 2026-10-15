// Lord recruit odds v2 (engine/LordRecruitChance.js, docs/specs/lord-recruit-odds.md): the
// chance a recruit node or a boss draft holds a lord falls as the army's lords grow. A run from
// before v2 keeps the flat chance (a lord its route card shows never vanishes on an update), a
// card never changes as the act goes on, and a fallen lord still counts.
import { afterEach, describe, expect, it } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import {
  LORD_RECRUIT_ODDS_VERSION,
  countRunLords,
  lordRecruitChance,
  sanitizeLordRecruitOdds,
} from '../src/engine/LordRecruitChance.js';
import { generateBossRecruitCandidates } from '../src/engine/BossRecruitSystem.js';
import { prepareBossRecruit } from '../src/engine/PendingBossRecruit.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const SEEDS = Array.from({ length: 80 }, (_, i) => i + 1);
const realRandom = Math.random;

afterEach(() => {
  Math.random = realRandom;
});

function run(seed, lordRecruitChanceBonus = 0.15) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId: 'normal', applyBlessingsAtStart: false });
  rm.metaEffects = { ...(rm.metaEffects || {}), lordRecruitChanceBonus };
  return rm;
}

/** A lord in the army: a starting lord's copy under another lord's name. */
function lordNamed(rm, name) {
  const unit = structuredClone(rm.roster.find((u) => u.isLord));
  unit.name = name;
  unit.uid = `test-${name}`;
  return unit;
}

function recruitNodes(rm) {
  return rm.nodeMap.nodes
    .filter((n) => n.type === 'recruit')
    .sort((a, b) => a.row - b.row || a.col - b.col);
}

describe('lordRecruitChance', () => {
  it('keeps the flat chance for a run with no v2 record', () => {
    expect(lordRecruitChance({ source: 'node' })).toBeCloseTo(0.15);
    expect(lordRecruitChance({ source: 'boss' })).toBeCloseTo(0.25);
    expect(lordRecruitChance({ source: 'node', bonus: 0.24 })).toBeCloseTo(0.39);
    // A flat run at 6 lords is not cut.
    expect(lordRecruitChance({ source: 'node', bonus: 0.24, odds: null })).toBeCloseTo(0.39);
    expect(lordRecruitChance({ source: 'boss', bonus: 2 })).toBe(1);
    expect(lordRecruitChance({ source: 'boss', bonus: -1 })).toBe(0);
    expect(lordRecruitChance({ source: 'other' })).toBe(0);
  });

  it('falls with the lord count under v2: all of it to 3 lords, then a half, a quarter, a tenth', () => {
    const at = (lordCount, source = 'node', bonus = 0.15) =>
      lordRecruitChance({ source, bonus, odds: { v: 2, lordCount } });
    expect(at(2)).toBeCloseTo(0.3);
    expect(at(3)).toBeCloseTo(0.3);
    expect(at(4)).toBeCloseTo(0.15);
    expect(at(5)).toBeCloseTo(0.075);
    expect(at(6)).toBeCloseTo(0.03);
    expect(at(7)).toBe(0);
    expect(at(4, 'boss', 0)).toBeCloseTo(0.125);
    expect(at(6, 'boss', 0.15)).toBeCloseTo(0.04);
    // A record of another version is not v2: the flat chance.
    expect(
      lordRecruitChance({ source: 'node', bonus: 0, odds: { v: 3, lordCount: 6 } }),
    ).toBeCloseTo(0.15);
  });

  it('counts each lord the run has had once, the fallen included', () => {
    const roster = [
      { name: 'Edric', isLord: true },
      { name: 'Sera', isLord: true },
      { name: 'Gaspar' },
    ];
    expect(countRunLords(roster, [])).toBe(2);
    expect(countRunLords(roster, [{ name: 'Kira', isLord: true }, { name: 'Bram' }])).toBe(3);
    // A lord in both lists (a revival's copy) counts once.
    expect(countRunLords(roster, [{ name: 'Sera', isLord: true }])).toBe(2);
  });

  it('reads only a whole v2 record from a save', () => {
    expect(sanitizeLordRecruitOdds(undefined)).toBe(null);
    expect(sanitizeLordRecruitOdds({ v: 1, lordsAtActStart: 2 })).toBe(null);
    expect(sanitizeLordRecruitOdds({ v: 2 })).toBe(null);
    expect(sanitizeLordRecruitOdds({ v: 2, lordsAtActStart: -1 })).toBe(null);
    expect(sanitizeLordRecruitOdds({ v: 2, lordsAtActStart: 4 })).toEqual({
      v: 2,
      lordsAtActStart: 4,
    });
  });
});

describe('the run keeps its odds', () => {
  it('a new run follows v2 from its starting lords, and the record survives a save', () => {
    const rm = run(1);
    expect(rm.lordRecruitOdds).toEqual({ v: LORD_RECRUIT_ODDS_VERSION, lordsAtActStart: 2 });
    const loaded = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(loaded.lordRecruitOdds).toEqual({ v: 2, lordsAtActStart: 2 });
  });

  it('a save from before v2 keeps every lord its cards show, at any lord count', () => {
    let cut = 0;
    for (const seed of SEEDS) {
      const rm = run(seed);
      for (const name of ['Kira', 'Voss', 'Rowan', 'Astrid']) rm.roster.push(lordNamed(rm, name));
      // An old save: no record, written before v2.
      const saved = JSON.parse(JSON.stringify(rm.toJSON()));
      delete saved.lordRecruitOdds;
      const old = RunManager.fromJSON(saved, data);
      old.metaEffects = { ...(old.metaEffects || {}), lordRecruitChanceBonus: 0.15 };
      expect(old.lordRecruitOdds).toBe(null);
      // The same run under v2 at 6 lords.
      rm.lordRecruitOdds = { v: 2, lordsAtActStart: 6 };
      for (const node of recruitNodes(rm)) {
        const flat = old.getRecruitNodeUnit(node);
        const v2 = rm.getRecruitNodeUnit(node);
        const flatChance = lordRecruitChance({ source: 'node', bonus: 0.15 });
        expect(old.getLordRecruitOdds('node', node)).toBe(null);
        // v2 only ever takes a lord away, and the old save keeps the flat roll.
        if (v2.isLord) expect(flat.isLord).toBe(true);
        if (flat.isLord && !v2.isLord) cut++;
        expect(flatChance).toBeCloseTo(0.3);
      }
    }
    expect(cut).toBeGreaterThan(0);
  });
});

describe('a recruit card never changes as the act goes on', () => {
  it('reads the lords at the act start plus the lord cards ahead of it on the map', () => {
    let laterCards = 0;
    for (const seed of SEEDS) {
      const rm = run(seed, 1); // every node a lord while the multiplier allows
      let ahead = 0;
      for (const node of recruitNodes(rm)) {
        expect(rm.getLordRecruitOdds('node', node)).toEqual({ v: 2, lordCount: 2 + ahead });
        if (ahead > 0) laterCards++;
        if (rm.getRecruitNodeUnit(node).isLord) ahead++;
      }
    }
    expect(laterCards).toBeGreaterThan(SEEDS.length);
  });

  it('taking a lord elsewhere in the act, or losing one, changes no other card', () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const rm = run(seed, 0.5);
      const nodes = recruitNodes(rm);
      const firstLordIdx = nodes.findIndex((n) => rm.getRecruitNodeUnit(n).isLord);
      if (firstLordIdx < 0 || firstLordIdx === nodes.length - 1) continue;
      const cards = nodes.map((n) => rm.getRecruitNodeUnit(n).isLord);
      // The first lord card is recruited, and a starting lord falls.
      const firstLord = rm.getRecruitNodeUnit(nodes[firstLordIdx]).unit;
      rm.roster.push(structuredClone(firstLord));
      rm.markNodeComplete(nodes[firstLordIdx].id);
      const sera = rm.roster.findIndex((u) => u.name === 'Sera');
      rm.fallenUnits.push(rm.roster.splice(sera, 1)[0]);
      nodes.forEach((n, i) => {
        if (i === firstLordIdx) return;
        expect(rm.getRecruitNodeUnit(n).isLord).toBe(cards[i]);
      });
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('the next act counts the lords the army begins it with, the fallen included', () => {
    const rm = run(3);
    rm.roster.push(lordNamed(rm, 'Kira'));
    rm.fallenUnits.push(lordNamed(rm, 'Voss'));
    rm.markNodeComplete(rm.nodeMap.bossNodeId);
    rm.advanceAct();
    expect(rm.currentAct).toBe('act2');
    expect(rm.lordRecruitOdds).toEqual({ v: 2, lordsAtActStart: 4 });
  });
});

describe('the boss draft', () => {
  // Every Math.random draw in the draft reads 0.05: under the flat 25% the lord slot is taken,
  // and under v2 at 6 lords (25% x 0.1 = 2.5%) it is not.
  const lordInDraft = (candidates) => candidates.some((c) => c.isLord);

  it('reads the lord count it is given', () => {
    const rm = run(4, 0);
    for (const name of ['Kira', 'Voss', 'Rowan', 'Astrid']) rm.roster.push(lordNamed(rm, name));
    const draft = (lordOdds) => {
      Math.random = () => 0.05;
      return generateBossRecruitCandidates('act1', rm.roster, data, {}, [], [], 4, { lordOdds });
    };
    expect(lordInDraft(draft(null))).toBe(true);
    expect(lordInDraft(draft({ v: 2, lordCount: 3 }))).toBe(true);
    expect(lordInDraft(draft({ v: 2, lordCount: 6 }))).toBe(false);
  });

  it("is rolled with the run's lords now, or flat for a save from before v2", () => {
    const draftFor = (rm) => {
      Math.random = () => 0.05;
      const candidates = prepareBossRecruit(rm, data);
      rm.pendingBossRecruit = null;
      return candidates;
    };
    const rm = run(5, 0);
    for (const name of ['Kira', 'Voss', 'Rowan', 'Astrid']) rm.roster.push(lordNamed(rm, name));
    expect(rm.getLordRecruitOdds('boss')).toEqual({ v: 2, lordCount: 6 });
    expect(lordInDraft(draftFor(rm))).toBe(false);
    rm.lordRecruitOdds = null;
    expect(lordInDraft(draftFor(rm))).toBe(true);
  });
});

describe("Hero's Call", () => {
  it('gives +5% a tier', () => {
    const heros = data.metaUpgrades.find((u) => u.id === 'heros_call');
    expect(heros.effects.map((e) => e.lordRecruitChanceBonus)).toEqual([0.05, 0.1, 0.15]);
    expect(heros.description).toBe('+5% lord recruit chance per tier');
  });
});
