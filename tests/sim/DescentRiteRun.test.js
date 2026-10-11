// The Rite through a headless run of the Descent (docs/specs/act-v-descent.md §4, §9.5), with the
// route switched on for the test: the full-run driver walks Act V through the real RunManager and
// HeadlessBattle, as tests/sim/DescentRun.test.js does, and every battle's config and its Vigil
// count are recorded at the victory commit. Ways this breaks:
//   - the Vigil's words never reach the run's Rite, reach it twice, or reach it from another
//     battle (a count the harness never spoke)
//   - the Rite starts at another value than the Eclipse's phase says
//   - a finale or gate is generated without its tier's mods, or with another tier's
//   - an Answered rite reaches the Entity's stones or HP
import { describe, it, expect } from 'vitest';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { RunSimulationDriver } from './RunSimulationDriver.js';
import { riteBand, riteModsFor } from '../../src/engine/Rite.js';
import { revivalStonesFor } from '../../src/engine/RevivalStones.js';
import { ENTITY_SPLASH_COUNT } from '../../src/utils/constants.js';

const baseData = loadGameData();
const descentData = () => ({
  ...baseData,
  descent: { ...structuredClone(baseData.descent), enabled: true },
});

/**
 * Walk the Descent on a rung, recording each battle as its victory commits: the node, its
 * config, the harness's Vigil count, the Rite before and after, and the mods the run handed it.
 * `riteAtEntry` sets the Rite's words right after the act opens (the Eclipse's start replaced).
 */
async function walk(difficultyId, seed, { riteAtEntry = null } = {}) {
  installSeed(seed);
  try {
    const driver = new RunSimulationDriver(descentData(), {
      runOptions: { runSeed: seed, difficultyId, autoSelectBlessing: false },
      invincibility: true,
      maxBattleActions: 1500,
    });
    driver.init();
    const run = driver.runManager;
    run.actIndex = run.actSequence.indexOf('finalBoss') - 1;
    run.advanceAct();
    const startedAt = run.rite ? run.rite.words : null;
    if (riteAtEntry !== null) run.rite = { ...run.rite, words: riteAtEntry };
    for (const unit of run.roster) {
      Object.assign(unit.stats, { HP: 80, STR: 45, MAG: 45, SKL: 40, SPD: 40, DEF: 40, RES: 40 });
      unit.currentHP = unit.stats.HP;
    }
    const battles = [];
    const commit = driver._completeBattle.bind(driver);
    driver._completeBattle = (battleDriver, merged, node) => {
      const before = run.rite ? run.rite.words : null;
      const record = {
        key: node.descentKey,
        nodeId: node.id,
        config: structuredClone(battleDriver.battle.battleConfig),
        params: battleDriver.battle.battleParams,
        words: battleDriver.battle._vigilState?.words ?? null,
        before,
        expectedMods: riteModsFor(run, node),
      };
      const applied = commit(battleDriver, merged, node);
      record.applied = applied;
      record.after = run.rite ? run.rite.words : null;
      battles.push(record);
      return applied;
    };
    const result = await driver.run();
    return { result, run, battles, startedAt };
  } finally {
    restoreMathRandom();
  }
}

describe('the Rite through a headless Descent', () => {
  it('First Light: the Vigil’s spoken words are committed once, at its victory, and the finale reads the tier', async () => {
    const { result, run, battles, startedAt } = await walk('normal', 41);
    expect(result.result).toBe('victory');
    // A fresh run's Eclipse is Pale at Act V entry: the Rite starts at Pale's 0.
    expect(startedAt).toBe(baseData.descent.rite.startByPhase.pale);
    const vigil = battles.find((b) => b.key === 'vigil');
    expect(vigil.config.vigil).toBeTruthy();
    expect(vigil.words).toBeGreaterThan(0);
    // The words the harness counted, added once at the commit, logged as the Vigil's.
    expect(vigil.after - vigil.before).toBe(vigil.words);
    const vigilEntries = run.rite.log.filter((e) => e.source === 'vigil');
    expect(vigilEntries).toEqual([{ source: 'vigil', delta: vigil.words, nodeId: vigil.nodeId }]);
    // No other battle wrote a Vigil word; the stair moved nothing.
    for (const b of battles.filter((x) => x.key !== 'vigil' && x.key !== 'column'))
      expect(b.after, b.key).toBe(b.before);
    // The Hollowed the circles called read the words at entry (riteAtEntry) and the rule.
    expect(vigil.params.riteAtEntry).toBe(vigil.before);
    expect(vigil.config.vigil).toMatchObject({ perWordLevel: 4, levelCap: 4 });
    // The finale was built with the tier the Rite stood in at its entry.
    const finale = battles.find((b) => b.key === 'lieutenant');
    expect(finale.params.riteBand).toBe(riteBand(finale.before, baseData.descent));
    if (Object.keys(finale.expectedMods).length)
      expect(finale.params.riteMods).toEqual(finale.expectedMods);
    else expect(finale.params.riteMods).toBeUndefined();
    expect(run.rite.words).toBe(finale.after);
  }, 180_000);

  it('Nightfall on an Answered rite: the gate gains a stone and a wave, the Entity a wider splash and waves, never a stone', async () => {
    const { result, battles } = await walk('hard', 43, { riteAtEntry: 20 });
    expect(result.result).toBe('victory');
    const stones = baseData.difficulty.modes.hard.revivalStones;

    const gate = battles.find((b) => b.key === 'gate');
    expect(gate.params.riteMods).toMatchObject({ band: 'answered', target: 'lieutenant' });
    const lieutenant = gate.config.enemySpawns.find((s) => s.isBoss);
    expect(lieutenant.name).toBe('The Lieutenant');
    expect(lieutenant.revivalStones).toBe(revivalStonesFor(stones, 'lieutenant') + 1);
    const gateWaves = (gate.config.reinforcements?.scriptedWaves || []).filter((w) => w.rite);
    expect(gateWaves).toHaveLength(1);
    expect(gateWaves[0]).toMatchObject({ turn: 4, parNeutral: true });
    expect(gateWaves[0].spawns.map((s) => s.className)).toEqual(['Hollowed', 'Hollowed']);

    const finale = battles.find((b) => b.key === 'entity');
    expect(finale.params.riteMods).toMatchObject({ band: 'answered', target: 'entity' });
    expect(finale.config.entitySplashCount).toBe(ENTITY_SPLASH_COUNT + 1);
    const entity = finale.config.enemySpawns.find((s) => s.isEntity);
    expect(entity.revivalStones).toBeUndefined();
    const templateWaves = finale.config.reinforcements.waves;
    const riteWaves = finale.config.reinforcements.scriptedWaves.filter((w) => w.rite);
    expect(riteWaves.map((w) => w.turn)).toEqual(templateWaves.map((w) => w.turn));
  }, 180_000);
});
