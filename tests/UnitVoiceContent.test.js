// Unit voice content contract — dialogue.json `unitVoice` (level-up, promotion
// and last-words lines). See docs/lore-style-guide.md, "Unit voices".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { loadGameData } from './testData.js';
import {
  TEMPERAMENT_IDS,
  VOICE_LINE_BUDGET,
  fallenLine,
  levelUpLine,
  promotionLine,
} from '../src/engine/UnitVoice.js';
import { XP_STAT_NAMES } from '../src/utils/constants.js';
import { levelUpContent } from '../src/ui/growthContent.js';

const gameData = {
  ...loadGameData(),
  dialogue: JSON.parse(readFileSync(new URL('../data/dialogue.json', import.meta.url), 'utf-8')),
};
const voice = gameData.dialogue.unitVoice;
const lordNames = gameData.lords.map((l) => l.name);
const longestLord = Math.max(...lordNames.map((n) => n.length));

/** Every [path, line] pair under a node. */
function allLines(node, path = 'unitVoice') {
  if (typeof node === 'string') return [[path, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => allLines(v, `${path}[${i}]`));
  if (node && typeof node === 'object')
    return Object.entries(node)
      .filter(([k]) => k !== 'label')
      .flatMap(([k, v]) => allLines(v, `${path}.${k}`));
  return [];
}

// Classes a recruit can hold: recruitable base classes and their promotions.
const LORD_CLASSES = new Set(gameData.lords.flatMap((l) => [l.class, l.promotedClass]));
const ENEMY_ONLY = new Set(['Zombie', 'Revenant', 'Dragon', 'Dragon Lord', 'Entity']);
const recruitClasses = gameData.classes
  .filter((c) => !LORD_CLASSES.has(c.name) && !ENEMY_ONLY.has(c.name) && c.tier !== 'boss')
  .map((c) => c.name);

describe('unit voice content contract', () => {
  it('every line fits the budget, is single-line and quote-free', () => {
    const lines = allLines(voice);
    expect(lines.length).toBeGreaterThan(1000);
    for (const [path, line] of lines) {
      expect(line.trim().length, path).toBeGreaterThan(0);
      expect(line.includes('\n'), `${path}: multi-line`).toBe(false);
      expect(line.includes('"'), `${path}: double quote`).toBe(false);
      // {leader} fills with a lord's name; budget the longest one.
      const filled = line.replaceAll('{leader}', 'x'.repeat(longestLord));
      expect(filled.length, `${path}: ${line}`).toBeLessThanOrEqual(VOICE_LINE_BUDGET);
    }
  });

  it('uses only known tokens, in the pools that can resolve them', () => {
    for (const [path, line] of allLines(voice)) {
      const tokens = line.match(/\{[^}]*\}/g) || [];
      for (const token of tokens)
        expect(['{leader}', '{name}', '{skill}'], `${path}: ${token}`).toContain(token);
      if (line.includes('{skill}')) expect(path, line).toMatch(/^unitVoice\.skills/);
      // A lord may be the commander: lords never address {leader}.
      if (path.startsWith('unitVoice.lords')) expect(line, path).not.toMatch(/\{leader\}/);
    }
    expect(voice.skills.every((l) => l.includes('{skill}'))).toBe(true);
  });

  it('covers every temperament, recruit class, trait, stat and lord', () => {
    for (const id of TEMPERAMENT_IDS) {
      const t = voice.temperaments[id];
      expect(t?.label, id).toBeTruthy();
      for (const kind of ['normal', 'perfect', 'blank'])
        expect(t.levelUp[kind].length, `${id}.${kind}`).toBeGreaterThanOrEqual(3);
      expect(t.fallen.length, `${id}.fallen`).toBeGreaterThanOrEqual(3);
    }
    for (const name of recruitClasses) {
      const c = voice.classes[name];
      expect(c, `class ${name}`).toBeTruthy();
      for (const kind of ['normal', 'perfect', 'blank'])
        expect(c.levelUp[kind].length, `${name}.${kind}`).toBeGreaterThanOrEqual(3);
      expect(c.fallen.length, `${name}.fallen`).toBeGreaterThanOrEqual(3);
      const cls = gameData.classes.find((k) => k.name === name);
      if (cls.tier === 'promoted')
        expect(c.promotion?.length, `${name}.promotion`).toBeGreaterThanOrEqual(3);
    }
    for (const name of Object.keys(voice.classes))
      expect(
        gameData.classes.some((c) => c.name === name),
        name,
      ).toBe(true);
    const traitIds = new Set(gameData.traits.map((t) => t.id));
    for (const id of Object.keys(voice.traits)) expect(traitIds.has(id), id).toBe(true);
    for (const t of gameData.traits.filter((t) => t.rarity !== 'legendary'))
      expect(voice.traits[t.id]?.length, t.id).toBeGreaterThanOrEqual(3);
    expect(Object.keys(voice.stats).sort()).toEqual([...XP_STAT_NAMES].sort());
    expect(Object.keys(voice.lords).sort()).toEqual([...lordNames].sort());
    for (const name of lordNames) {
      const l = voice.lords[name];
      for (const kind of ['normal', 'perfect', 'blank'])
        expect(l.levelUp[kind].length, `${name}.${kind}`).toBeGreaterThanOrEqual(3);
      for (const m of ['10', '20', 'extended'])
        expect(l.levelUp.milestones[m].length, `${name}.m${m}`).toBeGreaterThanOrEqual(1);
      expect(l.promotion.length, `${name}.promotion`).toBeGreaterThanOrEqual(3);
    }
    for (const m of ['10', '20', 'extended'])
      expect(voice.milestones[m].length).toBeGreaterThanOrEqual(3);
    expect(voice.beats.perfect.length).toBeGreaterThanOrEqual(3);
    expect(voice.beats.blank.length).toBeGreaterThanOrEqual(3);
    expect(voice.beats.perfect.every((l) => l.length <= 48)).toBe(true);
    expect(voice.beats.blank.every((l) => l.length <= 48)).toBe(true);
  });

  it('never repeats a line within a pool', () => {
    const pools = [];
    const walk = (node, path) => {
      if (Array.isArray(node)) pools.push([path, node]);
      else if (node && typeof node === 'object')
        for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    };
    walk(voice, 'unitVoice');
    for (const [path, pool] of pools) expect(new Set(pool).size, path).toBe(pool.length);
  });

  it('every recruit class and lord says something at every kind of level', () => {
    const ctx = { voice, classes: gameData.classes, seed: 3, leader: 'Edric' };
    const all = Object.fromEntries(XP_STAT_NAMES.map((s) => [s, 1]));
    const units = [
      ...recruitClasses.map((className) => ({ name: 'Hedda', className, traits: ['keen'] })),
      ...gameData.lords.map((l) => ({ name: l.name, className: l.class, isLord: true })),
    ];
    for (const unit of units)
      for (const gains of [all, { DEF: 1 }, { HP: 1, STR: 2 }])
        for (const newLevel of [3, 10, 20]) {
          const content = levelUpContent(unit, { newLevel, gains }, [], ctx);
          expect(content.quote, `${unit.className} lv${newLevel}`).toBeTruthy();
          expect(content.quote).not.toMatch(/\{/);
        }
    for (const name of recruitClasses) {
      const unit = { name: 'Hedda', className: name };
      expect(fallenLine(unit, ctx), name).toBeTruthy();
      const cls = gameData.classes.find((k) => k.name === name);
      if (cls.tier === 'promoted') expect(promotionLine(unit, name, ctx), name).toBeTruthy();
    }
    for (const lord of gameData.lords)
      expect(promotionLine({ name: lord.name, isLord: true }, lord.promotedClass, ctx)).toBeTruthy(); // prettier-ignore
  });

  it('gives a recruit a varied voice across a whole career', () => {
    const unit = { name: 'Hedda', className: 'Fighter', traits: ['lazy'] };
    const ctx = { voice, classes: gameData.classes, seed: 11, leader: 'Kira' };
    const said = [];
    for (let lv = 2; lv <= 19; lv++) {
      const content = levelUpContent(unit, { newLevel: lv, gains: { HP: 1, STR: 1, SKL: 1 } });
      said.push(levelUpLine(unit, content, ctx).line);
    }
    expect(new Set(said).size).toBe(said.length);
  });
});
