import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';

function makeInteractiveText(seed = {}) {
  const handlers = {};
  return {
    ...seed,
    setOrigin() { return this; },
    setDepth() { return this; },
    setInteractive() { return this; },
    setColor() { return this; },
    on(event, cb) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(cb);
      return this;
    },
    handlers,
  };
}

function makePointerUpButton() {
  const scene = new BattleScene();
  const text = makeInteractiveText();
  const onClick = vi.fn();
  scene.add = {
    text: vi.fn(() => text),
  };

  BattleScene.prototype._makeMenuTextButton.call(
    scene,
    0,
    0,
    'Weapon Art',
    { fontFamily: 'monospace', fontSize: '12px', color: '#e0e0e0' },
    '#e0e0e0',
    onClick,
    { clickOnPointerUp: true },
  );

  return { scene, text, onClick };
}

describe('BattleScene clickOnPointerUp guard', () => {
  it('ignores pointerup when there was no prior pointerdown on the button', () => {
    const { text, onClick } = makePointerUpButton();

    text.handlers.pointerup[0]();

    expect(onClick).not.toHaveBeenCalled();
  });

  it('fires exactly once for a normal pointerdown -> pointerup click', () => {
    const { scene, text, onClick } = makePointerUpButton();

    text.handlers.pointerdown[0]();
    expect(scene._uiClickBlocked).toBe(true);

    text.handlers.pointerup[0]();

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disarms click if pointer leaves before release', () => {
    const { text, onClick } = makePointerUpButton();

    text.handlers.pointerdown[0]();
    const outHandlers = text.handlers.pointerout;
    outHandlers[outHandlers.length - 1]();
    text.handlers.pointerup[0]();

    expect(onClick).not.toHaveBeenCalled();
  });

  it('still honors _suppressNextClick for long-press tooltip flow', () => {
    const { text, onClick } = makePointerUpButton();

    text._suppressNextClick = true;
    text.handlers.pointerdown[0]();
    text.handlers.pointerup[0]();

    expect(onClick).not.toHaveBeenCalled();
    expect(text._suppressNextClick).toBe(false);
  });
});
