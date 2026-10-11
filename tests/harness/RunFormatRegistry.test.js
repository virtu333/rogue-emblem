// Test 24 (docs/specs/large-maps/04-set-pieces.md §12.1 step 8): a key census. Every key the
// corpus produces in a node's battleParams, a locked config (and its enemy spawns), a battle
// checkpoint and the run's top level is either in RUN_FORMAT_FIELDS (classified: inert,
// legacy-equivalent, the marker, or owned by a capability) or in the frozen baseline below: the
// keys that existed when the guard landed, which an older client already reads as meant. A new
// key in neither fails with its path, so the next mechanic cannot slip past the guard unlisted.
// The baseline never grows: a new key goes into RUN_FORMAT_FIELDS.
//
// The corpus: real runs on every rung through every act (seeded), every battle node's params and
// generated map, every event set piece on every rung and act, and a real suspend checkpoint.
// There are no data switches yet; each writer's PR turns its own on here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './JourneyTestSetup.js';
import { loadGameData } from '../testData.js';
import { walkRunFormatCorpus } from '../helpers/runFormatCorpus.js';
import { RunDriver, JourneyStorage } from './RunDriver.js';
import { journeyBattleScene } from './JourneyBattleScene.js';
import { createUnit } from '../../src/engine/UnitManager.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import {
  CLIENT_CAPABILITIES,
  RUN_FORMAT_FIELDS,
  requiredRunFormat,
} from '../../src/engine/RunFormat.js';

const SEEDS = 50;

// The keys each place held before the guard (generated runs, maps and a checkpoint, plus the
// optional keys a held blessing, burden, event or status adds). Frozen: never add to these.
const BASELINE = {
  battleParams: [
    'act', 'act1EnemyCountDeployCap', 'allowEnemyAffixes', 'battleDebuffs', 'battleSeed',
    'blessingParTurns', 'bossLevelBonus', 'carryConfig', 'carryPasses', 'classStatBonuses',
    'deployCount', 'difficultyId', 'eclipseAffix', 'eclipsePhaseIndex', 'enemyCountBase',
    'enemyCountBonus', 'enemyEquipTierShift', 'enemyLevelBonus', 'enemyPoisonChance',
    'enemySkillChance', 'enemyStatBonus', 'eventEnemyLevelBonus', 'excludeOpeningCavaliers',
    'firstBattleFightersOnly', 'foesShown', 'fogEnabled', 'fogOpeningRadius', 'goldMultiplier',
    'hasCaravan', 'hasVillage', 'holdShare', 'huntedWave', 'isAmbush', 'isBoss', 'isEclipsed',
    'isElite', 'isRecruitBattle', 'levelRange', 'objective', 'objectiveParOffset', 'parInflation',
    'recruitEnemyCountBonus', 'recruitGuardianChance', 'recruitPreview', 'reinforcementDelay',
    'reinforcementTurnOffset', 'reservedRecruitNames', 'revivalStones', 'routLadder', 'row',
    'siegeWeaponConfig', 'specialXpMultiplier', 'statusStaffConfig', 'swornEnemy', 'templateId',
    'templateWavesRaisePar', 'usedRecruitNames', 'xpMultiplier', 'xpUnderdogCap',
  ],
  battleConfig: [
    'ballistas', 'biome', 'caravanSpawn', 'cols', 'enemySpawns', 'escapeTiles', 'hybridAnchors',
    'hybridArena', 'mapLayout', 'npcSpawn', 'objective', 'parBonus', 'parFloor', 'parInflation',
    'parOffset', 'phaseTerrainOverrides', 'playerSpawns', 'reinforcementContractVersion',
    'reinforcements', 'rows', 'templateId', 'thronePos', 'toxicTiles', 'villageTile',
  ],
  enemySpawn: [
    'affixes', 'aiMode', 'areaArt', 'carries', 'carryValue', 'className', 'col', 'holdPack',
    'holdPackSize', 'isBoss', 'isEntity', 'level', 'name', 'poisonWeapon', 'revivalStones', 'row',
    'siegeWeapon', 'statusStaff', 'sunderWeapon',
  ],
  checkpoint: [
    'antiTurtleState', 'appliedHybridOverrideTurns', 'ballistas', 'battleBlessingsSpent',
    'battleRecruits', 'bossName', 'caravanExited', 'checkpointIndex', 'commanderEntityId',
    'commanderKillerName', 'commanderName', 'decisionRngState', 'enemyUnits', 'escapedUnits',
    'fallenBattleRecords', 'fallenClassName', 'fallenName', 'fog', 'goldEarned',
    'latePressureWarningShown', 'mapLayout', 'nextEntityId', 'nonDeployedUnits', 'npcUnits',
    'pendingActionCompletion', 'pendingCommittedAction', 'pendingHybridOverrideTiles',
    'pendingVisionSnapshot', 'phase', 'playerDeathsThisBattle', 'playerUnits', 'prologueState',
    'recoveryKind', 'restoreFailed', 'rewindPolicy', 'rngSeed', 'rngState', 'runBattleState',
    'temporaryTerrains', 'turnNumber', 'turnPar', 'version', 'villageState', 'visionBaseSeed',
    'visionSnapshot', 'zombieTombstones',
  ],
  run: [
    'accessories', 'actIndex', 'actSequence', 'actUnlockedWeaponArts', 'activeBlessings',
    'activeCaravanShop', 'battleConfigsByNodeId', 'battleInProgress', 'blessingBoonRevision',
    'blessingHistory', 'blessingRuntimeModifiers', 'blessingSelectionTelemetry', 'burdens',
    'churchPromotionTracker', 'churchTitheByNodeId', 'churchVowByNodeId', 'completedBattles',
    'contract', 'contractOwed', 'convoy', 'currentNodeId', 'defeatContext', 'difficultyId',
    'difficultyModifiers', 'earnedBlessingPicks', 'eclipse', 'endRunRewards', 'eventLog',
    'eventStateByNodeId', 'fallenUnits', 'gold', 'itemNamesRevision', 'laidToRest',
    'lastBattleCasualtyNotices', 'lastBattleReport', 'lastDeployment', 'legendaryGrants',
    'legendaryLordChance', 'maxWinStreak', 'metaEffects', 'metaUnlockedWeaponArts', 'mode',
    'narrativeSeen', 'nextUnitUid', 'noMetaMode', 'nodeMap', 'pendingAmbushNodeId',
    'pendingBattleReward', 'pendingBossRecruit', 'pendingCaravanShop', 'pendingEventNodeId',
    'pendingThirdLord', 'randomLegendary', 'reachedFirstActBoss', 'rewardRerollsSpent', 'rngSeed',
    'roster', 'ruinsChoiceByNodeId', 'runLordFalls', 'runRecordId', 'runSeed', 'savedAt', 'scrolls',
    'shopStateByNodeId', 'shownDialogueKeys', 'startGift', 'status', 'storyFlags',
    'thirdLordJoined', 'thirdLordRerolled', 'totalTurns', 'unlockedWeaponArts', 'usedRecruitNames',
    'version', 'visionChargesRemaining', 'visionCount', 'winStreak',
  ],
}; // prettier-ignore

