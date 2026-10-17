// Weapon durability as uses per battle (engine/WeaponUses.js, data/weaponUses.json): every
// combat weapon a player unit holds has its tier's uses each battle and refills after it.
// Each test pins one way it can break: a use is not spent (or spent by a side that never
// struck, or twice for a double), an enemy's weapon starts counting, a spent weapon still
// attacks or counters, the unit is left unarmed when it carries another weapon, the
// victory does not refill (roster or convoy), the switch off does not turn it off, a staff
// or Breachbolt changes count, the validator lets a tier through unlisted, or the forecast
// and banners say the wrong thing.
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import {
  canCounter,
  getCombatForecast,
  getPerBattleMaxUses,
  getPerBattleRemainingUses,
  getStaffMaxUses,
  resolveCombat,
  tracksBattleUses,
} from '../src/engine/Combat.js';
import { canAttackWithWeapon } from '../src/engine/AttackOptions.js';
import {
  settleCombatWeapons,
  spendAreaStrikeShot,
  strandedSpentWeaponMessages,
  weaponSwapMessage,
} from '../src/engine/PerBattleWeapons.js';
import {
  refillBattleUses,
  setWeaponUsesConfigForTesting,
  validateWeaponUsesConfig,
} from '../src/engine/WeaponUses.js';
import {
  equippedWeaponUsesLine,
  plannedWeaponUsesNote,
  weaponUsesShort,
} from '../src/engine/ItemKeywords.js';
import { forecastNotes } from '../src/ui/forecastDisplay.js';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';
import { readFileSync } from 'node:fs';

const weaponUsesData = JSON.parse(
  readFileSync(new URL('../data/weaponUses.json', import.meta.url), 'utf8'),
);

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));
// The owner's numbers (Dave, 2026-10-17: 10 is the floor), stated apart from the code.
const OWNER_USES = { Iron: 20, Steel: 15, Silver: 10, Rare: 10, Legend: 12, Epic: 12 };

function fighter(faction, { col = 0, row = 0, name, gear = ['Iron Sword'], ...extra } = {}) {
  const inventory = gear.map(weapon);
  return {
    name: name || (faction === 'player' ? 'Kira' : 'Brigand'),
    faction,
    className: 'Myrmidon',
    level: 10,
    col,
    row,
    stats: { HP: 999, STR: 0, MAG: 0, SKL: 10, SPD: 5, DEF: 99, RES: 99, LCK: 0, MOV: 5 },
    currentHP: 999,
    mov: 5,
    moveType: 'Infantry',
    proficiencies: [
      { type: 'Sword', rank: 'Mast' },
      { type: 'Lance', rank: 'Mast' },
    ],
    skills: [],
    weapon: inventory[0],
    inventory,
    ...extra,
  };
}

const fight = (atk, def, dist = 1) =>
  resolveCombat(atk, atk.weapon, def, def.weapon, dist, null, null, { skillsData: data.skills });

afterEach(() => setWeaponUsesConfigForTesting(null));

describe('the data', () => {
  it('holds the owner numbers, switched on', () => {
    expect(weaponUsesData.enabled).toBe(true);
    expect(weaponUsesData.byTier).toEqual(OWNER_USES);
    expect(Math.min(...Object.values(weaponUsesData.byTier))).toBeGreaterThanOrEqual(10);
  });

  it('a player weapon has its tier uses; an enemy and an NPC ally have no count', () => {
    for (const name of ['Iron Sword', 'Steel Sword', 'Silver Sword']) {
      const w = weapon(name);
      expect(getPerBattleMaxUses(w, { faction: 'player' })).toBe(OWNER_USES[w.tier]);
      expect(tracksBattleUses(w, { faction: 'enemy' })).toBe(false);
      expect(tracksBattleUses(w, { faction: 'npc' })).toBe(false);
    }
  });

  it('Breachbolt keeps its own shots and a staff its own uses', () => {
    const bolt = weapon('Breachbolt');
    expect(getPerBattleMaxUses(bolt, { faction: 'player' })).toBe(bolt.uses);
    expect(getPerBattleMaxUses(bolt, { faction: 'enemy' })).toBe(bolt.usesByFaction.enemy);
    const heal = weapon('Heal');
    expect(tracksBattleUses(heal, { faction: 'player' })).toBe(false);
    expect(getStaffMaxUses(heal, { stats: { MAG: 0 } })).toBe(heal.uses);
  });

  it('the validator wants every weapon tier listed with at least 1 use', () => {
    expect(validateWeaponUsesConfig(weaponUsesData, { weapons: data.weapons })).toEqual([]);
    const { Epic, ...noEpic } = weaponUsesData.byTier;
    expect(Epic).toBeGreaterThan(0);
    expect(
      validateWeaponUsesConfig({ ...weaponUsesData, byTier: noEpic }, { weapons: data.weapons }),
    ).toContain('byTier has no entry for weapon tier Epic');
    expect(
      validateWeaponUsesConfig(
        { ...weaponUsesData, byTier: { ...weaponUsesData.byTier, Iron: 0 } },
        { weapons: data.weapons },
      ),
    ).toContain('byTier.Iron must be a whole number >= 1');
  });
});

