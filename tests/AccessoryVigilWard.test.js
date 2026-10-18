// A Vigil Voice's ward (engine/Vigil.js, `unit.warded`) and the Warden's Buckler / Briar Cloak
// (AccessoryWard, AccessoryReactions) on the same unit: a warded blow lands for 0 before any
// defence reads it, so the Buckler is never spent on it and the cloak never pricks off it.
// Unwarded, the same accessories work (the controls), so the test can fail either way.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCombatForecast, resolveCombat } from '../src/engine/Combat.js';
import { wardReady } from '../src/engine/AccessoryWard.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const accessory = (name) => structuredClone(gameData.accessories.find((a) => a.name === name));
const sword = { name: 'Iron Sword', type: 'Sword', might: 5, hit: 100, crit: 0, range: '1' };

afterEach(() => vi.restoreAllMocks());

const unit = (name, extra = {}) => ({
  name,
  stats: { HP: 30, STR: 20, MAG: 0, SKL: 0, SPD: 10, DEF: 2, RES: 2, LCK: 0, MOV: 5 },
  currentHP: 30,
  weapon: sword,
  proficiencies: [{ type: 'Sword', rank: 'Prof' }],
  skills: [],
  accessory: null,
  ...extra,
});

describe("a Voice's ward with the Buckler and the Briar Cloak", () => {
  it('a warded blow spends no Buckler and the strike says the Voice ward, not the Buckler', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const voice = unit('V', { warded: true, accessory: accessory("Warden's Buckler") });
    const result = resolveCombat(unit('A'), sword, voice, sword, 1, null, null);
    const onVoice = result.events.filter((e) => e.target === 'V' && !e.miss);
    expect(onVoice.length).toBeGreaterThan(0);
    for (const e of onVoice) {
      expect(e).toMatchObject({ damage: 0, warded: true });
      expect(e.buckler).toBeUndefined();
    }
    expect(wardReady(voice)).toBe(true);

    // Control: unwarded, the first blow (20 + 5 - 2 = 23) is held to 1 and spends it.
    const plain = unit('V', { accessory: accessory("Warden's Buckler") });
    const open = resolveCombat(unit('A'), sword, plain, sword, 1, null, null);
    const first = open.events.find((e) => e.target === 'V' && !e.miss);
    expect(first).toMatchObject({ damage: 1, buckler: true });
    expect(first.warded).toBeUndefined();
    expect(wardReady(plain)).toBe(false);
  });

  it('a warded blow draws no prick from the Briar Cloak, in the forecast or the exchange', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const voice = unit('V', { warded: true, accessory: accessory('Briar Cloak') });
    const fc = getCombatForecast(unit('A'), sword, voice, sword, 1, null, null);
    expect(fc.attacker.thornsReflect).toBe(0);
    expect(fc.attacker).not.toHaveProperty('briar');
    const result = resolveCombat(unit('A'), sword, voice, sword, 1, null, null);
    for (const e of result.events.filter((x) => x.target === 'V' && !x.miss))
      expect(e.reflectDamage).toBe(0);
    expect(result.attackerHP).toBe(30 - fc.defender.damage); // only the counter, no prick
    expect(fc.defender.damage).toBe(20 + 5 - 2);

    // Control: unwarded, each landed blow pricks for the cloak's 5.
    const plain = unit('V', { accessory: accessory('Briar Cloak') });
    const ofc = getCombatForecast(unit('A'), sword, plain, sword, 1, null, null);
    expect(ofc.attacker.briar).toBe(5);
    const open = resolveCombat(unit('A'), sword, plain, sword, 1, null, null);
    expect(open.events.find((e) => e.target === 'V' && !e.miss).reflectDamage).toBe(5);
  });
});
