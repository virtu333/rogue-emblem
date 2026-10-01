// The headless harness mirrors three BattleScene behaviours it used to skip, so sims
// and fuzzers see the same battle: the anti-turtle clock (engine/TurnPressure.js), the
// gear a spawn carries (engine/EnemySpawnGear.js: siege tomes, status staves), and an
// enemy actually using its status staff.
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
