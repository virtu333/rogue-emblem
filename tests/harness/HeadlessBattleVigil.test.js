// The Vigil in the headless battle (rules: engine/Vigil.js; the scene drives the same rules
// through ui/VigilController.js), on the review set piece (utils/devSetPieceFixtures.js
// `dev_vigil`: four Voices on their sigils, the Waking's among them, four circles). Ways this
// breaks:
//   - the enemy phase speaks or calls more or less than the rules say, or a called Hollowed sits
//     the phase out
//   - a call moves the battle's Math.random stream
//   - a pipeline run twice in a turn speaks and calls twice
//   - a rewind keeps the later count or the later Hollowed, or the replayed phase calls another
//     unit; a resume's checkpoint loses the count
//   - a Hollowed pays gold, a full share of XP, survival XP or a deed
//   - the defeat objective waits for the Hollowed, or a silenced Voice's circle keeps calling
//   - a Voice shoved off its sigil never walks back (or walks back and speaks in the same phase)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameDriver } from './GameDriver.js';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { withDevSetPiece } from '../../src/utils/devSetPieceFixtures.js';
import {
  captureBattleWorldState,
  restoreBattleWorldState,
} from '../../src/engine/BattleSnapshotState.js';
import { restoreEquippedReference, serializeBattleUnit } from '../../src/engine/BattleUnitState.js';
import { relinkWeapon } from '../../src/engine/RunManager.js';
import { calculateCombatXP, createUnit } from '../../src/engine/UnitManager.js';
import { beginBattleDeeds, recordKill } from '../../src/engine/DeedSystem.js';
import { holdsPost } from '../../src/engine/SiegeArtillery.js';
import { checkInvariants } from './Invariants.js';

const data = withDevSetPiece(loadGameData(), 'dev_vigil');
const classOf = (name) => data.classes.find((c) => c.name === name);
const VOICES = ['voice_calling', 'voice_binding', 'voice_feeding', 'voice_waking'];

afterEach(() => {
  restoreMathRandom();
  vi.restoreAllMocks();
});

/** The review Vigil on Nightfall in Act V (no mirror for seed 3: the authored layout). */
function vigilBattle(seed = 3, params = {}) {
  installSeed(seed);
  const driver = new GameDriver(data, {
    act: 'finalBoss',
    objective: 'rout',
    setPiece: 'dev_vigil',
    battleSeed: seed,
    difficultyId: 'hard',
    deployCount: 2,
    ...params,
  });
  driver.init();
  const b = driver.battle;
  b.battleConfig.reinforcements = null;
  return { driver, b, edric: b.playerUnits.find((u) => u.name === 'Edric') };
}

const voiceOf = (b, id) => b.enemyUnits.find((u) => u.authoredId === id);
const called = (b) => b.enemyUnits.filter((u) => typeof u._summonedBy === 'string');
const sigilOf = (b, id) => b.battleConfig.vigil.sigils.find((s) => s.target === id);

/** Only the four Voices stand; Edric (alone) far from every circle and sigil. */
function voicesOnly(seed) {
  const ctx = vigilBattle(seed);
  const { b, edric } = ctx;
  b.enemyUnits.splice(0, b.enemyUnits.length, ...VOICES.map((id) => voiceOf(b, id)));
  b.playerUnits.splice(0, b.playerUnits.length, edric);
  Object.assign(edric, { col: 0, row: 10 });
  return ctx;
}

