import { describe, it, expect } from 'vitest';
import {
  compactBattleObjective,
  secondaryObjectiveStatus,
  sideObjectiveInputs,
  sidebarCounters,
} from '../src/ui/battleSidebarDisplay.js';
describe('battle sidebar labels', () => {
  it('retains progress and switches from defeating the boss to capturing the throne', () => {
    expect(compactBattleObjective('Escape: Only Lords must exit (1/2)\nOthers are safe')).toBe(
      'Escape · Lords 1/2',
    );
    expect(compactBattleObjective('Seize: Defeat boss, then capture throne')).toBe(
      'Seize · Defeat the boss',
    );
    expect(compactBattleObjective('Seize: Capture throne with a Lord!')).toBe(
      'Seize · Capture throne',
    );
    expect(compactBattleObjective('Rout: 4 enemies + 2 reviving')).toContain('2 reviving');
  });
  it('agrees the rout count with its verb', () => {
    expect(compactBattleObjective('Rout: 1 enemy remaining')).toBe('Rout · 1 enemy remains');
    expect(compactBattleObjective('Rout: 2 enemies remaining')).toBe('Rout · 2 enemies remain');
    expect(compactBattleObjective('Rout: 0 enemies remaining\nRecruit: Talk')).toBe(
      'Rout · 0 enemies remain',
    );
  });
  it('keeps par/rating and charges explicit, omitting unavailable par', () => {
    expect(sidebarCounters('Turn: 4 / Par: 7 (S)', 1)).toBe('Par 7 · S | Visions 1');
    expect(sidebarCounters('Turn: 4', 0)).toBe('Visions 0');
  });
});

describe('side objectives in the compact header', () => {
  const texts = (input) => secondaryObjectiveStatus(input).map((p) => [p.id, p.text, p.tone]);

  it('words the village and the caravan, and nothing for a battle without them', () => {
    expect(texts({})).toEqual([]);
    expect(texts({ village: 'intact' })).toEqual([['village', 'Village intact', 'open']]);
    expect(texts({ village: 'visited' })).toEqual([['village', 'Village visited', 'good']]);
    expect(texts({ village: 'razed' })).toEqual([['village', 'Village razed', 'bad']]);
    expect(texts({ village: 'toString' })).toEqual([]);
    expect(texts({ caravan: { state: 'travelling', hp: 20, maxHp: 26 } })).toEqual([
      ['caravan', 'Caravan 20/26 HP', 'open'],
    ]);
    // Half HP or less reads as a warning.
    expect(texts({ caravan: { state: 'travelling', hp: 13, maxHp: 26 } })[0][2]).toBe('warn');
    expect(texts({ caravan: { state: 'unseen' } })).toEqual([
      ['caravan', 'Caravan in fog', 'open'],
    ]);
    expect(texts({ caravan: { state: 'escaped' } })).toEqual([
      ['caravan', 'Caravan escaped', 'good'],
    ]);
    expect(texts({ caravan: { state: 'lost' } })).toEqual([['caravan', 'Caravan lost', 'bad']]);
    // Village first, then caravan.
    expect(
      texts({ village: 'intact', caravan: { state: 'travelling', hp: 8, maxHp: 26 } }).map(
        (p) => p[1],
      ),
    ).toEqual(['Village intact', 'Caravan 8/26 HP']);
  });

  const grid = (visible = () => true, fogEnabled = false) => ({
    fogEnabled,
    isVisible: (col, row) => visible(col, row),
  });
  const caravan = (over = {}) => ({
    isCaravan: true,
    faction: 'npc',
    col: 3,
    row: 4,
    currentHP: 12,
    stats: { HP: 26 },
    ...over,
  });

  it('reads the village status only when the battle has a village', () => {
    expect(sideObjectiveInputs({ _villageState: { status: 'intact' }, battleConfig: {} })).toEqual({
      village: null,
      caravan: null,
    });
    expect(
      sideObjectiveInputs({
        battleConfig: { villageTile: { col: 1, row: 1 } },
        _villageState: { status: 'visited' },
      }).village,
    ).toBe('visited');
  });

  it('shows the caravan HP only while its tile is in sight', () => {
    const memory = {};
    const scene = {
      battleConfig: { caravanSpawn: { col: 3, row: 5 } },
      npcUnits: [caravan()],
      grid: grid(() => true, true),
    };
    expect(sideObjectiveInputs(scene, memory).caravan).toEqual({
      state: 'travelling',
      hp: 12,
      maxHp: 26,
    });
    scene.grid = grid(() => false, true);
    expect(sideObjectiveInputs(scene, memory).caravan).toEqual({ state: 'unseen' });
  });

  it('reports a caravan gone in the fog as lost only once its last tile is in sight', () => {
    const memory = {};
    const scene = {
      battleConfig: { caravanSpawn: { col: 3, row: 5 } },
      npcUnits: [caravan()],
      grid: grid((col, row) => !(col === 3 && row === 4), true),
    };
    sideObjectiveInputs(scene, memory); // remembers its tile (3,4), unseen
    scene.npcUnits = [caravan({ currentHP: 0 })];
    expect(sideObjectiveInputs(scene, memory).caravan).toEqual({ state: 'unseen' });
    scene.grid = grid(() => true, true);
    expect(sideObjectiveInputs(scene, memory).caravan).toEqual({ state: 'lost' });
    // Without fog a lost caravan is simply lost.
    expect(
      sideObjectiveInputs({ ...scene, npcUnits: [], grid: grid(() => false, false) }, memory)
        .caravan,
    ).toEqual({ state: 'lost' });
  });

  it('an escaped caravan reads as escaped; a battle that never had one says nothing', () => {
    expect(
      sideObjectiveInputs({
        battleConfig: { caravanSpawn: { col: 0, row: 0 } },
        npcUnits: [],
        _caravanExited: true,
        grid: grid(),
      }).caravan,
    ).toEqual({ state: 'escaped' });
    expect(sideObjectiveInputs({ battleConfig: {}, npcUnits: [], grid: grid() }).caravan).toBe(
      null,
    );
  });
});
