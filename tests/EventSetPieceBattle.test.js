// An event fight that names a set piece (docs/specs/event-set-pieces.md), through the real event
// commands, the run's params, the generator, the lock and the place line.
//
// Ways this goes wrong:
//   - the choice builds an ordinary rout (the set piece id never reaches the node's params);
//   - the params lose the id, the cap or the event's level bonus on the way to the battle;
//   - the set piece's fog is not the one the battle gets, or a forced fog still draws;
//   - building the fight moves the run's Math.random stream;
//   - a reload or a lock changes the map;
//   - the deploy bonus lets more units in than the set piece has room for;
//   - the battle card or the slot card names a template (or nothing) instead of the place;
//   - a build that does not know the id strands the event (no fight at all).
import { describe, expect, it, vi } from 'vitest';
import { chooseEventOption } from '../src/engine/EventCommands.js';
import { RunManager } from '../src/engine/RunManager.js';
import { generateSeededBattle, applyGenerationFields } from '../src/engine/BattleScout.js';
import { deployLimitsForParams, resolveDeployLimits } from '../src/engine/BattleDeployCount.js';
import { battlePlace, regionName } from '../src/ui/placeDisplay.js';
import { templateName } from '../src/ui/slotCardModel.js';
import { findSetPiece } from '../src/engine/SetPieces.js';
import { arriveAs, baseData, eventNode, newRun, runWithEvents, soloEvent } from './eventKit.js';

const tollHouse = findSetPiece(baseData.setPieces, 'toll_house');

/** A run at a one-choice event whose outcome is the given battle effect. */
function fightRun(battle, options = {}) {
  const run = runWithEvents(
    [
      soloEvent([
        { type: 'battle', enemyLevelBonus: 1, victoryText: 'Won.', afterVictory: [], ...battle },
      ]),
    ],
    options,
  );
  const node = arriveAs(run, 'solo', eventNode(run));
  return { run, node };
}

/** The battle the scene would build for the node: its params, the deploy count, the seed. */
function battleFor(run, node, deployCount = 4) {
  const params = applyGenerationFields(run.getBattleParams(node), { deployCount });
  return { params, config: generateSeededBattle(params, run.gameData, params.battleSeed) };
}

const reload = (run) => RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), run.gameData);

describe('choosing a set-piece fight', () => {
  it('writes the set piece onto the node, with its cap and forced fog, and keeps it an event', () => {
    const { run, node } = fightRun({ setPiece: 'toll_house' });
    const chosen = chooseEventOption(run, node.id, 'go');
    expect(chosen.ok, chosen.reason).toBe(true);
    expect(chosen.battle).toBe(true);
    expect(node.type).toBe('event');
    expect(node.eventBattle).toBe(true);
    expect(node.battleParams).toMatchObject({
      act: 'act1',
      objective: 'rout',
      setPiece: 'toll_house',
      deployCap: tollHouse.deploy.max,
      isEventBattle: true,
      eventEnemyLevelBonus: 1,
    });
    expect(node.battleParams.levelRange).toEqual(node.row === 2 ? [1, 3] : [2, 3]);
    expect(node.templateId).toBeUndefined();
    expect(node.fogEnabled).toBe(true);
  });

  it('never draws from the run’s Math.random stream', () => {
    const { run, node } = fightRun({ setPiece: 'toll_house' });
    const outer = vi.fn(Math.random);
    const original = Math.random;
    Math.random = outer;
    try {
      expect(chooseEventOption(run, node.id, 'go').ok).toBe(true);
    } finally {
      Math.random = original;
    }
    expect(outer).not.toHaveBeenCalled();
  });

  it('the battle params carry the id, the cap and the rung’s level bonus plus the event’s', () => {
    const { run, node } = fightRun({ setPiece: 'toll_house' }, { difficulty: 'hard' });
    run.completedBattles = 1; // the first battle of a run never has fog
    chooseEventOption(run, node.id, 'go');
    const params = run.getBattleParams(node);
    expect(params).toMatchObject({ setPiece: 'toll_house', deployCap: 5, fogEnabled: true });
    expect(params.enemyLevelBonus).toBe(
      (run.getDifficultyModifier('enemyLevelBonus', 0) || 0) +
        run.getBlessingEnemyLevelDelta('act1') +
        1,
    );
  });

  it('the battle is the Toll-House, and a lock and a reload keep exactly that map', () => {
    const { run, node } = fightRun({ setPiece: 'toll_house' });
    chooseEventOption(run, node.id, 'go');
    const { config } = battleFor(run, node);
    expect(config.templateId).toBe('setpiece:toll_house');
    expect(config.enemySpawns.find((s) => s.isBoss)).toMatchObject({ name: 'The Toll-Keeper' });
    expect(config.enemySpawns.every((s) => s.className === 'Zombie')).toBe(true);
    run.lockBattleConfig(node.id, config);
    const again = reload(run);
    expect(again.getLockedBattleConfig(node.id)).toEqual(run.getLockedBattleConfig(node.id));
    // Generated again from the reloaded params, the map is the same one.
    const reloadedNode = again.nodeMap.nodes.find((n) => n.id === node.id);
    expect(battleFor(again, reloadedNode).config).toEqual(config);
  });

  it('a build that does not know the set piece fights an ordinary rout instead', () => {
    const { run, node } = fightRun({ setPiece: 'toll_house' });
    run.gameData = { ...run.gameData, setPieces: { setPieces: [] } };
    expect(chooseEventOption(run, node.id, 'go').battle).toBe(true);
    expect(node.battleParams.setPiece).toBeUndefined();
    expect(node.templateId).toBeTruthy();
    expect(battleFor(run, node).config.templateId).toBe(node.templateId);
  });
});

