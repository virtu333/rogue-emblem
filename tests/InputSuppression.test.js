
import { describe, it, expect, vi } from 'vitest';

// We mock a minimal BattleScene context to test the pointer suppression logic.
// In a real scenario, this logic is in src/scenes/BattleScene.js.
// We are testing the logic pattern that was implemented.

class MockBattleScene {
  constructor() {
    this._uiClickBlocked = false;
    this.onClickCalled = false;
    this.cancelTouchInspectHoldCalled = false;
  }

  // Implementation matching src/scenes/BattleScene.js:onPointerUp
  onPointerUp(pointer) {
    if ((pointer.rightButtonDown && pointer.rightButtonDown()) || pointer.button === 2) return;

    // Guard: ignore map clicks that occur immediately after a UI interaction (pointerdown)
    // to prevent 'bleed-through' clicks to the map.
    if (this._uiClickBlocked) {
      this._uiClickBlocked = false;
      return;
    }

    this.cancelTouchInspectHold();
    this.onClick(pointer);
  }

  cancelTouchInspectHold() {
    this.cancelTouchInspectHoldCalled = true;
  }

  onClick(pointer) {
    this.onClickCalled = true;
  }

  // Simulation of a UI element click (pointerdown)
  simulateUiPointerDown() {
    this._uiClickBlocked = true;
  }
}

describe('Input Suppression (onPointerUp Guard)', () => {
  it('suppresses onClick when _uiClickBlocked is true', () => {
    const scene = new MockBattleScene();
    const pointer = { button: 0 }; // Normal left click

    scene.simulateUiPointerDown();
    expect(scene._uiClickBlocked).toBe(true);

    scene.onPointerUp(pointer);

    expect(scene._uiClickBlocked).toBe(false, 'Guard should be reset');
    expect(scene.onClickCalled).toBe(false, 'onClick should NOT have been called');
    expect(scene.cancelTouchInspectHoldCalled).toBe(false);
  });

  it('allows onClick when _uiClickBlocked is false', () => {
    const scene = new MockBattleScene();
    const pointer = { button: 0 };

    expect(scene._uiClickBlocked).toBe(false);

    scene.onPointerUp(pointer);

    expect(scene.onClickCalled).toBe(true, 'onClick SHOULD have been called');
    expect(scene.cancelTouchInspectHoldCalled).toBe(true);
  });

  it('only suppresses a single click (one-shot)', () => {
    const scene = new MockBattleScene();
    const pointer = { button: 0 };

    scene.simulateUiPointerDown();
    scene.onPointerUp(pointer); // This one is suppressed
    expect(scene.onClickCalled).toBe(false);

    scene.onPointerUp(pointer); // This one should pass through
    expect(scene.onClickCalled).toBe(true);
  });

  it('does not block right clicks regardless of guard state', () => {
    const scene = new MockBattleScene();
    const rightPointer = { button: 2 };

    scene.simulateUiPointerDown();
    scene.onPointerUp(rightPointer);
    
    // Right click returns early before even checking the guard
    expect(scene._uiClickBlocked).toBe(true, 'Guard should still be active because right click returned early');
    expect(scene.onClickCalled).toBe(false);
  });
});
