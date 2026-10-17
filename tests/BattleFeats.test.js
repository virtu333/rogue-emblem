// What a battle counts for the achievements (engine/BattleFeats.js) and the scene's seam
// (ui/AchievementBattleController.js): counted as it happens, carried by the checkpoint,
// taken back by a rewind, and read into the meta save only once the victory is applied.
//
// Ways this can fail, each pinned below:
// - a foe's blow, a heal or an ally's strike counts as the army's (Heavy Hand, Unfathomed);
// - Shatter counts stones broken on an earlier turn, or in the enemy phase;
// - Bone Dry counts a Necromancer that raised a Skeleton;
// - a perfect level counts with a stat missed, or an extended level counts;
// - a Smite of an ally, or a ballista kill of a non-boss, counts;
// - the counts are lost by a suspend, or kept by a rewind past them;
// - the prologue or a scripted chapter counts anything;
// - a victory whose commit failed is recorded; the deeds' scratch is read after it is cleared.

import { describe, expect, it } from 'vitest';
import {
  battleAchievementFacts,
  emptyBattleFeats,
  featsRecordBallistaKill,
  featsRecordCombat,
  featsRecordKill,
  featsRecordLevelUps,
  featsRecordPush,
  isPerfectLevelUp,
  sanitizeBattleFeats,
} from '../src/engine/BattleFeats.js';
import {
  captureBattleWorldState,
  restoreBattleWorldState,
} from '../src/engine/BattleSnapshotState.js';
import { validateBattleState } from '../src/engine/BattleStateSnapshot.js';
import { captureBattleState } from '../src/ui/BattleCheckpointAdapter.js';
import {
  achievementsActive,
  battleFeats,
  recordVictory,
  victoryFacts,
} from '../src/ui/AchievementBattleController.js';

const player = (extra = {}) => ({ name: 'Edric', faction: 'player', ...extra });
const foe = (extra = {}) => ({ name: 'Foe', faction: 'enemy', ...extra });
const strike = (extra = {}) => ({
  type: 'strike',
  attackerSide: 'attacker',
  miss: false,
  damage: 10,
  ...extra,
});

describe('combat', () => {
  it("counts the army's landed blows on foes only", () => {
    const feats = emptyBattleFeats();
    const hero = player();
    const enemy = foe();
    featsRecordCombat(feats, { events: [strike({ damage: 31 })] }, hero, enemy);
    // The foe's counter, a miss and a blow on an ally never count.
    featsRecordCombat(feats, { events: [strike({ attackerSide: 'defender', damage: 60 })] }, hero, enemy); // prettier-ignore
    featsRecordCombat(feats, { events: [strike({ damage: 70, miss: true })] }, hero, enemy);
    featsRecordCombat(feats, { events: [strike({ damage: 80 })] }, hero, player({ name: 'Sera' }));
    expect(feats.maxStrike).toBe(31);
    // A counter the army lands counts.
    featsRecordCombat(feats, { events: [strike({ attackerSide: 'defender', damage: 44 })] }, enemy, hero); // prettier-ignore
    expect(feats.maxStrike).toBe(44);
  });

  it('a critical hit on the Entity, not on anyone else', () => {
    const feats = emptyBattleFeats();
    featsRecordCombat(feats, { events: [strike({ isCrit: true })] }, player(), foe());
    expect(feats.entityCrits).toBe(0);
    featsRecordCombat(feats, { events: [strike({ isCrit: true })] }, player(), foe({ isEntity: true })); // prettier-ignore
    expect(feats.entityCrits).toBe(1);
  });
});

describe('Shatter', () => {
  const stoned = () => foe({ isBoss: true, revivalStones: 0, revivalStonesMax: 2 });
  const breakOn = (feats, boss, ctx) =>
    featsRecordCombat(feats, { events: [strike({ stoneBroken: true })] }, player(), boss, ctx);

  it('every stone broken and the kill in one player phase', () => {
    const feats = emptyBattleFeats();
    const boss = stoned();
    breakOn(feats, boss, { phase: 'player', turn: 5 });
    breakOn(feats, boss, { phase: 'player', turn: 5 });
    featsRecordKill(feats, boss, player(), { phase: 'player', turn: 5 });
    expect(feats.shatters).toBe(1);
  });

  it('a stone broken the turn before, or in the enemy phase, spoils it', () => {
    const early = emptyBattleFeats();
    const a = stoned();
    breakOn(early, a, { phase: 'player', turn: 4 });
    breakOn(early, a, { phase: 'player', turn: 5 });
    featsRecordKill(early, a, player(), { phase: 'player', turn: 5 });
    expect(early.shatters).toBe(0);
    const enemyPhase = emptyBattleFeats();
    const b = stoned();
    breakOn(enemyPhase, b, { phase: 'enemy', turn: 5 });
    breakOn(enemyPhase, b, { phase: 'player', turn: 5 });
    featsRecordKill(enemyPhase, b, player(), { phase: 'player', turn: 5 });
    expect(enemyPhase.shatters).toBe(0);
  });

  it('a boss without stones is no shatter', () => {
    const feats = emptyBattleFeats();
    featsRecordKill(feats, foe({ isBoss: true }), player(), { phase: 'player', turn: 1 });
    expect(feats.shatters).toBe(0);
  });
});

