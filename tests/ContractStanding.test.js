// The contract's standing in a battle that is still being fought (engine/ContractStanding.js,
// docs/specs/event-nodes-phase2.md §2E): what the battle HUD says is missed must be exactly what
// the victory commit (RunManager.completeBattle -> ContractSettlement) would break.
//
// Ways this goes wrong:
//   - the HUD's par judgement is off by one against the settlement (par itself is still kept);
//   - noLosses misses a recruit who joined mid-battle and fell, or counts a benched/escaped unit
//     as lost;
//   - a battle that settles nothing (no contract, a node already won, no such node, no run) shows
//     a contract line anyway;
//   - a battle with no par shows an underPar contract as missed, though the settlement keeps it;
//   - the standing is remembered instead of derived: it must change with the turn and the units
//     and never touch the run.
// Every row of the table asks the standing, then wins the same battle for real and compares.
import { describe, expect, it } from 'vitest';
import { battleLosses, contractStanding } from '../src/engine/ContractStanding.js';
import { recordBattleRecruit } from '../src/engine/BattleRecruits.js';
import { createUnit } from '../src/engine/UnitManager.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import { serializeUnit } from '../src/engine/RunManager.js';
import { addUnit, runWithEvents } from './eventKit.js';
import { signedContract } from './contractKit.js';
import { contractEvent } from './eventPhase2Kit.js';

const signed = signedContract;

/** A recruit who joined mid-battle (Talk): in the army, on no roster yet. */
function talkRecruit(run) {
  const classData = run.gameData.classes.find((c) => c.name === 'Archer');
  const unit = createUnit(classData, 1, run.gameData.weapons, {
    name: 'Talky',
    rng: createSeededRng(7),
  });
  run.assignUnitUid(unit);
  return unit;
}

// [label, goal, turn, par, who is lost, expected: would a victory now break it?]
const ROWS = [
  ['underPar before par', 'underPar', 3, 5, {}, false],
  ['underPar on par', 'underPar', 5, 5, {}, false],
  ['underPar one turn over', 'underPar', 6, 5, {}, true],
  ['underPar far over', 'underPar', 12, 5, {}, true],
  [
    'underPar on par with a fallen ally (losses do not matter)',
    'underPar',
    5,
    5,
    { fall: 1 },
    false,
  ],
  ['underPar with no par', 'underPar', 40, null, {}, false],
  ['noLosses, nobody lost', 'noLosses', 9, 5, {}, false],
  ['noLosses, a roster unit fell', 'noLosses', 1, 5, { fall: 1 }, true],
  ['noLosses, a benched unit is not lost', 'noLosses', 1, 5, { bench: 1 }, false],
  ['noLosses, a mid-battle recruit lived', 'noLosses', 1, 5, { recruit: 'lives' }, false],
  ['noLosses, a mid-battle recruit fell', 'noLosses', 1, 5, { recruit: 'falls' }, true],
  [
    'noLosses, a roster unit and a recruit fell',
    'noLosses',
    1,
    5,
    { fall: 1, recruit: 'falls' },
    true,
  ],
];

/**
 * The battle's state for a row. `survivors` is every unit still in the army, benched
 * ones included (the scene's players, escaped and non-deployed units): the commit is
 * handed the same list, plus the as-joined records of recruits who fell.
 */
function battleOf(run, nodeId, [, , turn, par, who]) {
  addUnit(run, 'Archer', { name: 'Hale' });
  addUnit(run, 'Fighter', { name: 'Brant' });
  const army = run.getRoster();
  const survivors = army.filter((u) => !(who.fall && u.name === 'Hale'));
  const battleRecruits = [];
  let fallenRecruits = [];
  if (who.recruit) {
    const talked = talkRecruit(run);
    battleRecruits.push(...recordBattleRecruit([], talked));
    if (who.recruit === 'lives') survivors.push(talked);
    else fallenRecruits = [serializeUnit(talked)];
  }
  return {
    battle: { nodeId, turnCount: turn, turnPar: par, survivors, battleRecruits },
    fallenRecruits,
  };
}

