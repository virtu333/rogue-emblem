// The pacing sim's seek mode and its encounter metrics
// (docs/specs/large-maps/02-encounters-and-pacing.md §7, PR 2.0). A board whose every foe is one
// sleeping pack: without seek the careful player waits two turns and then advances; with seek
// it goes looking for the pack at once (the push onto its posts, the bait with one unit inside
// its zone), and the metrics see the wake, the contact and every foe's first attack.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ScenarioRunner } from '../agents/ScenarioRunner.js';
import { buildRoster, loadFixture } from '../fixtures/battles/index.js';
import { PushAgent, TacticianAgent } from '../../sim/lib/TacticianAgent.js';
import { attachPacingMetrics, summarizePacingMetrics } from '../../sim/lib/PacingMetrics.js';
import { enemyThreatTiles } from '../../src/engine/ThreatForecast.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SPEC = [
  { type: 'lord', name: 'Edric', level: 10, extraWeapons: ['Steel Sword', 'Javelin'] },
  { type: 'lord', name: 'Sera', level: 10, staff: true },
  { type: 'recruit', className: 'Cavalier', name: 'Marcus', level: 10 },
  { type: 'recruit', className: 'Knight', name: 'Oswin', level: 10 },
  { type: 'recruit', className: 'Archer', name: 'Wil', level: 10 },
];

/** Player units standing where a sleeping foe would strike (the bait's zone). */
function inSleepersZone(battle) {
  const ctx = battle._playerThreatContext();
  const positions = ctx.positions();
  return battle.playerUnits.filter((u) =>
    battle.enemyUnits.some(
      (e) =>
        e.currentHP > 0 &&
        e.aiMode === 'hold' &&
        enemyThreatTiles(ctx, e, positions).damage.has(`${u.col},${u.row}`),
    ),
  ).length;
}

/** One battle of act1_rout_basic with every foe in one hold pack, played by `make`. */
async function play(seed, make, { sleep = true, probe = null } = {}) {
  const fixture = { ...loadFixture('act1_rout_basic'), roster: SPEC, buildRoster: (gd) => buildRoster(SPEC, gd) }; // prettier-ignore
  let record;
  let phases = 0;
  let wake = null;
  let enemies = 0;
  let probed = null;
  const run = await new ScenarioRunner(seed, fixture, (driver) => {
    const battle = driver.battle;
    enemies = battle.enemyUnits.length;
    if (sleep) {
      for (const e of battle.enemyUnits) {
        Object.assign(e, { aiMode: 'hold', holdPack: 1, holdPost: { col: e.col, row: e.row } });
      }
    }
    probed = probe?.(driver) ?? null;
    record = attachPacingMetrics(battle);
    const phase = battle._processEnemyPhase.bind(battle);
    battle._processEnemyPhase = async () => {
      phases++;
      const turn = battle.turnManager.turnNumber;
      const asleep = battle.enemyUnits.some((e) => e.aiMode === 'hold');
      const zone = asleep ? inSleepersZone(battle) : 0;
      await phase();
      if (asleep && !wake && !battle.enemyUnits.some((e) => e.aiMode === 'hold'))
        wake = { turn, zone };
    };
    return make(driver);
  }).run(3000);
  return { run, summary: summarizePacingMetrics(record), phases, wake, enemies, probed };
}

const careful = (driver) => new TacticianAgent(driver, { rescue: true, objectives: true });
const bait = (driver) => new TacticianAgent(driver, { rescue: true, objectives: true, seek: 'bait' }); // prettier-ignore
const push = (driver) => new PushAgent(driver, { rescue: true, objectives: true, seek: 'push' });

describe('seek mode', () => {
  it('loads under Node ESM (every named import exists)', () => {
    // Vitest reads a missing named export as undefined; Node refuses the module.
    execFileSync(
      process.execPath,
      ['--input-type=module', '-e', "await import('./sim/lib/TacticianAgent.js');"],
      { cwd: ROOT, stdio: 'pipe' },
    );
  });

  // Seeds whose squad starts outside the pack's zone.
  const SEEDS = [1, 2, 4, 5];

  it('wakes a sleeping pack the turn the squad can reach it; the careful player waits', async () => {
    for (const seed of SEEDS) {
      const without = await play(seed, careful);
      const baited = await play(seed, bait);
      const pushed = await play(seed, push);
      expect(without.wake.turn, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      expect(baited.wake.turn, `seed ${seed}`).toBe(1);
      expect(pushed.wake.turn, `seed ${seed}`).toBe(1);
      for (const r of [without, baited, pushed]) {
        expect(r.run.result).toBe('victory');
        expect(r.summary.wakeReasons).toEqual({ threat: 1 });
        expect(r.summary.contactTurn).toBe(r.wake.turn);
      }
    }
  });

  it('a push walks onto the posts, past the danger the careful advance keeps out of', async () => {
    // Turn 1's first plan, from the same board: the push with seek against the push without.
    const posts = (battle, tile) =>
      Math.min(...battle.enemyUnits.map((e) => Math.abs(e.col - tile.col) + Math.abs(e.row - tile.row))); // prettier-ignore
    let closer = 0;
    for (const seed of SEEDS) {
      const { probed } = await play(seed, push, {
        probe: (driver) => {
          const seeking = new PushAgent(driver, { objectives: true, seek: 'push' })._bestPlan();
          const plain = new PushAgent(driver, { objectives: true })._bestPlan();
          return { seeking: posts(driver.battle, seeking.tile), plain: posts(driver.battle, plain.tile) }; // prettier-ignore
        },
      });
      expect(probed.seeking, `seed ${seed}`).toBeLessThanOrEqual(probed.plain);
      if (probed.seeking < probed.plain) closer++;
    }
    expect(closer).toBeGreaterThan(0);
  });

  it('a bait wakes the pack with one unit inside its zone', async () => {
    for (const seed of SEEDS) {
      const { wake } = await play(seed, bait);
      expect(wake.zone, `seed ${seed}`).toBe(1);
    }
  });
});

describe('pacing metrics', () => {
  it('count the battle the way it was played', async () => {
    const { run, summary, phases, enemies } = await play(1, push);
    expect(run.result).toBe('victory');
    expect(summary.startEnemies).toBe(enemies);
    expect(summary.groupsWoken).toBe(1);
    expect(summary.aiMs).toHaveLength(phases);
    expect(summary.engagedShare).toBe(summary.firstAttackTurns.length / summary.startEnemies);
    expect(summary.engagedShare).toBeGreaterThan(0);
    // A sleeping foe never decides to strike before the pack wakes.
    expect(Math.min(...summary.firstAttackTurns)).toBeGreaterThanOrEqual(summary.contactTurn);
  });

  it('with no pack, contact is the first exchange or Danger, never after a first attack', async () => {
    const { summary } = await play(1, careful, { sleep: false });
    expect(summary.groupsWoken).toBe(0);
    expect(summary.contactTurn).not.toBeNull();
    expect(summary.contactTurn).toBeLessThanOrEqual(Math.min(...summary.firstAttackTurns));
  });
});
