import { presentationText } from '../src/utils/presentationText.js';
import { describe, it, expect, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {}, BlendModes: { ADD: 1 } } }));
import { battleSpeed, combatDuration, waitDuration, waitTween } from '../src/utils/combatTiming.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { CombatFxController } from '../src/ui/CombatFxController.js';
const scene = (speed) => ({ registry: { get: () => ({ getBattleSpeed: () => speed }) } });
describe('combat presentation pacing', () => {
  it.each([
    ['normal', 200],
    ['fast', 100],
    ['instant', 1],
  ])('%s scales only the explicit combat waits', (speed, ms) => {
    const s = scene(speed);
    for (const label of [
      'animate_strike_hit_hold',
      'terrain_damage_tail',
      'acid_damage_tail',
      'terrain_damage_tint_clear',
      'acid_damage_tint_clear',
      'death_affix_chain_tick',
      'entity_splash_tick',
      'enemy_break_hold',
      'ballista_hit_float',
      'ballista_miss_float',
      'show_poison_damage',
      'show_skill_learned_banner',
      'animate_enemy_move_step',
    ])
      expect(waitDuration(s, label, 200)).toBe(ms);
    for (const label of [
      'scene_delay',
      'level_up',
      'dialogue',
      'show_brief_banner',
      'turn_start',
      'proc_unknown',
    ]) {
      expect(waitDuration(s, label, 200)).toBe(200);
    }
    const original = { duration: 200, delay: 100, hold: 0, onComplete: vi.fn() };
    expect(waitTween(s, 'combat_fx_lunge_back', original)).toMatchObject({
      duration: ms,
      hold: 0,
      onComplete: original.onComplete,
    });
    expect(original.duration).toBe(200);
    expect(combatDuration(s, 0)).toBe(0);
  });
  it('keeps scheduling/watchdog deadlines at the original duration', async () => {
    const s = new BattleScene();
    s.registry = scene('instant').registry;
    s._isSceneActiveForAsync = () => true;
    s._createLifecycleAwaitGuard = vi.fn(() => ({
      promise: Promise.resolve(),
      guard: { resolve: vi.fn() },
    }));
    s.tweens = { add: vi.fn() };
    await s._awaitSceneTween({ duration: 1000 }, { label: 'combat_fx_lunge_back' });
    expect(s.tweens.add.mock.calls[0][0].duration).toBe(1);
    expect(s._createLifecycleAwaitGuard.mock.calls[0][0].timeoutMs).toBe(1700);
  });
  it('snapshots speed for an exchange and restores it on failure', async () => {
    const s = new BattleScene();
    let speed = 'fast';
    s.registry = { get: () => ({ getBattleSpeed: () => speed }) };
    s._combatFx = { finishStrike: vi.fn() };
    s._runCombatResolutionAtSpeed = async () => {
      speed = 'instant';
      expect(battleSpeed(s)).toBe('fast');
      throw new Error('interrupted');
    };
    await expect(s._runCombatResolution({}, {}, {})).rejects.toThrow('interrupted');
    expect(battleSpeed(s)).toBe('instant');
    expect(s._combatFx.finishStrike).toHaveBeenCalledOnce();
  });
  it.each(['normal', 'fast', 'instant'])(
    '%s settles unfinished reactions without killing unrelated tweens',
    async (speed) => {
      const s = {
        ...scene(speed),
        _reduceMotion: () => false,
        tweens: { add: vi.fn(() => ({ remove: vi.fn() })), killTweensOf: vi.fn() },
        _awaitSceneTween: async () => {},
        cameras: { main: { zoom: 1, setZoom: vi.fn(), shake: vi.fn() } },
      };
      const fx = new CombatFxController(s);
      const a = { graphic: { x: 10, y: 20, scaleX: 2, scaleY: 2 } };
      const b = { graphic: { x: 30, y: 40, scaleX: 3, scaleY: 3 } };
      fx.settle(a);
      fx.settle(b);
      s.tweens.killTweensOf.mockClear();
      fx.recoil(b, a);
      fx.critImpact(a);
      fx.zoomPunch();
      a.graphic.scaleX = 4;
      b.graphic.x = 50;
      await fx.lungeBack(a, b);
      expect(a.graphic).toMatchObject({ x: 10, y: 20, scaleX: 2, scaleY: 2 });
      expect(b.graphic).toMatchObject({ x: 30, y: 40, scaleX: 3, scaleY: 3 });
      expect(b.graphic._fxHomeX).toBeUndefined();
      for (const call of s.tweens.add.mock.results)
        expect(call.value.remove).toHaveBeenCalledOnce();
      expect(s.tweens.killTweensOf).not.toHaveBeenCalled();
      expect(s.cameras.main.setZoom).toHaveBeenCalledWith(1);
    },
  );
});

it('text UUID allocation does not consume combat RNG, including failure', () => {
  const rng = vi.spyOn(Math, 'random');
  const s = { add: { text: () => Math.random() } };
  presentationText(s, 0, 0, 'Crit');
  expect(rng).not.toHaveBeenCalled();
  s.add.text = () => {
    throw new Error('allocation failed');
  };
  expect(() => presentationText(s, 0, 0, 'Crit')).toThrow();
  expect(Math.random).toBe(rng);
  rng.mockRestore();
});

it('disposes strike effects after releasing fast-forward back to normal', () => {
  const s = scene('normal');
  const fx = new CombatFxController(s);
  const timer = { remove: vi.fn() };
  const sprite = { destroy: vi.fn() };
  fx._timers.add(timer);
  fx._sprites.add(sprite);
  s._holdBattleFast = false;
  fx.finishStrike();
  expect(timer.remove).toHaveBeenCalledWith(false);
  expect(sprite.destroy).toHaveBeenCalledOnce();
});