describe('spending uses', () => {
  it('each combat the player weapon strikes in spends one use, a double included', () => {
    const kira = fighter('player', { stats: undefined });
    kira.stats = { HP: 999, STR: 30, MAG: 0, SKL: 30, SPD: 30, DEF: 99, RES: 99, LCK: 0, MOV: 5 };
    const foe = fighter('enemy', { col: 1 });
    foe.stats.HP = 999;
    const result = fight(kira, foe);
    const kiraStrikes = result.events.filter(
      (e) => e.type === 'strike' && e.attackerSide === 'attacker',
    );
    expect(kiraStrikes.length).toBe(2); // she doubles
    settleCombatWeapons(kira, foe, result);
    expect(getPerBattleRemainingUses(kira.weapon, kira)).toBe(OWNER_USES.Iron - 1);
    // The foe countered and spends nothing: enemies have no count.
    expect(foe.weapon._usesSpent ?? 0).toBe(0);
  });

  it('a counter spends a use; a side that never struck spends none', () => {
    const kira = fighter('player', { col: 1 });
    const foe = fighter('enemy');
    settleCombatWeapons(foe, kira, fight(foe, kira));
    expect(getPerBattleRemainingUses(kira.weapon, kira)).toBe(OWNER_USES.Iron - 1);

    const archer = fighter('enemy', { col: 2, gear: ['Iron Bow'] });
    archer.proficiencies = [{ type: 'Bow', rank: 'Mast' }];
    const out = fight(archer, kira, 2); // a sword cannot answer from 2
    expect(out.events.some((e) => e.type === 'strike' && e.attackerSide === 'defender')).toBe(
      false,
    );
    settleCombatWeapons(archer, kira, out);
    expect(getPerBattleRemainingUses(kira.weapon, kira)).toBe(OWNER_USES.Iron - 1);
  });

  it('a spent weapon cannot attack or counter, and the unit switches to the next one', () => {
    const kira = fighter('player', { gear: ['Silver Sword', 'Iron Lance'] });
    kira.weapon._usesSpent = OWNER_USES.Silver - 1;
    const foe = fighter('enemy', { col: 1 });
    const { swaps } = settleCombatWeapons(kira, foe, fight(kira, foe));
    expect(swaps.map((s) => [s.from.name, s.to.name])).toEqual([['Silver Sword', 'Iron Lance']]);
    expect(weaponSwapMessage(swaps[0])).toBe(
      "Kira's Silver Sword is spent: now wielding Iron Lance",
    );
    const silver = kira.inventory.find((w) => w.name === 'Silver Sword');
    expect(canAttackWithWeapon(kira, silver)).toBe(false);
    expect(canCounter(kira, silver, 1)).toBe(false);
    expect(canAttackWithWeapon(kira, kira.weapon)).toBe(true);
  });

  it('with nothing else to wield, the unit keeps the spent weapon and says so once', () => {
    const kira = fighter('player');
    kira.weapon._usesSpent = OWNER_USES.Iron;
    const foe = fighter('enemy', { col: 1 });
    const forecast = getCombatForecast(foe, foe.weapon, kira, kira.weapon, 1, null, null, {
      skillsData: data.skills,
    });
    expect(forecast.defender.canCounter).toBe(false);
    const announced = new WeakSet();
    expect(strandedSpentWeaponMessages([kira, foe], announced)).toEqual([
      "Kira's Iron Sword is spent for this battle",
    ]);
    expect(strandedSpentWeaponMessages([kira, foe], announced)).toEqual([]);
  });

  it('an area cast spends one use of a player weapon, none of an enemy one', () => {
    const kira = fighter('player');
    expect(spendAreaStrikeShot(kira.weapon, kira)).toBe(true);
    expect(getPerBattleRemainingUses(kira.weapon, kira)).toBe(OWNER_USES.Iron - 1);
    const foe = fighter('enemy');
    expect(spendAreaStrikeShot(foe.weapon, foe)).toBe(false);
    expect(foe.weapon._usesSpent ?? 0).toBe(0);
  });

  it('switched off, nothing counts and nothing runs dry', () => {
    setWeaponUsesConfigForTesting({ ...weaponUsesData, enabled: false });
    const kira = fighter('player');
    kira.weapon._usesSpent = 500;
    expect(tracksBattleUses(kira.weapon, kira)).toBe(false);
    expect(canAttackWithWeapon(kira, kira.weapon)).toBe(true);
    expect(canCounter(kira, kira.weapon, 1)).toBe(true);
    expect(weaponUsesShort(kira.weapon, kira)).toBeNull();
    // Breachbolt still has its shots.
    const bolt = weapon('Breachbolt');
    expect(tracksBattleUses(bolt, kira)).toBe(true);
  });
});

