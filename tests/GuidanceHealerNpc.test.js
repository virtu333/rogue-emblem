// The healer coach note (guide_healer_heals) also fires when only an NPC ally is
// hurt (the merchant caravan, a recruit), but only when the Heal command would
// actually offer that NPC to this healer this turn: the note asks the production
// target discovery (HealController.findHealTargets) from each tile the healer can
// still end its move on, or from where it stands at the action menu.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { GuidanceController } from '../src/ui/GuidanceController.js';
import { HealController } from '../src/ui/HealController.js';
import { guidanceText } from '../src/engine/Guidance.js';
import { createCaravanUnit } from '../src/engine/CaravanSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

/**
 * Sera (MAG 6, Staff) selected at (4,2) with Edric unhurt, a live HealController
 * behind the scene's findHealTargets / getUsableStaves seams, and a movement range
 * covering (4,2)..(6,2): she can end her move at most two tiles east.
 */
function scene({ staves = ['Heal'], npcUnits = [], visible = null, state = 'UNIT_SELECTED' } = {}) {
  const seen = new Set();
  const inventory = staves.map(weapon);
  const sera = {
    name: 'Sera',
    faction: 'player',
    col: 4,
    row: 2,
    currentHP: 18,
    stats: { HP: 18, MAG: 6, DEF: 3 },
    proficiencies: [{ type: 'Staff', rank: 'Mast' }],
    inventory,
    weapon: inventory[0],
    consumables: [],
    skills: [],
  };
  const edric = {
    name: 'Edric',
    faction: 'player',
    isCommander: true,
    col: 1,
    row: 2,
    currentHP: 20,
    stats: { HP: 20, DEF: 5 },
    proficiencies: [{ type: 'Sword' }],
    inventory: [],
  };
  const s = {
    _battleSession: 1,
    registry: {
      get: (key) =>
        ({
          hints: { hasSeen: (id) => seen.has(id), markSeen: (id) => seen.add(id) },
          settings: { getHints: () => true, getGuidance: () => 'full' },
          meta: { runsCompleted: 0 },
        })[key],
    },
    battleParams: {},
    battleState: state,
    selectedUnit: sera,
    turnManager: { currentPhase: 'player', turnNumber: 2 },
    playerUnits: [edric, sera],
    enemyUnits: [],
    npcUnits,
    grid: {
      fogEnabled: Boolean(visible),
      isVisible: (col, row) => !visible || visible.has(`${col},${row}`),
    },
    isMobileInput: true,
    findAttackTargets: () => [],
    movementRange: new Map([
      ['4,2', { cost: 0 }],
      ['5,2', { cost: 1 }],
      ['6,2', { cost: 2 }],
    ]),
  };
  const heal = new HealController(s);
  s.getUsableStaves = (u) => heal.getUsableStaves(u);
  s.getActiveHealStaff = (u) => heal.getActiveHealStaff(u);
  s.findHealTargets = (u, staff, options) => heal.findHealTargets(u, staff, options);
  return { s, sera, edric, pick: () => new GuidanceController(s).pick() };
}

const recruit = (col, row, currentHP) => ({
  name: 'Garrick',
  className: 'Cavalier',
  faction: 'npc',
  col,
  row,
  currentHP,
  stats: { HP: 24 },
});
const caravan = (col, row, currentHP) =>
  Object.assign(createCaravanUnit('act2', { col, row }), { currentHP });

