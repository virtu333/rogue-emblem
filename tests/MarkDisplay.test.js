// How a Mark shows (docs/specs/phase3.md 3C): the proc banner's fifth category, the one "Mark"
// line under the traits on every card that shows traits, and the Home Base upgrade's text.
// Ways this goes wrong: a Mark's activation reads as an unknown neutral (cyan) or takes a
// skill's colour; Veil's chip floats over the striker instead of the bearer; a card shows the
// Mark of an id the catalog does not know, or shows two lines, or none; the Mark is mixed into
// the trait rows (it is not a trait); the upgrade tiers read as raw numbers.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (value, min, max) => Math.max(min, Math.min(max, value)) },
  },
}));

import {
  PROC_CATEGORY,
  PROC_THEME,
  classifyActivation,
  dominantCategory,
  fxForActivation,
  splitStrikeActivations,
  themeFor,
} from '../src/ui/ProcVisualTheme.js';
import { markActivation } from '../src/engine/MarkSystem.js';
import { markLine, traitLines } from '../src/ui/traitContent.js';
import { unitLines } from '../src/ui/choiceContent.js';
import { describeRecruitPreview } from '../src/ui/loomModel.js';
import { UI_PALETTE } from '../src/utils/uiStyles.js';
import { HomeBaseScene } from '../src/scenes/HomeBaseScene.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const { marks, skills } = data;
const mark = (id) => marks.find((m) => m.id === id);

describe('the proc banner’s mark category', () => {
  it('classifies every Mark’s activation as `mark`, never as a skill or neutral', () => {
    for (const m of marks) {
      expect(classifyActivation(markActivation(m), skills), m.id).toBe(PROC_CATEGORY.MARK);
      expect(classifyActivation(markActivation(m, 'target'), skills), m.id).toBe(
        PROC_CATEGORY.MARK,
      );
    }
    // by the prefix or the flag alone, so a catalog the banner does not hold still reads right
    expect(classifyActivation({ id: 'mark_unheard_of' }, skills)).toBe(PROC_CATEGORY.MARK);
    expect(classifyActivation({ id: 'x', mark: true }, null)).toBe(PROC_CATEGORY.MARK);
    // and a real skill never does
    expect(classifyActivation({ id: 'luna' }, skills)).toBe(PROC_CATEGORY.OFFENSE);
  });

  it('no skill, art or affix id begins with `mark_` (the prefix is the Marks’)', () => {
    for (const skill of skills) expect(skill.id.startsWith('mark_'), skill.id).toBe(false);
    for (const art of data.weaponArts.arts) expect(art.id.startsWith('mark_'), art.id).toBe(false);
    for (const affix of data.affixes.affixes)
      expect(affix.id.startsWith('mark_'), affix.id).toBe(false);
  });

  it('has its own colour from the UI palette, apart from the other four', () => {
    expect(PROC_THEME.mark).toEqual({
      color: UI_PALETTE.mark,
      accent: Number.parseInt(UI_PALETTE.mark.slice(1), 16),
    });
    expect(themeFor('mark')).toBe(PROC_THEME.mark);
    const colors = Object.values(PROC_THEME).map((theme) => theme.color);
    expect(new Set(colors).size).toBe(colors.length);
    expect(PROC_THEME.mark.color).not.toBe(PROC_THEME.neutral.color);
  });

  it('puts Hunt over the striker and Veil over the bearer who defended', () => {
    const split = splitStrikeActivations(
      [markActivation(mark('hunt')), markActivation(mark('veil'), 'target')],
      skills,
    );
    expect(split.striker.map((e) => e.id)).toEqual(['mark_hunt']);
    expect(split.target.map((e) => e.id)).toEqual(['mark_veil']);
    expect([...split.striker, ...split.target].every((e) => e.category === 'mark')).toBe(true);
  });

  it('sits below art, offense and defense and above neutral when a strike mixes procs', () => {
    const e = (category) => ({ category });
    expect(dominantCategory([e('mark'), e('offense')])).toBe('offense');
    expect(dominantCategory([e('mark'), e('defense')])).toBe('defense');
    expect(dominantCategory([e('mark'), e('art')])).toBe('art');
    expect(dominantCategory([e('neutral'), e('mark')])).toBe('mark');
    expect(dominantCategory([e('mark')])).toBe('mark');
  });

  it('every Mark has an effect overlay that lands on the right unit', () => {
    const entry = (m, side) => ({ ...markActivation(m, side), category: 'mark' });
    expect(fxForActivation(entry(mark('hunt')))).toEqual({ key: 'fx_pierce', at: 'target' });
    expect(fxForActivation(entry(mark('veil'), 'target'))).toEqual({
      key: 'fx_shield',
      at: 'target',
    });
    for (const m of marks) {
      const fx = fxForActivation(entry(m));
      expect(fx, m.id).toBeTruthy();
      expect(fx.key).toMatch(/^fx_/);
    }
  });
});

