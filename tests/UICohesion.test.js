import { describe, it, expect, vi } from 'vitest';
import { pushOverlay, routeMobileAction, clearOverlayStack } from '../src/utils/overlayStack.js';
import { MobileHomeBase } from '../src/ui/MobileHomeBase.js';
import { dialoguePortraitKey } from '../src/ui/RebuiltPortraits.js';

describe('modal input ownership', () => {
  it('routes mobile Back only to the top overlay and blocks scene shortcuts', () => {
    const scene = {};
    const close = vi.fn();
    const sceneAction = vi.fn();
    pushOverlay(scene, { name: 'sheet', onCancel: close });
    routeMobileAction(scene, 'menu', sceneAction);
    routeMobileAction(scene, 'roster', sceneAction);
    expect(close).not.toHaveBeenCalled();
    expect(sceneAction).not.toHaveBeenCalled();
    routeMobileAction(scene, 'cancel', sceneAction);
    expect(close).toHaveBeenCalledTimes(1);
    expect(sceneAction).not.toHaveBeenCalled();
    clearOverlayStack(scene);
    routeMobileAction(scene, 'menu', sceneAction);
    expect(sceneAction).toHaveBeenCalledTimes(1);
  });
  it('Home Base cancel leaves the scene only when allowExit permits it', () => {
    const home = { tab: 'skills', render: vi.fn(), transition: vi.fn() };
    expect(MobileHomeBase.prototype.back.call(home, { allowExit: false })).toBe(true);
    expect(home.tab).toBe('lords');
    expect(MobileHomeBase.prototype.back.call(home, { allowExit: false })).toBe(false);
    expect(home.transition).not.toHaveBeenCalled();
    expect(MobileHomeBase.prototype.back.call(home, { allowExit: true })).toBe(true);
    expect(home.transition).toHaveBeenCalledWith('Title');
  });
});
describe('dialogue portrait resolution', () => {
  const make = (keys, roster = []) => ({
    textures: { exists: (key) => keys.includes(key) },
    runManager: { roster },
  });
  it('uses the current promoted lord identity', () => {
    const scene = make(
      ['rebuilt-portrait-lord_edric_promoted'],
      [{ name: 'Edric', isLord: true, tier: 'promoted' }],
    );
    expect(dialoguePortraitKey(scene, 'Edric', 'portrait_lord_edric')).toBe(
      'rebuilt-portrait-lord_edric_promoted',
    );
  });
  it('resolves boss art and retains missing-art and narration fallbacks', () => {
    const scene = make(['rebuilt-portrait-boss_the_emperor']);
    expect(dialoguePortraitKey(scene, 'The Emperor', 'portrait_boss_the_emperor')).toBe(
      'rebuilt-portrait-boss_the_emperor',
    );
    expect(dialoguePortraitKey(scene, 'Unknown', 'portrait_unknown')).toBe('portrait_unknown');
    expect(dialoguePortraitKey(scene, 'Edric', null)).toBeNull();
  });
});