describe('healer note for a hurt NPC ally', () => {
  it('fires for a hurt caravan the healer can reach and names it', () => {
    const merchant = caravan(7, 2, 10); // (6,2) is adjacent: Heal reaches it
    const { sera, pick } = scene({ npcUnits: [merchant] });
    const note = pick();
    expect(note).toMatchObject({ id: 'guide_healer_heals', anchor: sera });
    expect(note.context.npc).toBe(merchant);
    expect(guidanceText(note.id, note.context)).toBe(
      'Sera heals with a staff, and staves mend the merchant caravan too: move within reach of it and choose Heal. Keep Sera out of enemy reach.',
    );
  });

  it('fires for a hurt recruit and names the recruit', () => {
    const garrick = recruit(5, 3, 9); // adjacent to (5,2)
    const { pick } = scene({ npcUnits: [garrick] });
    const note = pick();
    expect(note.context.npc).toBe(garrick);
    expect(guidanceText(note.id, note.context)).toBe(
      'Sera heals with a staff, and staves mend green units too: move within reach of Garrick and choose Heal. Keep Sera out of enemy reach.',
    );
  });

  it('keeps the army wording when an army unit is hurt too', () => {
    const { edric, pick } = scene({ npcUnits: [caravan(7, 2, 10)] });
    edric.currentHP = 12;
    const note = pick();
    expect(note.context.npc).toBeUndefined();
    expect(guidanceText(note.id, note.context)).toBe(
      'Sera heals with a staff: move next to a hurt ally and choose Heal. Early on, keep Sera out of reach and heal Edric.',
    );
  });

  it('stays silent when nothing heal-able is hurt', () => {
    // A whole caravan, a fallen recruit, one Talked away: nothing to mend.
    const whole = caravan(7, 2, 26);
    const fallen = recruit(5, 3, 0);
    const leaving = { ...recruit(6, 3, 5), _removing: true };
    expect(scene({ npcUnits: [whole, fallen, leaving] }).pick()).toBeNull();
    // A hurt enemy is never an ally.
    const { s, pick } = scene();
    s.enemyUnits = [{ name: 'Brigand', faction: 'enemy', col: 5, row: 3, currentHP: 3 }];
    expect(pick()).toBeNull();
  });

  it('stays silent when the hurt NPC is beyond reach this turn', () => {
    // (8,2): two tiles from the farthest stop (6,2); Heal reaches 1.
    expect(scene({ npcUnits: [caravan(8, 2, 10)] }).pick()).toBeNull();
  });

  it('counts only tiles the healer can end its move on', () => {
    const { s, pick } = scene({ npcUnits: [caravan(7, 2, 10)] });
    s.movementRange.set('6,2', { cost: 2, stoppable: false }); // an ally stands there
    expect(pick()).toBeNull();
  });

  it('never reveals an NPC the fog hides', () => {
    const visible = new Set(['4,2', '5,2', '6,2', '1,2']);
    const { pick } = scene({ npcUnits: [caravan(7, 2, 10)], visible });
    expect(pick()).toBeNull();
    visible.add('7,2');
    expect(pick()?.context.npc).toMatchObject({ isCaravan: true });
  });

  it('needs a staff that restores HP: a cure staff alone does not count', () => {
    const garrick = recruit(5, 3, 9);
    garrick._conditions = [{ id: 'sleep', turnsRemaining: 2 }];
    expect(scene({ staves: ['Restore'], npcUnits: [garrick] }).pick()).toBeNull();
    // A relocation staff never moves NPCs either.
    expect(scene({ staves: ['Warp Staff'], npcUnits: [recruit(5, 3, 9)] }).pick()).toBeNull();
    // With Heal in the bag as well, the heal is on offer.
    expect(scene({ staves: ['Restore', 'Heal'], npcUnits: [garrick] }).pick()?.context.npc).toBe(
      garrick,
    );
  });

  it('at the action menu, fires only when Heal from this tile would offer the NPC', () => {
    const merchant = caravan(7, 2, 10);
    const { s, sera, pick } = scene({ npcUnits: [merchant], state: 'UNIT_ACTION_MENU' });
    expect(pick()).toBeNull(); // 3 tiles away from (4,2)
    sera.col = 6; // moved next to it
    expect(s.findHealTargets(sera)).toEqual([merchant]);
    expect(pick()?.context.npc).toBe(merchant);
  });

  it('is never offered when Heal would restore nothing (a zero heal multiplier)', () => {
    const { s, pick } = scene({ npcUnits: [caravan(7, 2, 10)] });
    s.runManager = { blessingRuntimeModifiers: { healingEffectivenessMultiplier: 0 } };
    expect(s.findHealTargets(s.selectedUnit, null, { from: { col: 6, row: 2 } })).toEqual([]);
    expect(pick()).toBeNull();
  });
});