describe('the Toll Bridge names its set pieces', () => {
  it('the Dark Omen search that wakes something fights the Toll-House', () => {
    let found = null;
    for (let seed = 1; seed <= 80 && !found; seed++) {
      const run = newRun({ seed });
      const node = arriveAs(run, 'toll_bridge');
      run.eventStateByNodeId[node.id].dark = true;
      const chosen = chooseEventOption(run, node.id, 'search');
      expect(chosen.ok, chosen.reason).toBe(true);
      if (chosen.battle) found = { run, node };
    }
    expect(found).not.toBeNull();
    expect(found.node.battleParams).toMatchObject({ setPiece: 'toll_house' });
    expect(found.node.fogEnabled).toBe(true);
    expect(battleFor(found.run, found.node).config.setPieceId).toBe('toll_house');
  });

  it('a failed bluff fights at the Toll Crossing', () => {
    let found = null;
    for (let seed = 1; seed <= 80 && !found; seed++) {
      const run = newRun({ seed });
      const node = arriveAs(run, 'toll_bridge');
      const chosen = chooseEventOption(run, node.id, 'bluff');
      expect(chosen.ok, chosen.reason).toBe(true);
      if (chosen.battle) found = { run, node };
    }
    expect(found).not.toBeNull();
    expect(found.node.battleParams).toMatchObject({ setPiece: 'toll_crossing', deployCap: 6 });
    const { config } = battleFor(found.run, found.node);
    expect(config.enemySpawns.find((s) => s.isBoss)).toMatchObject({
      name: 'The Toll-Keeper',
      className: 'Archer',
    });
  });
});

describe('deploy cap', () => {
  it('holds after the deploy bonus, and the min follows it down', () => {
    expect(
      resolveDeployLimits({
        base: deployLimitsForParams({ act: 'act3', deployCap: 5 }),
        deployBonus: 2,
      }),
    ).toMatchObject({ min: 5, max: 5 });
    expect(
      resolveDeployLimits({
        base: deployLimitsForParams({ act: 'act1', deployCap: 5 }),
        deployBonus: 2,
      }),
    ).toMatchObject({ min: 3, max: 5 });
    expect(
      resolveDeployLimits({
        base: deployLimitsForParams({ act: 'act4', deployCap: 4 }),
        deployBonus: 0,
      }),
    ).toMatchObject({ min: 4, max: 4 });
    // Under the cap the bonus still opens slots; a lock still narrows further.
    expect(
      resolveDeployLimits({
        base: deployLimitsForParams({ act: 'act1', deployCap: 6 }),
        deployBonus: 1,
      }),
    ).toMatchObject({ max: 5 });
    expect(
      resolveDeployLimits({
        base: deployLimitsForParams({ act: 'act2', deployCap: 6 }),
        deployBonus: 1,
        lockedSpawnCount: 4,
      }),
    ).toMatchObject({ max: 4, lockedTo: 4 });
    // No cap: the act's own limits, untouched.
    expect(deployLimitsForParams({ act: 'act2' })).toEqual({ min: 4, max: 5 });
  });
});

describe('the place', () => {
  it('the battle card and the slot card name the set piece', () => {
    const config = { templateId: 'setpiece:toll_house' };
    expect(battlePlace(baseData, config, 'act1')).toEqual({
      title: [regionName('act1'), 'The Toll-House'].filter(Boolean).join(' — '),
      lore: tollHouse.lore,
    });
    expect(templateName(baseData.mapTemplates, 'setpiece:toll_house', baseData.setPieces)).toBe(
      'The Toll-House',
    );
    // A template id still reads the template.
    const first = Object.values(baseData.mapTemplates)
      .flat()
      .find((t) => t?.id && t?.name);
    expect(templateName(baseData.mapTemplates, first.id, baseData.setPieces)).toBe(first.name);
  });
});
