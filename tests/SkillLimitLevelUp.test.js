// Playtest (Sep 2026): "What happened to the class skills? I thought units got skills at
// certain levels." They still do (level 10 for most classes), but a unit already holding
// five skills lost the new one without a word. The level-up card now names a skill that
// came due at a level just reached and found every slot full — once, not on every later
// level-up that retries it.
import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { createUnit, skillGateLevels } from '../src/engine/UnitManager.js';
import { levelUpContent, skillLimitNote } from '../src/ui/growthContent.js';
import { XP_PER_LEVEL } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

function display() {
  const obj = new Proxy(
    {},
    { get: (t, k) => (k === 'then' ? undefined : (t[k] ||= vi.fn(() => obj))) },
  );
  return obj;
}

function scene() {
  const s = new BattleScene();
  s.grid = { gridToPixel: () => ({ x: 0, y: 0 }) };
  s.gameData = { skills: gameData.skills, classes: gameData.classes, traits: gameData.traits };
  s.battleParams = {};
  s.runManager = { getDifficultyModifier: (_k, fallback) => fallback };
  s.add = { text: vi.fn(() => display()) };
  s.tweens = { add: vi.fn() };
  s.sys = { isActive: () => true };
  s.updateHPBar = vi.fn();
  return s;
}

// A level-9 Myrmidon (learns Forestall at 10) already holding five skills.
function fullMyrmidon(level = 9) {
  const unit = createUnit(
    gameData.classes.find((c) => c.name === 'Myrmidon'),
    level,
    gameData.weapons,
    { name: 'Tess' },
  );
  unit.faction = 'player';
  unit.xp = 0;
  unit.skills = ['sol', 'luna', 'astra', 'miracle', 'renewal'];
  return unit;
}

describe('level-ups at the skill limit', () => {
  it('Myrmidon learns Forestall at 10 (the help and the data agree)', () => {
    expect(skillGateLevels(fullMyrmidon(), gameData.classes).get('vantage')).toBe(10);
  });

  it('the level-10 card names the skill that found every slot full', async () => {
    const s = scene();
    const unit = fullMyrmidon(9);
    await s.awardScaledXP(unit, XP_PER_LEVEL);
    expect(unit.level).toBe(10);
    expect(unit.skills).not.toContain('vantage');
    expect(unit.benchedSkills).toEqual(['vantage']); // kept, not lost
    const [card] = s._pendingLevelUpPopups;
    expect(card.learnedNames).toEqual([]);
    expect(card.levelUp.blockedSkills).toEqual(['Forestall']);
    expect(levelUpContent(unit, card.levelUp).blocked).toEqual(['Forestall']);
    expect(skillLimitNote(['Forestall'])).toBe(
      'All 5 skill slots full: Forestall kept on the bench (swap in from Skills).',
    );
  });

  it('a later level-up retries it quietly', async () => {
    const s = scene();
    const unit = fullMyrmidon(10);
    await s.awardScaledXP(unit, XP_PER_LEVEL);
    expect(unit.level).toBe(11);
    expect(s._pendingLevelUpPopups[0].levelUp.blockedSkills).toBeUndefined();
  });

  it('with a free slot the skill is learned and named as new', async () => {
    const s = scene();
    const unit = fullMyrmidon(9);
    unit.skills = unit.skills.slice(0, 4);
    await s.awardScaledXP(unit, XP_PER_LEVEL);
    expect(unit.skills).toContain('vantage');
    expect(s._pendingLevelUpPopups[0].learnedNames).toEqual(['Forestall']);
    expect(s._pendingLevelUpPopups[0].levelUp.blockedSkills).toBeUndefined();
  });
});
