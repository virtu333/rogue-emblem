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

  it('plays the pursuit theme on escape maps, on its calm layer first', () => {
    const { audio, scene } = makeScene();
    const ctrl = new BattleMusicController(scene, { playersInDanger: () => false });
    const key = ctrl.create({ act: 'act3', objective: 'escape' });
    expect(key).toBe(MUSIC.escape);
    expect(MUSIC_LAYERS[key]).toBeTruthy();
    expect(audio.setMusicIntensity).toHaveBeenCalledWith('calm', 0);
    // a boss on an escape map still gets its own theme
    expect(ctrl.create({ act: 'act3', isBoss: true, objective: 'escape' })).toBe(MUSIC.boss.act3);
    // other objectives use the act pool
    expect(MUSIC.battle.act3).toContain(ctrl.create({ act: 'act3', objective: 'seize' }));
  });

  it("layers a boss theme with that boss's enrage layer and crossfades to it on enrage", () => {
    const { audio, scene } = makeScene();
    const ctrl = new BattleMusicController(scene, { bossEnraged: () => false });
    const key = ctrl.create({ act: 'act1', isBoss: true, bossName: 'Iron Captain' });
    expect(key).toBe(MUSIC.boss.act1);
    expect(audio.playMusic).toHaveBeenCalledWith(key, scene, 800, {
      layers: { enrage: 'music_boss_act1_enrage_iron_captain' },
    });
    expect(audio.setMusicIntensity).toHaveBeenLastCalledWith('full', 0);
    expect(ctrl.onBossEnrage()).toBe(true);
    expect(audio.setMusicIntensity).toHaveBeenLastCalledWith('enrage', expect.any(Number));
    audio.setMusicIntensity.mockClear();
    expect(ctrl.onBossEnrage()).toBe(false); // once
    expect(audio.setMusicIntensity).not.toHaveBeenCalled();
  });

  it('opens a resumed, already-enraged boss battle on the enrage layer', () => {
    const { audio, scene } = makeScene();
    const ctrl = new BattleMusicController(scene, { bossEnraged: () => true });
    ctrl.create({ act: 'act3', isBoss: true, bossName: 'Blade Lord' });
    expect(audio.setMusicIntensity).toHaveBeenCalledWith('enrage', 0);
  });

  it('catches up at the next phase when the enrage came without the hook', () => {
    const { audio, scene } = makeScene();
    let enraged = false;
    const ctrl = new BattleMusicController(scene, { bossEnraged: () => enraged });
    ctrl.create({ act: 'act2', isBoss: true, bossName: 'Archmage' });
    enraged = true;
    ctrl.onPhaseStart('enemy');
    expect(audio.setMusicIntensity).toHaveBeenLastCalledWith('enrage', expect.any(Number));
  });

  it('gives the story bosses their enrage layers on their own themes', () => {
    const { audio, scene } = makeScene();
    const ctrl = new BattleMusicController(scene);
    for (const [name, act] of [
      ['The Emperor', 'act4'],
      ['The Lieutenant', 'finalBoss'],
      ['The Entity', 'finalBoss'],
    ]) {
      const key = ctrl.create({ act, isBoss: true, bossName: name });
      expect(audio.playMusic).toHaveBeenLastCalledWith(key, scene, 800, {
        layers: { enrage: expect.stringMatching(new RegExp(`^${key}_enrage_`)) },
      });
    }
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