describe('a Vigil enemy phase in the harness', () => {
  it('the fixture is the authored layout: four Voices on their sigils, posts, no mirror', () => {
    const { b } = vigilBattle();
    expect(b.battleConfig.mirrored).toBe(false);
    for (const id of VOICES) {
      const voice = voiceOf(b, id);
      expect([voice.col, voice.row]).toEqual([sigilOf(b, id).col, sigilOf(b, id).row]);
      expect(voice).toMatchObject({ aiMode: 'post', className: 'Circle Adept' });
      expect(voice.postTile).toEqual({ col: voice.col, row: voice.row });
    }
    expect(b._vigilState).toEqual({ words: 0, byVoice: {}, byCircle: {}, summoned: 0, lastProcessedTurn: 0 }); // prettier-ignore
  });

  it('speaks five words a phase (the Waking two) and calls four Hollowed, who act that phase', async () => {
    const { driver, b } = vigilBattle();
    // The army outlasts three enemy phases (the point is the Vigil, not the fight).
    for (const u of b.playerUnits) {
      Object.assign(u.stats, { HP: 999, DEF: 99, RES: 99, SPD: 99 });
      u.currentHP = 999;
    }
    const seen = [];
    const run = b.aiController.processEnemyPhase.bind(b.aiController);
    b.aiController.processEnemyPhase = (enemies, ...rest) => {
      seen.push(enemies.filter((e) => e._summonedBy).map((e) => e.hasActed));
      return run(enemies, ...rest);
    };
    await driver.step({ type: 'end_turn', payload: {} });
    expect(b._vigilState).toMatchObject({
      words: 5,
      byVoice: { voice_calling: 1, voice_binding: 1, voice_feeding: 1, voice_waking: 2 },
      summoned: 4,
      lastProcessedTurn: 1,
    });
    expect(seen[0]).toEqual([false, false, false, false]);
    expect(
      called(b)
        .map((u) => u._summonedBy)
        .sort(),
    ).toEqual([
      'circle:circle_binding',
      'circle:circle_calling',
      'circle:circle_feeding',
      'circle:circle_waking',
    ]);
    expect(called(b).every((u) => u.battleEntityId && u.className === 'Hollowed')).toBe(true);
    // Nobody pushed a Voice: still on their sigils, so phase 2 speaks again; the cap holds at 8.
    await driver.step({ type: 'end_turn', payload: {} });
    await driver.step({ type: 'end_turn', payload: {} });
    expect(b._vigilState.words).toBe(15);
    expect(b._vigilState.summoned).toBe(8);
    expect(checkInvariants(driver)).toEqual([]);
  });

  it('a call never moves the battle stream', () => {
    const { b } = vigilBattle(4);
    installSeed(99);
    b._processVigil();
    expect(called(b)).toHaveLength(4);
    const after = Math.random();
    installSeed(99);
    expect(Math.random()).toBe(after);
  });

  it('a second run of the pipeline in the same turn speaks and calls nothing', () => {
    const { b } = vigilBattle();
    b.turnManager.turnNumber = 2;
    b._processVigil();
    const state = structuredClone(b._vigilState);
    const roster = [...b.enemyUnits];
    b._processVigil();
    expect(b._vigilState).toEqual(state);
    expect(b.enemyUnits).toEqual(roster);
  });

  it('a player unit on a circle keeps it from calling', () => {
    const { b, edric } = vigilBattle();
    const circle = b.battleConfig.vigil.circles.find((c) => c.id === 'circle_waking');
    Object.assign(edric, { col: circle.col, row: circle.row });
    b._processVigil();
    expect(called(b).map((u) => u._summonedBy)).not.toContain('circle:circle_waking');
    expect(called(b)).toHaveLength(3);
    expect(b._vigilState.byCircle.circle_waking).toBeUndefined();
  });
});

