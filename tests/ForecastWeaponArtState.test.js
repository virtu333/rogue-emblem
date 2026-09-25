// A weapon art changes the attacker before the exchange: its HP cost, the
// Recoil Guard DEF/RES buff and a Phoenix Brooch heal all apply before
// resolveCombat runs. The forecast built its skill context in that state but
// read the numbers after restoring it, so a Recoil Guard art showed the
// counterattack 3 damage higher than it hit. The forecast is now computed in
// the same state, and the live unit is left exactly as it was.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { getCombatForecast, resolveCombat } from '../src/engine/Combat.js';
import { applyWeaponArtCost } from '../src/engine/WeaponArtSystem.js';
import { checkPhoenixBrooch } from '../src/engine/SkillSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const accessory = (name) => structuredClone(data.accessories.find((a) => a.name === name));
const art = (id) => structuredClone(data.weaponArts.arts.find((a) => a.id === id));
const plain = data.terrain.find((t) => t.name === 'Plain') || data.terrain[0];

function unit(name, faction, weaponName, extra = {}) {
  const w = weapon(weaponName);
  return {
    name,
    faction,
    className: faction === 'player' ? 'Myrmidon' : 'Cavalier',
    level: 5,
    col: faction === 'player' ? 2 : 3,
    row: 2,
    battleEntityId: faction === 'player' ? 'u1' : 'u2',
    stats: { HP: 30, STR: 9, MAG: 0, SKL: 12, SPD: 10, DEF: 5, RES: 3, LCK: 6, MOV: 5 },
    currentHP: 30,
    weapon: w,
    inventory: [w],
    consumables: [],
    skills: [],
    affixes: [],
    weaponRank: 'Prof',
    moveType: faction === 'player' ? 'Infantry' : 'Cavalry',
    ...extra,
  };
}

function scene(attacker, defender) {
  const s = new BattleScene();
  Object.assign(s, {
    gameData: data,
    grid: { getTerrainAt: () => plain, fogEnabled: false },
    turnManager: { turnNumber: 1, currentPhase: 'player' },
    runManager: null,
    playerUnits: [attacker],
    enemyUnits: [defender],
    npcUnits: [],
    registry: { get: () => null },
    _battleRewindPolicy: 'fixed-v1',
    visionBaseSeed: 7,
  });
  return s;
}

/** The pre-resolution steps of BattleScene._runCombatResolutionAtSpeed, then resolveCombat. */
function resolveAsBattle(s, attacker, defender, weaponArt, c) {
  applyWeaponArtCost(attacker, weaponArt, { weaponArtHpCostDelta: 0 });
  s._applyRecoilGuardAfterArtUse(attacker, weaponArt);
  checkPhoenixBrooch(attacker);
  const ctx = s.buildSkillCtx(attacker, defender, weaponArt);
  // Every strike lands (100·c below both Hits), none crits (above both Crits).
  vi.spyOn(Math, 'random').mockReturnValue(c);
  return resolveCombat(attacker, attacker.weapon, defender, defender.weapon, 1, plain, plain, ctx);
}

afterEach(() => vi.restoreAllMocks());

describe('weapon-art forecast is computed in the state the exchange resolves in', () => {
  it.each([
    ['Recoil Guard + Wrath Strike', 'Recoil Guard', 'sword_wrath_strike', 30],
    ['Phoenix Brooch at the edge + Precise Cut', 'Phoenix Brooch', 'sword_precise_cut', 8],
    ['no accessory + Wrath Strike (vengeance-free)', null, 'sword_wrath_strike', 20],
  ])('%s', (_label, accessoryName, artId, hp) => {
    const attacker = unit('Daska', 'player', 'Iron Sword', {
      accessory: accessoryName ? accessory(accessoryName) : null,
      currentHP: hp,
    });
    const defender = unit('Cavalier', 'enemy', 'Iron Lance', {
      stats: { HP: 60, STR: 14, MAG: 0, SKL: 8, SPD: 4, DEF: 6, RES: 2, LCK: 3, MOV: 7 },
      currentHP: 60,
    });
    const weaponArt = art(artId);
    const s = scene(attacker, defender);
    const before = structuredClone({ ...attacker, weapon: null, inventory: null });

    const forecast = s._computePlayerForecast(attacker, defender, weaponArt, {
      dist: 1,
      atkTerrain: plain,
      defTerrain: plain,
    });
    // Previewing never changes the live unit.
    expect(structuredClone({ ...attacker, weapon: null, inventory: null })).toEqual(before);
    // The old way: the context in the art's state, the numbers after restoring it.
    const stale = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      plain,
      plain,
      s._buildForecastSkillCtx(attacker, defender, weaponArt),
    );
    if (accessoryName === 'Recoil Guard')
      expect(stale.defender.damage).toBe(forecast.defender.damage + 3);

    const crit = Math.max(forecast.attacker.crit, forecast.defender.crit);
    expect(Math.min(forecast.attacker.hit, forecast.defender.hit)).toBeGreaterThan(crit + 1);
    const result = resolveAsBattle(s, attacker, defender, weaponArt, (crit + 0.5) / 100);
    const strike = (side) =>
      result.events.find((e) => e.type === 'strike' && e.attackerSide === side && !e.miss);
    expect(strike('attacker').damage).toBe(forecast.attacker.damage);
    expect(forecast.defender.canCounter).toBe(true);
    expect(strike('defender').damage).toBe(forecast.defender.damage);
  });
});
