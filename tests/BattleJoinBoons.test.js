// A unit that joins the army mid-battle (Talk: a recruit node's or an event's green recruit) is
// owed what the army was given as the battle began, by the card's own words
// (engine/BattleJoinBoons.js): Cavalier's Hour ("mounted units +1 Move in battle; foot soldiers
// +1 DEF") and Captain's Whistle ("every unit has +1 Move on turn 1"), as battle-scoped state the
// battle's end takes back; the act-scoped stat cards ("+3 STR and +3 MAG to all units in Act 1")
// as the run's permanent act delta, keyed on the unit so a Vision rewind across the Talk can
// neither lose nor double it. A Lingering Injury is one named unit's and never a joiner's.
//
// Each test names the realistic way the rule breaks. The battles are the headless harness's
// (HeadlessBattle._executeTalk calls the same settleRecruitJoin as the scene's
// MovementActionController.executeTalk); the checkpoint is captureBattleState's, crossed through
// JSON and restored the way BattleSuspendController.applyUnits restores it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunManager, serializeUnit } from '../src/engine/RunManager.js';
import { clearBattleScopedDeltas, applyBattleDebuff } from '../src/engine/BattleStatDeltas.js';
import { applyBattleJoinBoons, battleJoinBoons } from '../src/engine/BattleJoinBoons.js';
import { settleRecruitJoin } from '../src/engine/BattleRecruits.js';
import { expireTimedBuffs } from '../src/engine/TimedWeaponArtBuffs.js';
import { restoreEquippedReference } from '../src/engine/BattleUnitState.js';
import { captureBattleState } from '../src/ui/BattleCheckpointAdapter.js';
import { createUnit } from '../src/engine/UnitManager.js';
import { addBurden } from '../src/engine/Burdens.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { loadFixture } from './fixtures/battles/index.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const ROOT = join(import.meta.dirname, '..');
const talkSource = readFileSync(join(ROOT, 'src/ui/MovementActionController.js'), 'utf8');
const harnessSource = readFileSync(join(ROOT, 'tests/harness/HeadlessBattle.js'), 'utf8');

let store;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  restoreMathRandom();
});

const classOf = (name) => data.classes.find((c) => c.name === name);

function startRun({ seed = 515 } = {}) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId: 'dusk', applyBlessingsAtStart: false });
  return rm;
}
function hold(rm, ...ids) {
  rm.activeBlessings = ids.map((id) => ({ id, rolledCost: null }));
  rm._runStartBlessingsApplied = false;
  rm.applyRunStartBlessingEffects();
  return rm;
}
const firstBattle = (rm) => rm.nodeMap.nodes.find((n) => n.type === 'battle');

/** A fresh battle of the run's roster, as the scene's fresh start fields it. */
function battleOf(rm, { seed = 9 } = {}) {
  installSeed(seed);
  const node = firstBattle(rm);
  const params = { ...loadFixture('act1_village_race').battleParams, ...rm.getBattleParams(node) };
  const battle = new HeadlessBattle(data, params, rm.getRoster(), { runManager: rm });
  battle.init();
  return { battle, node };
}

/** A green recruit of `className` on a free tile beside the army's lord. */
function placeRecruit(battle, className, name) {
  const lord = battle.playerUnits.find((u) => u.isLord) || battle.playerUnits[0];
  const occupied = new Set(
    [...battle.playerUnits, ...battle.enemyUnits, ...battle.npcUnits].map(
      (u) => `${u.col},${u.row}`,
    ),
  );
  const tile = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
    .map(([dc, dr]) => ({ col: lord.col + dc, row: lord.row + dr }))
    .find(
      ({ col, row }) =>
        col >= 0 &&
        row >= 0 &&
        col < battle.grid.cols &&
        row < battle.grid.rows &&
        !occupied.has(`${col},${row}`),
    );
  expect(tile).toBeTruthy();
  const npc = createUnit(classOf(className), 3, data.weapons, { name, faction: 'npc' });
  npc.col = tile.col;
  npc.row = tile.row;
  battle.npcUnits.push(npc);
  return { lord, npc };
}

/** The lord Talks to the recruit through the harness's own action menu. */
function talk(battle, lord) {
  battle.selectUnit(lord.name);
  battle.moveTo(lord.col, lord.row);
  battle.chooseAction('Talk');
}

const statsOf = (unit) => ({ ...unit.stats, mov: unit.mov });

/** A suspend checkpoint (captureBattleState) across a JSON boundary, as the save holds it. */
const checkpointOf = (battle) => JSON.parse(JSON.stringify(captureBattleState(battle)));