describe('the other counts', () => {
  it('Bone Dry: a Necromancer felled before it raised one', () => {
    const feats = emptyBattleFeats();
    featsRecordKill(feats, foe({ className: 'Necromancer', _raisedCount: 1 }), player());
    expect(feats.cleanNecromancerKills).toBe(0);
    featsRecordKill(feats, foe({ className: 'Necromancer' }), player());
    expect(feats.cleanNecromancerKills).toBe(1);
    // A fall with no player killer is nobody's.
    featsRecordKill(feats, foe({ className: 'Necromancer' }), null);
    expect(feats.cleanNecromancerKills).toBe(1);
  });

  it('a ballista kill counts for a boss; a Smite sends only a foe', () => {
    const feats = emptyBattleFeats();
    featsRecordBallistaKill(feats, foe());
    expect(feats.ballistaBossKills).toBe(0);
    featsRecordBallistaKill(feats, foe({ isBoss: true }));
    expect(feats.ballistaBossKills).toBe(1);
    featsRecordPush(feats, player(), 6);
    expect(feats.maxPushTiles).toBe(0);
    featsRecordPush(feats, foe(), 4);
    featsRecordPush(feats, foe(), 2);
    expect(feats.maxPushTiles).toBe(4);
  });

  it('a perfect level raises all eight stats; an extended level never counts', () => {
    const all = { HP: 1, STR: 1, MAG: 1, SKL: 1, SPD: 1, DEF: 1, RES: 1, LCK: 1 };
    expect(isPerfectLevelUp({ gains: all })).toBe(true);
    expect(isPerfectLevelUp({ gains: { ...all, MAG: 0 } })).toBe(false);
    expect(isPerfectLevelUp({ gains: all, isExtended: true })).toBe(false);
    const feats = emptyBattleFeats();
    featsRecordLevelUps(feats, foe(), [{ gains: all }]);
    featsRecordLevelUps(feats, player(), [{ gains: { ...all, LCK: 0 } }, { gains: all }]);
    expect(feats.perfectLevelUps).toBe(1);
  });

  it('a garbled scratch reads as zero', () => {
    expect(sanitizeBattleFeats({ maxStrike: 'x', steals: -3, extra: 9 })).toEqual(
      emptyBattleFeats(),
    );
  });
});

describe("the won battle's facts", () => {
  const run = { currentAct: 'act3', runSeed: 9, completedBattles: 4, nodeMap: {} };

  it('reads kills, wounds and bosses from the survivors and the fallen', () => {
    const facts = battleAchievementFacts({
      run,
      nodeId: 'n1',
      battleParams: {},
      battleConfig: { objective: 'rout' },
      survivors: [
        { _battleDeeds: { kills: 4, woundsTaken: 0, bossNames: ['Warchief'] } },
        { _battleDeeds: { kills: 3, woundsTaken: 0, bossNames: [] } },
      ],
      fallenRecords: [{ battleDeeds: { kills: 5, woundsTaken: 2, bossNames: ['Warchief'] } }],
      alliesFallen: 1,
      standard: true,
    });
    expect(facts.foesDefeated).toBe(12);
    expect(facts.maxUnitKills).toBe(5);
    expect(facts.alliesWounded).toBe(2);
    expect(facts.bossesSlain).toEqual(['Warchief']);
    expect(facts.key).toBe('9:act3:n1:4');
  });

  it('Lone Lord: the commander alone, no Talk recruit', () => {
    const base = { run, battleParams: {}, battleConfig: {}, fallenRecords: [] };
    const alone = battleAchievementFacts({ ...base, survivors: [{ isCommander: true }] });
    expect(alone.loneCommander).toBe(true);
    const two = battleAchievementFacts({
      ...base,
      survivors: [{ isCommander: true }],
      fallenRecords: [{ battleDeeds: {} }],
    });
    expect(two.loneCommander).toBe(false);
    const talked = battleAchievementFacts({
      ...base,
      survivors: [{ isCommander: true }, {}],
      recruits: 1,
    });
    expect(talked.loneCommander).toBe(false);
  });

  it('All Out: an escape with everyone off the field and nobody fallen', () => {
    const base = { run, battleParams: {}, battleConfig: { objective: 'escape' } };
    expect(battleAchievementFacts({ ...base, onField: 0, escaped: 3 }).allEscaped).toBe(true);
    expect(battleAchievementFacts({ ...base, onField: 1, escaped: 3 }).allEscaped).toBe(false);
    expect(
      battleAchievementFacts({ ...base, onField: 0, escaped: 3, alliesFallen: 1 }).allEscaped,
    ).toBe(false);
  });
});