describe('the standing is the settlement, asked early', () => {
  for (const row of ROWS) {
    it(row[0], () => {
      const [, goal, , , , missed] = row;
      const { run, nodeId } = signed(goal);
      const { battle, fallenRecruits } = battleOf(run, nodeId, row);
      const before = JSON.stringify(run.toJSON());
      const standing = contractStanding(run, battle);
      expect(JSON.stringify(run.toJSON()), 'asking changes nothing').toBe(before);
      // Worked by hand, not by the code under test.
      expect(standing?.missed).toBe(missed);

      // Now win it for real: the commit says the same.
      const applied = run.completeBattle(battle.survivors, nodeId, 100, {
        turnCount: battle.turnCount,
        turnPar: battle.turnPar,
        fallenRecruits,
      });
      expect(applied).toBe(true);
      const settled = run.lastContractSettlement;
      expect(standing.missed).toBe(!settled.kept);
      expect(standing.noPar).toBe(settled.noPar);
      expect(standing.losses).toBe(settled.losses);
    });
  }

  it('says why: par for underPar, losses for noLosses', () => {
    const over = signed('underPar');
    expect(
      contractStanding(over.run, { nodeId: over.nodeId, turnCount: 6, turnPar: 5, survivors: [] }),
    ).toMatchObject({ goal: 'underPar', missed: true, cause: 'par' });
    const lost = signed('noLosses');
    addUnit(lost.run, 'Archer', { name: 'Hale' });
    expect(
      contractStanding(lost.run, {
        nodeId: lost.nodeId,
        turnCount: 1,
        turnPar: 5,
        survivors: lost.run.getRoster().filter((u) => u.name !== 'Hale'),
      }),
    ).toMatchObject({ goal: 'noLosses', missed: true, cause: 'losses', losses: 1 });
    const fine = signed('noLosses');
    expect(
      contractStanding(fine.run, {
        nodeId: fine.nodeId,
        turnCount: 99,
        turnPar: 5,
        survivors: fine.run.getRoster(),
      }),
    ).toMatchObject({ missed: false, cause: null });
  });

  it('is derived, never kept: it follows the turn back and forth (a rewind, a par bump)', () => {
    const { run, nodeId } = signed('underPar');
    const at = (turnCount, turnPar = 5) =>
      contractStanding(run, { nodeId, turnCount, turnPar, survivors: run.getRoster() }).missed;
    expect([at(5), at(6), at(5), at(6, 7)]).toEqual([false, true, false, false]);
  });
});

describe('a battle that settles no contract has no standing', () => {
  const battleFor = (run, nodeId) => ({
    nodeId,
    turnCount: 9,
    turnPar: 1,
    survivors: run.getRoster(),
  });

  it('no contract open', () => {
    const run = runWithEvents([contractEvent()], { seed: 61 });
    const node = run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed);
    expect(contractStanding(run, battleFor(run, node.id))).toBeNull();
  });

  it('a node that is already won, or on no map, cannot be won again', () => {
    const { run, nodeId } = signed('underPar');
    expect(contractStanding(run, battleFor(run, 'nowhere'))).toBeNull();
    expect(contractStanding(run, { ...battleFor(run, nodeId), nodeId: null })).toBeNull();
    // The commit refuses a node already complete and leaves the contract open: the same rule.
    run.markNodeComplete(nodeId);
    expect(contractStanding(run, battleFor(run, nodeId))).toBeNull();
    expect(run.completeBattle(run.getRoster(), nodeId, 0, { turnCount: 9, turnPar: 1 })).toBe(
      false,
    );
    expect(run.contract).not.toBeNull();
  });

  it('no run (a standalone replay) has none', () => {
    expect(contractStanding(null, { nodeId: 'n', survivors: [] })).toBeNull();
    expect(contractStanding({ contract: { goal: 'underPar' } }, { nodeId: 'n' })).toBeNull();
  });

  it('a boss battle settles like any other', () => {
    const { run } = signed('underPar');
    const boss = run.nodeMap.nodes.find((n) => n.id === run.nodeMap.bossNodeId);
    expect(
      contractStanding(run, {
        nodeId: boss.id,
        turnCount: 9,
        turnPar: 5,
        survivors: run.getRoster(),
      }),
    ).toMatchObject({ missed: true, cause: 'par' });
  });
});

describe('battleLosses', () => {
  it('counts each unit once: a living namesake never hides a casualty', () => {
    const { run } = signed('noLosses');
    addUnit(run, 'Archer', { name: 'Hale' });
    const army = run.getRoster();
    const twin = structuredClone(army.find((u) => u.name === 'Hale'));
    twin.unitUid = 'ru9999';
    expect(battleLosses(run, { survivors: [twin] })).toBe(army.length);
  });
});
