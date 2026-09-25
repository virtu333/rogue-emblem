// The draft screens' content (src/ui/choiceContent.js): comparisons, cues,
// "for whom", tarot and banner copy. Pure: no DOM, no RNG, no mutation.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';
import { generateBossRecruitCandidates } from '../src/engine/BossRecruitSystem.js';
import { RunManager } from '../src/engine/RunManager.js';
import {
  CHOICE_STATS,
  ROSTER_ROLES,
  blessingCardContent,
  candidateCards,
  candidateCue,
  candidateStatBoard,
  difficultyBannerContent,
  growthHints,
  rewardForWhom,
  rosterGaps,
  unitLines,
  weaponMarks,
} from '../src/ui/choiceContent.js';
import { itemIconId } from '../src/ui/itemIcons.js';
import { generateModifierSummary } from '../src/engine/DifficultyEngine.js';

let data;
beforeAll(() => {
  data = loadGameData();
});
afterEach(() => vi.restoreAllMocks());

const stats = (o) => ({ HP: 20, STR: 5, MAG: 1, SKL: 5, SPD: 5, DEF: 5, RES: 1, LCK: 3, ...o });
function recruit(className, name = className, level = 5) {
  const cls = data.classes.find((c) => c.name === className);
  const unit = createRecruitUnit({ name, className, level }, cls, data.weapons, null, null, null, data.classes); // prettier-ignore
  unit.faction = 'player';
  return unit;
}

describe('candidateStatBoard', () => {
  it('marks the strict leader of each stat and scales bars to the draft', () => {
    const board = candidateStatBoard([
      { stats: stats({ STR: 9, SPD: 7 }) },
      { stats: stats({ STR: 4, SPD: 7 }) },
      { stats: stats({ STR: 6, SPD: 3 }) },
    ]);
    const str = board.map((b) => b.stats.find((r) => r.stat === 'STR'));
    expect(str.map((r) => r.best)).toEqual([true, false, false]);
    // Bars run against the draft's best (at least 10, so small numbers stay small).
    expect(str[0].ratio).toBeCloseTo(0.9);
    expect(str[1].ratio).toBeCloseTo(0.4);
    // A top value two candidates share is still "best"; one all share is not.
    const spd = board.map((b) => b.stats.find((r) => r.stat === 'SPD'));
    expect(spd.map((r) => r.best)).toEqual([true, true, false]);
    const def = board.map((b) => b.stats.find((r) => r.stat === 'DEF'));
    expect(def.every((r) => !r.best)).toBe(true);
    expect(board[0].stats.map((r) => r.stat)).toEqual(CHOICE_STATS);
  });
  it('has nothing to be best against with one candidate, and tolerates thin units', () => {
    const [only] = candidateStatBoard([{ stats: { HP: 20 } }]);
    expect(only.stats.every((r) => !r.best && r.value === 0 && r.ratio === 0)).toBe(true);
    expect(only.hp).toMatchObject({ current: 20, max: 20, fill: 1 });
    expect(candidateStatBoard(null)).toEqual([]);
  });
  it('shows current HP against max', () => {
    const [unit] = candidateStatBoard([{ stats: stats({ HP: 20 }), currentHP: 5 }]);
    expect(unit.hp.fill).toBeCloseTo(0.25);
  });
});

describe('growthHints', () => {
  it('names the two fastest growths of at least 40%', () => {
    expect(growthHints({ growths: { HP: 60, STR: 45, SPD: 70, LCK: 20 } })).toEqual(['SPD', 'HP']);
    expect(growthHints({ growths: { HP: 30, STR: 35 } })).toEqual([]);
    expect(growthHints({})).toEqual([]);
  });
  it('feeds the board', () => {
    const [b] = candidateStatBoard([{ stats: stats(), growths: { SPD: 70, SKL: 60 } }]);
    expect(b.stats.filter((r) => r.grows).map((r) => r.stat)).toEqual(['SKL', 'SPD']);
  });
});