/** Put a checkpoint's units and recruits back, as BattleSuspendController.applyUnits does. */
function restoreFrom(battle, checkpoint) {
  const restore = (list) =>
    list.map((data) => {
      const unit = structuredClone(data);
      restoreEquippedReference(unit);
      return unit;
    });
  battle.playerUnits = restore(checkpoint.playerUnits);
  battle.enemyUnits = restore(checkpoint.enemyUnits);
  battle.npcUnits = restore(checkpoint.npcUnits);
  battle._battleRecruits = structuredClone(checkpoint.battleRecruits);
  battle.turnManager.playerUnits = battle.playerUnits;
  battle.turnManager.enemyUnits = battle.enemyUnits;
  battle.turnManager.npcUnits = battle.npcUnits;
}

/** The victory commit: battle deltas taken back (PostCombatController), then the run's. */
function win(rm, battle, node) {
  clearBattleScopedDeltas(battle.playerUnits);
  expect(rm.completeBattle(battle.playerUnits, node.id, 0, { turnCount: 3, turnPar: 8 })).toBe(
    true,
  );
}

// ── Cavalier's Hour ───────────────────────────────────────────────────────

describe("Cavalier's Hour reaches a unit that joins mid-battle", () => {
  it.each([
    ['Cavalier', { MOV: 1, DEF: 0 }],
    ['Pegasus Knight', { MOV: 1, DEF: 0 }],
    ['Fighter', { MOV: 0, DEF: 1 }],
    ['Knight', { MOV: 0, DEF: 0 }],
  ])('a %s recruited by Talk takes its move type’s bonus, once', (className, gain) => {
    const rm = hold(startRun(), 'cavaliers_hour');
    const { battle } = battleOf(rm);
    const { lord, npc } = placeRecruit(battle, className, 'Joiner');
    const before = statsOf(npc);
    talk(battle, lord);
    const joined = battle.playerUnits.find((u) => u.name === 'Joiner');
    expect(joined).toBe(npc);
    expect(joined.faction).toBe('player');
    // "+1 Move" for Cavalry and Flying, "+1 DEF" for foot soldiers, nothing for Armored.
    expect(joined.stats.MOV).toBe(before.MOV + gain.MOV);
    expect(joined.mov).toBe(before.MOV + gain.MOV);
    expect(joined.stats.DEF).toBe(before.DEF + gain.DEF);
    for (const stat of ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'RES', 'LCK'])
      expect(joined.stats[stat], stat).toBe(before[stat]);
    // A battle delta, so the battle's end takes it back like the army's.
    const recorded = Object.fromEntries(
      Object.entries(joined._battleDeltas || {}).filter(([, v]) => v !== 0),
    );
    const expected = Object.fromEntries(Object.entries(gain).filter(([, v]) => v !== 0));
    expect(recorded).toEqual(expected);
  });

  it('a joining Cavalier moves as far as one that started the battle (5 -> 6)', () => {
    const rm = hold(startRun(), 'cavaliers_hour');
    const rider = createUnit(classOf('Cavalier'), 1, data.weapons, { name: 'Rider' });
    rm.assignUnitUid(rider);
    rm.roster.push(rider);
    const { battle } = battleOf(rm);
    const starter = battle.playerUnits.find((u) => u.name === 'Rider');
    expect(starter).toBeTruthy();
    expect(classOf('Cavalier').baseStats.MOV).toBe(5);
    expect(starter.stats.MOV).toBe(6);
    const { lord, npc } = placeRecruit(battle, 'Cavalier', 'Joiner');
    expect(npc.stats.MOV).toBe(5);
    talk(battle, lord);
    expect(npc.stats.MOV).toBe(6);
  });

  it('a run without the card gives a joiner nothing', () => {
    const rm = startRun();
    const { battle } = battleOf(rm);
    const { lord, npc } = placeRecruit(battle, 'Cavalier', 'Joiner');
    const before = statsOf(npc);
    talk(battle, lord);
    expect(statsOf(npc)).toEqual(before);
    expect(npc._battleDeltas).toBeUndefined();
  });

  it('never twice: a joiner already carrying the delta takes no more', () => {
    const rm = hold(startRun(), 'cavaliers_hour');
    const { battle } = battleOf(rm);
    const { lord, npc } = placeRecruit(battle, 'Cavalier', 'Joiner');
    const before = statsOf(npc);
    talk(battle, lord);
    expect(battleJoinBoons({ unit: npc, run: rm, turn: 1 }).deltas).toEqual([]);
    applyBattleJoinBoons(npc, { run: rm, turn: 1 });
    expect(npc.stats.MOV).toBe(before.MOV + 1);
    // A battle delta of another kind (an Intimidate) is no Cavalier's Hour: it does not count.
    const other = createUnit(classOf('Cavalier'), 1, data.weapons, { name: 'Other' });
    rm.assignUnitUid(other);
    applyBattleDebuff(other, 'SPD', -1);
    expect(battleJoinBoons({ unit: other, run: rm, turn: 1 }).deltas).toEqual([
      { unitUid: other.unitUid, stat: 'MOV', value: 1, source: 'cavaliers_hour' },
    ]);
  });

  it('a Lingering Injury is one named unit’s: a joiner takes only the army-wide card', () => {
    const rm = hold(startRun(), 'cavaliers_hour');
    const edric = rm.roster[0];
    expect(
      addBurden(rm, 'wounded', { unitUid: edric.unitUid, unitName: edric.name, stat: 'STR' }).ok,
    ).toBe(true);
    expect(rm.getBattleParams(firstBattle(rm)).battleDebuffs.map((d) => d.source)).toContain(
      'wounded',
    );
    const { battle } = battleOf(rm);
    const { lord, npc } = placeRecruit(battle, 'Fighter', 'Joiner');
    const before = statsOf(npc);
    talk(battle, lord);
    expect(npc.stats.STR).toBe(before.STR);
    expect(npc.stats.DEF).toBe(before.DEF + 1);
    expect(npc._battleDeltaSources).toEqual(['cavaliers_hour']);
  });

  it('survives a suspend exactly once: the checkpoint carries it and a resume adds nothing', () => {
    const rm = hold(startRun(), 'cavaliers_hour');
    const { battle } = battleOf(rm);
    const { lord, npc } = placeRecruit(battle, 'Cavalier', 'Joiner');
    const before = statsOf(npc);
    talk(battle, lord);
    const checkpoint = checkpointOf(battle);
    restoreFrom(battle, checkpoint);
    const resumed = battle.playerUnits.find((u) => u.name === 'Joiner');
    expect(resumed).not.toBe(npc);
    expect(resumed.stats.MOV).toBe(before.MOV + 1);
    expect(resumed.mov).toBe(before.MOV + 1);
    expect(resumed._battleDeltas).toEqual({ MOV: 1 });
    // Whatever runs the join's rule again on the resumed unit owes it nothing.
    applyBattleJoinBoons(resumed, { run: rm, turn: battle.turnManager.turnNumber });
    expect(resumed.stats.MOV).toBe(before.MOV + 1);
    // And it is still taken back at the battle's end.
    clearBattleScopedDeltas([resumed]);
    expect(resumed.stats.MOV).toBe(before.MOV);
    expect(resumed._battleDeltaSources).toBeUndefined();
  });

  it('a Vision rewind to before the Talk forgets it; the Talk again gives it once', () => {
    const rm = hold(startRun(), 'cavaliers_hour');
    const { battle } = battleOf(rm);
    const { lord, npc } = placeRecruit(battle, 'Fighter', 'Joiner');
    const before = statsOf(npc);
    const beforeTalk = checkpointOf(battle);
    talk(battle, lord);
    expect(npc.stats.DEF).toBe(before.DEF + 1);
    restoreFrom(battle, beforeTalk);
    const green = battle.npcUnits.find((u) => u.name === 'Joiner');
    expect(green.faction).toBe('npc');
    expect(green.stats.DEF).toBe(before.DEF);
    const lordAgain = battle.playerUnits.find((u) => u.name === lord.name);
    talk(battle, lordAgain);
    expect(green.faction).toBe('player');
    expect(green.stats.DEF).toBe(before.DEF + 1);
  });

  it('never becomes permanent: after the victory the roster unit has its own stats', () => {
    const rm = hold(startRun(), 'cavaliers_hour');
    const { battle, node } = battleOf(rm);
    const { lord, npc } = placeRecruit(battle, 'Cavalier', 'Joiner');
    const before = statsOf(npc);
    talk(battle, lord);
    expect(npc.stats.MOV).toBe(before.MOV + 1);
    win(rm, battle, node);
    const kept = rm.roster.find((u) => u.name === 'Joiner');
    expect(kept).toBeTruthy();
    expect(statsOf(kept)).toEqual(before);
    expect(kept._battleDeltas).toBeUndefined();
    expect(kept._battleDeltaSources).toBeUndefined();
    // The next battle gives it again, once, through the battle's start (it is in the roster now).
    const debuffs = rm
      .getBattleParams(rm.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed))
      .battleDebuffs.filter((d) => d.unitUid === kept.unitUid);
    expect(debuffs).toEqual([
      { unitUid: kept.unitUid, stat: 'MOV', value: 1, source: 'cavaliers_hour' },
    ]);
  });

  it('a saved unit never carries the bookkeeping (serializeUnit drops the source ledger)', () => {
    const rm = hold(startRun(), 'cavaliers_hour');
    const { battle } = battleOf(rm);
    const { lord, npc } = placeRecruit(battle, 'Fighter', 'Joiner');
    talk(battle, lord);
    expect(npc._battleDeltaSources).toEqual(['cavaliers_hour']);
    const saved = serializeUnit(npc);
    expect(saved._battleDeltas).toBeUndefined();
    expect(saved._battleDeltaSources).toBeUndefined();
  });

  it('a joiner who falls is recorded as it joined, without the battle’s bonus', () => {
    const rm = hold(startRun(), 'cavaliers_hour');
    const { battle } = battleOf(rm);
    const { lord, npc } = placeRecruit(battle, 'Fighter', 'Joiner');
    const before = statsOf(npc);
    talk(battle, lord);
    const record = battle._battleRecruits.find((r) => r.name === 'Joiner');
    expect(record.unit.stats.DEF).toBe(before.DEF);
    expect(record.unit._battleDeltas).toBeUndefined();
    expect(record.unit._battleDeltaSources).toBeUndefined();
  });
});

