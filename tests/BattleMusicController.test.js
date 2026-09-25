import { describe, it, expect, vi } from 'vitest';
import BattleMusicController from '../src/ui/BattleMusicController.js';
import { MUSIC, MUSIC_LAYERS } from '../src/utils/musicConfig.js';

function makeScene() {
  const audio = {
    playMusic: vi.fn(async () => {}),
    releaseMusic: vi.fn(),
    setMusicIntensity: vi.fn(),
  };
  return { audio, scene: { registry: { get: (k) => (k === 'audio' ? audio : null) } } };
}

describe('BattleMusicController', () => {
  it('opens an adaptive battle theme on its calm layer', () => {
    const { audio, scene } = makeScene();
    const ctrl = new BattleMusicController(scene, { playersInDanger: () => false });
    const key = ctrl.create({ act: 'act1' });
    expect(MUSIC.battle.act1).toContain(key);
    expect(MUSIC_LAYERS[key]).toBeTruthy();
    expect(audio.setMusicIntensity).toHaveBeenCalledWith('calm', 0);
    expect(audio.playMusic).toHaveBeenCalledWith(key, scene, 800);
    expect(audio.setMusicIntensity.mock.invocationCallOrder[0]).toBeLessThan(
      audio.playMusic.mock.invocationCallOrder[0],
    );
  });

  it('rises on combat and settles after a quiet round', () => {
    const { audio, scene } = makeScene();
    let danger = false;
    const ctrl = new BattleMusicController(scene, { playersInDanger: () => danger });
    ctrl.create({ act: 'act2' });
    audio.setMusicIntensity.mockClear();

    ctrl.onCombat();
    expect(audio.setMusicIntensity).toHaveBeenLastCalledWith('full', expect.any(Number));
    ctrl.onPhaseStart('enemy');
    ctrl.onPhaseStart('player');
    expect(audio.setMusicIntensity).toHaveBeenCalledTimes(1); // still full after a fighting round
    ctrl.onPhaseStart('enemy');
    ctrl.onPhaseStart('player');
    expect(audio.setMusicIntensity).toHaveBeenLastCalledWith('calm', expect.any(Number));

    danger = true;
    ctrl.onPhaseStart('enemy');
    expect(audio.setMusicIntensity).toHaveBeenLastCalledWith('full', expect.any(Number));
  });

  it('plays a named antagonist theme and never touches layers for bosses', () => {
    const { audio, scene } = makeScene();
    const ctrl = new BattleMusicController(scene);
    const key = ctrl.create({ act: 'finalBoss', isBoss: true, bossName: 'The Entity' });
    expect(key).toBe(MUSIC.bossByName['The Entity']);
    audio.setMusicIntensity.mockClear();
    ctrl.onCombat();
    ctrl.onPhaseStart('player');
    expect(audio.setMusicIntensity).not.toHaveBeenCalled();
  });

  it('uses the act boss theme for other bosses', () => {
    const { scene } = makeScene();
    const ctrl = new BattleMusicController(scene);
    expect(ctrl.create({ act: 'act3', isBoss: true, bossName: 'Blade Lord' })).toBe(
      MUSIC.boss.act3,
    );
  });

  it('releases previous music first in tutorial mode and survives a throwing danger probe', () => {
    const { audio, scene } = makeScene();
    const ctrl = new BattleMusicController(scene, {
      playersInDanger: () => {
        throw new Error('grid not ready');
      },
    });
    ctrl.create({ act: 'act1', releaseFirst: true });
    expect(audio.releaseMusic).toHaveBeenCalledWith(scene, 0);
    expect(() => ctrl.onPhaseStart('enemy')).not.toThrow();
  });
});
