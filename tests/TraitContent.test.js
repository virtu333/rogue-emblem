// Trait text shown on recruit / boss-recruit cards, the roster sheet and unit
// details: every line must be concrete for the unit it describes.
import { describe, it, expect } from 'vitest';
import { traitEffectText, traitLines } from '../src/ui/traitContent.js';
import { parseWeaponProficiencies } from '../src/engine/UnitManager.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const trait = (id) => gameData.traits.find((t) => t.id === id);

function unitOf(className, traits = [], extra = {}) {
  const cls = gameData.classes.find((c) => c.name === className);
  return {
    name: 'Aldric',
    className,
    moveType: cls.moveType,
    proficiencies: parseWeaponProficiencies(cls.weaponProficiencies),
    skills: className === 'Dancer' ? ['dance'] : [],
    traits,
    ...extra,
  };
}

const RECRUIT_CLASSES = gameData.classes
  .filter((c) => c.tier !== 'boss' && c.weaponProficiencies && !c.lordOnly)
  .map((c) => c.name);

describe('trait effect text', () => {
  it('names the stat Kindled actually raises for this unit', () => {
    expect(traitEffectText(trait('gifted'), unitOf('Mage', ['gifted']), gameData)).toBe(
      '+1 Mag and +10% Mag growth (the stat it fights with).',
    );
    expect(traitEffectText(trait('gifted'), unitOf('Cleric', ['gifted']), gameData)).toBe(
      '+1 Mag and +10% Mag growth (the stat it heals with).',
    );
    expect(traitEffectText(trait('gifted'), unitOf('Cavalier', ['gifted']), gameData)).toBe(
      '+1 Str and +10% Str growth (the stat it fights with).',
    );
    // A recorded attack stat wins (a Cleric promoted into Battle Monk kept Mag).
    const monk = unitOf('Battle Monk', ['gifted'], { traitAttackStat: 'MAG' });
    expect(traitEffectText(trait('gifted'), monk, gameData)).toMatch(/^\+1 Mag/);
  });

  it('without a unit it reads as the catalog rule', () => {
    expect(traitEffectText(trait('gifted'))).toBe('+1 Str or Mag and +10% Str or Mag growth.');
    expect(traitEffectText(trait('slow_oath'))).toBe(trait('slow_oath').description);
  });

  it('shows the real mastery threshold and the doubled class perk side by side', () => {
    const cavalier = unitOf('Cavalier', ['slow_oath']);
    expect(traitEffectText(trait('slow_oath'), cavalier, gameData)).toBe(
      'Masters its class in 10 battles, not 8; Wayfarer becomes +2 Atk, +2 Spd (from +1 Atk, +1 Spd).',
    );
    expect(traitEffectText(trait('studious'), unitOf('Knight', ['studious']), gameData)).toBe(
      'Masters its class in 6 battles, not 8.',
    );
  });

  it('explains stacked mastery traits instead of contradicting itself', () => {
    const both = unitOf('Cavalier', ['studious', 'slow_oath']);
    expect(traitEffectText(trait('studious'), both, gameData)).toBe(
      'Masters its class 2 battles sooner (8 with its other traits).',
    );
    expect(traitEffectText(trait('slow_oath'), both, gameData)).toMatch(
      /^Masters its class 2 battles later \(8 with its other traits\); Wayfarer becomes/,
    );
  });

  it('promoted units show their base family perk', () => {
    const paladin = unitOf('Paladin', ['slow_oath']);
    expect(traitEffectText(trait('slow_oath'), paladin, gameData)).toMatch(/Wayfarer becomes/);
  });

  it('combat, XP, legendary and retired traits read as their catalog line', () => {
    for (const id of ['reckless', 'stalwart', 'quick_study', 'standard_bearer', 'steady', 'lazy'])
      expect(traitEffectText(trait(id), unitOf('Fighter', [id]), gameData)).toBe(
        trait(id).description,
      );
  });

  it('every trait on every class produces a clean, card-sized line', () => {
    for (const className of RECRUIT_CLASSES)
      for (const t of gameData.traits) {
        const text = traitEffectText(t, unitOf(className, [t.id]), gameData);
        expect(text.length, `${t.id} on ${className}`).toBeGreaterThan(0);
        expect(text.length, `${t.id} on ${className}`).toBeLessThanOrEqual(110);
        expect(text).not.toMatch(/undefined|NaN|\{|ATTACK/);
      }
  });
});

describe('trait lines on recruit cards', () => {
  it('lists name + concrete effect, flags legendaries, skips unknown ids', () => {
    const unit = unitOf('Mage', ['gifted', 'mystery', 'reckless']);
    expect(traitLines(unit, gameData)).toEqual([
      {
        id: 'gifted',
        name: 'Kindled',
        text: '+1 Mag and +10% Mag growth (the stat it fights with).',
        legendary: false,
      },
      {
        id: 'reckless',
        name: 'Reckless',
        text: trait('reckless').description,
        legendary: false,
      },
    ]);
    expect(traitLines({ traits: ['standard_bearer'] }, gameData)[0].legendary).toBe(true);
    expect(traitLines({}, gameData)).toEqual([]);
  });
});