// ── Captain's Whistle ─────────────────────────────────────────────────────

describe("Captain's Whistle reaches a unit that joins on turn 1", () => {
  function whistleRun() {
    const rm = startRun();
    rm.blessingRuntimeModifiers.firstTurnMovDelta = 1;
    return rm;
  }

  it('a turn-1 joiner has +1 Move until turn 1’s enemy phase, like the army', () => {
    const rm = whistleRun();
    const { battle } = battleOf(rm);
    const starter = battle.playerUnits[0];
    const starterBase = rm.roster.find((u) => u.unitUid === starter.unitUid).stats.MOV;
    expect(starter.stats.MOV).toBe(starterBase + 1);
    expect(battle.turnManager.turnNumber).toBe(1);
    const { lord, npc } = placeRecruit(battle, 'Fighter', 'Joiner');
    const before = statsOf(npc);
    talk(battle, lord);
    expect(npc.stats.MOV).toBe(before.MOV + 1);
    expect(npc.mov).toBe(before.MOV + 1);
    // It ends with the army's, as turn 1's enemy phase starts.
    expireTimedBuffs(battle.playerUnits, 'enemy', 1);
    expect(npc.stats.MOV).toBe(before.MOV);
    expect(starter.stats.MOV).toBe(starterBase);
  });

  it('a join on a later turn is owed nothing, and twice on turn 1 is still +1', () => {
    const state = { firstTurnMov: 1, lastStand: 0, firstKillHeal: 0, spent: [] };
    const unit = createUnit(classOf('Fighter'), 1, data.weapons, { name: 'Late' });
    expect(battleJoinBoons({ unit, battleBlessings: state, turn: 2 }).buffs).toEqual([]);
    const mov = unit.stats.MOV;
    applyBattleJoinBoons(unit, { battleBlessings: state, turn: 1 });
    applyBattleJoinBoons(unit, { battleBlessings: state, turn: 1 });
    expect(unit.stats.MOV).toBe(mov + 1);
  });

  it('rides the checkpoint and is taken back at the victory', () => {
    const rm = whistleRun();
    const { battle, node } = battleOf(rm);
    const { lord, npc } = placeRecruit(battle, 'Fighter', 'Joiner');
    const before = statsOf(npc);
    talk(battle, lord);
    restoreFrom(battle, checkpointOf(battle));
    const resumed = battle.playerUnits.find((u) => u.name === 'Joiner');
    expect(resumed.stats.MOV).toBe(before.MOV + 1);
    win(rm, battle, node);
    expect(statsOf(rm.roster.find((u) => u.name === 'Joiner'))).toEqual(before);
  });
});

