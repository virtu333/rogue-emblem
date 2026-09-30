import { afterEach, describe, expect, it, vi } from 'vitest';
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import {
  affixForecastNotes,
  affixForecastText,
  affixSummaryText,
} from '../src/engine/AffixForecast.js';
import { getAffixCombatMods } from '../src/engine/AffixSystem.js';
import { getCombatForecast } from '../src/engine/Combat.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
import { loadGameData } from './testData.js';
const data = loadGameData();
const affixData = data.affixes;
const ids = (notes) => notes.map((n) => n.affixId);
const side = (extra = {}) => ({
  damage: 8,
  crit: 0,
  hit: 75,
  attackCount: 1,
  canCounter: true,
  ...extra,
});
const unit = (extra = {}) => ({
  name: 'Soldier',
  faction: 'enemy',
  currentHP: 8,
  stats: { HP: 20, STR: 10, MAG: 0, SKL: 10, SPD: 8, DEF: 5, RES: 5, LCK: 0 },
  skills: [],
  affixes: [],
  ...extra,
});
function notes(affixes, atk = {}, def = {}, unitExtra = {}, distance = 1) {
  return affixForecastNotes(
    unit(),
    unit({ affixes, ...unitExtra }),
    { display: { distance }, attacker: side(atk), defender: side(def) },
    affixData,
  ).defender;
}
afterEach(() => vi.restoreAllMocks());
describe('affix forecast contract', () => {
  const validate = new Ajv().compile(
    JSON.parse(readFileSync('schemas/affixes.schema.json', 'utf8')),
  );
  it('requires every affix to declare its mode and every exchange rule its text and condition', () => {
    expect(validate(affixData)).toBe(true);
    for (const affix of affixData.affixes) {
      const clone = structuredClone(affixData);
      delete clone.affixes.find((a) => a.id === affix.id).forecast;
      expect(validate(clone), affix.id).toBe(false);
      if (affix.forecast !== 'exchange') continue;
      for (const field of ['forecastText', 'forecastCondition']) {
        const bad = structuredClone(affixData);
        delete bad.affixes.find((a) => a.id === affix.id)[field];
        expect(validate(bad), `${affix.id}.${field}`).toBe(false);
      }
      expect(affixForecastText(affix)).not.toMatch(/[{}]/);
    }
  });

  // The canvas inspection row is one line of 9px text (UnitDetailOverlay): an affix with
  // no forecast line needs its own short summary, or its long description is cut off.
  it('gives every affix a short inspection line with no unfilled placeholder', () => {
    for (const affix of affixData.affixes) {
      if (affix.forecast !== 'exchange') {
        const bad = structuredClone(affixData);
        delete bad.affixes.find((a) => a.id === affix.id).summary;
        expect(validate(bad), `${affix.id}.summary`).toBe(false);
      }
      const line = `${affix.name} · ${affixSummaryText(affix)}`;
      expect(affixSummaryText(affix), affix.id).not.toBe('');
      expect(line, affix.id).not.toMatch(/[{}]/);
      expect(line.length, line).toBeLessThanOrEqual(66);
    }
    const byId = (id) => affixData.affixes.find((a) => a.id === id);
    expect(affixSummaryText(byId('regenerator'))).toBe('Heals 20% max HP each enemy phase');
    expect(affixSummaryText(byId('haste'))).toBe('+2 MOV');
    // An exchange affix's inspection line is its forecast line.
    expect(affixSummaryText(byId('thorns'))).toBe(affixForecastText(byId('thorns')));
    expect(affixForecastText(byId('thorns'))).toMatch(/^Reflects 25% /);
  });

  it('leaves an unknown placeholder visible rather than printing an empty value', () => {
    expect(affixSummaryText({ effects: {}, summary: 'Heals {nope}%' })).toBe('Heals {nope}%');
  });
  it('omits number and field affixes and never consumes RNG or mutates inputs', () => {
    const attacker = unit();
    const defender = unit({ affixes: affixData.affixes.map((a) => a.id) });
    const forecast = {
      display: { distance: 1 },
      attacker: side({ attackCount: 2 }),
      defender: side(),
    };
    const before = structuredClone({ attacker, defender, forecast, affixData });
    const rng = vi.spyOn(Math, 'random');
    const result = affixForecastNotes(attacker, defender, forecast, affixData);
    expect(ids(result.defender)).toEqual(
      affixData.affixes.filter((a) => a.forecast === 'exchange').map((a) => a.id),
    );
    expect(rng).not.toHaveBeenCalled();
    expect({ attacker, defender, forecast, affixData }).toEqual(before);
  });
});
describe('conditional consequences', () => {
  for (const id of ['venomous', 'corrosive', 'grievous']) {
    it(`${id} requires a possible hit, including a zero-damage hit`, () => {
      expect(ids(notes([id], {}, { damage: 0 }))).toEqual([id]);
      for (const def of [{ canCounter: false }, { hit: 0 }, { attackCount: 0 }])
        expect(notes([id], {}, def)).toEqual([]);
    });
  }
  it('Shielded has one warning until the phase shield is spent', () => {
    expect(ids(notes(['shielded']))).toEqual(['shielded']);
    expect(notes(['shielded'], {}, {}, { _hitByPlayerThisPhase: true })).toEqual([]);
    expect(notes(['shielded'], { hit: 0 })).toEqual([]);
  });
  it('Thorns checks range, rounding, possible crits, and damage after Shielded', () => {
    expect(notes(['thorns'], { damage: 3 })).toEqual([]);
    expect(ids(notes(['thorns'], { damage: 3, crit: 1 }))).toEqual(['thorns']);
    expect(notes(['thorns'], {}, {}, {}, 2)).toEqual([]);
    expect(ids(notes(['shielded', 'thorns']))).toEqual(['shielded']);
    expect(ids(notes(['shielded', 'thorns'], { attackCount: 2 }))).toEqual(['shielded', 'thorns']);
  });
  it('Teleporter needs damage after Shielded', () => {
    expect(ids(notes(['teleporter']))).toEqual(['teleporter']);
    expect(notes(['teleporter'], { damage: 0 })).toEqual([]);
    expect(ids(notes(['shielded', 'teleporter']))).toEqual(['shielded']);
  });
  it('Deathburst warns for possible crit/double kills, with an adjacent opponent', () => {
    expect(notes(['deathburst'], { damage: 3 })).toEqual([]);
    expect(ids(notes(['deathburst'], { damage: 3, crit: 1 }, {}, {}, 1))).toEqual(['deathburst']);
    expect(ids(notes(['deathburst'], { damage: 4, attackCount: 2 }))).toEqual(['deathburst']);
    expect(notes(['deathburst'], { damage: 8, hit: 0 })).toEqual([]);
    expect(ids(notes(['shielded', 'deathburst']))).toEqual(['shielded']);
  });
  it('only warns for a ranged blast with a living, known unit in its radius', () => {
    const attacker = unit({ col: 3, row: 1, faction: 'player' });
    const defender = unit({ col: 1, row: 1, affixes: ['deathburst'] });
    const forecast = { display: { distance: 2 }, attacker: side(), defender: side() };
    const note = (visibleUnits = []) =>
      affixForecastNotes(attacker, defender, forecast, affixData, { visibleUnits }).defender;
    expect(note()).toEqual([]);
    // All factions can be hit. Unseen occupants are deliberately absent from this input.
    for (const faction of ['player', 'enemy', 'npc'])
      expect(ids(note([unit({ faction, col: 2, row: 1 })]))).toEqual(['deathburst']);
    expect(note([unit({ col: 1, row: 3 })])).toEqual([]);
    expect(note([unit({ col: 2, row: 1, currentHP: 0 }), defender])).toEqual([]);
  });
  it('puts an initiating enemy affix in the attacker column', () => {
    const result = affixForecastNotes(
      unit({ affixes: ['venomous'] }),
      unit(),
      { display: { distance: 1 }, attacker: side(), defender: side({ canCounter: false }) },
      affixData,
    );
    expect(ids(result.attacker)).toEqual(['venomous']);
    expect(result.defender).toEqual([]);
  });
  it('uses real forecast counter rules for range, sleep and counter prevention', () => {
    const sword = data.weapons.find((w) => w.name === 'Iron Sword');
    const bow = data.weapons.find((w) => w.name === 'Iron Bow');
    const attacker = unit({ faction: 'player', currentHP: 20 });
    const defender = unit({ affixes: ['venomous', 'corrosive', 'grievous'], currentHP: 20 });
    const ctx = { affixData, atkMods: {}, defMods: {} };
    const forecast = (weapon = sword, dist = 1, context = ctx) =>
      getCombatForecast(attacker, weapon, defender, sword, dist, null, null, context);
    expect(ids(forecast().defender.affixNotes)).toEqual(['venomous', 'corrosive', 'grievous']);
    expect(forecast(bow, 2).defender.affixNotes).toEqual([]);
    expect(
      forecast(sword, 1, { ...ctx, atkMods: { preventCounter: true } }).defender.affixNotes,
    ).toEqual([]);
    applyCondition(defender, 'sleep', 3);
    expect(forecast().defender.affixNotes).toEqual([]);
  });
  it('does not promise Wounded against status immunity', () => {
    const result = affixForecastNotes(
      unit({ affixes: ['grievous'] }),
      unit({ accessory: { combatEffects: { statusImmunity: true } } }),
      { display: { distance: 1 }, attacker: side(), defender: side() },
      affixData,
    );
    expect(result.attacker).toEqual([]);
  });
  it('labels Rally aura sources while keeping stacked attack bonuses', () => {
    const fighter = unit({ col: 1, row: 1 });
    const allies = [
      unit({ col: 2, row: 1, affixes: ['rally'] }),
      unit({ col: 1, row: 2, affixes: ['rally'] }),
    ];
    const mods = getAffixCombatMods(fighter, unit(), allies, affixData, null);
    expect(mods.atkBonus).toBe(6);
    expect(mods.activated).toEqual([{ id: 'rally', name: 'Rally' }]);
  });
});
