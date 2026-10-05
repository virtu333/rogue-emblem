// Presentation polish for commander choice: sprite lookup, Vision prompt copy.

import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: { Scene: class {} },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';

function makeSpriteCtx(textureKeys) {
  const ctx = Object.create(BattleScene.prototype);
  ctx.textures = { exists: (key) => textureKeys.includes(key) };
  return ctx;
}

describe('BattleScene.getSpriteKey lord lookup', () => {
  const allKeys = ['lordedric', 'greatlordedric', 'edric', 'cael', 'sentinel', 'champion'];

  it('Edric keeps his tier-specific sprites', () => {
    const ctx = makeSpriteCtx(allKeys);
    expect(ctx.getSpriteKey({ isLord: true, name: 'Edric', tier: 'base', className: 'Lord' })).toBe(
      'lordedric',
    );
    expect(
      ctx.getSpriteKey({ isLord: true, name: 'Edric', tier: 'promoted', className: 'Great Lord' }),
    ).toBe('greatlordedric');
  });

  it('other lords use the name-keyed sprite at both tiers', () => {
    const ctx = makeSpriteCtx(allKeys);
    expect(
      ctx.getSpriteKey({ isLord: true, name: 'Cael', tier: 'base', className: 'Sentinel' }),
    ).toBe('cael');
    expect(
      ctx.getSpriteKey({ isLord: true, name: 'Cael', tier: 'promoted', className: 'Champion' }),
    ).toBe('cael');
  });

  it('falls through to the class sprite when no lord sprite exists', () => {
    const ctx = makeSpriteCtx(['sentinel']);
    expect(
      ctx.getSpriteKey({ isLord: true, name: 'Cael', tier: 'base', className: 'Sentinel' }),
    ).toBe('sentinel');
  });
});

describe('Vision lord-death prompt copy', () => {
  function promptTitle(roster, playerUnits = []) {
    const scene = { visionSnapshot: {}, playerUnits };
    const ctrl = new VisionRewindController(scene, { roster, visionChargesRemaining: 1 });
    ctrl.getChargesRemaining = () => 1;
    let captured = null;
    ctrl.showDialog = (opts) => {
      captured = opts;
    };
    expect(ctrl.showLordDeathPrompt()).toBe(true);
    return captured.title;
  }

  it("names Sera while she is in the run's roster", () => {
    expect(promptTitle([{ name: 'Edric' }, { name: 'Sera' }])).toBe("Sera's vision fractures!");
  });

  it('names Sera when she joined on this field (a Talk) before the roster knows her', () => {
    // Prologue P3: Sera Talks her way into the army mid-battle; the run's roster takes
    // her in only when the chapter is won. Her vision is the one being offered.
    const edric = { name: 'Edric' };
    const sera = { name: 'Sera' };
    expect(promptTitle([edric, { name: 'Gaspar' }], [edric, sera])).toBe(
      "Sera's vision fractures!",
    );
  });

  it('uses generic copy without Sera', () => {
    expect(promptTitle([{ name: 'Cael' }, { name: 'Kira' }])).toBe('A vision fractures!');
  });
});