describe('refilling after a battle', () => {
  it('refill clears a weapon and a Breachbolt, never a consumable', () => {
    const sword = { ...weapon('Iron Sword'), _usesSpent: 7 };
    const bolt = { ...weapon('Breachbolt'), _usesSpent: 2 };
    const vul = { name: 'Vulnerary', type: 'Consumable', uses: 2, _usesSpent: 1 };
    [sword, bolt, vul].forEach(refillBattleUses);
    expect([sword._usesSpent, bolt._usesSpent, vul._usesSpent]).toEqual([0, 0, 1]);
  });

  it('a fresh staff or Breachbolt starts the battle at 0 spent, not undefined', () => {
    // The battle and its browser specs read a staff's count as a number.
    const staff = { ...weapon('Warp Staff') };
    const bolt = { ...weapon('Breachbolt') };
    delete staff._usesSpent;
    delete bolt._usesSpent;
    [staff, bolt].forEach(refillBattleUses);
    expect([staff._usesSpent, bolt._usesSpent]).toEqual([0, 0]);
  });

  it('a victory refills the roster and the convoy', () => {
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 21, difficultyId: 'normal', applyBlessingsAtStart: false });
    const node = rm.getAvailableNodes().find((n) => n.type === 'battle');
    const roster = rm.getRoster();
    for (const u of roster) for (const w of u.inventory || []) w._usesSpent = 3;
    rm.convoy.weapons = [{ ...weapon('Steel Lance'), _usesSpent: 4 }];
    rm.completeBattle(roster, node.id, 0, { turnCount: 5, turnPar: 7 });
    const spent = [
      ...rm.getRoster().flatMap((u) => u.inventory || []),
      ...rm.convoy.weapons,
    ].filter((w) => w.type !== 'Consumable' && w.type !== 'Scroll');
    expect(spent.length).toBeGreaterThan(1);
    expect(spent.every((w) => !w._usesSpent)).toBe(true);
  });
});

describe('what the player reads', () => {
  it('the unit card and inspect line show the equipped weapon uses', () => {
    const kira = fighter('player');
    kira.weapon._usesSpent = 8;
    expect(weaponUsesShort(kira.weapon, kira)).toBe(`${OWNER_USES.Iron - 8}/${OWNER_USES.Iron}`);
    expect(equippedWeaponUsesLine(kira)).toBe(
      `Iron Sword: ${OWNER_USES.Iron - 8}/${OWNER_USES.Iron} uses this battle`,
    );
    expect(equippedWeaponUsesLine(fighter('enemy'))).toBeNull();
  });

  it("the forecast always gives the planned weapon's uses, for each weapon cycled to", () => {
    const kira = fighter('player', { gear: ['Silver Sword', 'Iron Sword'] });
    const [silver, iron] = kira.inventory;
    silver._usesSpent = 3;
    const foe = fighter('enemy', { col: 1 });
    const forecast = getCombatForecast(kira, silver, foe, foe.weapon, 1, null, null, {
      skillsData: data.skills,
    });
    const notesFor = (planned) =>
      forecastNotes(forecast, true, forecast.attacker.hp, {
        planned,
        equipped: silver,
        unit: kira,
      });
    expect(notesFor(silver)).toContain(
      `Silver Sword: ${OWNER_USES.Silver - 3}/${OWNER_USES.Silver} uses this battle`,
    );
    expect(notesFor(iron)).toContain(
      `Iron Sword: ${OWNER_USES.Iron}/${OWNER_USES.Iron} uses this battle`,
    );
    // No warning wording at any count (Dave, 2026-10-17): the count is the whole note.
    silver._usesSpent = OWNER_USES.Silver - 1;
    expect(notesFor(silver)).toContain(`Silver Sword: 1/${OWNER_USES.Silver} uses this battle`);
    // The defending side, and a foe's weapon, say nothing about uses.
    const defending = forecastNotes(forecast, false, forecast.attacker.hp, { unit: kira });
    expect(defending.some((n) => n.includes('uses this battle'))).toBe(false);
    expect(plannedWeaponUsesNote(foe.weapon, foe)).toBeNull();
  });
});
