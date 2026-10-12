// Acceptance, scenario 4 (the boss previews tell the battle the game will play): for every boss the
// Rite reads (the Lieutenant as finale on First Light and Dusk, as gate on Nightfall and Black Sun,
// the Entity), every tier, with and without the Hollow Hourglass (the real earned blessing), the
// open preview (the loom card's Rite block before the map is locked, the chip's note and the pause
// list's terms), the route scout's field (Seer's Eye) and the locked preview must agree with the
// map BattleScene generates and locks, and with what the harness then plays on it: the escort the
// tier took, the boss's Revival Stones, and each Rite wave of Hollowed arriving on the turn named
// and in the number named. Ways this breaks:
//   - the open preview names a turn, a count or a stone the locked map does not hold (a rung's
//     reinforcement offset or the Hourglass applied on one path and not the other)
//   - the scout shows a field other than the battle's (a different deploy count or seed)
//   - the chip, the pause list and the loom card disagree about the same boss
//   - the battle releases a Rite wave on another turn than the preview says, or a delayed wave
//     is released twice, or the Entity's Rite waves are not beside its template waves
import { afterEach, describe, expect, it } from 'vitest';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { createRite, riteBand } from '../../src/engine/Rite.js';
import {
  applyGenerationFields,
  battleGenerationSeed,
  generateSeededBattle,
  reinforcementsOf,
  scoutBattle,
  scoutDeployCount,
} from '../../src/engine/BattleScout.js';
import { riteBurdenEntry, riteChipModel, riteNodeModel } from '../../src/ui/riteModel.js';
import { ENTITY_SPLASH_COUNT } from '../../src/utils/constants.js';
import { entitySplashCountFor } from '../../src/engine/EntitySystem.js';
import { GameDriver } from './GameDriver.js';
import {
  baseData,
  descentRun,
  endTurn,
  nodeOf,
  passNode,
  strongArmy,
  winNode,
} from './DescentAcceptanceKit.js';

afterEach(() => restoreMathRandom());

const RITE = baseData.descent.rite;
const bandWords = (id) => RITE.bands.find((b) => b.id === id).min + 1;

/** A run standing before `key` on `difficultyId`, the Rite at `band`, maybe with the Hourglass. */
function before(difficultyId, key, band, { hourglass = false, seed = 51 } = {}) {
  installSeed(seed);
  const rm = descentRun(difficultyId, { runSeed: seed });
  winNode(rm, 'stair');
  winNode(rm, 'column', { turnCount: 30, turnPar: 12 });
  winNode(rm, 'vigil');
  if (key === 'entity') {
    passNode(rm, 'landing');
    winNode(rm, 'gate');
  } else if (key === 'gate') passNode(rm, 'landing');
  passNode(rm, 'ruins');
  // Seer's Eye lets the route preview read the whole field (and its waves).
  expect(rm.addBlessingMidRun('seers_eye', { earned: true })).toBeTruthy();
  if (hourglass) expect(rm.addBlessingMidRun('hollow_hourglass', { earned: true })).toBeTruthy();
  rm.rite = createRite({ start: bandWords(band) });
  expect(riteBand(rm.rite.words, RITE)).toBe(band);
  return rm;
}

/** The map BattleScene generates at entry (the deploy screen's count, the scene's seed). */
function enter(rm, node) {
  const params = rm.getBattleParams(node);
  applyGenerationFields(params, { deployCount: scoutDeployCount(rm, node), isBoss: true });
  const seed = battleGenerationSeed(params, { runSeed: rm.runSeed, nodeId: node.id });
  const config = generateSeededBattle(params, rm.gameData, seed);
  rm.lockBattleConfig(node.id, config);
  return { params, config };
}

const foeKey = (f) => `${f.className}|${f.level}|${f.isBoss ? 'boss' : ''}`;
const turnIn = (line) => Number(/turn (\d+)$/.exec(line)?.[1]);
const countIn = (line) =>
  Number(/^(\d+) Hollowed/.exec(line)?.[1] ?? /brings (\d+)/.exec(line)?.[1]);

/**
 * Play the locked map in the harness, the army standing still, recording each turn the Rite's
 * Hollowed arrive (scripted waves flagged `rite`). The army is out of reach of nothing, but too
 * strong to fall in a dozen enemy phases.
 */
async function riteArrivals(rm, node, params, config, turns) {
  const army = strongArmy(rm, 1);
  for (const u of army) {
    u.stats.HP = 900;
    u.currentHP = 900;
  }
  const driver = new GameDriver(rm.gameData, params, army, { runManager: rm });
  driver.init({ battleConfig: config });
  const b = driver.battle;
  const boss = b.enemyUnits.find((u) => u.isBoss);
  const seen = new Set(b.enemyUnits);
  const arrivals = [];
  // Waves land at the end of the enemy phase of the turn they are due (as BattleScene), so each
  // arrival is filed under the turn whose enemy phase brought it.
  while ((b.turnManager.turnNumber || 0) <= turns && !b.result) {
    const turn = b.turnManager.turnNumber;
    await endTurn(driver);
    const fresh = b.enemyUnits.filter((u) => !seen.has(u));
    for (const u of fresh) seen.add(u);
    const hollowed = fresh.filter((u) => u.className === 'Hollowed' && !u._summonedBy);
    if (hollowed.length) arrivals.push({ turn, count: hollowed.length });
    const others = fresh.filter((u) => u.className !== 'Hollowed' && !u._summonedBy);
    if (others.length) arrivals.push({ turn, template: others.length });
  }
  return { arrivals, boss, b };
}

