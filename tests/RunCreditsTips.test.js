import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRADE_BARS, SURVIVAL_PENALTY_PER_LOSS, gradeRun } from '../src/engine/RunGrade.js';
import { createRunLedger } from '../src/engine/RunLedger.js';
import { runCreditsSection } from '../src/ui/runCreditsView.js';
import { installFakeDom } from './helpers/fakeDom.js';

const ledger = {
  ...createRunLedger(1000, 500),
  parBattles: 10,
  underPar: 10,
  goldIn: 1500,
  losses: 1,
  worstSurvival: 0.75,
};
const graded = (over = {}) => gradeRun({ result: 'victory', ledger, gold: 400, ...over });

describe('grade helper tips: the words', () => {
  it('every bar says what it measures and how to score, from the live constants', () => {
    const bars = Object.fromEntries(graded().bars.map((b) => [b.key, b]));
    expect(Object.keys(bars)).toEqual(GRADE_BARS.map((b) => b.key));
    for (const bar of Object.values(bars)) expect(bar.help.length).toBeGreaterThan(30);
    // A number in the words is the scoring's own.
    expect(bars.survival.help).toContain(`${SURVIVAL_PENALTY_PER_LOSS} points`);
    expect(bars.pace.help).toContain('par');
    // Restraint is gone: nothing in the grade asks for No Meta.
    expect(bars.restraint).toBeUndefined();
    expect(JSON.stringify(GRADE_BARS)).not.toContain('No Meta');
  });

  it('each bar also says where this run stood on it', () => {
    const by = Object.fromEntries(graded().bars.map((b) => [b.key, b.standing]));
    expect(by).toEqual({
      pace: '10 of 10 battles at or under par',
      survival: '1 ally lost',
      resolve: '75% of your force came out of your worst battle alive',
      economy: '400 gold unspent of 2000 received',
    });
    expect(graded({ ledger: { ...ledger, losses: 2 } }).bars[1].standing).toBe('2 allies lost');
  });
});

describe('grade helper tips: the row', () => {
  beforeEach(() => installFakeDom(vi));
  afterEach(() => vi.unstubAllGlobals());

  const render = () => runCreditsSection({ grade: graded(), details: [] }, 'Black Sun');
  const rowOf = (section, label) =>
    [...section.querySelectorAll('li')].find((li) =>
      li.querySelector('.re-credits-why')?.textContent.startsWith(label),
    );

  it('a tap on the label opens a note under that row only, and a second tap closes it', () => {
    const section = render();
    const row = rowOf(section, 'Economy');
    const toggle = row.querySelector('.re-credits-why');
    const note = row.querySelector('.re-credits-tip');
    expect(note.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.onclick();
    expect(note.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(note.textContent).toContain('Gold put to use');
    expect(note.textContent).toContain('Your run: 400 gold unspent of 2000 received.');
    expect(rowOf(section, 'Pace').querySelector('.re-credits-tip').hidden).toBe(true);
    toggle.onclick();
    expect(note.hidden).toBe(true);
  });

  it('the toggle is a real button, names the note it opens, and has a hover title', () => {
    const section = render();
    for (const bar of graded().bars) {
      const toggle = rowOf(section, bar.label).querySelector('.re-credits-why');
      expect(toggle.tagName.toLowerCase()).toBe('button');
      expect(toggle.type).toBe('button');
      expect(toggle.title).toBe(bar.help);
      const noteId = toggle.getAttribute('aria-controls');
      expect(rowOf(section, bar.label).querySelector('.re-credits-tip').id).toBe(noteId);
    }
  });
});
