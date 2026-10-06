// Contracts (docs/specs/event-nodes-phase2.md §2A): a goal for the next battle, settled at the
// victory commit beside the burdens.
//
// Ways this goes wrong:
//   - a second contract opens while one is open, or the open one is lost on save/load, or a
//     malformed saved contract is trusted;
//   - the verdict is off by one (par: equal turns are kept), a battle with no par breaks the
//     contract (a goal nobody could see), `noLosses` ignores a recruit who joined mid-battle and
//     fell, or counts a unit that was only benched;
//   - the contract settles on a battle that was not won (a reverted or suspended one), twice for
//     the same victory, for a second battle, or never;
//   - the penalty's Debt garnishes the very battle that broke it, or never garnishes;
//   - a reward lands on units the commit has not built yet (lost with the roster), an item with no
//     room fails the victory instead of becoming a note, or a failing term blocks the victory or
//     leaves the contract open or half applied.
// Numbers by hand: First Light, kill gold 100 on a battle node = 234 gold (see EventBattles).
import { describe, expect, it, vi } from 'vitest';
import {
  arriveAtEvent,
  chooseEventOption,
  eventChoiceBlock,
  leaveEvent,
} from '../src/engine/EventCommands.js';
import {
  CONTRACT_EFFECT_TYPES,
  contractOf,
  contractVerdict,
  describeContract,
  normalizeContract,
  settlementLines,
} from '../src/engine/Contracts.js';
import { planEffects } from '../src/engine/EventEffects.js';
import { createUnit } from '../src/engine/UnitManager.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import { serializeUnit } from '../src/engine/RunManager.js';
import { addUnit, arriveAs, eventNode, runWithEvents } from './eventKit.js';
import { contractEvent, roundTrip } from './eventPhase2Kit.js';

const BATTLE_GOLD = 234;
const NO_ROOM = 'Nowhere to carry anything more. Make room in the convoy.';

/** A run that has signed a contract at an event node and left it. */
function signed(terms = {}, { seed = 61, difficulty = 'normal' } = {}) {
  const run = runWithEvents([contractEvent(terms)], { seed, difficulty });
  const node = eventNode(run);
  expect(arriveAtEvent(run, node.id).eventId).toBe('contract');
  expect(chooseEventOption(run, node.id, 'sign').ok).toBe(true);
  expect(leaveEvent(run, node.id).ok).toBe(true);
  return { run, signedAt: node };
}

/** The next battle to win: an uncompleted battle node the run stands beside. */
function battleNode(run) {
  const node = run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed);
  run.currentNodeId = node.id;
  return node;
}

function win(
  run,
  { turns = 5, par = 5, survivors = null, gold = 100, node = battleNode(run), ...options } = {},
) {
  const army = survivors || run.getRoster();
  const applied = run.completeBattle(army, node.id, gold, {
    turnCount: turns,
    turnPar: par,
    ...options,
  });
  expect(applied).toBe(true);
  return node;
}

