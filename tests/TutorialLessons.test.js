import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/ui/HintDisplay.js', () => ({ showImportantHint: vi.fn(async () => {}) }));
import { showImportantHint } from '../src/ui/HintDisplay.js';
import { HintManager } from '../src/engine/HintManager.js';
import { TutorialController } from '../src/ui/TutorialController.js';
import {
  applyCompletedTutorialHints,
  forecastTutorialLesson,
  TUTORIAL_LESSONS_KEY,
} from '../src/ui/tutorialLessons.js';

function fixture() {
  const hints = { markSeen: vi.fn() };
  const scene = {
    battleParams: { tutorialMode: true },
    battleState: 'UNIT_ACTION_MENU',
    sys: { isActive: () => true },
    registry: { get: () => hints },
    grid: { getTerrainAt: () => ({ defBonus: 2, avoidBonus: 20 }) },
    _inputController: { refreshTileInfo: vi.fn() },
    _mobileBattleHud: { sync: vi.fn() },
  };
  return { scene, hints, controller: new TutorialController(scene) };
}
beforeEach(() => {
  vi.clearAllMocks();
  const data = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, String(v)),
  });
  showImportantHint.mockImplementation(async () => {});
});

describe('tutorial lessons', () => {
  it('teaches triangle and doubling only when they appear in the forecast', () => {
    expect(forecastTutorialLesson({}).ids).toEqual(['battle_forecast']);
    const forecast = { display: { triangle: { damage: 1, hit: 10 } }, attacker: { doubles: true } };
    expect(forecastTutorialLesson(forecast).ids).toEqual(['battle_forecast']);
    expect(forecastTutorialLesson(forecast, new Set(['battle_forecast'])).ids).toEqual([
      'battle_triangle',
    ]);
    expect(
      forecastTutorialLesson(forecast, new Set(['battle_forecast', 'battle_triangle'])).ids,
    ).toEqual(['battle_doubling']);
    expect(
      forecastTutorialLesson(
        forecast,
        new Set(['battle_forecast', 'battle_triangle', 'battle_doubling']),
      ).message,
    ).toBe('');
  });
  it('refreshes the arrived terrain before showing its lesson and restores the action menu', async () => {
    const { scene, controller } = fixture();
    showImportantHint.mockImplementation(async () => {
      expect(scene._inputController.refreshTileInfo).toHaveBeenCalledWith(3, 3);
      expect(scene._mobileBattleHud.sync).toHaveBeenCalled();
      expect(scene.battleState).toBe('TUTORIAL_HINT');
    });
    await controller.showFortLesson({ col: 3, row: 3 });
    expect(showImportantHint).toHaveBeenCalledWith(
      scene,
      expect.stringContaining('Defense +2, Avoid +20'),
    );
    expect(scene.battleState).toBe('UNIT_ACTION_MENU');
  });
  it('keeps concurrent lessons from stacking and never restores a state after shutdown', async () => {
    const { scene, controller } = fixture();
    let finish;
    showImportantHint.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = controller.showForecastLesson({});
    expect(await controller.showResourceLesson([{ item: { type: 'Staff' } }])).toBe(false);
    scene._sceneShutdownCleanedUp = true;
    scene.battleState = 'BATTLE_END';
    controller.destroy();
    finish();
    expect(await pending).toBe(false);
    expect(scene.battleState).toBe('BATTLE_END');
    expect(controller.taught.size).toBe(0);
  });
  it('teaches both resource lifetimes once at a resource menu', async () => {
    const { controller } = fixture();
    expect(await controller.showResourceLesson([{ item: { type: 'Sword' } }])).toBe(false);
    expect(await controller.showResourceLesson([{ item: { type: 'Staff' } }])).toBe(true);
    expect(await controller.showResourceLesson([{ item: { type: 'Consumable' } }])).toBe(false);
    expect(showImportantHint).toHaveBeenCalledTimes(1);
  });
  it('carries only taught, known lessons into the first new slot after completing', async () => {
    const { controller } = fixture();
    await controller.showForecastLesson({ display: { triangle: { damage: 1 } } });
    await controller.showForecastLesson({ display: { triangle: { damage: 1 } } });
    controller.recordCompletion();
    const newHints = { markSeen: vi.fn() };
    applyCompletedTutorialHints(newHints);
    expect(newHints.markSeen.mock.calls.flat()).toEqual(
      expect.arrayContaining(['battle_triangle', 'battle_forecast', 'battle_first_turn']),
    );
    expect(newHints.markSeen).not.toHaveBeenCalledWith('battle_staff_scope');
    expect(newHints.markSeen).not.toHaveBeenCalledWith('battle_doubling');
  });
  it('does not suppress lessons after a skipped tutorial or trust unknown persisted ids', () => {
    localStorage.setItem(TUTORIAL_LESSONS_KEY, JSON.stringify(['battle_triangle', 'arbitrary']));
    const hints = { markSeen: vi.fn() };
    applyCompletedTutorialHints(hints);
    expect(hints.markSeen).not.toHaveBeenCalled();
    localStorage.setItem('emblem_rogue_tutorial_completed', '1');
    applyCompletedTutorialHints(hints);
    expect(hints.markSeen.mock.calls).toEqual([['battle_triangle']]);
  });
});

describe('completed tutorial import and explicit reset', () => {
  it('imports only into new slots, preserving a reset across reconstructed managers', () => {
    localStorage.setItem('emblem_rogue_tutorial_completed', '1');
    localStorage.setItem(
      TUTORIAL_LESSONS_KEY,
      JSON.stringify(['battle_forecast', 'battle_triangle']),
    );
    const first = new HintManager(1);
    expect(first.isNew).toBe(true);
    applyCompletedTutorialHints(first);
    expect(first.hasSeen('battle_triangle')).toBe(true);
    first.reset();
    applyCompletedTutorialHints(first);
    expect(first.hasSeen('battle_triangle')).toBe(false);
    const restored = new HintManager(1);
    expect(restored.isNew).toBe(false);
    applyCompletedTutorialHints(restored);
    expect([...restored.seen]).toEqual([]);
    const nextSlot = new HintManager(2);
    applyCompletedTutorialHints(nextSlot);
    expect(nextSlot.hasSeen('battle_triangle')).toBe(true);
  });
  it('uses the actual consumable effect and avoids a hardcoded Vulnerary example', async () => {
    const { controller } = fixture();
    await controller.showResourceLesson([
      { item: { type: 'Consumable', name: 'Elixir', effect: 'healFull' } },
    ]);
    const message = showImportantHint.mock.calls.at(-1)[1];
    expect(message).toContain('Elixir: Restore HP to full');
    expect(message).not.toContain('10 HP');
  });
});
