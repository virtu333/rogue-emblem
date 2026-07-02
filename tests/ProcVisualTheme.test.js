import { describe, it, expect } from 'vitest';
import {
  PROC_CATEGORY,
  PROC_THEME,
  classifyActivation,
  splitStrikeActivations,
  dominantCategory,
  themeFor,
  classifySkillEventName,
  findLegendaryArtActivation,
} from '../src/ui/ProcVisualTheme.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const skills = gameData.skills;
const arts = gameData.weaponArts.arts;

describe('classifyActivation', () => {
  it('classifies weapon_art activations as art', () => {
    expect(classifyActivation({ id: 'weapon_art', name: 'Precise Cut' }, skills)).toBe(
      PROC_CATEGORY.ART,
    );
  });

  it('classifies on-attack skills as offense', () => {
    for (const id of ['luna', 'sol', 'astra', 'adept', 'lethality']) {
      const skill = skills.find((s) => s.id === id);
      expect(skill?.trigger).toBe('on-attack');
      expect(classifyActivation({ id, name: skill.name }, skills)).toBe(PROC_CATEGORY.OFFENSE);
    }
  });

  it('classifies on-defend skills as defense', () => {
    for (const id of ['pavise', 'aegis', 'miracle', 'cancel']) {
      const skill = skills.find((s) => s.id === id);
      expect(skill?.trigger).toBe('on-defend');
      expect(classifyActivation({ id, name: skill.name }, skills)).toBe(PROC_CATEGORY.DEFENSE);
    }
  });

  it('classifies defensive affix activations as defense', () => {
    for (const id of ['shielded', 'teleporter', 'thorns']) {
      expect(classifyActivation({ id, name: id }, skills)).toBe(PROC_CATEGORY.DEFENSE);
    }
  });

  it('falls back to neutral for combat-start skills, unknown ids, and bad input', () => {
    expect(classifyActivation({ id: 'vantage', name: 'Vantage' }, skills)).toBe(
      PROC_CATEGORY.NEUTRAL,
    );
    expect(classifyActivation({ id: 'nonexistent_skill', name: '?' }, skills)).toBe(
      PROC_CATEGORY.NEUTRAL,
    );
    expect(classifyActivation(null, skills)).toBe(PROC_CATEGORY.NEUTRAL);
    expect(classifyActivation({ id: 'luna', name: 'Luna' }, null)).toBe(PROC_CATEGORY.NEUTRAL);
  });
});

describe('splitStrikeActivations', () => {
  it('sends defense procs to the target side and everything else to the striker', () => {
    const activations = [
      { id: 'weapon_art', name: 'Wrath Strike' },
      { id: 'luna', name: 'Luna' },
      { id: 'pavise', name: 'Pavise' },
      { id: 'thorns', name: 'Thorns' },
    ];
    const split = splitStrikeActivations(activations, skills);
    expect(split.striker.map((e) => e.id)).toEqual(['weapon_art', 'luna']);
    expect(split.target.map((e) => e.id)).toEqual(['pavise', 'thorns']);
    expect(split.striker[0].category).toBe(PROC_CATEGORY.ART);
    expect(split.striker[1].category).toBe(PROC_CATEGORY.OFFENSE);
    expect(split.target.every((e) => e.category === PROC_CATEGORY.DEFENSE)).toBe(true);
  });

  it('handles empty and missing activation lists', () => {
    expect(splitStrikeActivations([], skills)).toEqual({ striker: [], target: [] });
    expect(splitStrikeActivations(undefined, skills)).toEqual({ striker: [], target: [] });
  });
});

describe('dominantCategory', () => {
  it('prefers art > offense > defense > neutral', () => {
    expect(
      dominantCategory([{ category: 'offense' }, { category: 'art' }, { category: 'neutral' }]),
    ).toBe(PROC_CATEGORY.ART);
    expect(dominantCategory([{ category: 'neutral' }, { category: 'offense' }])).toBe(
      PROC_CATEGORY.OFFENSE,
    );
    expect(dominantCategory([{ category: 'defense' }])).toBe(PROC_CATEGORY.DEFENSE);
  });

  it('returns neutral for empty or missing lists', () => {
    expect(dominantCategory([])).toBe(PROC_CATEGORY.NEUTRAL);
    expect(dominantCategory(undefined)).toBe(PROC_CATEGORY.NEUTRAL);
  });
});

describe('themeFor', () => {
  it('returns the matching theme with a fallback to neutral', () => {
    expect(themeFor('art')).toBe(PROC_THEME.art);
    expect(themeFor('offense')).toBe(PROC_THEME.offense);
    expect(themeFor('defense')).toBe(PROC_THEME.defense);
    expect(themeFor('bogus')).toBe(PROC_THEME.neutral);
    expect(themeFor(undefined)).toBe(PROC_THEME.neutral);
  });
});

describe('classifySkillEventName', () => {
  it('classifies pre-combat skill events by display name', () => {
    expect(classifySkillEventName('Astra', skills)).toBe(PROC_CATEGORY.OFFENSE);
    expect(classifySkillEventName('Vantage', skills)).toBe(PROC_CATEGORY.NEUTRAL);
    expect(classifySkillEventName('Desperation', skills)).toBe(PROC_CATEGORY.NEUTRAL);
    expect(classifySkillEventName('Not A Skill', skills)).toBe(PROC_CATEGORY.NEUTRAL);
  });
});

describe('findLegendaryArtActivation', () => {
  const legendary = arts.find((a) => a.tierAffinity === 'Legendary');
  const iron = arts.find((a) => a.tierAffinity === 'Iron');

  it('finds a Legendary art by activation display name', () => {
    expect(legendary).toBeTruthy();
    const found = findLegendaryArtActivation([{ id: 'weapon_art', name: legendary.name }], arts);
    expect(found).toBe(legendary);
  });

  it('returns null for non-Legendary arts and non-art activations', () => {
    expect(iron).toBeTruthy();
    expect(findLegendaryArtActivation([{ id: 'weapon_art', name: iron.name }], arts)).toBeNull();
    expect(findLegendaryArtActivation([{ id: 'luna', name: legendary.name }], arts)).toBeNull();
    expect(findLegendaryArtActivation([], arts)).toBeNull();
    expect(findLegendaryArtActivation(undefined, arts)).toBeNull();
  });
});
