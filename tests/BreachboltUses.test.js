// Breachbolt shots per battle (docs/specs/dusk-pressure.md 2c): the player's copy fires
// `uses` times a battle, an enemy's `usesByFaction.enemy` times, and nothing ever spent
// them before (an enemy siege caster fired every enemy phase). Each test pins one way
// that can break: the use is never spent, a spent tome still counters or attacks, the
// enemy goes inert instead of falling back, Danger keeps drawing the spent 3-10 reach,
// or the card promises a count the data does not hold.
import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import {
  canCounter,
  getCombatForecast,
  getPerBattleRemainingUses,
  nextStrikeWeapon,
  resolveCombat,
  settlePerBattleWeaponUses,
} from '../src/engine/Combat.js';
import { canAttackWithWeapon } from '../src/engine/AttackOptions.js';
import { applyEnemySpawnGear } from '../src/engine/EnemySpawnGear.js';
import { settleCombatWeapons } from '../src/engine/PerBattleWeapons.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { itemKeywords, perBattleUsesText } from '../src/engine/ItemKeywords.js';
import { computeDangerTiles } from '../src/engine/ThreatForecast.js';
import { Grid } from '../src/engine/Grid.js';
import { HeadlessBattle, HEADLESS_STATES } from './harness/HeadlessBattle.js';
import { loadFixture } from './fixtures/battles/index.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const BOLT = data.weapons.find((w) => w.name === 'Breachbolt');
// The owner's numbers, stated independently of the code under test.
const PLAYER_SHOTS = 3;
const ENEMY_SHOTS = 5;

function caster(faction, extra = {}) {
  const bolt = weapon('Breachbolt');
  const fire = weapon('Fire');
  return {
    name: faction === 'enemy' ? 'Sage' : 'Mira',
    faction,
    className: 'Sage',
    level: 10,
    col: 0,
    row: 0,
    stats: { HP: 40, STR: 2, MAG: 20, SKL: 12, SPD: 8, DEF: 6, RES: 10, LCK: 5, MOV: 5 },
    currentHP: 40,
    mov: 5,
    moveType: 'Infantry',
    proficiencies: [{ type: 'Tome', rank: 'Mast' }],
    skills: [],
    weapon: bolt,
    inventory: [bolt, fire],
    ...extra,
  };
}

function soldier(faction, col, row) {
  const lance = weapon('Iron Lance');
  return {
    name: 'Soldier',
    faction,
    className: 'Soldier',
    level: 5,
    col,
    row,
    stats: { HP: 60, STR: 6, MAG: 0, SKL: 5, SPD: 4, DEF: 30, RES: 30, LCK: 0, MOV: 4 },
    currentHP: 60,
    mov: 4,
    moveType: 'Infantry',
    proficiencies: [{ type: 'Lance', rank: 'Prof' }],
    skills: [],
    weapon: lance,
    inventory: [lance],
  };
}

const fight = (atk, def, dist) =>
  resolveCombat(atk, atk.weapon, def, def.weapon, dist, null, null, { skillsData: data.skills });

describe('Breachbolt data and cards', () => {
  it('holds the owner numbers', () => {
    expect(BOLT.uses).toBe(PLAYER_SHOTS);
    expect(BOLT.usesByFaction.enemy).toBe(ENEMY_SHOTS);
  });

  it('the siege keyword and the uses line read the same counts the engine spends', () => {
    const siege = itemKeywords(BOLT).find((k) => k.id === 'siege');
    expect(siege.title).toContain(`${PLAYER_SHOTS} shots per battle`);
    expect(siege.title).toContain(`an enemy's: ${ENEMY_SHOTS}`);
    const mira = caster('player');
    expect(perBattleUsesText(mira.weapon, mira)).toBe(
      `Uses ${PLAYER_SHOTS}/${PLAYER_SHOTS} this battle`,
    );
    mira.weapon._usesSpent = 1;
    expect(perBattleUsesText(mira.weapon, mira)).toBe(
      `Uses ${PLAYER_SHOTS - 1}/${PLAYER_SHOTS} this battle`,
    );
    expect(perBattleUsesText(weapon('Fire'), mira)).toBeNull();
  });
});

