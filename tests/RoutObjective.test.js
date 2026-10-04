// RoutObjective (engine/RoutObjective.js): one predicate for the end of a rout, read by
// BattleScene.checkBattleEnd and the headless harness alike. A rout ends when no enemy
// stands, no remains rise and every required recruit (the prologue's Sera in P3) is in
// the army; a standard battle requires nobody. The objective line says who must still
// join, and the sidebar still shortens it.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import {
  isRoutComplete,
  pendingRequiredRecruits,
  routObjectiveLabel,
} from '../src/engine/RoutObjective.js';
import { compactBattleObjective } from '../src/ui/battleSidebarDisplay.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { loadGameData } from './testData.js';
import { prologueBattleParams } from '../src/engine/ScriptedBattle.js';

const edric = { name: 'Edric', isCommander: true, isLord: true, currentHP: 20, faction: 'player' };
const sera = { name: 'Sera', isLord: true, currentHP: 18, faction: 'npc' };
const soldier = { name: 'Soldier', currentHP: 5, faction: 'enemy' };

describe('isRoutComplete', () => {
  it('a standard rout: nobody required, so an empty field is the win', () => {
    expect(isRoutComplete({ enemyUnits: [], playerUnits: [edric] })).toBe(true);
    expect(isRoutComplete({ enemyUnits: [soldier], playerUnits: [edric] })).toBe(false);
    expect(isRoutComplete({ enemyUnits: [], zombieTombstones: [{}], playerUnits: [edric] })).toBe(false); // prettier-ignore
    expect(isRoutComplete()).toBe(true);
  });

  it('a required recruit still green holds the rout open; in the army (or escaped) it closes', () => {
    const required = ['Sera'];
    expect(isRoutComplete({ enemyUnits: [], requiredRecruits: required, playerUnits: [edric] })).toBe(false); // prettier-ignore
    expect(pendingRequiredRecruits(required, [edric])).toEqual(['Sera']);
    const joined = { ...sera, faction: 'player' };
    expect(isRoutComplete({ enemyUnits: [], requiredRecruits: required, playerUnits: [edric, joined] })).toBe(true); // prettier-ignore
    expect(pendingRequiredRecruits(required, [edric, joined])).toEqual([]);
    expect(isRoutComplete({ enemyUnits: [], requiredRecruits: required, playerUnits: [edric], escapedUnits: [joined] })).toBe(true); // prettier-ignore
    // Enemies standing still matter with the recruit in.
    expect(isRoutComplete({ enemyUnits: [soldier], requiredRecruits: required, playerUnits: [edric, joined] })).toBe(false); // prettier-ignore
  });
});

describe('routObjectiveLabel', () => {
  it('reads as before without required recruits, and the sidebar shortens it', () => {
    expect(routObjectiveLabel({ remaining: 3 })).toBe('Rout: 3 enemies remaining');
    expect(routObjectiveLabel({ remaining: 1 })).toBe('Rout: 1 enemy remaining');
    expect(routObjectiveLabel({ remaining: 1, reviving: 2 })).toBe('Rout: 1 enemy + 2 reviving');
    expect(compactBattleObjective(routObjectiveLabel({ remaining: 1 }))).toBe('Rout · 1 enemy remains'); // prettier-ignore
  });

  it('names who must still join: beside the count, or alone once the field is clear', () => {
    expect(routObjectiveLabel({ remaining: 2, pendingRecruits: ['Sera'] })).toBe(
      'Rout: 2 enemies remaining · Sera must join',
    );
    expect(routObjectiveLabel({ remaining: 0, pendingRecruits: ['Sera'] })).toBe(
      'Rout: Sera must join to win',
    );
    expect(routObjectiveLabel({ remaining: 0, reviving: 1, pendingRecruits: ['Sera'] })).toBe(
      'Rout: 0 enemies + 1 reviving · Sera must join',
    );
    expect(routObjectiveLabel({ remaining: 0, pendingRecruits: ['Sera', 'Ren'] })).toBe(
      'Rout: Sera and Ren must join to win',
    );
    expect(compactBattleObjective(routObjectiveLabel({ remaining: 0, pendingRecruits: ['Sera'] }))).toBe('Rout · Sera must join to win'); // prettier-ignore
  });
});

describe('one implementation', () => {
  it('BattleScene.checkBattleEnd and the harness read the predicate, never a count of their own', () => {
    const scene = readFileSync(new URL('../src/scenes/BattleScene.js', import.meta.url), 'utf8');
    const harness = readFileSync(new URL('./harness/HeadlessBattle.js', import.meta.url), 'utf8');
    const body = (source, name) => {
      const start = source.indexOf(`\n  ${name}() {`);
      expect(start, name).toBeGreaterThan(0);
      return source.slice(start, source.indexOf('\n  }\n', start));
    };
    for (const text of [body(scene, 'checkBattleEnd'), body(harness, '_checkBattleEnd')]) {
      expect(text).toContain('isRoutComplete(this.routObjectiveState())');
      expect(text).not.toMatch(/enemyUnits\.length === 0/);
    }
  });
});

describe('BattleScene.checkBattleEnd with a required recruit', () => {
  const data = loadGameData();
  function makeScene({ battleConfig, battleParams = {}, gameData = data } = {}) {
    const green = { ...sera };
    const scene = Object.assign(Object.create(BattleScene.prototype), {
      battleState: 'PLAYER_IDLE',
      battleConfig,
      battleParams,
      gameData,
      playerUnits: [{ ...edric }],
      enemyUnits: [],
      npcUnits: [green],
      escapedUnits: [],
      _zombieTombstones: [],
      onVictory: vi.fn(),
      onDefeat: vi.fn(),
      showLordDeathVisionPrompt: vi.fn(() => false),
    });
    return { scene, green };
  }

  it('the last enemy gone with Sera still green: no victory; her join wins it, once', () => {
    const { scene, green } = makeScene({
      battleConfig: { objective: 'rout', requiredRecruits: ['Sera'] },
    });
    expect(scene.checkBattleEnd()).toBe(false);
    expect(scene.onVictory).not.toHaveBeenCalled();
    expect(scene.pendingRequiredRecruits()).toEqual(['Sera']);
    // Talk: she joins the army.
    scene.npcUnits.splice(0, 1);
    green.faction = 'player';
    scene.playerUnits.push(green);
    expect(scene.checkBattleEnd()).toBe(true);
    expect(scene.onVictory).toHaveBeenCalledTimes(1);
  });

  it('a locked config from before the field existed reads the chapter (an old prologue save)', () => {
    const p3 = data.prologue.chapters.find((c) => c.id === 'p3_seer_on_the_road');
    const { scene } = makeScene({
      battleConfig: { objective: 'rout' },
      battleParams: prologueBattleParams(p3),
    });
    expect(scene.checkBattleEnd()).toBe(false);
    expect(scene.onVictory).not.toHaveBeenCalled();
  });

  it('a standard rout requires nobody: a green unit never holds the win', () => {
    const { scene } = makeScene({ battleConfig: { objective: 'rout' } });
    expect(scene.checkBattleEnd()).toBe(true);
    expect(scene.onVictory).toHaveBeenCalledTimes(1);
  });
});