function census() {
  const seen = { battleParams: new Map(), battleConfig: new Map(), enemySpawn: new Map(), checkpoint: new Map(), run: new Map() }; // prettier-ignore
  const note = (place, value, where) => {
    for (const key of Object.keys(value || {})) if (!seen[place].has(key)) seen[place].set(key, where); // prettier-ignore
  };
  const derived = [];
  walkRunFormatCorpus(loadGameData(), {
    seeds: SEEDS,
    visit({ kind, value, where }) {
      if (kind === 'nodeParams' || kind === 'battleParams') note('battleParams', value, where);
      if (kind === 'config') {
        note('battleConfig', value, where);
        for (const spawn of value.enemySpawns || []) note('enemySpawn', spawn, where);
      }
      if (kind === 'run') {
        note('run', value, where);
        derived.push(...requiredRunFormat(value).capabilities.map((id) => `${where}: ${id}`));
      }
    },
  });
  return { seen, derived };
}

let storage;
beforeEach(() => {
  storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  installSeed(42);
});
afterEach(() => {
  restoreMathRandom();
  vi.unstubAllGlobals();
});

/** A real suspend checkpoint, saved by the scene's own capture (JourneyCombat's fixture). */
function checkpointRun() {
  const d = new RunDriver(storage);
  d.run.beginBattleInProgress(d.run.nodeMap.nodes[0].id, { battleParams: {} });
  const s = journeyBattleScene(d.run, d.data);
  const unit = createUnit(d.data.classes.find((c) => c.name === 'Fighter'), 14, d.data.weapons, { name: 'Veteran' }); // prettier-ignore
  Object.assign(unit, { col: 1, row: 1, faction: 'player' });
  const enemy = structuredClone(unit);
  Object.assign(enemy, { name: 'Raider', faction: 'enemy', col: 3, row: 3 });
  s.playerUnits = [unit];
  s.enemyUnits = [enemy];
  for (const u of [unit, enemy]) s.addUnitGraphic(u);
  expect(s._captureSuspendCheckpoint({ session: s._battleSession })).toBe(true);
  return JSON.parse(storage.getItem('emblem_rogue_slot_1_run'));
}

const unlisted = (place, seen) =>
  [...seen.entries()]
    .filter(([key]) => !(key in RUN_FORMAT_FIELDS[place]) && !BASELINE[place].includes(key))
    .map(([key, where]) => `${place}.${key} (first in ${where})`);

describe('test 24: every key in a saved run is classified', () => {
  it('the generated corpus holds no unlisted key and needs no capability this client lacks', () => {
    const { seen, derived } = census();
    const missing = Object.keys(seen).flatMap((place) => unlisted(place, seen[place]));
    expect(missing).toEqual([]);
    // A client never writes what it can't read.
    expect(derived.filter((d) => !CLIENT_CAPABILITIES.some((id) => d.endsWith(`: ${id}`)))).toEqual([]); // prettier-ignore
    // The corpus is not empty in any place (a walk that saw nothing would pass vacuously).
    for (const [place, keys] of Object.entries(seen))
      if (place !== 'checkpoint') expect(keys.size, place).toBeGreaterThan(5);
  }, 120_000);

  it('a real suspend checkpoint holds no unlisted key', () => {
    const saved = checkpointRun();
    const checkpoint = saved.battleInProgress.checkpoint;
    const seen = new Map(Object.keys(checkpoint).map((k) => [k, 'suspend checkpoint']));
    expect(unlisted('checkpoint', seen)).toEqual([]);
    const top = new Map(Object.keys(saved).map((k) => [k, 'checkpoint run']));
    expect(unlisted('run', top)).toEqual([]);
    expect(requiredRunFormat(saved).capabilities).toEqual([]);
  });

  it('the baseline and the registry never overlap (a key has one classification)', () => {
    for (const place of Object.keys(BASELINE))
      for (const key of BASELINE[place])
        expect(key in RUN_FORMAT_FIELDS[place], `${place}.${key}`).toBe(false);
  });
});