describe('spending shots', () => {
  it('each combat the wielder strikes in spends one shot, hit or miss', () => {
    const mira = caster('player');
    for (let shot = 1; shot <= PLAYER_SHOTS; shot++) {
      const target = soldier('enemy', 5, 0);
      const result = fight(mira, target, 5);
      settlePerBattleWeaponUses(mira, target, result);
      expect(getPerBattleRemainingUses(mira.weapon, mira)).toBe(PLAYER_SHOTS - shot);
    }
    // Spent: the attack menu no longer offers it, the unit keeps its Fire.
    expect(canAttackWithWeapon(mira, mira.weapon)).toBe(false);
    expect(canAttackWithWeapon(mira, mira.inventory[1])).toBe(true);
  });

  it('a counter with it spends a shot; a spent tome cannot counter', () => {
    const sage = caster('enemy');
    const attacker = soldier('player', 4, 0);
    attacker.weapon = weapon('Javelin'); // stretched to reach the Sage at range 3
    attacker.weapon.range = '3';
    attacker.inventory = [attacker.weapon];
    const result = fight(attacker, sage, 3);
    expect(result.events.some((e) => e.type === 'strike' && e.attackerSide === 'defender')).toBe(
      true,
    );
    settlePerBattleWeaponUses(attacker, sage, result);
    expect(getPerBattleRemainingUses(sage.weapon, sage)).toBe(ENEMY_SHOTS - 1);

    sage.weapon._usesSpent = ENEMY_SHOTS;
    expect(canCounter(sage, sage.weapon, 3)).toBe(false);
    const forecast = getCombatForecast(
      attacker,
      attacker.weapon,
      sage,
      sage.weapon,
      3,
      null,
      null,
      {
        skillsData: data.skills,
      },
    );
    expect(forecast.defender.canCounter).toBe(false);
  });

  it('a side that did not strike spends nothing', () => {
    const sage = caster('enemy');
    const attacker = soldier('player', 1, 0); // adjacent: Breachbolt (3-10) cannot answer
    const result = fight(attacker, sage, 1);
    settlePerBattleWeaponUses(attacker, sage, result);
    expect(getPerBattleRemainingUses(sage.weapon, sage)).toBe(ENEMY_SHOTS);
  });
});

describe('a weapon that runs dry is swapped out at once', () => {
  it('a player unit equips its next usable weapon after the last shot, and counters with it', () => {
    const mira = caster('player');
    for (let shot = 1; shot <= PLAYER_SHOTS; shot++) {
      const target = soldier('enemy', 5, 0);
      const { swaps } = settleCombatWeapons(mira, target, fight(mira, target, 5));
      if (shot < PLAYER_SHOTS) expect(swaps).toEqual([]);
      else expect(swaps.map((x) => [x.from.name, x.to.name])).toEqual([['Breachbolt', 'Fire']]);
    }
    expect(mira.weapon.name).toBe('Fire');
    expect(mira.inventory[0]).toBe(mira.weapon); // equipped first, as a manual equip
    const foe = soldier('enemy', 1, 0);
    const forecast = getCombatForecast(foe, foe.weapon, mira, mira.weapon, 1, null, null, {
      skillsData: data.skills,
    });
    expect(forecast.defender.canCounter).toBe(true);
  });

  it('an enemy swaps right after its last shot, not at its next turn', () => {
    const sage = caster('enemy');
    sage.weapon._usesSpent = ENEMY_SHOTS - 1;
    const target = soldier('player', 5, 0);
    const { swaps } = settleCombatWeapons(sage, target, fight(sage, target, 5));
    expect(swaps).toHaveLength(1);
    expect(sage.weapon.name).toBe('Fire');
    expect(canCounter(sage, sage.weapon, 1)).toBe(true);
  });

  it('a player unit keeps the spent tome when it cannot equip anything else', () => {
    const mira = caster('player');
    mira.inventory = [mira.weapon, weapon('Iron Sword')]; // no Sword rank
    mira.weapon._usesSpent = PLAYER_SHOTS - 1;
    const target = soldier('enemy', 5, 0);
    const { swaps } = settleCombatWeapons(mira, target, fight(mira, target, 5));
    expect(swaps).toEqual([]);
    expect(mira.weapon.name).toBe('Breachbolt');
  });

  it('the battle announces a swap for the player own units only', () => {
    const scene = { showBriefBanner: vi.fn(() => Promise.resolve()) };
    BattleScene.prototype._announceWeaponSwaps.call(scene, [
      { unit: { name: 'Mira', faction: 'player' }, to: { name: 'Fire' } },
      { unit: { name: 'Sage', faction: 'enemy' }, to: { name: 'Fire' } },
    ]);
    expect(scene.showBriefBanner).toHaveBeenCalledTimes(1);
    expect(scene.showBriefBanner.mock.calls[0][0]).toContain('Mira');
    expect(scene.showBriefBanner.mock.calls[0][0]).toContain('Fire');
  });
});