// A scene with just what the seam and the world snapshot read.
function sceneFor({ prologue = false, scripted = false } = {}) {
  return {
    runManager: {
      mode: prologue ? 'prologue' : 'standard',
      currentAct: 'act2',
      runSeed: 3,
      completedBattles: 1,
      storyFlags: {},
      difficultyId: 'normal',
      roster: [],
      gameData: {},
    },
    battleParams: scripted ? { scripted: true, prologueChapter: 'P1' } : {},
    battleConfig: { objective: 'rout' },
    turnManager: { currentPhase: 'player', turnNumber: 2 },
    playerUnits: [],
    enemyUnits: [],
    npcUnits: [],
    grid: { mapLayout: [[0]], temporaryTerrains: [] },
    _battleFeats: emptyBattleFeats(),
  };
}

describe('the scene seam', () => {
  it('records in a run battle; never in the prologue run or a scripted chapter', () => {
    const live = sceneFor();
    expect(achievementsActive(live)).toBe(true);
    battleFeats.combat(live, player(), foe(), { events: [strike({ damage: 22 })] });
    battleFeats.steal(live);
    battleFeats.refreshBurst(live, 3);
    expect(live._battleFeats).toMatchObject({ maxStrike: 22, steals: 1, maxRefreshBurst: 3 });
    for (const scene of [sceneFor({ prologue: true }), sceneFor({ scripted: true })]) {
      battleFeats.combat(scene, player(), foe(), { events: [strike({ damage: 22 })] });
      battleFeats.steal(scene);
      expect(scene._battleFeats).toEqual(emptyBattleFeats());
      expect(victoryFacts(scene, [])).toBeNull();
    }
  });

  it('a recording failure never reaches the battle', () => {
    const scene = sceneFor();
    expect(() => battleFeats.combat(scene, player(), foe(), { events: 'garbled' })).not.toThrow();
    expect(() => battleFeats.levelUps(scene, player(), null)).not.toThrow();
  });

  it('a suspend keeps the counts; a rewind takes back what came after', () => {
    const scene = sceneFor();
    battleFeats.steal(scene);
    const checkpoint = JSON.parse(JSON.stringify(captureBattleWorldState(scene)));
    battleFeats.steal(scene);
    battleFeats.combat(scene, player(), foe(), { events: [strike({ damage: 55 })] });
    expect(scene._battleFeats.steals).toBe(2);
    restoreBattleWorldState(scene, checkpoint);
    expect(scene._battleFeats).toMatchObject({ steals: 1, maxStrike: 0 });
    // A checkpoint from before the field starts the counts over (never a crash).
    const old = { ...checkpoint };
    delete old.battleFeats;
    restoreBattleWorldState(scene, old);
    expect(scene._battleFeats).toEqual(emptyBattleFeats());
  });

  it('the checkpoint validator takes the counts, and refuses a garbled one', () => {
    // Only the field this change adds is in question: graft it onto a minimal valid state.
    const state = minimalValidState();
    expect(validateBattleState(state)).toBe(true);
    expect(validateBattleState({ ...state, battleFeats: { ...emptyBattleFeats(), steals: 2 } })).toBe(true); // prettier-ignore
    expect(validateBattleState({ ...state, battleFeats: { steals: 'two' } })).toBe(false);
    expect(validateBattleState({ ...state, battleFeats: [1] })).toBe(false);
  });

  it('records the victory only through recordVictory, with the facts read before it', () => {
    const scene = sceneFor();
    const calls = [];
    scene.registry = {
      get: (key) =>
        key === 'meta'
          ? { recordAchievementFacts: (f) => (calls.push(f), ['first_blood']), getDefeatedByCount: () => 0 } // prettier-ignore
          : null,
    };
    const survivor = { isCommander: true, _battleDeeds: { kills: 2, bossNames: [] } };
    const facts = victoryFacts(scene, [survivor]);
    // The deeds commit clears the scratch after this point; the facts already hold it.
    delete survivor._battleDeeds;
    expect(calls).toEqual([]);
    expect(recordVictory(scene, facts)).toEqual(['first_blood']);
    expect(calls[0].battle).toMatchObject({ standard: true, foesDefeated: 2, actId: 'act2' });
    expect(recordVictory(scene, null)).toEqual([]);
  });
});

function minimalValidState() {
  const scene = sceneFor();
  Object.assign(scene, { escapedUnits: [], nonDeployedUnits: [], _battleFeats: null });
  Object.assign(scene.runManager, {
    convoy: { weapons: [], consumables: [] },
    accessories: [],
    gold: 0,
    visionChargesRemaining: 0,
  });
  return JSON.parse(JSON.stringify(captureBattleState(scene, { rngSeed: 7 })));
}
