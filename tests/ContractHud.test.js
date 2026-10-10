// The contract on the battle HUD (docs/specs/event-nodes-phase2.md §2E): the words
// (ui/contractHudModel.js) and the live read of a scene (ui/ContractHudController.js).
//
// Ways this goes wrong:
//   - the line says "missed" for a battle the contract does not settle on, or shows no line for
//     one it does (no contract, a standalone replay, a node already won);
//   - a unit fading out (dead, not yet removed from the army) still counts as alive, a benched or
//     escaped unit counts as lost;
//   - the terms on the HUD drift from the route map chip's, or lose what keeping and breaking cost;
//   - "missed" is remembered: it must follow the turn and the units (rewind, resume, par bumps);
//   - the longest wording outgrows the room the rails give it (the browser spec measures it; the
//     budget below is what it was drawn for).
import { describe, expect, it } from 'vitest';
import { describeContract } from '../src/engine/Contracts.js';
import { contractChipModel } from '../src/ui/eventMenuModel.js';
import { contractHelpBlocks, contractHudModel } from '../src/ui/contractHudModel.js';
import {
  ContractHudController,
  liveSurvivorsOf,
  sceneContractHud,
  sceneContractStanding,
} from '../src/ui/ContractHudController.js';
import { addUnit } from './eventKit.js';
import { signedContract } from './contractKit.js';

/** The scene as the HUD reads it: a run, the node, the turn and par, the units in play. */
function sceneOf(run, nodeId, extra = {}) {
  return {
    runManager: run,
    nodeId,
    turnPar: 5,
    turnManager: { turnNumber: 1 },
    playerUnits: run.getRoster(),
    escapedUnits: [],
    nonDeployedUnits: [],
    _battleRecruits: [],
    battleParams: {},
    ...extra,
  };
}

describe('the HUD line', () => {
  it('says Contract · <goal>, and "— missed" once a victory would break it', () => {
    const { run, nodeId } = signedContract('underPar');
    const scene = sceneOf(run, nodeId);
    expect(sceneContractHud(scene)).toMatchObject({
      text: 'Contract · Under par',
      status: 'open',
      missed: false,
      note: '',
    });
    scene.turnManager.turnNumber = 5; // par itself is kept
    expect(sceneContractHud(scene).text).toBe('Contract · Under par');
    scene.turnManager.turnNumber = 6;
    expect(sceneContractHud(scene)).toMatchObject({
      text: 'Contract · Under par — missed',
      status: 'missed',
      note: 'Turn par has passed: a victory now breaks the contract.',
    });
    scene.turnManager.turnNumber = 5; // a Vision rewind
    expect(sceneContractHud(scene).status).toBe('open');
  });

  it('noLosses: an ally falling misses it; a benched or escaped one does not', () => {
    const { run, nodeId } = signedContract('noLosses');
    addUnit(run, 'Archer', { name: 'Hale' });
    addUnit(run, 'Fighter', { name: 'Brant' });
    const army = run.getRoster();
    const hale = army.find((u) => u.name === 'Hale');
    const brant = army.find((u) => u.name === 'Brant');
    const rest = army.filter((u) => u !== hale && u !== brant);
    const scene = sceneOf(run, nodeId, {
      playerUnits: [...rest, hale],
      nonDeployedUnits: [brant],
    });
    expect(sceneContractHud(scene)).toMatchObject({ text: 'Contract · No losses', missed: false });
    // Brant walks off the field (Escape): still in the army.
    Object.assign(scene, { nonDeployedUnits: [], escapedUnits: [brant] });
    expect(sceneContractHud(scene).missed).toBe(false);
    // Hale is struck down: dead, still fading out; then removed.
    hale.currentHP = 0;
    expect(sceneContractHud(scene)).toMatchObject({
      text: 'Contract · No losses — missed',
      note: 'An ally has fallen: a victory now breaks the contract.',
    });
    scene.playerUnits = rest;
    expect(sceneContractHud(scene).missed).toBe(true);
    // Rewound: Hale lives.
    scene.playerUnits = [...rest, { ...hale, currentHP: 9 }];
    expect(sceneContractHud(scene).missed).toBe(false);
  });

  it('is nothing at all when the battle settles no contract', () => {
    const { run, nodeId } = signedContract('underPar');
    expect(sceneContractHud(sceneOf(run, nodeId))).not.toBeNull();
    expect(sceneContractHud(sceneOf(run, 'elsewhere'))).toBeNull(); // not a node of this run
    expect(sceneContractHud({ runManager: null, nodeId })).toBeNull(); // a standalone replay
    run.markNodeComplete(nodeId); // a node already won settles nothing
    expect(sceneContractHud(sceneOf(run, nodeId))).toBeNull();
    const fresh = signedContract('underPar');
    fresh.run.contract = null;
    expect(sceneContractHud(sceneOf(fresh.run, fresh.nodeId))).toBeNull();
    expect(sceneContractStanding(sceneOf(fresh.run, fresh.nodeId))).toBeNull();
  });

  it('a battle with no par never shows an underPar contract as missed', () => {
    const { run, nodeId } = signedContract('underPar');
    const scene = sceneOf(run, nodeId, { turnPar: null, turnManager: { turnNumber: 40 } });
    expect(sceneContractHud(scene)).toMatchObject({ text: 'Contract · Under par', missed: false });
  });

  it('counts survivors as the commit does: in play, escaped, benched; not the dying', () => {
    const { run, nodeId } = signedContract('noLosses');
    const army = run.getRoster();
    const [a, b, c] = army;
    b.currentHP = 0;
    const scene = sceneOf(run, nodeId, {
      playerUnits: [a, b],
      escapedUnits: [c].filter(Boolean),
      nonDeployedUnits: army.slice(3),
    });
    expect(liveSurvivorsOf(scene)).toEqual([a, ...[c].filter(Boolean), ...army.slice(3)]);
  });
});