describe('rewind and resume', () => {
  /** What a checkpoint holds of this battle (units and world state), across JSON. */
  const checkpoint = (b) =>
    JSON.parse(
      JSON.stringify({
        world: captureBattleWorldState(b),
        enemyUnits: b.enemyUnits.map(serializeBattleUnit),
        playerUnits: b.playerUnits.map(serializeBattleUnit),
        turn: b.turnManager.turnNumber,
      }),
    );
  const restore = (b, saved) => {
    const revive = (list) =>
      structuredClone(list).map((unit) => {
        restoreEquippedReference(unit);
        relinkWeapon(unit);
        return unit;
      });
    b.enemyUnits.splice(0, b.enemyUnits.length, ...revive(saved.enemyUnits));
    b.playerUnits.splice(0, b.playerUnits.length, ...revive(saved.playerUnits));
    b.turnManager.turnNumber = saved.turn;
    restoreBattleWorldState(b, saved.world);
  };
  const shape = (unit) => {
    const { battleEntityId: _id, ...rest } = serializeBattleUnit(unit);
    return rest;
  };

  it('a rewind takes back the later words and Hollowed, and the replayed phase calls the same', () => {
    const { b } = voicesOnly(5);
    b.turnManager.turnNumber = 1;
    b._processVigil();
    // Move every Hollowed off its circle (as the phase's walk would), then snapshot turn 2.
    called(b).forEach((u, i) => Object.assign(u, { col: 3 + i, row: 2 }));
    b.turnManager.turnNumber = 2;
    const saved = checkpoint(b);
    expect(saved.world.vigilState).toMatchObject({ words: 5, summoned: 4, lastProcessedTurn: 1 });

    b._processVigil();
    const first = called(b).slice(4).map(shape);
    expect(first).toHaveLength(4);
    expect(b._vigilState).toMatchObject({ words: 10, summoned: 8, lastProcessedTurn: 2 });

    restore(b, saved);
    expect(b._vigilState).toMatchObject({ words: 5, summoned: 4, lastProcessedTurn: 1 });
    expect(called(b)).toHaveLength(4);
    b._processVigil();
    expect(called(b).slice(4).map(shape)).toEqual(first);
    expect(b._vigilState).toMatchObject({ words: 10, summoned: 8, lastProcessedTurn: 2 });
  });

  it('a resume from a checkpoint taken after the phase step never replays it', () => {
    const { b } = voicesOnly(5);
    b.turnManager.turnNumber = 3;
    b._processVigil();
    const saved = checkpoint(b);
    // Another battle object at the same point loses its live state, then takes the checkpoint.
    const resumed = voicesOnly(5).b;
    resumed._vigilState = null;
    restore(resumed, saved);
    expect(resumed._vigilState).toEqual(b._vigilState);
    expect(called(resumed).map(shape)).toEqual(called(b).map(shape));
    // The resumed enemy phase runs the turn-start step again (a replayed pipeline): nothing.
    resumed._processVigil();
    expect(called(resumed)).toHaveLength(4);
    expect(resumed._vigilState.words).toBe(5);
  });

  it('a world state from a map without a Vigil leaves the count alone (and saves none)', () => {
    const { b } = vigilBattle();
    b._processVigil();
    const before = structuredClone(b._vigilState);
    restoreBattleWorldState(b, { mapLayout: null });
    expect(b._vigilState).toEqual(before);
    const plain = { ...b, _vigilState: null, grid: b.grid };
    expect(captureBattleWorldState(plain)).not.toHaveProperty('vigilState');
  });
});