describe('roster cue', () => {
  it('names the highest-priority gap a candidate fills, never pushy', () => {
    const roster = [recruit('Myrmidon', 'A'), recruit('Cleric', 'B')];
    const gaps = rosterGaps(roster);
    expect(gaps).not.toContain('healer');
    expect(gaps).toContain('flier');
    expect(candidateCue(recruit('Pegasus Knight'), roster)).toEqual({
      role: 'flier',
      text: 'Your army lacks a flier',
    });
    expect(candidateCue(recruit('Cleric', 'C'), roster)).toBeNull();
    expect(candidateCue(recruit('Myrmidon', 'D'), roster)).toBeNull();
  });
  it('orders roles healer first', () => {
    expect(ROSTER_ROLES[0].id).toBe('healer');
    // An empty army lacks everything; a mounted healer reads as the healer.
    const staffFlier = { moveType: 'Flying', proficiencies: [{ type: 'Staff', rank: 'Prof' }] };
    expect(candidateCue(staffFlier, [])?.role).toBe('healer');
  });
});

describe('weapon marks and lines', () => {
  it('turns proficiencies into rank marks', () => {
    expect(
      weaponMarks({
        proficiencies: [
          { type: 'Sword', rank: 'Mast' },
          { type: 'Staff', rank: 'Prof' },
        ],
      }),
    ).toEqual([
      { type: 'Sword', rank: 'M', label: 'Sword Master' },
      { type: 'Staff', rank: 'P', label: 'Staff Proficient' },
    ]);
  });
  it('reads trait text through TraitSystem and skills from the catalog', () => {
    const trait = data.traits[0];
    const skill = data.skills.find((s) => s.description);
    const lines = unitLines({ traits: [trait.id, 'missing'], skills: [skill.id, skill.id] }, data);
    expect(lines).toEqual([
      { kind: 'trait', id: trait.id, name: trait.name, text: trait.description },
      { kind: 'skill', id: skill.id, name: skill.name, text: skill.description },
    ]);
  });
});

describe('candidateCards', () => {
  it('builds every card from real boss recruit candidates without touching them', () => {
    const run = new RunManager(data, null);
    run.startRun({ difficultyId: 'normal' });
    const candidates = generateBossRecruitCandidates('act2', run.roster, data, {}, []);
    const units = candidates.map((c) => c.unit);
    const before = JSON.stringify(units);
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('presentation must not roll');
    });
    const cards = candidateCards(units, {
      roster: run.roster,
      gameData: data,
      temperamentOf: (u) => `T-${u.name}`,
    });
    random.mockRestore();
    expect(JSON.stringify(units)).toBe(before);
    expect(cards).toHaveLength(units.length);
    for (const [i, card] of cards.entries()) {
      expect(card.name).toBe(units[i].name);
      expect(card.className).toBe(units[i].className);
      expect(card.temperament).toBe(`T-${units[i].name}`);
      expect(card.board.stats).toHaveLength(CHOICE_STATS.length);
      expect(card.weapons.length).toBe(units[i].proficiencies.length);
    }
  });
  it('survives a failing temperament lookup and malformed units', () => {
    const [card] = candidateCards([{ name: 'Good', stats: { HP: 20 }, className: 'Fighter' }], {
      gameData: data,
      temperamentOf: () => {
        throw new Error('no voice data');
      },
    });
    expect(card).toMatchObject({ name: 'Good', temperament: null, lines: [], weapons: [] });
  });
});

describe('rewardForWhom', () => {
  function run(roster) {
    return { roster };
  }
  it('names the wielder who gains the most attack', () => {
    const a = recruit('Myrmidon', 'Ayla');
    const b = recruit('Mercenary', 'Brom');
    b.stats.STR += 6;
    const steel = structuredClone(data.weapons.find((w) => w.name === 'Steel Sword'));
    const result = rewardForWhom({ type: 'weapon', item: steel }, run([a, b]));
    expect(result.who).toBe('For Brom');
    expect(result.detail).toMatch(/^Atk \d+ → \d+ · 2 can wield$/);
    expect(result.tone).toBe('good');
  });
  it('says plainly when no one can wield it', () => {
    const lance = structuredClone(
      data.weapons.find((w) => w.type === 'Lance' && w.tier === 'Silver'),
    );
    const result = rewardForWhom({ type: 'weapon', item: lance }, run([recruit('Myrmidon')]));
    expect(result).toMatchObject({ who: 'No one can wield it', tone: 'bad' });
  });
  it('covers staves, forge stones, supplies, boosters, gold and skipping', () => {
    const cleric = recruit('Cleric', 'Mira');
    const heal = structuredClone(data.weapons.find((w) => w.type === 'Staff' && w.name === 'Heal'));
    expect(rewardForWhom({ type: 'weapon', item: heal }, run([cleric])).who).toBe('For Mira');
    const myr = recruit('Myrmidon', 'Ayla');
    const stone = { type: 'Whetstone', name: 'Might Whetstone', forgeStat: 'might' };
    expect(rewardForWhom({ type: 'forge', item: stone }, run([myr])).who).toMatch(/can take it$/);
    const booster = data.consumables.find((c) => c.effect === 'statBoost');
    expect(rewardForWhom({ type: 'consumable', item: booster }, run([myr])).who).toBe(
      'Any unit · permanent',
    );
    expect(rewardForWhom({ type: 'gold', goldAmount: 100, xpAmount: 25 }, run([])).detail).toBe(
      '+25 XP to every unit',
    );
    expect(rewardForWhom({ type: 'skip' }, run([])).who).toBe('Your vault');
    expect(rewardForWhom({ type: 'accessory', item: data.accessories[0] }, run([])).who).toBe(
      'Any unit',
    );
  });
});

