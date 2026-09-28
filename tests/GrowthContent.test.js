import { describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import {
  GROWTH_TIMING,
  growthTiming,
  levelSchedule,
  levelUpContent,
  projectUnit,
  promotionPathContent,
  rankChipText,
  recruitCardContent,
  recruitLine,
  riteSchedule,
  sealedBeats,
  stableHash,
  statChipText,
} from '../src/ui/growthContent.js';
import { createLordUnit, createRecruitUnit, promoteUnit } from '../src/engine/UnitManager.js';
import { RunManager } from '../src/engine/RunManager.js';

import dialogue from '../data/dialogue.json';

const gameData = { ...loadGameData(), dialogue };
const cls = (name) => gameData.classes.find((c) => c.name === name);

function myrmidon() {
  const unit = createRecruitUnit(
    { name: 'Ilse', level: 10 },
    cls('Myrmidon'),
    gameData.weapons,
    null,
    null,
    null,
  );
  unit.level = 10;
  return unit;
}

describe('promotionPathContent', () => {
  it('projects exactly what promoteUnit applies, without touching the unit or the RNG', () => {
    const unit = myrmidon();
    const before = JSON.stringify(projectUnit(unit));
    const spy = vi.spyOn(Math, 'random');
    const content = promotionPathContent(unit, cls('Duelist'), gameData);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(JSON.stringify(projectUnit(unit))).toBe(before);
    const real = structuredClone(projectUnit(unit));
    const result = promoteUnit(real, cls('Duelist'), cls('Duelist').promotionBonuses, gameData.skills); // prettier-ignore
    for (const row of content.stats) {
      expect(row.after, row.stat).toBe(real.stats[row.stat]);
      expect(row.bonus).toBe(cls('Duelist').promotionBonuses[row.stat]);
    }
    expect(content.skills.map((s) => s.id)).toEqual(result.learnedSkills);
    expect(content.fromClass).toBe('Myrmidon');
    expect(content.toClass).toBe('Duelist');
    expect(content.toTier).toBe('promoted');
    expect(content.levelTo).toBe(1);
  });

  it('weapon ranks: an owned type ranks up, a new type is marked new', () => {
    const content = promotionPathContent(myrmidon(), cls('Duelist'), gameData);
    const byType = Object.fromEntries(content.ranks.map((r) => [r.type, r]));
    expect(byType.Sword).toMatchObject({ from: 'Prof', to: 'Mast', change: 'up', label: 'P→M' });
    expect(byType.Lance).toMatchObject({ from: null, change: 'new' });
    expect(rankChipText(byType.Sword)).toBe('Sword P→M');
    expect(rankChipText(byType.Lance)).toBe('Lance · new');
    expect(content.grants).toContain('Iron Lance');
    const beats = sealedBeats(content);
    expect(beats.map((b) => b.kind)).toEqual([
      'rank',
      'weapon',
      ...content.skills.map(() => 'skill'),
    ]);
  });

  it('lords promote with their own bonuses (lords.json), as the engine does', () => {
    const edric = createLordUnit(gameData.lords.find((l) => l.name === 'Edric'), gameData.classes, gameData.weapons); // prettier-ignore
    edric.level = 10;
    const content = promotionPathContent(edric, cls('Great Lord'), gameData);
    const lordBonus = gameData.lords.find((l) => l.name === 'Edric').promotionBonuses;
    for (const row of content.stats) expect(row.bonus, row.stat).toBe(lordBonus[row.stat]);
  });

  describe('role line: weapons the promotion really adds', () => {
    // Independent of the code under test: class data spells weapons in the plural.
    const PLURAL = { Sword: 'Swords', Lance: 'Lances', Axe: 'Axes', Bow: 'Bows', Tome: 'Tomes', Light: 'Light', Staff: 'Staves', Breath: 'Breath' }; // prettier-ignore
    const TYPE = Object.fromEntries(Object.entries(PLURAL).map(([type, word]) => [word, type]));
    const typesIn = (profs) =>
      String(profs || '')
        .split(',')
        .map((part) => TYPE[part.trim().replace(/\s*\([PM]\)$/, '')])
        .filter(Boolean);
    const lordFor = (base) => gameData.lords.find((l) => l.class === base.name);

    it('Sera already heals with staves: Light Priestess names the rank, never "Gains Staves"', () => {
      const run = new RunManager(gameData);
      run.startRun();
      const sera = run.roster.find((u) => u.name === 'Sera');
      sera.level = 10;
      // The playtest's case: a Light Sage carries Heal and can use it.
      expect(sera.className).toBe('Light Sage');
      expect(sera.proficiencies).toContainEqual({ type: 'Staff', rank: 'Prof' });
      const content = promotionPathContent(sera, cls('Light Priestess'), gameData);
      expect(content.role).toBe('Staves: Master, +MOV');
      expect(content.ranks.find((r) => r.type === 'Staff')).toMatchObject({ from: 'Prof', to: 'Mast', change: 'up' }); // prettier-ignore
      // What the line keeps: the path's MOV bonus is real.
      expect(content.stats.find((r) => r.stat === 'MOV')?.bonus).toBe(1);
    });

    it('a Light Sage without staves (Sera before her healer kit) is told she gains them', () => {
      const sera = createLordUnit(gameData.lords.find((l) => l.name === 'Sera'), cls('Light Sage'), gameData.weapons); // prettier-ignore
      sera.level = 10;
      expect(sera.proficiencies.map((p) => p.type)).toEqual(['Light']);
      expect(promotionPathContent(sera, cls('Light Priestess'), gameData).role).toBe('Gains Staves, +MOV'); // prettier-ignore
    });

    it('every promotion path names as gained exactly the weapons new to the unit', () => {
      const bases = gameData.classes.filter((c) => c.tier === 'base' && c.promotesTo);
      expect(bases.length).toBeGreaterThan(10);
      for (const base of bases) {
        const lord = lordFor(base);
        for (const target of lord ? [lord.promotedClass] : [].concat(base.promotesTo)) {
          const unit = lord
            ? createLordUnit(lord, base, gameData.weapons)
            : createRecruitUnit({ name: 'Probe', level: 10 }, base, gameData.weapons, null, null, null); // prettier-ignore
          unit.level = 10;
          const role = promotionPathContent(unit, cls(target), gameData).role;
          const had = new Set(typesIn(base.weaponProficiencies));
          const fresh = typesIn(cls(target).weaponProficiencies)
            .filter((type) => !had.has(type))
            .map((type) => PLURAL[type]);
          const gained = /^Gains ([^,]+)/.exec(role)?.[1].split('/') ?? [];
          expect(gained, `${base.name} → ${target}: "${role}"`).toEqual(fresh);
          // A weapon the unit already uses is never offered as a gain.
          for (const type of had) expect(gained, `${base.name} → ${target}`).not.toContain(PLURAL[type]); // prettier-ignore
          // These units hold only their class's weapons, so no rank note either
          // (the chips show every P→M; the line names only what the class adds).
          expect(role, `${base.name} → ${target}`).not.toMatch(/: Master\b/);
        }
      }
    });

    it('class notes never name a weapon: weapon gains come from the proficiency data', () => {
      const weaponWords =
        /\b(gains?|swords?|lances?|axes?|bows?|tomes?|staff|staves|light|breath)\b/i;
      for (const c of gameData.classes.filter((x) => x.roleChange))
        expect(c.roleChange, c.name).not.toMatch(weaponWords);
    });
  });

  it('missing data yields null rather than throwing', () => {
    expect(promotionPathContent(null, cls('Hero'), gameData)).toBeNull();
    expect(promotionPathContent(myrmidon(), null, gameData)).toBeNull();
    expect(promotionPathContent(myrmidon(), { name: 'Nothing' }, gameData)).toBeNull();
  });

  it('projectUnit copies only class state (battle units carry Phaser graphics)', () => {
    const unit = { ...myrmidon(), graphic: { destroy() {} }, hpBar: {} };
    const copy = projectUnit(unit);
    expect(copy.graphic).toBeUndefined();
    copy.stats.STR = 999;
    copy.skills.push('x');
    expect(unit.stats.STR).not.toBe(999);
    expect(unit.skills).not.toContain('x');
    expect(statChipText({ stat: 'STR', bonus: 2 })).toBe('STR +2');
  });
});

describe('levelUpContent', () => {
  it('orders the card so its left column reads HP, STR, SPD, RES', () => {
    const unit = { name: 'Edric', className: 'Lord', stats: { HP: 21, STR: 7, MAG: 2, SKL: 9, SPD: 10, DEF: 7, RES: 3, LCK: 8 } }; // prettier-ignore
    const c = levelUpContent(unit, { newLevel: 3, gains: { SKL: 1 } });
    const order = c.rows.map((r) => r.stat);
    expect(order).toEqual(['HP', 'MAG', 'STR', 'SKL', 'SPD', 'DEF', 'RES', 'LCK']);
    // The card is a two-column grid filled row by row.
    expect(order.filter((_, i) => i % 2 === 0)).toEqual(['HP', 'STR', 'SPD', 'RES']);
    expect(order.filter((_, i) => i % 2 === 1)).toEqual(['MAG', 'SKL', 'DEF', 'LCK']);
    expect(c.rows.find((r) => r.stat === 'SKL')).toMatchObject({ before: 8, after: 9, gain: 1 });
  });
  const unit = { name: 'Edric', className: 'Lord', stats: { HP: 20, STR: 6, MAG: 2, SKL: 7, SPD: 9, DEF: 5, RES: 3, LCK: 6 } }; // prettier-ignore

  it('rows reconstruct before/after from the (already applied) stats', () => {
    const c = levelUpContent(unit, { newLevel: 5, gains: { HP: 1, STR: 1 } }, ['Vantage']);
    expect(c.rows.find((r) => r.stat === 'HP')).toEqual({ stat: 'HP', gain: 1, before: 19, after: 20 }); // prettier-ignore
    expect(c.rows.find((r) => r.stat === 'MAG')).toEqual({ stat: 'MAG', gain: 0, before: 2, after: 2 }); // prettier-ignore
    expect(c).toMatchObject({ levelFrom: '4', levelTo: '5', total: 2, kind: 'normal', beat: null });
    expect(c.skills).toEqual(['Vantage']);
  });

  it('perfect and lean levels get their own beat; extended levels are never lean', () => {
    const all = Object.fromEntries(['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'].map((s) => [s, 1])); // prettier-ignore
    expect(levelUpContent(unit, { newLevel: 6, gains: all }).kind).toBe('perfect');
    expect(levelUpContent(unit, { newLevel: 6, gains: all }).beat.word).toBe('A PERFECT LEVEL');
    expect(levelUpContent(unit, { newLevel: 6, gains: { DEF: 1 } }).kind).toBe('blank');
    expect(levelUpContent(unit, { newLevel: 6, gains: {} }).kind).toBe('blank');
    const ext = levelUpContent(unit, { newLevel: 20, isExtended: true, extendedLevel: 2, gains: { LCK: 1 } }); // prettier-ignore
    expect(ext).toMatchObject({ kind: 'normal', levelFrom: '20+1', levelTo: '20+2' });
    const first = levelUpContent(unit, { isExtended: true, extendedLevel: 1, gains: { LCK: 1 } });
    expect(first.levelFrom).toBe('20');
  });

  it('displayStats (multi-level awards) win over the unit', () => {
    const c = levelUpContent(unit, { newLevel: 3, gains: { STR: 1 }, displayStats: { ...unit.stats, STR: 5 } }); // prettier-ignore
    expect(c.rows.find((r) => r.stat === 'STR')).toMatchObject({ before: 4, after: 5 });
  });
});

describe('recruit lines and cards', () => {
  it('a lord speaks their own line, others their class (then base class)', () => {
    const d = gameData.dialogue;
    expect(d.lordRecruitLines.Kira).toContain(recruitLine({ name: 'Kira', className: 'Tactician' }, d)); // prettier-ignore
    expect(d.recruitLines.Cleric).toContain(recruitLine({ name: 'Maren', className: 'Cleric' }, d)); // prettier-ignore
    const promoted = { name: 'Oda', className: 'Imaginary' };
    expect(recruitLine(promoted, d, [{ name: 'Imaginary', promotesFrom: 'Cleric' }])).toBeTruthy();
    expect(recruitLine({ name: 'X', className: 'Nope' }, d)).toBe('');
    expect(recruitLine({ name: 'X', className: 'Cleric' }, d, [], '  Given line ')).toBe('Given line'); // prettier-ignore
  });

  it('the pick is a stable hash (same unit, same line) and never the RNG', () => {
    const spy = vi.spyOn(Math, 'random');
    const d = gameData.dialogue;
    const a = recruitLine({ name: 'Maren', className: 'Cleric' }, d);
    expect(recruitLine({ name: 'Maren', className: 'Cleric' }, d)).toBe(a);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(stableHash('abc')).toBe(stableHash('abc'));
    expect(stableHash('abc')).not.toBe(stableHash('abd'));
  });

  it('card copy per kind, with crest and level', () => {
    const unit = { name: 'Astrid', className: 'Seraph Knight', level: 1 };
    const opts = { dialogue: gameData.dialogue, classes: gameData.classes };
    expect(recruitCardContent(unit, { ...opts, kind: 'boss' })).toMatchObject({
      kicker: 'Sworn to your cause',
      name: 'Astrid',
      crest: 'Seraph Knight',
      meta: 'Seraph Knight · Lv 1',
    });
    expect(recruitCardContent(unit, { ...opts, kind: 'lord' }).kicker).toBe('A lord arrives');
    expect(recruitCardContent(unit, opts).kicker).toBe('Joins your army');
    expect(recruitCardContent({ ...unit, extendedLevels: 2, level: 20 }, opts).meta).toContain('Lv 20+2'); // prettier-ignore
    expect(recruitCardContent(null, opts)).toBeNull();
  });
});

describe('growth timing', () => {
  it('normal animates; fast scales; Instant and reduced motion show the end state', () => {
    const normal = growthTiming('rite', {});
    expect(normal).toMatchObject({ animate: true, k: 1, light: GROWTH_TIMING.rite.light });
    const fast = growthTiming('rite', { speed: 'fast' });
    expect(fast.burn).toBe(Math.round(GROWTH_TIMING.rite.burn * 0.55));
    for (const prefs of [{ speed: 'instant' }, { reducedMotion: true }]) {
      const t = growthTiming('level', prefs);
      expect(t.animate).toBe(false);
      expect(t.pip + t.enter + t.beat).toBe(0);
    }
    // Reading windows survive reduced motion; Instant halves them.
    expect(growthTiming('join', { reducedMotion: true }).hold).toBe(GROWTH_TIMING.join.hold);
    expect(growthTiming('join', { speed: 'instant' }).hold).toBe(GROWTH_TIMING.join.hold / 2);
  });

  it('schedules: only real gains take time, and static schedules end at 0', () => {
    const content = { rows: [{ gain: 1 }, { gain: 0 }, { gain: 1 }], beat: null, skills: [] };
    const t = growthTiming('level', {});
    expect(levelSchedule(content, t).done).toBe(t.enter + 2 * t.pip);
    expect(levelSchedule(content, growthTiming('level', { speed: 'instant' })).done).toBe(0);
    // A level-up at normal speed holds within ~a second (typical: under half).
    const perfect = { rows: Array(8).fill({ gain: 1 }), beat: {}, skills: ['A'] };
    expect(levelSchedule(perfect, t).done).toBeLessThan(1200);
    const rite = riteSchedule(
      { stats: [1, 2, 3], ranks: [], skills: [] },
      growthTiming('rite', {}),
    );
    expect(rite.statsAt).toBeGreaterThan(rite.nameAt);
    expect(rite.done).toBeLessThan(4200);
    expect(riteSchedule({ stats: [1] }, growthTiming('rite', { reducedMotion: true })).done).toBe(
      0,
    );
  });
});
