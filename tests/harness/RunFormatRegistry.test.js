// Test 24 (docs/specs/large-maps/04-set-pieces.md §12.1 step 8): a key census. Every key the
// corpus produces in a node's battleParams, a locked config (and its enemy spawns), a battle
// checkpoint, the run's top level, the route map's and a route node's is either in RUN_FORMAT_FIELDS (classified: inert,
// legacy-equivalent, the marker, or owned by a capability) or in the frozen baseline below: the
// keys that existed when the guard landed, which an older client already reads as meant. A new
// key in neither fails with its path, so the next mechanic cannot slip past the guard unlisted.
// The baseline never grows: a new key goes into RUN_FORMAT_FIELDS.
//
// The corpus: real runs on every rung through every act (seeded), every battle node's params and
// generated map, every event set piece on every rung and act, and real suspend checkpoints (one
// written mid-Vigil). Data switches, each writer's PR turning its own on here: the Descent
// (data/descent.json `enabled`, set on a copy whatever the file ships), so every rung walks its
// route through Act V.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './JourneyTestSetup.js';
import { loadGameData } from '../testData.js';
import { walkRunFormatCorpus } from '../helpers/runFormatCorpus.js';
import { RunDriver, JourneyStorage } from './RunDriver.js';
import { journeyBattleScene } from './JourneyBattleScene.js';
import { createUnit } from '../../src/engine/UnitManager.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { createVigilState } from '../../src/engine/Vigil.js';
import {
  descentEntryRun,
  descentNode,
  enterBattle,
  winBattle,
} from '../helpers/descentRunFormatFixtures.js';
import {
  CLIENT_CAPABILITIES,
  RUN_FORMAT_FIELDS,
  requiredRunFormat,
} from '../../src/engine/RunFormat.js';

const SEEDS = 50;

/** The game data with every writer's switch on (see above). */
function corpusData() {
  const data = loadGameData();
  return { ...data, descent: { ...structuredClone(data.descent), enabled: true } };
}

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
  // The route map's top level, and a node's (the prologue's route carried a title, preview and
  // boss line before the guard; the Eclipse, events and recruit previews the rest).
  nodeMap: ['actId', 'bossNodeId', 'nodes', 'prologue', 'sanctumRolled', 'startNodeId'],
  node: [
    'ambushCleared', 'battleParams', 'bossLine', 'col', 'completed', 'darkOmen', 'eclipse', 'edges',
    'encounterLocked', 'eventBattle', 'fogEnabled', 'id', 'isAmbush', 'preview', 'prologueLines',
    'prologueStock', 'recruitAlternate', 'recruitPreview', 'row', 'sanctum', 'templateId', 'title',
    'type',
  ],
}; // prettier-ignore