describe('what a called Hollowed pays', () => {
  it('no gold, half the XP (even on an elite node), no survival XP, no deed', () => {
    const { b, edric } = vigilBattle(3, { isElite: true });
    b._processVigil();
    const [hollowed] = called(b);
    expect(b._getEnemyRewardMultiplier(hollowed)).toBe(0);
    expect(b._getEnemyXpMultiplier(hollowed)).toBe(0.5);
    // A Voice on the same elite node pays the elite bonus.
    expect(b._getEnemyXpMultiplier(voiceOf(b, 'voice_calling'))).toBeGreaterThan(1);

    const gold = b.goldEarned;
    b._removeUnit(hollowed, { killer: edric });
    expect(b.goldEarned).toBe(gold);

    b.battleParams.xpMultiplier = 1;
    b.turnPar = null;
    const [victim] = called(b);
    const plain = { ...victim };
    delete plain._summonedBy;
    Object.assign(edric, { level: 1, tier: 'base', xp: 0 });
    const earned = (foe) => {
      Object.assign(edric, { level: 1, xp: 0 });
      b._awardCombatXP(edric, foe, true, null, null);
      return (edric.level - 1) * 100 + edric.xp;
    };
    const base = calculateCombatXP(edric, victim, true);
    expect(base).toBeGreaterThan(8);
    expect(earned(plain)).toBe(Math.floor(base * 1)); // a plain foe at this battle's rate
    expect(earned(victim)).toBe(Math.floor(base * 0.5));

    // Surviving its attack: nothing (a plain foe's attack pays the survival minimum).
    const survived = (foe) => {
      Object.assign(edric, { level: 1, xp: 0 });
      b._awardCombatXP(edric, foe, false, 0, foe.currentHP, { survivedAttack: true });
      return edric.xp;
    };
    expect(survived(plain)).toBeGreaterThan(0);
    expect(survived(victim)).toBe(0);

    // Deeds: the kill counts, the terrain and weapon tallies do not.
    const hero = createUnit(classOf('Fighter'), 5, data.weapons, { name: 'Hero' });
    recordKill({ ...victim, faction: 'enemy' }, hero, { terrain: 'Floor' });
    const tallies = beginBattleDeeds(hero);
    expect(tallies.kills).toBe(1);
    expect(tallies.killsByTerrain).toEqual({});
    expect(tallies.killsByWeapon).toEqual({});
  });
});

describe('the defeat objective and the circles', () => {
  it('silencing the four Voices wins with Hollowed standing; a silenced Voice’s circle stays shut', () => {
    const { b, edric } = vigilBattle();
    b._processVigil();
    expect(called(b)).toHaveLength(4);
    b._removeUnit(voiceOf(b, 'voice_calling'), { killer: edric });
    called(b).forEach((u, i) => Object.assign(u, { col: 1 + i, row: 2 }));
    b.turnManager.turnNumber = 2;
    b._processVigil();
    expect(called(b).filter((u) => u._summonedBy === 'circle:circle_calling')).toHaveLength(1);
    expect(called(b)).toHaveLength(7);
    expect(b._checkBattleEnd()).toBe(false);
    for (const id of VOICES.slice(1)) b._removeUnit(voiceOf(b, id), { killer: edric });
    expect(called(b).length).toBeGreaterThan(0);
    expect(b._checkBattleEnd()).toBe(true);
    expect(b.result).toBe('victory');
  });
});

describe('a Voice moved off its sigil walks back', () => {
  it('shoved off, it speaks nothing, walks back in the enemy phase, and speaks the next', async () => {
    const { driver, b, edric } = voicesOnly(6);
    const voice = voiceOf(b, 'voice_binding');
    const sigil = sigilOf(b, 'voice_binding');
    Object.assign(voice, { col: sigil.col + 2, row: sigil.row }); // two tiles east
    expect(holdsPost(voice)).toBe(false); // Danger draws its walk, not the post's reach
    const decisions = [];
    const decide = b.aiController._decideAction.bind(b.aiController);
    b.aiController._decideAction = (enemy, ...rest) => {
      const decision = decide(enemy, ...rest);
      if (enemy === voice) decisions.push(decision.reason);
      return decision;
    };
    await driver.step({ type: 'end_turn', payload: {} });
    expect(b._vigilState.byVoice.voice_binding).toBeUndefined(); // off its sigil: no word
    expect(decisions).toEqual(['post_return_advance']);
    expect([voice.col, voice.row]).toEqual([sigil.col, sigil.row]);
    expect(holdsPost(voice)).toBe(true);
    expect(edric.currentHP).toBeGreaterThan(0);
    await driver.step({ type: 'end_turn', payload: {} });
    expect(b._vigilState.byVoice.voice_binding).toBe(1);
    // Back on its post it holds: no walk.
    expect(decisions[1]).toMatch(/post_hold|attack_in_range/);
  });

  it('a unit standing on its sigil is struck from beside it, never walked around', async () => {
    const { driver, b, edric } = voicesOnly(6);
    const voice = voiceOf(b, 'voice_feeding');
    const sigil = sigilOf(b, 'voice_feeding');
    Object.assign(voice, { col: sigil.col, row: sigil.row + 1 });
    Object.assign(edric, { col: sigil.col, row: sigil.row });
    let reason = null;
    const decide = b.aiController._decideAction.bind(b.aiController);
    b.aiController._decideAction = (enemy, ...rest) => {
      const decision = decide(enemy, ...rest);
      if (enemy === voice) reason = decision.reason;
      return decision;
    };
    const hp = edric.currentHP;
    await driver.step({ type: 'end_turn', payload: {} });
    expect(reason).toBe('post_return_attack_blocker');
    expect(edric.currentHP).toBeLessThanOrEqual(hp);
    expect(b._vigilState.byVoice.voice_feeding).toBeUndefined();
  });
});