// ── The act's stat cards (Rally Cry, the Act 1 DEF prices) ─────────────────

describe('An act-scoped "all units" stat card reaches a Talk recruit once, rewind or not', () => {
  it('a Talk recruit in Act 1 takes Rally Cry’s +3 STR / +3 MAG; the act’s end takes it back', () => {
    const rm = hold(startRun(), 'rally_cry');
    const { battle, node } = battleOf(rm);
    const { lord, npc } = placeRecruit(battle, 'Fighter', 'Joiner');
    const before = statsOf(npc);
    talk(battle, lord);
    expect(npc.stats.STR).toBe(before.STR + 3);
    expect(npc.stats.MAG).toBe(before.MAG + 3);
    win(rm, battle, node);
    const kept = rm.roster.find((u) => u.name === 'Joiner');
    expect(kept.stats.STR).toBe(before.STR + 3);
    rm._revertActScopedBlessingEffects('act1');
    expect(kept.stats.STR).toBe(before.STR);
    expect(kept.stats.MAG).toBe(before.MAG);
  });

  it('a Vision rewind across the Talk: the Talk again gives it once, and the act end nets zero', () => {
    const rm = hold(startRun(), 'rally_cry');
    const { battle, node } = battleOf(rm);
    const { lord, npc } = placeRecruit(battle, 'Fighter', 'Joiner');
    // The scene gives a recruit its run identity as it spawns, so the rewound unit keeps it.
    rm.assignUnitUid(npc);
    const before = statsOf(npc);
    const beforeTalk = checkpointOf(battle);
    talk(battle, lord);
    expect(npc.stats.STR).toBe(before.STR + 3);
    // The run's tracker is not part of a battle checkpoint: it keeps the recruit's uid.
    restoreFrom(battle, beforeTalk);
    const green = battle.npcUnits.find((u) => u.name === 'Joiner');
    expect(green.stats.STR).toBe(before.STR);
    talk(
      battle,
      battle.playerUnits.find((u) => u.name === lord.name),
    );
    expect(green.stats.STR).toBe(before.STR + 3);
    expect(green.stats.MAG).toBe(before.MAG + 3);
    win(rm, battle, node);
    const kept = rm.roster.find((u) => u.name === 'Joiner');
    rm._revertActScopedBlessingEffects('act1');
    expect(kept.stats.STR).toBe(before.STR);
    expect(kept.stats.MAG).toBe(before.MAG);
  });

  it('a save from before holders were tracked: a joiner takes it, as the act end reverts the roster', () => {
    const rm = hold(startRun(), 'rally_cry');
    for (const tracker of rm.blessingRuntimeModifiers.actStatDeltaAllUnits) delete tracker.unitUids;
    const { battle, node } = battleOf(rm);
    const { lord, npc } = placeRecruit(battle, 'Fighter', 'Joiner');
    const before = statsOf(npc);
    talk(battle, lord);
    expect(npc.stats.STR).toBe(before.STR + 3);
    win(rm, battle, node);
    const kept = rm.roster.find((u) => u.name === 'Joiner');
    rm._revertActScopedBlessingEffects('act1');
    expect(kept.stats.STR).toBe(before.STR);
  });

  it('a second join call on the same unit gives nothing more', () => {
    const rm = hold(startRun(), 'rally_cry');
    const unit = createUnit(classOf('Fighter'), 1, data.weapons, { name: 'Twice' });
    const str = unit.stats.STR;
    rm.grantRecruitBlessingConsumables(unit);
    rm.grantRecruitBlessingConsumables(unit);
    expect(unit.stats.STR).toBe(str + 3);
  });

  it('a roster unit the card already reached is never given it again', () => {
    const rm = hold(startRun(), 'rally_cry');
    const edric = rm.roster[0];
    const str = edric.stats.STR;
    rm.grantRecruitBlessingConsumables(edric);
    expect(edric.stats.STR).toBe(str);
  });
});

// ── The scene and the harness join the same way ───────────────────────────

describe('both Talk paths hand settleRecruitJoin what the join reads', () => {
  it('the scene and the harness pass the battle’s earned-blessing state', () => {
    expect(talkSource).toMatch(
      /settleRecruitJoin\(\{[^}]*battleBlessings: scene\._battleBlessings/s,
    );
    expect(harnessSource).toMatch(
      /settleRecruitJoin\(\{[^}]*battleBlessings: this\._battleBlessings/s,
    );
  });

  it('a recruit with no run gets its identity from nobody and is owed no delta', () => {
    const npc = createUnit(classOf('Cavalier'), 1, data.weapons, { name: 'Alone' });
    npc.faction = 'npc';
    const npcUnits = [npc];
    const playerUnits = [];
    const mov = npc.stats.MOV;
    expect(
      settleRecruitJoin({ npc, npcUnits, playerUnits, battleRecruits: [], runManager: null }),
    ).toBeTruthy();
    expect(npc.stats.MOV).toBe(mov);
  });
});
