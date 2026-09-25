import { describe, it, expect, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { BlendModes: { ADD: 1 } } }));
import { CombatFxController } from '../src/ui/CombatFxController.js';
import { ProcBannerController } from '../src/ui/ProcBannerController.js';
function fixture(motion, quality) {
  const objects = [];
  const make = (x = 0, y = 0) => {
    const o = {
      x,
      y,
      scaleX: 1,
      scaleY: 1,
      scene: {},
      destroy: vi.fn(),
      play: vi.fn(),
      once: vi.fn(),
    };
    for (const method of [
      'setDepth',
      'setBlendMode',
      'setRotation',
      'setScale',
      'setTint',
      'setFrame',
      'setOrigin',
      'setAlpha',
      'setDisplaySize',
    ])
      o[method] = vi.fn(() => o);
    objects.push(o);
    return o;
  };
  const scene = {
    _reduceMotion: () => motion,
    _effectsQuality: () => quality,
    _pinToScreen: vi.fn(),
    sys: { isActive: () => true },
    cameras: { main: { width: 640, centerY: 240, zoom: 1, shake: vi.fn() } },
    tweens: { killTweensOf: vi.fn(), add: vi.fn() },
    textures: { exists: () => true },
    anims: { exists: () => true },
    time: { now: 0, delayedCall: vi.fn() },
    add: {
      sprite: vi.fn(make),
      text: vi.fn(make),
      rectangle: vi.fn(make),
      image: vi.fn(make),
      container: vi.fn(make),
    },
    _awaitSceneDelay: vi.fn(async () => {}),
    _awaitSceneTween: vi.fn(async (config) => {
      config.onComplete?.();
    }),
  };
  return { scene, objects, make };
}
describe('independent motion and visual quality', () => {
  it.each([
    [false, 'high'],
    [true, 'high'],
    [false, 'low'],
    [true, 'low'],
  ])('motion=%s quality=%s retains readable cut-ins', async (motion, quality) => {
    const { scene } = fixture(motion, quality);
    await new ProcBannerController(scene).showCutIn({
      unitName: 'Edric',
      portraitKey: 'portrait',
      label: 'CRITICAL HIT',
      category: 'offense',
      side: 'left',
    });
    expect(scene.add.text).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'CRITICAL HIT',
      expect.anything(),
    );
    const slides = scene._awaitSceneTween.mock.calls.map(([c]) => c.x);
    if (motion || quality === 'low') expect(slides.every((x) => x === 0)).toBe(true);
    else expect(slides.some((x) => x !== 0)).toBe(true);
  });
  it('low quality omits overlay art without suppressing normal motion', async () => {
    const { scene, make } = fixture(false, 'low');
    const fx = new CombatFxController(scene);
    fx.playOverlay('fx_heal', 10, 20);
    expect(scene.add.sprite).not.toHaveBeenCalled();
    await fx.lungeForward({ graphic: make(10, 10) }, { graphic: make(20, 10) });
    expect(scene._awaitSceneTween).toHaveBeenCalled();
  });
  it('reduced motion removes lunges, recoil, scale pops and shake; high art stays static', async () => {
    const { scene, make } = fixture(true, 'high');
    const fx = new CombatFxController(scene);
    const unit = { graphic: make(10, 10) },
      target = { graphic: make(20, 10) };
    await fx.lungeForward(unit, target);
    await fx.lungeBack(unit, target);
    fx.dodge(unit, target);
    fx.recoil(unit, target);
    fx.brace(unit);
    fx.critImpact(unit);
    fx.zoomPunch();
    expect(scene._awaitSceneTween).not.toHaveBeenCalled();
    expect(scene.tweens.add).not.toHaveBeenCalled();
    expect(scene.cameras.main.shake).not.toHaveBeenCalled();
    fx.playOverlay('fx_heal', 10, 20);
    const sprite = scene.add.sprite.mock.results[0].value;
    expect(sprite.play).not.toHaveBeenCalled();
    // Combat v2 atlas frames: a static, readable frame of the heal (no animation).
    expect(sprite.setFrame).toHaveBeenCalledWith('fx_heal/2');
    expect(scene.time.delayedCall).toHaveBeenCalled();
  });
});