describe('opening a contract', () => {
  it('records the terms on the run and tells the page what was signed', () => {
    const run = runWithEvents([contractEvent()], { seed: 5 });
    const node = eventNode(run);
    arriveAtEvent(run, node.id);
    const result = chooseEventOption(run, node.id, 'sign');
    expect(run.contract).toEqual({
      goal: 'underPar',
      reward: [{ type: 'gold', value: 600 }],
      penalty: [{ type: 'burden', id: 'debt', params: { owed: 300 } }],
      eventId: 'contract',
      nodeId: node.id,
      act: 'act1',
    });
    expect(result.results).toEqual([
      {
        kind: 'contract',
        goal: 'underPar',
        label: 'Contract',
        short: 'Under par',
        line: 'Win the next battle by turn par or sooner.',
        reward: ['+600 G'],
        penalty: ['Debt 300 G'],
        eventId: 'contract',
        nodeId: node.id,
      },
    ]);
    expect(describeContract(run)).toMatchObject({ goal: 'underPar', short: 'Under par' });
    expect(describeContract(runWithEvents([contractEvent()]))).toBeNull();
  });

  it('one at a time: a choice that can open a contract is blocked while one is open; declining never is', () => {
    const { run } = signed();
    const second = arriveAs(
      run,
      'contract',
      run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed && n.row >= 2),
    );
    expect(eventChoiceBlock(run, second.id, 'sign')).toBe('You are already bound by a contract.');
    expect(chooseEventOption(run, second.id, 'sign')).toEqual({
      ok: false,
      reason: 'You are already bound by a contract.',
    });
    expect(eventChoiceBlock(run, second.id, 'decline')).toBe('');
    expect(run.contract.nodeId).not.toBe(second.id); // the first contract is still the one in force
  });

  it('the planner refuses a second contract on its own: two in one outcome, or one more while one is open', () => {
    const terms = { type: 'contract', goal: 'noLosses', reward: [], penalty: [] };
    const run = runWithEvents([contractEvent()], { seed: 5 });
    const node = eventNode(run);
    arriveAtEvent(run, node.id);
    const ctx = { run, node, nodeId: node.id, phase: 'o', choice: { id: 'sign' }, page: 'start' };
    expect(planEffects(ctx, [terms, terms])).toEqual({
      ok: false,
      reason: 'You are already bound by a contract.',
    });
    expect(planEffects(ctx, [terms]).ok).toBe(true);
    run.contract = normalizeContract({ ...terms, eventId: 'x', nodeId: 'n' });
    expect(planEffects(ctx, [terms])).toEqual({
      ok: false,
      reason: 'You are already bound by a contract.',
    });
  });

  it('the goal is plain data: a contract survives a save and a load', () => {
    const { run } = signed({ goal: 'noLosses' });
    expect(roundTrip(run).contract).toEqual(run.contract);
  });
});

describe('the verdict', () => {
  it('underPar: equal turns keep it, one over breaks it', () => {
    const contract = { goal: 'underPar' };
    expect(contractVerdict(contract, { turnCount: 5, turnPar: 5 }).kept).toBe(true);
    expect(contractVerdict(contract, { turnCount: 4, turnPar: 5 }).kept).toBe(true);
    expect(contractVerdict(contract, { turnCount: 6, turnPar: 5 }).kept).toBe(false);
  });

  it('a battle with no par cannot be judged: the contract is kept (and says so)', () => {
    const contract = { goal: 'underPar' };
    for (const par of [null, undefined, NaN]) {
      expect(contractVerdict(contract, { turnCount: 99, turnPar: par })).toEqual({
        kept: true,
        noPar: true,
      });
    }
    expect(contractVerdict(contract, { turnPar: 5 })).toEqual({ kept: true, noPar: true });
    // par 0 is a par: one turn is over it
    expect(contractVerdict(contract, { turnCount: 1, turnPar: 0 }).kept).toBe(false);
  });

  it('noLosses: any loss breaks it', () => {
    const contract = { goal: 'noLosses' };
    expect(contractVerdict(contract, { losses: 0 }).kept).toBe(true);
    expect(contractVerdict(contract, { losses: 1 }).kept).toBe(false);
    expect(contractVerdict(contract, {}).kept).toBe(true);
  });
});