const CASES = [
  ['normal', 'lieutenant'],
  ['dusk', 'lieutenant'],
  ['hard', 'gate'],
  ['lunatic', 'gate'],
  ['hard', 'entity'],
  ['lunatic', 'entity'],
];

describe('the Rite previews agree with the battle', () => {
  for (const [difficultyId, key] of CASES) {
    for (const band of ['broken', 'spoken', 'answered']) {
      for (const hourglass of [false, true]) {
        const name = `${difficultyId} ${key}, ${band}${hourglass ? ', Hollow Hourglass' : ''}`;
        it(
          name,
          async () => {
            const rm = before(difficultyId, key, band, { hourglass });
            const node = nodeOf(rm, key);
            const target = key === 'entity' ? 'entity' : 'lieutenant';

            // The open previews: the loom card's block, the chip's note, the pause list.
            const open = riteNodeModel(rm, node);
            expect(open).toMatchObject({ state: 'open', target });
            const chip = riteChipModel(rm).effects.find((e) => e.target === target);
            expect(chip, 'the chip names this boss').toBeTruthy();
            const pause = riteBurdenEntry(rm).text;
            expect(chip.lines).toEqual(open.lines);
            for (const line of open.lines) expect(pause).toContain(line.replace(/^The \w+/, ''));
            const scouted = scoutBattle(rm, node);
            expect(scouted).toMatchObject({ locked: false, level: 'foes' });

            // Execution: the map the scene builds and locks at entry.
            const { params, config } = enter(rm, node);
            expect(scouted.foes.map(foeKey)).toEqual(config.enemySpawns.map(foeKey));
            expect(scouted.reinforcements).toEqual(reinforcementsOf(config));
            // The locked previews read the same battle: the loom card's lines did not move.
            const locked = riteNodeModel(rm, node);
            expect(locked.state).toBe('locked');
            expect(locked.lines).toEqual(open.lines);
            expect(scoutBattle(rm, node)).toMatchObject({ locked: true });
            expect(scoutBattle(rm, node).foes.map(foeKey)).toEqual(scouted.foes.map(foeKey));

            // What the tier asked of this boss, read from the data, against the map.
            const mods = RITE.mods[band]?.[target] || {};
            const record = config.riteMods || null;
            if (target === 'lieutenant') {
              const bare = (() => {
                const plain = before(difficultyId, key, 'spoken', { hourglass });
                return enter(plain, nodeOf(plain, key)).config;
              })();
              expect(bare.enemySpawns.length - config.enemySpawns.length).toBe(
                mods.escortDrop || 0,
              );
              const boss = config.enemySpawns.find((s) => s.isBoss);
              const bareBoss = bare.enemySpawns.find((s) => s.isBoss);
              expect((boss.revivalStones || 0) - (bareBoss.revivalStones || 0)).toBe(
                mods.revivalStones || 0,
              );
            } else {
              expect(entitySplashCountFor(config)).toBe(
                ENTITY_SPLASH_COUNT + (mods.splashDelta || 0),
              );
            }

            // Play it: each Rite wave arrives on the turn and in the number the preview named.
            const waveLine = locked.lines.find((l) => /Hollowed/.test(l));
            const riteWaves = (config.reinforcements?.scriptedWaves || []).filter((w) => w.rite);
            if (!mods.waveHollowed) {
              expect(waveLine).toBeUndefined();
              expect(riteWaves).toEqual([]);
              return;
            }
            expect(waveLine, locked.lines.join(' | ')).toBeTruthy();
            expect(record?.waves?.length).toBeGreaterThan(0);
            const turns = target === 'lieutenant' ? turnIn(waveLine) + 1 : 12;
            const { arrivals, boss } = await riteArrivals(rm, node, params, config, turns);
            expect(boss.revivalStones || 0).toBe(
              config.enemySpawns.find((s) => s.isBoss).revivalStones || 0,
            );
            const rite = arrivals.filter((a) => a.count);
            if (target === 'lieutenant') {
              expect(rite).toEqual([{ turn: turnIn(waveLine), count: countIn(waveLine) }]);
            } else {
              // Beside each template wave: on its turn, in the number named.
              const template = arrivals.filter((a) => a.template).map((a) => a.turn);
              expect(template.length).toBeGreaterThan(0);
              expect(rite.map((a) => a.turn)).toEqual(template);
              for (const a of rite) expect(a.count).toBe(countIn(waveLine));
            }
          },
          120_000,
        );
      }
    }
  }
});