describe('the terms on the line', () => {
  it('are the route map chip’s terms, plus why when missed', () => {
    const { run } = signedContract('underPar');
    const contract = describeContract(run);
    const chip = contractChipModel(contract);
    const open = contractHudModel(contract, { missed: false });
    expect(open.terms).toBe(chip.terms);
    expect(open.title).toBe(`Contract · Under par. ${chip.terms}`);
    // What the dev contract pays and costs (data/the kit's contract: 600 G kept, Debt 300 G broken).
    expect(open.terms).toMatch(/Win the next battle by turn par or sooner\./);
    expect(open.terms).toMatch(/Kept: \+600 G\./);
    expect(open.terms).toMatch(/Broken: Debt 300 G\./);
    const missed = contractHudModel(contract, { missed: true, cause: 'par' });
    expect(missed.title).toBe(
      `Contract · Under par — missed. Turn par has passed: a victory now breaks the contract. ${chip.terms}`,
    );
    expect(contractHelpBlocks(missed)).toEqual([
      { lead: 'Contract · Under par — missed' },
      'Turn par has passed: a victory now breaks the contract.',
      chip.terms,
    ]);
    expect(contractHelpBlocks(open)).toEqual([{ lead: 'Contract · Under par' }, chip.terms]);
  });

  it('no contract or no standing: nothing to show', () => {
    expect(contractHudModel(null, { missed: false })).toBeNull();
    expect(contractHudModel({ goal: 'underPar', short: 'Under par' }, null)).toBeNull();
    expect(contractHelpBlocks(null)).toEqual([]);
  });

  it('the longest line stays within the budget the rails were drawn for', () => {
    // 29 characters: "Contract · No losses — missed" (Press Start 2P 8px: 232px on the desktop plate).
    const longest = ['underPar', 'noLosses']
      .map((goal) => signedContract(goal).run)
      .flatMap((run) =>
        [false, true].map((missed) => contractHudModel(describeContract(run), { missed })),
      )
      .map((model) => model.text.length);
    expect(Math.max(...longest)).toBeLessThanOrEqual(29);
  });
});

describe('ContractHudController', () => {
  it('follows the scene on every read, with nothing stored', () => {
    const { run, nodeId } = signedContract('underPar');
    const scene = sceneOf(run, nodeId, { _mobileBattleHud: {}, add: null, events: null });
    const hud = new ContractHudController(scene).create();
    expect(hud.label()).toBe('Contract · Under par');
    scene.turnManager.turnNumber = 9;
    hud.sync();
    expect(hud.label()).toBe('Contract · Under par — missed');
    expect(hud.model().missed).toBe(true);
    scene.turnPar = 12; // reinforcements raise par: a victory now would keep it
    expect(hud.label()).toBe('Contract · Under par');
    hud.destroy();
    expect(hud.label()).toBe('');
    expect(hud.model()).toBeNull();
  });

  it('draws nothing on a phone (the DOM rail reads it) and nothing without a contract', () => {
    const { run, nodeId } = signedContract('noLosses');
    const created = [];
    const add = { text: (...args) => created.push(args) };
    new ContractHudController(sceneOf(run, nodeId, { _mobileBattleHud: {}, add })).create();
    expect(created).toEqual([]);
    run.contract = null;
    const hud = new ContractHudController(sceneOf(run, nodeId, { add })).create();
    expect(created).toEqual([]);
    expect(hud.label()).toBe('');
  });
});
