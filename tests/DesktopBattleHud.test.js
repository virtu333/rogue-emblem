import { describe, it, expect, vi } from 'vitest';
import {
  DesktopBattleHud,
  DESKTOP_HINT_TEXT,
  DESKTOP_SELECTED_HINT_TEXT,
} from '../src/ui/DesktopBattleHud.js';
import { UI_DEPTHS } from '../src/utils/uiDepths.js';

function makeText(text, width = 80, height = 10) {
  const t = {
    text,
    visible: true,
    x: 0,
    y: 0,
    originX: 0,
    originY: 0,
    scaleX: 1,
    depth: 100,
    style: { color: '#fff' },
    get displayWidth() {
      return this.text.length * 6 || width;
    },
    displayHeight: height,
    setStyle: vi.fn(() => t),
    setBackgroundColor: vi.fn(() => t),
    setPadding: vi.fn(() => t),
    setLineSpacing: vi.fn(() => t),
    setDepth: vi.fn((d) => ((t.depth = d), t)),
    setOrigin: vi.fn((x, y = x) => ((t.originX = x), (t.originY = y), t)),
    setPosition: vi.fn((x, y) => ((t.x = x), (t.y = y ?? t.y), t)),
    setText: vi.fn((v) => ((t.text = v), t)),
    setColor: vi.fn(() => t),
    setVisible: vi.fn((v) => ((t.visible = v), t)),
  };
  return t;
}

function makeScene(extra = {}) {
  const listeners = {};
  const graphics = {
    setDepth: vi.fn(() => graphics),
    clear: vi.fn(),
    fillStyle: vi.fn(),
    fillPoints: vi.fn(),
    lineStyle: vi.fn(),
    strokePoints: vi.fn(),
    lineBetween: vi.fn(),
    destroy: vi.fn(),
  };
  return {
    graphics,
    add: { graphics: () => graphics },
    cameras: {
      main: {
        width: 640,
        height: 480,
        setBackgroundColor: vi.fn(),
        backgroundColor: { rgba: 'x' },
      },
    },
    events: {
      on: (e, fn) => (listeners[e] ||= new Set()).add(fn),
      off: (e, fn) => listeners[e]?.delete(fn),
      emit: (e) => [...(listeners[e] || [])].forEach((fn) => fn()),
      listeners,
    },
    turnCounterText: makeText('Turn: 1 / Par: 8 (S)'),
    visionHudText: makeText('Eye: 1 left this run'),
    objectiveText: makeText('Rout: 3 enemies remaining'),
    infoText: makeText(''),
    parTooltipText: makeText(''),
    dangerButton: makeText('[D] Danger'),
    rosterButton: makeText('[O] Roster'),
    endTurnButton: makeText('[E] End Turn'),
    cancelButton: makeText('[X] Cancel'),
    instructionText2: makeText('[R] Vision  [V] Right-click Unit: Details'),
    ...extra,
  };
}

describe('DesktopBattleHud', () => {
  it('stays inactive when the touch HUD owns the battle', () => {
    const scene = makeScene({ _mobileBattleHud: {} });
    const hud = new DesktopBattleHud(scene).create();
    expect(hud.active).toBe(false);
    expect(scene.turnCounterText.setStyle).not.toHaveBeenCalled();
  });

  it('keeps every HUD text, puts it on plates above the world and keeps the texts', () => {
    const scene = makeScene();
    const hud = new DesktopBattleHud(scene).create();
    expect(hud.active).toBe(true);
    expect(scene.graphics.setDepth).toHaveBeenCalledWith(UI_DEPTHS.SCREEN_UI);
    expect(scene.turnCounterText.depth).toBeGreaterThan(UI_DEPTHS.SCREEN_UI);
    expect(scene.turnCounterText.text).toBe('Turn: 1 / Par: 8 (S)');
    expect(scene.objectiveText.text).toBe('Rout: 3 enemies remaining');
    expect(scene.instructionText2.text).toBe(DESKTOP_HINT_TEXT);
    for (const key of ['Vision', 'right-click', 'details', 'Esc', 'off-map', 'cancel'])
      expect(DESKTOP_HINT_TEXT).toContain(key);
    expect(scene.graphics.fillPoints).toHaveBeenCalled();
  });

  it('lays the bottom line out without overlaps and re-lays only on change', () => {
    const scene = makeScene();
    new DesktopBattleHud(scene).create();
    const row = [scene.dangerButton, scene.rosterButton, scene.endTurnButton];
    for (let i = 1; i < row.length; i++)
      expect(row[i].x).toBeGreaterThanOrEqual(row[i - 1].x + row[i - 1].displayWidth);
    expect(scene.cancelButton.x + scene.cancelButton.displayWidth).toBeLessThanOrEqual(640);
    const clears = scene.graphics.clear.mock.calls.length;
    scene.events.emit('postupdate');
    expect(scene.graphics.clear.mock.calls.length).toBe(clears);
    scene.infoText.text = 'Forest | Move: 2';
    scene.events.emit('postupdate');
    expect(scene.graphics.clear.mock.calls.length).toBe(clears + 1);
    // Hover info sits below the status plate, never on top of the turn line.
    expect(scene.infoText.y).toBeGreaterThan(scene.turnCounterText.y + 10);
  });

  it('while a unit is selected the hint says what a map click does, then reverts', () => {
    const scene = makeScene({ battleState: 'PLAYER_IDLE' });
    new DesktopBattleHud(scene).create();
    expect(scene.instructionText2.text).toBe(DESKTOP_HINT_TEXT);
    scene.battleState = 'UNIT_SELECTED';
    scene.selectedUnit = { name: 'Edric' };
    scene.events.emit('postupdate');
    expect(scene.instructionText2.text).toBe(DESKTOP_SELECTED_HINT_TEXT);
    for (const key of ['move', 'enemy in reach: attack', 'unit: actions'])
      expect(DESKTOP_SELECTED_HINT_TEXT).toContain(key);
    scene.battleState = 'PLAYER_IDLE';
    scene.selectedUnit = null;
    scene.events.emit('postupdate');
    expect(scene.instructionText2.text).toBe(DESKTOP_HINT_TEXT);
  });

  it('destroy removes plates and listeners and restores the camera background', () => {
    const scene = makeScene();
    const hud = new DesktopBattleHud(scene).create();
    hud.destroy();
    expect(scene.graphics.destroy).toHaveBeenCalled();
    expect(scene.events.listeners.postupdate.size).toBe(0);
    expect(scene.cameras.main.setBackgroundColor).toHaveBeenLastCalledWith('x');
    expect(hud.active).toBe(false);
  });
});