function census() {
  const seen = { battleParams: new Map(), battleConfig: new Map(), enemySpawn: new Map(), checkpoint: new Map(), run: new Map(), nodeMap: new Map(), node: new Map() }; // prettier-ignore
  const note = (place, value, where) => {
    for (const key of Object.keys(value || {})) if (!seen[place].has(key)) seen[place].set(key, where); // prettier-ignore
  };
  const derived = [];
  const derive = (saved, where) =>
    derived.push(...requiredRunFormat(saved).capabilities.map((id) => `${where}: ${id}`));
  walkRunFormatCorpus(corpusData(), {
    seeds: SEEDS,
    visit({ kind, value, where }) {
      if (kind === 'nodeParams' || kind === 'battleParams') {
        note('battleParams', value, where);
        derive({ battleInProgress: { battleParams: value } }, where);
      }
      if (kind === 'config') {
        note('battleConfig', value, where);
        for (const spawn of value.enemySpawns || []) note('enemySpawn', spawn, where);
        derive({ battleConfigsByNodeId: { [where]: value } }, where);
      }
      if (kind === 'run') {
        note('run', value, where);
        note('nodeMap', value.nodeMap, where);
        for (const node of value.nodeMap?.nodes || []) note('node', node, where);
        derive(value, where);
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

/**
 * A real suspend checkpoint written mid-Vigil: the Entity road walked to the Vigil (its map
 * generated and locked as the scene's entry does), the battle's count after a phase, saved by the
 * scene's own capture into the run's slot.
 */
function midVigilCheckpointRun() {
  const data = corpusData();
  const run = descentEntryRun(data, { difficultyId: 'hard' });
  winBattle(run, 'stair');
  winBattle(run, 'column');
  const { params, config } = enterBattle(run, descentNode(run, 'vigil'));
  expect(config.vigil).toBeTruthy();
  const s = journeyBattleScene(run, data);
  s.battleParams = params;
  s.battleConfig = config;
  s._vigilState = {
    ...createVigilState(),
    words: 3,
    byVoice: { voice_waking: 2, voice_calling: 1 },
    lastProcessedTurn: 1,
  };
  const unit = createUnit(data.classes.find((c) => c.name === 'Fighter'), 14, data.weapons, { name: 'Veteran' }); // prettier-ignore
  Object.assign(unit, { col: 1, row: 1, faction: 'player' });
  // A Voice on its sigil (its class does not matter to the checkpoint's keys).
  const voice = structuredClone(unit);
  Object.assign(voice, { name: 'Voice', faction: 'enemy', col: 3, row: 3, authoredId: 'voice_waking' }); // prettier-ignore
  s.playerUnits = [unit];
  s.enemyUnits = [voice];
  for (const u of [unit, voice]) s.addUnitGraphic(u);
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
    // A client never writes what it can't read: no run, params or map in the corpus.
    expect(derived.filter((d) => !CLIENT_CAPABILITIES.some((id) => d.endsWith(`: ${id}`)))).toEqual([]); // prettier-ignore
    // The corpus is not empty in any place (a walk that saw nothing would pass vacuously)...
    for (const [place, keys] of Object.entries(seen))
      if (place !== 'checkpoint') expect(keys.size, place).toBeGreaterThan(4);
    // ...and it walked the Descent on every rung (its route, Rite, Vigil and defeat model).
    for (const rung of ['normal', 'dusk', 'hard', 'lunatic'])
      for (const id of ['descent', 'rite', 'vigil'])
        expect(derived.some((d) => d.startsWith(`${rung}#`) && d.endsWith(`: ${id}`)), `${rung} ${id}`).toBe(true); // prettier-ignore
    expect(derived.some((d) => d.startsWith('hard#') && d.endsWith(': defeatObjective'))).toBe(true); // prettier-ignore
  }, 180_000);

  it('a real suspend checkpoint holds no unlisted key', () => {
    const saved = checkpointRun();
    const checkpoint = saved.battleInProgress.checkpoint;
    const seen = new Map(Object.keys(checkpoint).map((k) => [k, 'suspend checkpoint']));
    expect(unlisted('checkpoint', seen)).toEqual([]);
    const top = new Map(Object.keys(saved).map((k) => [k, 'checkpoint run']));
    expect(unlisted('run', top)).toEqual([]);
    expect(requiredRunFormat(saved).capabilities).toEqual([]);
  });

  it('a real checkpoint written mid-Vigil holds no unlisted key, and its save is marked', () => {
    const saved = midVigilCheckpointRun();
    const checkpoint = saved.battleInProgress.checkpoint;
    expect(checkpoint.vigilState).toMatchObject({ words: 3, lastProcessedTurn: 1 });
    const seen = new Map(Object.keys(checkpoint).map((k) => [k, 'mid-Vigil checkpoint']));
    expect(unlisted('checkpoint', seen)).toEqual([]);
    const top = new Map(Object.keys(saved).map((k) => [k, 'mid-Vigil run']));
    expect(unlisted('run', top)).toEqual([]);
    expect(saved.requiresClient).toBe(2);
    expect(saved.requiresCapabilities).toEqual(['descent', 'rite', 'vigil', 'defeatObjective']);
    // The checkpoint alone (a save whose map and route this client somehow lost) still holds it.
    expect(
      requiredRunFormat({ battleInProgress: { checkpoint: { ...checkpoint, battleConfig: null } } })
        .capabilities,
    ).toEqual(['vigil']);
  });

  it('the baseline and the registry never overlap (a key has one classification)', () => {
    for (const place of Object.keys(BASELINE))
      for (const key of BASELINE[place])
        expect(key in RUN_FORMAT_FIELDS[place], `${place}.${key}`).toBe(false);
  });
});