describe('the Mark line on a unit’s card', () => {
  const unit = (markId, extra = {}) => ({
    name: 'Brant',
    traits: [],
    skills: [],
    markId,
    ...extra,
  });

  it('is one row: id, name and the catalog’s text', () => {
    expect(markLine(unit('hunt'), data)).toEqual({
      id: 'hunt',
      name: 'Mark of the Hunt',
      text: '15% per strike: +5 damage on that strike.',
    });
  });

  it('is absent without a Mark, for an unknown id, and without a catalog', () => {
    expect(markLine(unit(undefined), data)).toBeNull();
    expect(markLine(unit('a_mark_from_the_future'), data)).toBeNull();
    expect(markLine(unit('hunt'), { ...data, marks: undefined })).toBeNull();
    expect(markLine(unit('hunt'), null)).toBeNull();
    expect(markLine(null, data)).toBeNull();
  });

  it('is not a trait: traitLines never lists it', () => {
    expect(traitLines(unit('hunt'), data)).toEqual([]);
  });

  it('the recruit card’s lines carry it between the traits and the skills', () => {
    const trait = data.traits[0];
    const skill = data.skills.find((s) => s.description);
    const lines = unitLines(unit('ember', { traits: [trait.id], skills: [skill.id] }), data);
    expect(lines.map((l) => l.kind)).toEqual(['trait', 'mark', 'skill']);
    expect(lines[1]).toEqual({
      kind: 'mark',
      id: 'ember',
      name: 'Mark of the Ember',
      text: '20% on a kill: restores 5 HP.',
    });
    expect(unitLines(unit(undefined), data)).toEqual([]);
  });

  it('the Loom’s recruit card carries it as `mark`, one row, null without one', () => {
    const options = {
      traitLines: (u) => traitLines(u, data),
      markLine: (u) => markLine(u, data),
    };
    const base = {
      stats: { HP: 20, STR: 5, SKL: 5, SPD: 5, DEF: 5, RES: 5 },
      className: 'Archer',
      level: 3,
    };
    const marked = describeRecruitPreview(
      { unit: { ...base, name: 'A', markId: 'veil' } },
      options,
    );
    expect(marked.mark).toEqual({
      name: 'Mark of the Veil',
      text: '15% when a magic strike lands on the bearer: halves its damage.',
    });
    expect(marked.traits).toEqual([]);
    const plain = describeRecruitPreview({ unit: { ...base, name: 'B' } }, options);
    expect(plain.mark).toBeNull();
    // a caller that passes no markLine (an older panel) just gets none
    expect(
      describeRecruitPreview({ unit: { ...base, name: 'C', markId: 'veil' } }).mark,
    ).toBeNull();
  });
});

describe('Marked Blood on the Home Base', () => {
  const scene = new HomeBaseScene();

  it('reads each tier as one in N, and says what it does', () => {
    expect(scene._formatEffectValue({ markChance: 0.1667 })).toBe('1 in 6');
    expect(scene._formatEffectValue({ markChance: 0.25 })).toBe('1 in 4');
    expect(scene._getActionDesc({ effects: [{ markChance: 0.1667 }] })).toBe(
      'Recruits that bear a Mark (base 1 in 10)',
    );
  });
});