describe('settling at the victory commit', () => {
  it('underPar kept: the reward is paid, the contract is closed, the band has its line', () => {
    const { run } = signed();
    const gold = run.gold;
    const node = win(run, { turns: 5, par: 5 });
    expect(run.gold).toBe(gold + BATTLE_GOLD + 600);
    expect(run.contract).toBeNull();
    expect(run.lastContractSettlement).toMatchObject({
      nodeId: node.id,
      goal: 'underPar',
      kept: true,
      noPar: false,
      losses: 0,
      failed: null,
      lines: ['Contract kept: +600 G'],
    });
    expect(run.lastContractSettlement.results).toEqual([
      { kind: 'gold', value: 600, requested: 600 },
    ]);
  });

  it('underPar broken: the penalty is a burden, and its Debt starts with the NEXT victory', () => {
    const { run } = signed();
    const gold = run.gold;
    win(run, { turns: 6, par: 5 });
    expect(run.gold).toBe(gold + BATTLE_GOLD); // this victory is not garnished by the debt it created
    expect(run.burdens).toEqual([{ id: 'debt', owed: 300, garnish: 0.25 }]); // First Light: a quarter
    expect(run.lastContractSettlement).toMatchObject({
      kept: false,
      lines: ['Contract broken: Debt (300 G owed)'],
    });
    // the next victory is garnished: floor(234 x 0.25) = 58
    const after = run.gold;
    win(run, {
      turns: 1,
      par: 5,
      node: run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed),
    });
    expect(run.gold).toBe(after + BATTLE_GOLD - 58);
    expect(run.burdens).toEqual([{ id: 'debt', owed: 242, garnish: 0.25 }]);
  });

  it('noLosses: nobody lost is kept; a fallen unit breaks it; a bench warmer is not a loss', () => {
    const kept = signed({ goal: 'noLosses' });
    const army = kept.run.getRoster();
    win(kept.run, { survivors: army });
    expect(kept.run.lastContractSettlement).toMatchObject({ kept: true, losses: 0 });

    const broken = signed({ goal: 'noLosses' });
    addUnit(broken.run, 'Archer', { name: 'Hale' });
    const survivors = broken.run.getRoster().filter((u) => u.name !== 'Hale');
    win(broken.run, { survivors });
    expect(broken.run.fallenUnits.map((u) => u.name)).toEqual(['Hale']);
    expect(broken.run.lastContractSettlement).toMatchObject({ kept: false, losses: 1 });
    expect(broken.run.burdens.map((b) => b.id)).toEqual(['debt']);
  });

  it('noLosses: a recruit who joined mid-battle and fell counts', () => {
    const { run } = signed({ goal: 'noLosses' });
    const classData = run.gameData.classes.find((c) => c.name === 'Archer');
    const talked = createUnit(classData, 1, run.gameData.weapons, {
      name: 'Talky',
      rng: createSeededRng(7),
    });
    run.assignUnitUid(talked);
    win(run, { fallenRecruits: [serializeUnit(talked)] });
    expect(run.lastContractSettlement).toMatchObject({ kept: false, losses: 1 });
  });

  it('a battle with no par keeps an underPar contract', () => {
    const { run } = signed();
    win(run, { turns: 40, par: null });
    expect(run.lastContractSettlement).toMatchObject({ kept: true, noPar: true });
    expect(run.contract).toBeNull();
  });

  it('settles once, for the next victory only: the second battle is untouched', () => {
    const { run } = signed();
    win(run, { turns: 1, par: 5 });
    const gold = run.gold;
    win(run, {
      turns: 1,
      par: 5,
      node: run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed),
    });
    expect(run.gold).toBe(gold + BATTLE_GOLD);
    expect(run.lastContractSettlement).toBeNull();
  });

  it('a victory that does not apply (the node is already won) settles nothing', () => {
    const { run } = signed();
    const node = win(run, { turns: 1, par: 5 });
    // a second contract is signed; completing the same node again is a no-op
    run.contract = normalizeContract({
      goal: 'underPar',
      reward: [{ type: 'gold', value: 600 }],
      eventId: 'x',
      nodeId: 'n',
    });
    const gold = run.gold;
    expect(run.completeBattle(run.getRoster(), node.id, 100, { turnCount: 1, turnPar: 5 })).toBe(
      false,
    );
    expect(run.contract).not.toBeNull();
    expect(run.gold).toBe(gold);
  });

  it('a boss victory settles too', () => {
    const { run } = signed();
    const gold = run.gold;
    const boss = run.nodeMap.nodes.find((n) => n.id === run.nodeMap.bossNodeId);
    run.currentNodeId = boss.id;
    expect(run.completeBattle(run.getRoster(), boss.id, 100, { turnCount: 2, turnPar: 9 })).toBe(
      true,
    );
    expect(run.lastContractSettlement).toMatchObject({ kept: true, nodeId: boss.id });
    expect(run.gold).toBeGreaterThanOrEqual(gold + 600);
  });
});

describe('a battle that is not won leaves the contract alone', () => {
  it('Continue from Map restores the entry state and the contract stays open and unchanged', () => {
    const { run } = signed();
    const node = battleNode(run);
    const contract = structuredClone(run.contract);
    const gold = run.gold;
    run.beginBattleInProgress(node.id, { battleParams: run.getBattleParams(node) });
    run.setBattleCheckpoint({ turn: 4 });
    expect(run.revertBattleInProgressToEntry()).toBe(true);
    expect(run.contract).toEqual(contract);
    expect(run.gold).toBe(gold);
    expect(run.lastContractSettlement).toBeNull();
    // replaying the node settles exactly once
    win(run, { turns: 1, par: 5, node });
    expect(run.gold).toBe(gold + BATTLE_GOLD + 600);
    expect(run.contract).toBeNull();
  });

  it('a suspended battle (a reload mid-fight) keeps it', () => {
    const { run } = signed({ goal: 'noLosses' });
    const node = battleNode(run);
    run.beginBattleInProgress(node.id, { battleParams: run.getBattleParams(node) });
    run.setBattleCheckpoint({ version: 1, turnNumber: 4 });
    const loaded = roundTrip(run);
    expect(loaded.contract).toEqual(run.contract);
    expect(loaded.battleInProgress).toBeTruthy();
  });
});

