// The More Info guide's par pages quote turnBonus.json and the maps' parBonus.
// Each test fails when that tuning moves and the guide is left behind.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { HELP_TABS } from '../src/data/helpContent.js';
import { GOLD_PAR_BONUS_MULTIPLIER } from '../src/utils/constants.js';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const load = (name) => JSON.parse(readFileSync(join(dataDir, name), 'utf-8'));
const turnBonus = load('turnBonus.json');

function pageLines(title) {
  const page = HELP_TABS.find((t) => t.label === 'Goals')?.pages.find((p) => p.title === title);
  expect(page, title).toBeTruthy();
  return page.lines.map((l) => l.text);
}

const bracket = (rating) => turnBonus.brackets.find((b) => b.rating === rating);

describe('More Info: Par & Turn Ratings', () => {
  const lines = pageLines('Par & Turn Ratings');

  it('states each rating band and its EXP multiplier', () => {
    // S at 3+ under, A at par or under, B up to 3 over, C beyond.
    expect(bracket('S').threshold).toBe(-3);
    expect(bracket('A').threshold).toBe(0);
    expect(bracket('B').threshold).toBe(3);
    expect(lines).toContain(
      `  S  3+ turns under par · EXP x${turnBonus.parXpMultipliers.S.toFixed(2)}`,
    );
    expect(lines).toContain(`  A  par or under · EXP x${turnBonus.parXpMultipliers.A.toFixed(2)}`);
    expect(lines).toContain(
      `  B  1-3 turns over · EXP x${turnBonus.parXpMultipliers.B.toFixed(2)}`,
    );
    expect(lines).toContain(`  C  4+ turns over · EXP x${turnBonus.parXpMultipliers.C.toFixed(2)}`);
  });

  it('names every map that adds par turns, and adds 1-2', () => {
    const templates = load('mapTemplates.json');
    const all = Object.values(templates).flat();
    const added = all.filter((t) => t && t.parBonus).map((t) => [t.id, t.parBonus]);
    expect(added.sort()).toEqual([
      ['castle_ruins', 2],
      ['corridor_siege', 1],
      ['great_hall', 1],
      ['mire_crossing', 2],
    ]);
    const pieces = load('setPieces.json').setPieces;
    // Only the set pieces that add par turns (the Descent's add none).
    expect(pieces.filter((p) => p.parBonus).map((p) => [p.id, p.parBonus])).toEqual([
      ['toll_house', 2],
      ['toll_crossing', 2],
    ]);
    const text = lines.join(' ').replace(/\s+/g, ' ');
    expect(text).toContain('Castles, Mire Crossing, the');
    expect(text).toContain('Toll-House and Toll Crossing add 1-2.');
  });
});

describe('More Info: Par Rewards', () => {
  const lines = pageLines('Par Rewards');

  it('quotes the par gold paid per act and rating', () => {
    const acts = ['act1', 'act2', 'act3', 'act4', 'finalBoss'];
    for (const rating of ['S', 'A', 'B']) {
      const golds = acts.map((act) =>
        Math.floor(
          turnBonus.baseBonusGold[act] *
            bracket(rating).bonusMultiplier *
            GOLD_PAR_BONUS_MULTIPLIER,
        ),
      );
      expect(lines).toContain(`  ${rating}  ${golds.join(' · ')}`);
    }
    expect(bracket('C').bonusMultiplier).toBe(0);
    expect(lines).toContain('  C  nothing');
  });

  it('states when late pressure starts, how it steps and where it bottoms out', () => {
    const lp = turnBonus.latePressure;
    // "3+ turns over par": pressure starts once turns over par exceeds startOverPar.
    expect(lp.startOverPar).toBe(2);
    expect(lp.stepTurns).toBe(2);
    expect(lp.xpMultipliers.at(-1)).toBe(0.1);
    expect(lp.goldMultipliers.at(-1)).toBe(0.1);
    const text = lines.join(' ').replace(/\s+/g, ' ');
    expect(text).toContain('Running long (3+ turns over par)');
    expect(text).toContain('Every 2 more turns cut deeper, to x0.1.');
  });

  it('states the boss enrage turn', () => {
    const lp = turnBonus.latePressure;
    expect([lp.bossEnrageOverPar, lp.bossEnrageTurn, lp.bossEnrageMinOverPar]).toEqual([2, 12, 1]);
    const text = lines.join(' ').replace(/\s+/g, ' ');
    expect(text).toContain(
      'A boss enrages at par +2, or turn 12 if sooner, but never before par +1.',
    );
  });
});
