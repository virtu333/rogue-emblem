import { describe, it, expect, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { BattleScene } from '../src/scenes/BattleScene.js';
import { Grid } from '../src/engine/Grid.js';
import { InputController } from '../src/ui/InputController.js';
import {
  canInspectUnit,
  statusDescriptions,
  statusStaffThreat,
} from '../src/engine/BattleInformation.js';
import { applyCondition, processConditionRecovery } from '../src/engine/StatusConditionSystem.js';

const enemy = () => ({
  faction: 'enemy',
  col: 2,
  row: 2,
  currentHP: 20,
  stats: { MOV: 0 },
  mov: 0,
  moveType: 'Infantry',
  weapon: { range: '1' },
  statusStaff: { name: 'Sleep', type: 'Staff', range: '3-7', uses: 3, statusEffect: 'sleep' },
});
function sceneFor(u) {
  const scene = new BattleScene();
  scene.enemyUnits = [u];
  scene.playerUnits = [];
  scene.grid = {
    cols: 12,
    rows: 10,
    fogEnabled: false,
    getMovementRange: () => new Map([['2,2', { stoppable: true }]]),
    getAttackRange: Grid.prototype.getAttackRange,
  };
  scene.buildUnitPositionMap = () => new Map();
  scene._getCostModifier = () => 0;
  return scene;
}
describe('battle information contracts', () => {
  it('keeps hidden enemies private but permits a visible part of an entity', () => {
    const grid = { fogEnabled: true, isVisible: (c, r) => c === 4 && r === 4 };
    expect(canInspectUnit(grid, enemy())).toBe(false);
    expect(canInspectUnit(grid, { ...enemy(), isEntity: true })).toBe(true);
    expect(canInspectUnit(grid, { ...enemy(), faction: 'player' })).toBe(true);
  });
  it('refuses quick inspection and filters detail cycling through the same fog boundary', () => {
    const hidden = enemy(),
      visible = { ...enemy(), col: 3 };
    const s = sceneFor(hidden);
    s.enemyUnits.push(visible);
    s.grid.fogEnabled = true;
    s.grid.isVisible = (c) => c === 3;
    s.grid.pixelToGrid = () => ({ col: 2, row: 2 });
    s.getUnitAt = () => hidden;
    s.inspectionPanel = { show: vi.fn(), hide: vi.fn(), _unit: visible };
    s.unitDetailOverlay = { show: vi.fn() };
    s.refreshEndTurnControl = vi.fn();
    const input = new InputController(s);
    expect(input._showInspectionAtPixel(10, 10)).toBe(false);
    expect(s.inspectionPanel.show).not.toHaveBeenCalled();
    input.openUnitDetailOverlay();
    expect(s.unitDetailOverlay.show.mock.calls[0][3].rosterUnits).toEqual([visible]);
  });
  it('shows real condition duration and recovery rather than promising a fixed sleep', () => {
    const unit = enemy();
    applyCondition(unit, 'sleep', 3);
    expect(statusDescriptions(unit)[0]).toContain('up to 3 turns');
    processConditionRecovery([unit], () => 0.9);
    expect(statusDescriptions(unit)[0]).toContain('up to 2 turns');
    processConditionRecovery([unit], () => 0);
    expect(statusDescriptions(unit)).toEqual([]);
  });
  it('adds status staff outer range with separate semantics and removes exhausted uses', () => {
    const unit = enemy(),
      s = sceneFor(unit);
    expect(s.calculateDangerZone()).toContainEqual({
      col: 9,
      row: 2,
      statusThreat: true,
      damageThreat: false,
    });
    expect(s.calculateDangerZone()).toContainEqual({ col: 3, row: 2 });
    unit.statusStaff._usesSpent = 3;
    expect(s.calculateDangerZone().some((t) => t.statusThreat)).toBe(false);
    unit.statusStaff._usesSpent = 0;
    s.grid.fogEnabled = true;
    s.grid.isVisible = () => false;
    expect(s.calculateDangerZone()).toEqual([]);
  });
  it('accounts for recovery before the next phase conservatively', () => {
    const unit = enemy();
    applyCondition(unit, 'silence', 2, { recoveryChance: 0 });
    expect(statusStaffThreat(unit)).toBeNull();
    processConditionRecovery([unit], () => 1);
    expect(statusStaffThreat(unit)).not.toBeNull();
    applyCondition(unit, 'silence', 3);
    expect(statusStaffThreat(unit)).not.toBeNull();
  });
  it('refreshes the displayed danger and cache after changes', () => {
    const unit = enemy(),
      s = sceneFor(unit);
    s.dangerZone = { visible: true, show: vi.fn() };
    s.refreshVisibleDangerZone();
    expect(s.dangerZoneCache.some((t) => t.statusThreat)).toBe(true);
    unit.statusStaff._usesSpent = 3;
    s.refreshVisibleDangerZone();
    expect(s.dangerZoneCache.some((t) => t.statusThreat)).toBe(false);
    expect(s.dangerZone.show).toHaveBeenLastCalledWith(s.dangerZoneCache);
    expect(s.dangerZoneStale).toBe(false);
  });
  it('warns before enrage and persists active aggression without a defeated-boss warning', () => {
    const unit = { ...enemy(), isBoss: true },
      s = sceneFor(unit);
    s.turnBonusConfig = { latePressure: { bossEnrageTurn: 10 } };
    s.turnManager = { turnNumber: 9 };
    expect(s.getBossPressureWarning()).toBe('Boss enrages next turn (turn 10)');
    s.turnManager.turnNumber = 10;
    expect(s.getBossPressureWarning()).toBe('Boss enrages this enemy phase');
    s.antiTurtleState = { turnEnrageActive: true };
    expect(s.getBossPressureWarning()).toContain('Boss enraged');
    unit.currentHP = 0;
    expect(s.getBossPressureWarning()).toBe('');
  });
});