describe('rewards and penalties go through the effect planner', () => {
  it('a reward lands on the army the commit built (a heal reaches the survivors)', () => {
    const { run } = signed({ reward: [{ type: 'hp', mode: 'heal', percent: 50, scope: 'all' }] });
    const survivors = run.getRoster();
    const edric = survivors.find((u) => u.name === 'Edric');
    edric.currentHP = 5;
    win(run, { survivors, turns: 1, par: 5 });
    const healed = run.roster.find((u) => u.name === 'Edric');
    expect(healed.currentHP).toBe(5 + Math.round(edric.stats.HP / 2));
  });

  it('an item reward is delivered, and with nowhere to put it becomes a note, never a failed victory', () => {
    const reward = [
      { type: 'item', pool: { kind: 'weapon', weaponTypes: '$army', tierOffset: 1 } },
    ];
    const roomy = signed({ reward });
    const weapons =
      roomy.run.roster.flatMap((u) => u.inventory).length + roomy.run.convoy.weapons.length;
    win(roomy.run, { turns: 1, par: 5 });
    expect(roomy.run.lastContractSettlement.results[0]).toMatchObject({ kind: 'item' });
    expect(
      roomy.run.roster.flatMap((u) => u.inventory).length + roomy.run.convoy.weapons.length,
    ).toBe(weapons + 1);

    const full = signed({ reward });
    for (const unit of full.run.roster) {
      while (unit.inventory.length < 5) unit.inventory.push(structuredClone(unit.inventory[0]));
      while (unit.consumables.length < 3)
        unit.consumables.push(full.run.getConsumableTemplate('Vulnerary'));
    }
    const caps = full.run.getConvoyCapacities();
    full.run.convoy.weapons = Array.from({ length: caps.weapons }, () =>
      structuredClone(full.run.gameData.weapons[0]),
    );
    full.run.convoy.consumables = Array.from({ length: caps.consumables }, () =>
      full.run.getConsumableTemplate('Vulnerary'),
    );
    win(full.run, { turns: 1, par: 5 });
    expect(full.run.lastContractSettlement).toMatchObject({
      kept: true,
      failed: null,
      lines: ['Contract kept'],
    });
    expect(full.run.lastContractSettlement.results).toEqual([
      { kind: 'note', of: 'item', text: NO_ROOM },
    ]);
    expect(full.run.contract).toBeNull();
  });

  it('the same seed pays the same item (settlement is seeded)', () => {
    const reward = [
      { type: 'item', pool: { kind: 'weapon', weaponTypes: '$army', tierOffset: 1 } },
    ];
    const pay = () => {
      const { run } = signed({ reward }, { seed: 77 });
      win(run, { turns: 1, par: 5 });
      return run.lastContractSettlement.results[0].name;
    };
    expect(pay()).toBe(pay());
  });

  it('terms that cannot be planned do not block the victory: the contract closes and the run is untouched', () => {
    const { run } = signed({
      reward: [
        { type: 'gold', value: 600 },
        { type: 'burden', id: 'ghost' },
      ],
    });
    const gold = run.gold;
    win(run, { turns: 1, par: 5 });
    expect(run.gold).toBe(gold + BATTLE_GOLD); // plan, then apply: not even the gold that came first
    expect(run.contract).toBeNull();
    expect(run.lastContractSettlement.failed).toBe('Unknown burden "ghost".');
    expect(run.lastContractSettlement.results).toEqual([]);
    expect(run.lastContractSettlement.lines).toEqual(['Contract kept']);
  });

  it('an item the army cannot be given is a note and the rest of the terms still pay', () => {
    const { run } = signed({
      reward: [
        { type: 'item', name: 'No Such Blade' },
        { type: 'gold', value: 600 },
      ],
    });
    const gold = run.gold;
    win(run, { turns: 1, par: 5 });
    expect(run.gold).toBe(gold + BATTLE_GOLD + 600);
    expect(run.lastContractSettlement.results.map((r) => r.kind)).toEqual(['note', 'gold']);
  });

  it('a term that throws while applying puts the run back as it was before the terms', () => {
    const { run } = signed({
      reward: [
        { type: 'gold', value: 600 },
        { type: 'blessing', tier: 1 },
      ],
    });
    const gold = run.gold;
    const spy = vi.spyOn(run, 'addBlessingMidRun').mockReturnValue(false);
    win(run, { turns: 1, par: 5 });
    spy.mockRestore();
    expect(run.gold).toBe(gold + BATTLE_GOLD); // the 600 G that came first was rolled back with it
    expect(run.contract).toBeNull();
    expect(run.lastContractSettlement.failed).toContain('could not be met');
  });
});