describe('blessings and difficulty', () => {
  it('reads a blessing as a tarot card', () => {
    const b = data.blessings.blessings.find((x) => x.tier === 3);
    const card = blessingCardContent({ ...b, rolledCost: { label: ' -20% battle gold ' } });
    expect(card).toMatchObject({
      name: b.name,
      tier: 3,
      numeral: 'III',
      boon: b.description,
      cost: '-20% battle gold',
      lore: b.lore,
    });
    expect(blessingCardContent({ name: 'X', tier: 1 }).cost).toBe('');
    expect(blessingCardContent(null)).toBeNull();
  });
  it("names a pact blessing's fixed price as a pact on the card", () => {
    const tome = data.blessings.blessings.find((x) => x.pact);
    expect(tome).toBeTruthy();
    const card = blessingCardContent({ ...tome, rolledCost: { label: tome.pact.label } });
    expect(card).toMatchObject({ pact: true, costLabel: 'Pact', cost: tome.pact.label });
    const plain = data.blessings.blessings.find((x) => !x.pact && x.tier >= 2);
    expect(blessingCardContent({ ...plain, rolledCost: { label: 'x' } }).costLabel).toBe('Cost');
  });
  it('splits a mode into what grows harder and what pays back', () => {
    const mode = data.difficulty.modes.lunatic;
    const summary = generateModifierSummary(mode);
    const content = difficultyBannerContent(
      { id: 'lunatic', label: 'Lunatic', summary, locked: true, lockReason: 'Beat Hard' },
      2,
    );
    expect(content.rank).toBe(3);
    expect(content.rewards.some((l) => /meta currency/.test(l))).toBe(true);
    expect(content.harder.some((l) => /meta currency/.test(l))).toBe(false);
    expect(content.harder.length + content.rewards.length).toBe(summary.length);
    expect(content).toMatchObject({ locked: true, lockReason: 'Beat Hard', tagline: expect.any(String) }); // prettier-ignore
  });
});

describe('reward item art', () => {
  it('every reward card resolves to its own item icon (the atlas, not legacy art)', () => {
    expect(itemIconId({ type: 'weapon', item: { name: 'Steel Sword', type: 'Sword' } })).toBe(
      'steel-sword',
    );
    expect(itemIconId({ type: 'consumable', item: { name: 'Speedwing', type: 'Consumable' } })).toBe('speedwing'); // prettier-ignore
    expect(itemIconId({ type: 'accessory', item: { name: "Veteran's Crest", type: 'Accessory' } })).toBe('veterans-crest'); // prettier-ignore
    expect(itemIconId({ type: 'consumable', item: { name: 'Herb', type: 'Consumable', effect: 'cure' } })).toBe('herb'); // prettier-ignore
    expect(itemIconId({ type: 'forge', item: { name: 'Prismatic Stone', type: 'Whetstone' } })).toBe('prismatic-stone'); // prettier-ignore
    expect(itemIconId({ type: 'gold' })).toBe('gold');
    expect(itemIconId({ type: 'skip' })).toBe('gold');
    expect(itemIconId({ type: 'weapon', item: { name: 'Odd', type: 'Breath' } })).toBe(
      'generic-breath',
    );
  });
});