describe('enemy siege gear and fallback', () => {
  it('a siege spawn carries the tome equipped with its own weapon behind it', () => {
    const own = weapon('Fire');
    const enemy = {
      proficiencies: [{ type: 'Tome', rank: 'Mast' }],
      weapon: own,
      inventory: [own],
    };
    applyEnemySpawnGear(enemy, { siegeWeapon: 'Breachbolt' }, { weapons: data.weapons });
    expect(enemy.weapon.name).toBe('Breachbolt');
    expect(enemy.inventory.map((w) => w.name)).toEqual(['Breachbolt', 'Fire']);
  });

  it('once spent, the next strike weapon is the fallback (null with none)', () => {
    const sage = caster('enemy');
    expect(nextStrikeWeapon(sage)).toBe(sage.weapon);
    sage.weapon._usesSpent = ENEMY_SHOTS;
    expect(nextStrikeWeapon(sage).name).toBe('Fire');
    expect(nextStrikeWeapon({ ...sage, inventory: [sage.weapon] })).toBeNull();
  });

  it('Danger draws the fallback reach, not the spent 3-10', () => {
    const map = Array.from({ length: 41 }, () => Array(41).fill(0));
    const stub = new Proxy({}, { get: (t, p) => (p === 'destroy' ? () => {} : () => stub) });
    const scene = {
      cameras: { main: { width: 640, height: 480 } },
      add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
      textures: { exists: () => false },
    };
    const g = new Grid(scene, 41, 41, data.terrain, map, false);
    const sage = caster('enemy', { col: 20, row: 20 });
    const ctx = {
      grid: g,
      enemyUnits: [sage],
      ballistas: [],
      positions: () => new Map([['20,20', { faction: 'enemy' }]]),
      costModifier: () => 0,
    };
    const far = (tiles) =>
      Math.max(
        ...tiles
          .filter((t) => t.damageThreat)
          .map((t) => Math.abs(t.col - 20) + Math.abs(t.row - 20)),
      );
    expect(far(computeDangerTiles(ctx))).toBe(5 + 10); // MOV 5 + Breachbolt 10
    sage.weapon._usesSpent = ENEMY_SHOTS;
    expect(far(computeDangerTiles(ctx))).toBe(5 + 2); // MOV 5 + Fire 2
  });
});

describe('an enemy siege caster through the headless enemy phase', () => {
  afterEach(() => restoreMathRandom());

  /** One sturdy player unit at 0,0 and a siege Sage nine tiles away on open ground. */
  function siegeDuel({ fallback = true } = {}) {
    installSeed(7);
    const fixture = loadFixture('act1_rout_basic');
    const battle = new HeadlessBattle(data, { ...fixture.battleParams }, fixture.buildRoster(data));
    battle.init();
    const target = battle.playerUnits[0];
    battle.playerUnits = [target];
    Object.assign(target.stats, { HP: 999, DEF: 99, RES: 99, SPD: 99, LCK: 99 });
    target.currentHP = 999;
    const rows = battle.battleConfig.mapLayout.length;
    const cols = battle.battleConfig.mapLayout[0].length;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) battle.battleConfig.mapLayout[r][c] = 0;
    battle.grid.mapLayout = battle.battleConfig.mapLayout;
    target.col = 0;
    target.row = 0;
    battle.enemyUnits = [];
    const sage = battle._addEnemyFromSpawn({
      className: 'Sage',
      level: 10,
      col: Math.min(cols - 1, 9),
      row: 0,
      siegeWeapon: 'Breachbolt',
    });
    if (!fallback) sage.inventory = [sage.weapon];
    const strikesBy = [];
    const original = battle._executeEnemyCombat.bind(battle);
    battle._executeEnemyCombat = (enemy, foe) => {
      strikesBy.push(enemy.weapon.name);
      return original(enemy, foe);
    };
    const run = async (phases) => {
      for (let turn = 1; turn <= phases; turn++) {
        battle.turnManager.turnNumber = turn;
        battle.turnManager.currentPhase = 'enemy';
        battle.battleState = HEADLESS_STATES.ENEMY_PHASE;
        sage.hasActed = false;
        await battle._processEnemyPhase();
        if (battle.battleState === HEADLESS_STATES.BATTLE_END) break;
      }
    };
    return { battle, sage, strikesBy, run };
  }

  it('fires exactly its enemy shots, then fights on with its fallback tome', async () => {
    const { sage, strikesBy, run } = siegeDuel();
    expect(sage.weapon.name).toBe('Breachbolt');
    const fallbackName = sage.inventory[1]?.name;
    expect(fallbackName).toBeTruthy();
    await run(ENEMY_SHOTS + 3);
    expect(strikesBy.filter((n) => n === 'Breachbolt')).toHaveLength(ENEMY_SHOTS);
    expect(strikesBy.slice(0, ENEMY_SHOTS).every((n) => n === 'Breachbolt')).toBe(true);
    expect(sage.weapon.name).toBe(fallbackName);
  });

  it('with nothing to fall back on, a spent caster stops attacking (Danger shows it harmless)', async () => {
    const { sage, strikesBy, run } = siegeDuel({ fallback: false });
    await run(ENEMY_SHOTS + 4);
    expect(strikesBy).toHaveLength(ENEMY_SHOTS);
    expect(sage.weapon._usesSpent).toBe(ENEMY_SHOTS);
    expect(nextStrikeWeapon(sage)).toBeNull();
  });
});
