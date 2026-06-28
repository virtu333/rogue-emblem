import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { PromotionChoicePanel } from '../src/ui/PromotionChoicePanel.js';
import { BossRecruitOverlay } from '../src/ui/BossRecruitOverlay.js';
import { InputAction } from '../src/utils/InputActions.js';
import { activeInputOwner, pushInputScope, _resetInputFocus } from '../src/utils/inputFocus.js';

beforeEach(() => _resetInputFocus());

const focusStub = () => ({ move: vi.fn(), activate: vi.fn(), destroy: vi.fn() });

describe('PromotionChoicePanel gamepad routing', () => {
  const route = (fake, action, payload) =>
    PromotionChoicePanel.prototype._onInputAction.call(fake, action, payload);

  it('NAVIGATE picks between columns (dx); CONFIRM activates; CANCEL resolves null', () => {
    const fake = { _focus: focusStub(), destroy: vi.fn(), _resolve: vi.fn() };
    route(fake, InputAction.NAVIGATE, { dx: 1, dy: 0 });
    expect(fake._focus.move).toHaveBeenCalledWith(1);
    route(fake, InputAction.CONFIRM);
    expect(fake._focus.activate).toHaveBeenCalledTimes(1);
    route(fake, InputAction.CANCEL);
    expect(fake.destroy).toHaveBeenCalledTimes(1);
    expect(fake._resolve).toHaveBeenCalledWith(null);
  });

  it('destroy() releases the input-focus scope', () => {
    const panel = new PromotionChoicePanel({}, {}, [], []);
    panel.objects = [];
    panel._selectButtons = [];
    panel._focus = focusStub();
    panel._onInputActionBound = () => {};
    pushInputScope(panel, panel._onInputActionBound);
    expect(activeInputOwner()).toBe(panel);

    panel.destroy();
    expect(activeInputOwner()).toBe(null);
    expect(panel._focus).toBe(null);
  });
});

describe('BossRecruitOverlay gamepad routing', () => {
  const route = (fake, action, payload) =>
    BossRecruitOverlay.prototype._onInputAction.call(fake, action, payload);

  it('NAVIGATE moves across cards (dx); CONFIRM activates; CANCEL skips (resolve null)', () => {
    const fake = { _focus: focusStub(), _resolveSelection: vi.fn() };
    route(fake, InputAction.NAVIGATE, { dx: -1, dy: 0 });
    expect(fake._focus.move).toHaveBeenCalledWith(-1);
    route(fake, InputAction.CONFIRM);
    expect(fake._focus.activate).toHaveBeenCalledTimes(1);
    route(fake, InputAction.CANCEL);
    expect(fake._resolveSelection).toHaveBeenCalledWith(null);
  });

  it('_cleanup() releases the input-focus scope', () => {
    const overlay = new BossRecruitOverlay({}, {}, {});
    overlay.displayObjects = [];
    overlay._focus = focusStub();
    overlay._onInputActionBound = () => {};
    pushInputScope(overlay, overlay._onInputActionBound);
    expect(activeInputOwner()).toBe(overlay);

    overlay._cleanup();
    expect(activeInputOwner()).toBe(null);
    expect(overlay._focus).toBe(null);
  });
});
