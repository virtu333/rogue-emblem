// The headless harness mirrors three BattleScene behaviours it used to skip, so sims
// and fuzzers see the same battle: the anti-turtle clock (engine/TurnPressure.js), the
// gear a spawn carries (engine/EnemySpawnGear.js: siege tomes, status staves), an
// enemy actually using its status staff, and the Entity's 3x3 footprint.
import { describe, it, expect, afterEach } from 'vitest';
import { HeadlessBattle, HEADLESS_STATES } from './HeadlessBattle.js';
import { loadFixture } from '../fixtures/battles/index.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { ANTI_TURTLE_NO_PROGRESS_TURNS } from '../../src/utils/constants.js';
import { loadGameData } from '../testData.js';

const data = loadGameData();

function battleFor(seed = 11) {
  installSeed(seed);
  const fixture = loadFixture('act1_rout_basic');
  const battle = new HeadlessBattle(data, { ...fixture.battleParams }, fixture.buildRoster(data));
  battle.init();
  return battle;
}

afterEach(() => restoreMathRandom());

describe('HeadlessBattle mirrors', () => {
  it('the anti-turtle clock starts from the spawned army and turns the AI aggressive', () => {
    const quiet = battleFor();
    expect(quiet.antiTurtleState.bestEnemyCount).toBe(quiet.enemyUnits.length);
    for (let turn = 1; turn <= ANTI_TURTLE_NO_PROGRESS_TURNS; turn++) {
      expect(quiet.aiController.aggressiveMode).toBe(false);
      quiet._onPhaseChange('enemy', turn);
    }
    expect(quiet.aiController.aggressiveMode).toBe(true);

    const killing = battleFor();
    for (let turn = 1; turn <= ANTI_TURTLE_NO_PROGRESS_TURNS + 1; turn++) {
      killing.enemyUnits.pop();
      killing._onPhaseChange('enemy', turn);
    }
    expect(killing.aiController.aggressiveMode).toBe(false);
  });

  it('a spawn flagged with a siege tome or a status staff carries it', () => {
    const battle = battleFor();
    const sage = battle._addEnemyFromSpawn({
      className: 'Sage',
      level: 10,
      col: 1,
      row: 1,
      siegeWeapon: 'Breachbolt',
      statusStaff: 'silence',
    });
    expect(sage.weapon.name).toBe('Breachbolt');
    expect(sage.statusStaff?.name).toBe('Silence Staff');
  });

  it('the Entity fights and blocks from its footprint, as in the scene', () => {
    const battle = battleFor();
    const hero = battle.playerUnits[0];
    battle.playerUnits = [hero];
    battle.enemyUnits = [];
    const entity = battle._addEnemyFromSpawn({
      className: 'Entity',
      level: 20,
      col: 2,
      row: 1,
      isBoss: true,
      isEntity: true,
      name: 'The Entity',
    });
    expect(entity.isEntity).toBe(true);
    // Beside the footprint's right column (cols 2-4), four tiles from the anchor.
    hero.col = 5;
    hero.row = 3;
    hero.weapon = hero.inventory.find((w) => w.range === '1') || hero.weapon;
    hero.weapon.range = '1';
    expect(battle._findAttackTargets(hero)).toContain(entity);
    // Touching the body, a melee weapon stays equipped (no swap to a bow for the
    // anchor's distance).
    hero.proficiencies = [
      { type: 'Sword', rank: 'Mast' },
      { type: 'Bow', rank: 'Mast' },
    ];
    const sword = structuredClone(data.weapons.find((w) => w.name === 'Iron Sword'));
    const bow = structuredClone(data.weapons.find((w) => w.name === 'Iron Bow'));
    hero.inventory = [sword, bow];
    hero.weapon = sword;
    hero.col = 3; // above the top-middle body tile: the anchor is two tiles away
    hero.row = 0;
    battle._ensureValidWeaponForTarget(hero, entity);
    expect(hero.weapon).toBe(sword);
    const blocked = battle._buildUnitPositionMap('player');
    expect(blocked.has('4,3')).toBe(true); // a body tile, not the anchor
    expect(battle._getReinforcementOccupiedTiles()).toEqual(
      expect.arrayContaining([{ col: 3, row: 2 }]),
    );
  });

  it('a spent Breachbolt is neither a reach for targeting nor re-equipped', () => {
    const battle = battleFor();
    const hero = battle.playerUnits[0];
    const foe = battle.enemyUnits[0];
    battle.enemyUnits = [foe];
    hero.proficiencies = [{ type: 'Tome', rank: 'Mast' }];
    const fire = structuredClone(data.weapons.find((w) => w.name === 'Fire'));
    const bolt = structuredClone(data.weapons.find((w) => w.name === 'Breachbolt'));
    hero.inventory = [fire, bolt];
    hero.weapon = fire;
    foe.col = hero.col + 4 < battle.battleConfig.cols ? hero.col + 4 : hero.col - 4;
    foe.row = hero.row;
    expect(battle._findAttackTargets(hero)).toContain(foe); // in Breachbolt reach

    bolt._usesSpent = bolt.uses; // the player's shots are gone
    expect(battle._findAttackTargets(hero)).not.toContain(foe);
    battle._ensureValidWeaponForTarget(hero, foe);
    expect(hero.weapon).toBe(fire);
  });

  describe('a last-shot kill is credited to the weapon that struck', () => {
    // The hero's Breachbolt (Tome) fires its last shot and kills; the weapon it then
    // switches to is of another kind. Kill credit must read the Breachbolt.
    function lastShotKill(fallbackName, foeClass) {
      const battle = battleFor();
      const hero = battle.playerUnits[0];
      battle.playerUnits = [hero];
      hero.proficiencies = [
        { type: 'Tome', rank: 'Mast' },
        { type: 'Light', rank: 'Mast' },
        { type: 'Sword', rank: 'Mast' },
      ];
      Object.assign(hero.stats, { MAG: 40, SKL: 60, LCK: 30 });
      const bolt = structuredClone(data.weapons.find((w) => w.name === 'Breachbolt'));
      const fallback = structuredClone(data.weapons.find((w) => w.name === fallbackName));
      bolt._usesSpent = bolt.uses - 1;
      hero.inventory = [bolt, fallback];
      hero.weapon = bolt;
      battle.enemyUnits = [];
      const cols = battle.battleConfig.cols;
      const foe = battle._addEnemyFromSpawn({
        className: foeClass,
        level: 1,
        col: hero.col + 4 < cols ? hero.col + 4 : hero.col - 4,
        row: hero.row,
      });
      foe.currentHP = 1;
      // A second foe far away keeps the battle going (a win would commit the deeds).
      battle._addEnemyFromSpawn({
        className: 'Fighter',
        level: 1,
        col: cols - 1,
        row: battle.battleConfig.rows - 1,
      });
      battle._executeCombat(hero, foe);
      expect(battle.enemyUnits).not.toContain(foe); // the shot killed
      expect(hero.weapon.name).toBe(fallbackName); // and the hero then switched
      return { battle, hero };
    }

    it('in the deeds (kills by weapon type)', () => {
      const { hero } = lastShotKill('Iron Sword', 'Fighter');
      expect(hero._battleDeeds.killsByWeapon).toEqual({ Tome: 1 });
    });

    it('for zombie remains (only Light leaves none)', () => {
      const { battle } = lastShotKill('Glimmer', 'Zombie');
      expect(battle._zombieTombstones).toHaveLength(1);
    });
  });

  it('an enemy that chooses its status staff uses it (a use is spent, the AI moves on)', async () => {
    const battle = battleFor();
    const target = battle.playerUnits[0];
    battle.playerUnits = [target];
    battle.enemyUnits = [];
    const mage = battle._addEnemyFromSpawn({
      className: 'Mage',
      level: 5,
      col: target.col + 4 < battle.battleConfig.cols ? target.col + 4 : target.col - 4,
      row: target.row,
      statusStaff: 'sleep',
    });
    expect(mage.statusStaff?.name).toBe('Sleep Staff');
    const decisions = [];
    const decide = battle.aiController._decideAction.bind(battle.aiController);
    battle.aiController._decideAction = (...args) => {
      const d = decide(...args);
      decisions.push(d.reason);
      return d;
    };
    battle.turnManager.turnNumber = 1;
    battle.turnManager.currentPhase = 'enemy';
    battle.battleState = HEADLESS_STATES.ENEMY_PHASE;
    await battle._processEnemyPhase();
    expect(decisions).toContain('status_staff');
    expect(mage.statusStaff._usesSpent).toBe(1);
  });
});
