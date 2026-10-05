// P3 cannot end without Sera (docs/specs/prologue-chapter.md §6 P3; review, 2026-10-04):
// the chapter's rout requires her (`requiredRecruits`), so the last Soldier's fall
// while she is still green leaves the battle playable (the turn ends, an empty enemy
// phase passes, the next turn comes) and victory fires the moment Edric Talks her into
// the army. The headless harness plays the real engine on the locked config; the coach
// model names the one goal left once the field is clear.
import { afterEach, describe, expect, it } from 'vitest';
import { HEADLESS_STATES } from './harness/HeadlessBattle.js';
import { restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { startP3, finishPhase, enemy, unit, sera } from './harness/prologueP3Policies.js';
import { loadGameData } from './testData.js';
import { buildPrologueBattleConfig, battleRequiredRecruits } from '../src/engine/Prologue.js';
import { prologueBattleParams } from '../src/engine/ScriptedBattle.js';
import { prologueCoachState } from '../src/ui/prologueCoachModel.js';

const data = loadGameData();
const p3 = data.prologue.chapters.find((c) => c.id === 'p3_seer_on_the_road');

afterEach(() => restoreMathRandom());

/** Edric walks next to Sera and Talks (as the scene's Talk command settles the join). */
function talk(battle) {
  const seer = sera(battle);
  battle.selectUnit('Edric');
  const tile = [...battle.movementRange.keys()]
    .map((k) => k.split(',').map(Number))
    .find(([c, r]) => Math.abs(c - seer.col) + Math.abs(r - seer.row) === 1);
  expect(tile).toBeDefined();
  battle.moveTo(tile[0], tile[1]);
  battle.chooseAction('Talk');
}

function routTheSoldiers(battle) {
  for (const id of ['s', 'a', 'b']) {
    const foe = enemy(battle, id);
    foe.currentHP = 0;
    battle._removeUnit(foe, { killer: unit(battle, 'Edric') });
  }
  expect(battle.enemyUnits).toEqual([]);
}

describe('P3 requires Sera', () => {
  it('the chapter and its config name her', () => {
    expect(p3.requiredRecruits).toEqual(['Sera']);
    expect(buildPrologueBattleConfig(p3, data.terrain).requiredRecruits).toEqual(['Sera']);
    // The other chapters require nobody.
    for (const chapter of data.prologue.chapters.filter((c) => c !== p3))
      expect(buildPrologueBattleConfig(chapter, data.terrain).requiredRecruits).toEqual([]);
    // A run's locked config from before the field existed reads the chapter.
    expect(battleRequiredRecruits({ battleConfig: { objective: 'rout' }, battleParams: prologueBattleParams(p3), gameData: data })).toEqual(['Sera']); // prettier-ignore
    expect(battleRequiredRecruits({ battleConfig: { objective: 'rout' }, battleParams: { act: 'act1' }, gameData: data })).toEqual([]); // prettier-ignore
  });

  it('the last Soldier falls first: no victory, the turn ends and comes back, then the Talk wins it', async () => {
    const battle = startP3(data.prologue.seed);
    expect(sera(battle).faction).toBe('npc');
    routTheSoldiers(battle);
    // The scene checks the end after every death: nothing ends here.
    expect(battle._checkBattleEnd()).toBe(false);
    expect(battle.result ?? null).toBeNull();
    expect(battle.battleState).toBe(HEADLESS_STATES.PLAYER_IDLE);
    expect(sera(battle).faction).toBe('npc');
    // A clean continuation: the turn ends, the empty enemy phase passes, turn 2 opens.
    await finishPhase(battle);
    expect(battle.result ?? null).toBeNull();
    expect(battle.battleState).toBe(HEADLESS_STATES.PLAYER_IDLE);
    expect(battle.turnManager.turnNumber).toBe(2);
    expect(battle.turnManager.currentPhase).toBe('player');
    expect(sera(battle).currentHP).toBe(18);
    // Edric reaches her: the join is the win, with Sera in the army that leaves.
    talk(battle);
    expect(battle.result).toBe('victory');
    expect(battle.battleState).toBe(HEADLESS_STATES.BATTLE_END);
    expect(battle.playerUnits.map((u) => u.name)).toContain('Sera');
    expect(battle.npcUnits).toEqual([]);
  });

  it('Sera first, then the rout: the win fires on the last Soldier as any rout does', () => {
    const battle = startP3(data.prologue.seed);
    talk(battle);
    expect(battle.result ?? null).toBeNull();
    routTheSoldiers(battle);
    expect(battle._checkBattleEnd()).toBe(true);
    expect(battle.result).toBe('victory');
    // Idempotent: a late check never wins twice.
    expect(battle._checkBattleEnd()).toBe(true);
  });

  it('the coach names the one goal left once the field is clear', () => {
    const snapshot = {
      scripted: null,
      gated: false,
      phase: 'player',
      state: 'PLAYER_IDLE',
      touch: false,
      commanderName: 'Edric',
      units: [{ name: 'Edric', acted: false, hp: 20, maxHp: 20, healer: false }],
      enemies: 0,
      menu: [],
      selected: null,
    };
    expect(prologueCoachState({ ...snapshot, recruitsPending: ['Sera'] })).toMatchObject({
      id: 'recruit-required',
      goal: 'Reach Sera and Talk',
      detail: expect.stringContaining('Sera must join before this chapter ends'),
      anchor: { kind: 'unit', name: 'Edric' },
    });
    // The goal stands whatever is open: the action menu, a selection.
    expect(prologueCoachState({ ...snapshot, state: 'UNIT_SELECTED', recruitsPending: ['Sera'] })?.id).toBe('recruit-required'); // prettier-ignore
    // Nobody required: the victory flow owns the screen, as before.
    expect(prologueCoachState({ ...snapshot, recruitsPending: [] })).toBeNull();
    expect(prologueCoachState(snapshot)).toBeNull();
  });
});