describe('a penalty that darkens the sun', () => {
  it('the nodes the dark takes are listed once, on the victory commit, not on the term (the band reads one list)', () => {
    const { run } = signed({ penalty: [{ type: 'shadow', value: 90 }] });
    const before = new Set(run.nodeMap.nodes.filter((n) => n.eclipse).map((n) => n.id));
    win(run, { turns: 9, par: 5 }); // broken: +90 shadow on top of the battle's own
    const taken = run.nodeMap.nodes.filter((n) => n.eclipse && !before.has(n.id)).map((n) => n.id);
    expect(taken.length).toBeGreaterThan(0); // 90 shadow is far past most knots
    expect(run.lastEclipseCommit.fell.slice().sort()).toEqual(taken.sort());
    const record = run.lastContractSettlement.results.find((r) => r.kind === 'shadow');
    expect(record).toMatchObject({ value: expect.any(Number), requested: 90, fell: [] });
  });
});

describe('the contract record from a save', () => {
  it('keeps a valid contract and drops what cannot be one', () => {
    const good = {
      goal: 'noLosses',
      reward: [{ type: 'gold', value: 5 }],
      penalty: [],
      eventId: 'm',
      nodeId: 'n1',
      act: 'act2',
    };
    expect(normalizeContract(good)).toEqual(good);
    for (const bad of [null, undefined, 5, 'x', [], {}, { goal: 'nope' }, { goal: 'win' }])
      expect(normalizeContract(bad)).toBeNull();
  });

  it('keeps only effects a contract may hold, as copies', () => {
    const raw = {
      goal: 'underPar',
      reward: [
        { type: 'gold', value: 1 },
        { type: 'learnSkill', skillId: 'x' },
        { type: 'battle' },
        'junk',
        null,
        { type: 'contract', goal: 'underPar' },
      ],
      penalty: [
        { type: 'join', class: 'Archer' },
        { type: 'burden', id: 'debt', params: { owed: 5 } },
      ],
    };
    const contract = normalizeContract(raw);
    expect(contract.reward).toEqual([{ type: 'gold', value: 1 }]);
    expect(contract.penalty).toEqual([{ type: 'burden', id: 'debt', params: { owed: 5 } }]);
    contract.reward[0].value = 99;
    expect(raw.reward[0].value).toBe(1);
    expect(contract.nodeId).toBe('contract'); // a seed anchor even for a record with none
    expect(CONTRACT_EFFECT_TYPES).not.toContain('battle');
  });

  it('a run loaded from a save with a junk contract has none; an old save has none', () => {
    const { run } = signed();
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    saved.contract = { goal: 'win-big' };
    expect(contractOf(runLoad(saved, run))).toBeNull();
    delete saved.contract;
    expect(runLoad(saved, run).contract).toBeNull();
  });
});

describe('the band says what happened', () => {
  it('words for a kept and a broken contract, with and without terms', () => {
    expect(settlementLines(null)).toEqual([]);
    expect(settlementLines({ kept: true, results: [{ kind: 'gold', value: 600 }] })).toEqual([
      'Contract kept: +600 G',
    ]);
    expect(settlementLines({ kept: true, results: [] })).toEqual(['Contract kept']);
    expect(
      settlementLines({
        kept: false,
        results: [
          { kind: 'burden', label: 'Debt', detail: '300 G owed' },
          { kind: 'gold', value: -40 },
          { kind: 'item', name: 'Silver Sword' },
        ],
      }),
    ).toEqual(['Contract broken: Debt (300 G owed), −40 G, Silver Sword']);
  });
});

function runLoad(saved, run) {
  return run.constructor.fromJSON(saved, run.gameData);
}