// Unweave (engine/Vigil.js unweaveCircle; the scene's action menu, VigilController.unweave):
//   - offered with no shields, off a circle, or on a broken one; not offered on a standing one
//   - the circle waits for the enemy phase to break, or the unit can act again after it
//   - the scripted agent standing on its circle attacks or waits instead of Unweaving
describe('Unweave in the harness', () => {
  const shielded = () => {
    const out = vigilBattle();
    Object.assign(out.b.battleConfig.vigil, { wards: true, choir: true });
    return out;
  };
  const circleOf = (b, id) => b.battleConfig.vigil.circles.find((c) => c.id === id);
  const labels = (driver) =>
    driver
      .listLegalActions()
      .filter((a) => a.type === 'choose_action')
      .map((a) => a.payload.label);
  const onTo = async (driver, unit, tile) => {
    unit.col = tile.col;
    unit.row = tile.row;
    await driver.step({ type: 'select_unit', payload: { unitName: unit.name } });
    await driver.step({ type: 'move_to', payload: { col: tile.col, row: tile.row } });
  };

  it('breaks the circle under the unit at once and ends its action', async () => {
    const { driver, b, edric } = shielded();
    await onTo(driver, edric, circleOf(b, 'circle_calling'));
    expect(labels(driver)).toContain('Unweave');
    await driver.step({ type: 'choose_action', payload: { label: 'Unweave' } });
    expect(b._vigilState.broken).toEqual({ circle_calling: 1 });
    expect(edric.hasActed).toBe(true);
    expect(voiceOf(b, 'voice_calling').warded).toBeUndefined();
    expect(voiceOf(b, 'voice_binding')).toMatchObject({ warded: true, wardMark: 2 });
  });

  it('is not offered with the shields off, off a circle, or on a broken circle', async () => {
    const plain = vigilBattle();
    await onTo(plain.driver, plain.edric, circleOf(plain.b, 'circle_calling'));
    expect(labels(plain.driver)).not.toContain('Unweave');

    const { driver, b, edric } = shielded();
    await onTo(driver, edric, { col: edric.col, row: edric.row });
    expect(labels(driver)).not.toContain('Unweave');
    await driver.step({ type: 'choose_action', payload: { label: 'Wait' } });
    b._vigilState = { ...b._vigilState, broken: { circle_binding: 1 } };
    const other = b.playerUnits.find((u) => u !== edric);
    await onTo(driver, other, circleOf(b, 'circle_binding'));
    expect(labels(driver)).not.toContain('Unweave');
  });

  it('the scripted agent on its circle Unweaves it', async () => {
    const { ScriptedAgent } = await import('../agents/ScriptedAgent.js');
    const { driver, b, edric } = shielded();
    await onTo(driver, edric, circleOf(b, 'circle_calling'));
    const pick = new ScriptedAgent(driver).chooseAction(driver.listLegalActions());
    expect(pick.payload.label).toBe('Unweave');
  });
});
