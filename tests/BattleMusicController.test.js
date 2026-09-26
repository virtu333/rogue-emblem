import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import BattleMusicController, { entityHumGain } from '../src/ui/BattleMusicController.js';
import { entityHealth } from '../src/engine/EntitySystem.js';
import { ENTITY_FINALE, MUSIC, MUSIC_LAYERS } from '../src/utils/musicConfig.js';
import { MUSIC_STINGERS } from '../src/utils/musicStingers.js';

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

// ---------------------------------------------------------------- the Entity's finale

function makeEntityScene() {
  const audio = {
    currentMusicKey: null,
    playMusic: vi.fn(async (key) => {
      audio.currentMusicKey = key;
    }),
    stopMusic: vi.fn(() => {
      audio.currentMusicKey = null;
      return true;
    }),
    releaseMusic: vi.fn(),
    setMusicIntensity: vi.fn(),
    setMusicLayerGain: vi.fn(() => true),
    preloadMusic: vi.fn(),
    preloadStingers: vi.fn(),
    playStinger: vi.fn(async () => ({ startTime: 12.5, stop: vi.fn() })),
    audioTime: vi.fn(() => 13),
  };
  const entity = { isEntity: true, isBoss: true, stats: { HP: 80 }, currentHP: 80 };
  let enraged = false;
  const scene = { registry: { get: (k) => (k === 'audio' ? audio : null) } };
  const onFinale = vi.fn();
  const ctrl = new BattleMusicController(scene, {
    bossEnraged: () => enraged,
    entityHealth: () => entityHealth([{ isBoss: false }, entity]),
    onFinale,
  });
  return {
    audio,
    entity,
    scene,
    ctrl,
    onFinale,
    enrage: () => {
      enraged = true;
    },
  };
}

const startEntity = (ctrl) =>
  ctrl.create({ act: 'finalBoss', isBoss: true, bossName: 'The Entity' });

describe("BattleMusicController — the Entity's finale", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('plays the Entity theme alone and readies the finale, the hum and the hinge', () => {
    const { audio, scene, ctrl } = makeEntityScene();
    expect(startEntity(ctrl)).toBe(ENTITY_FINALE.theme);
    expect(audio.playMusic).toHaveBeenCalledWith(ENTITY_FINALE.theme, scene, 800);
    expect(audio.preloadMusic).toHaveBeenCalledWith(
      [ENTITY_FINALE.track, ENTITY_FINALE.hum],
      scene,
    );
    expect(audio.preloadStingers).toHaveBeenCalledWith([ENTITY_FINALE.hinge]);
    expect(ctrl.entityStage).toBe('theme');
  });

  it('keeps the theme while the Entity is unhurt', () => {
    const { audio, ctrl } = makeEntityScene();
    startEntity(ctrl);
    ctrl.onCombatResolved(); // a miss
    ctrl.onPhaseStart('enemy');
    expect(audio.stopMusic).not.toHaveBeenCalled();
    expect(ctrl.entityStage).toBe('theme');
  });

  it('the first wound: the theme stops dead, a silence, the violin, then the finale on its downbeat', async () => {
    const { audio, entity, scene, ctrl } = makeEntityScene();
    startEntity(ctrl);
    audio.playMusic.mockClear();
    entity.currentHP = 60;
    ctrl.onCombatResolved();
    expect(audio.stopMusic).toHaveBeenCalledWith(scene, ENTITY_FINALE.cutMs, true);
    expect(ctrl.entityStage).toBe('hinge');
    // the silence
    await vi.advanceTimersByTimeAsync(ENTITY_FINALE.silenceMs - 10);
    expect(audio.playStinger).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(audio.playStinger).toHaveBeenCalledWith(
      ENTITY_FINALE.hinge,
      expect.objectContaining({ duck: 1 }),
    );
    // the answer, sample-aligned to the cue's handoff
    expect(audio.playMusic).toHaveBeenCalledWith(ENTITY_FINALE.track, scene, 0, {
      layers: { hum: ENTITY_FINALE.hum },
      layerGains: { hum: 0.75 },
      startAt: 12.5 + MUSIC_STINGERS[ENTITY_FINALE.hinge].handoff,
    });
    expect(ctrl.entityStage).toBe('finale');
    // later wounds do not restart it; the hum follows the HP
    audio.stopMusic.mockClear();
    entity.currentHP = 20;
    ctrl.onCombatResolved();
    expect(audio.stopMusic).not.toHaveBeenCalled();
    expect(audio.setMusicLayerGain).toHaveBeenLastCalledWith('hum', 0.25, expect.any(Number));
    entity.currentHP = 0;
    ctrl.onPhaseStart('enemy');
    expect(audio.setMusicLayerGain).toHaveBeenLastCalledWith('hum', 0, expect.any(Number));
  });

  it('tells the allies when the answer lands, on the audio clock', async () => {
    const { entity, ctrl, onFinale } = makeEntityScene();
    startEntity(ctrl);
    entity.currentHP = 50;
    ctrl.onCombatResolved();
    expect(onFinale).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(ENTITY_FINALE.silenceMs + 10);
    const handoff = MUSIC_STINGERS[ENTITY_FINALE.hinge].handoff;
    expect(onFinale).toHaveBeenCalledTimes(1);
    const beat = onFinale.mock.calls[0][0];
    // the cue started at 12.5 s, the clock reads 13 s: the downbeat is handoff - 0.5 s away
    expect(beat.leadMs).toBeCloseTo((12.5 + handoff - 13) * 1000, 3);
    expect(beat.barMs).toBeCloseTo((handoff / 2) * 1000, 3);
  });

  it('a resumed finale does not replay the rally', () => {
    const { entity, ctrl, onFinale } = makeEntityScene();
    entity.currentHP = 30;
    startEntity(ctrl);
    expect(onFinale).not.toHaveBeenCalled();
  });

  it('turn pressure starts the finale when nobody has wounded the Entity yet', async () => {
    const { audio, ctrl, enrage } = makeEntityScene();
    startEntity(ctrl);
    enrage();
    expect(ctrl.onBossEnrage()).toBe(true);
    expect(audio.stopMusic).toHaveBeenCalled();
    expect(audio.setMusicIntensity).not.toHaveBeenCalledWith('enrage', expect.anything());
    await vi.advanceTimersByTimeAsync(ENTITY_FINALE.silenceMs + 10);
    expect(audio.playMusic).toHaveBeenLastCalledWith(
      ENTITY_FINALE.track,
      expect.anything(),
      0,
      expect.objectContaining({ layerGains: { hum: 1 } }),
    );
    expect(ctrl.onBossEnrage()).toBe(false); // once
  });

  it('catches an enrage that came without the hook at the next phase', () => {
    const { audio, ctrl, enrage } = makeEntityScene();
    startEntity(ctrl);
    enrage();
    ctrl.onPhaseStart('player');
    expect(audio.stopMusic).toHaveBeenCalledTimes(1);
    expect(ctrl.entityStage).toBe('hinge');
  });

  it('starts the finale without the hinge when the cue cannot play', async () => {
    const { audio, scene, ctrl, entity } = makeEntityScene();
    audio.playStinger.mockResolvedValue(null);
    startEntity(ctrl);
    entity.currentHP = 79;
    ctrl.onCombatResolved();
    await vi.advanceTimersByTimeAsync(ENTITY_FINALE.silenceMs + 10);
    expect(audio.playMusic).toHaveBeenLastCalledWith(
      ENTITY_FINALE.track,
      scene,
      0,
      expect.objectContaining({ startAt: null }),
    );
  });

  it('opens a resumed battle with a wounded Entity straight on the finale', () => {
    const { audio, entity, scene, ctrl } = makeEntityScene();
    entity.currentHP = 40;
    expect(startEntity(ctrl)).toBe(ENTITY_FINALE.track);
    expect(audio.stopMusic).not.toHaveBeenCalled();
    expect(audio.playStinger).not.toHaveBeenCalled();
    expect(audio.playMusic).toHaveBeenCalledTimes(1);
    expect(audio.playMusic).toHaveBeenCalledWith(ENTITY_FINALE.track, scene, 800, {
      layers: { hum: ENTITY_FINALE.hum },
      layerGains: { hum: 0.5 },
      startAt: null,
    });
  });

  it('stays out of the way if the battle ended during the silence', async () => {
    const { audio, entity, ctrl } = makeEntityScene();
    startEntity(ctrl);
    entity.currentHP = 10;
    ctrl.onCombatResolved();
    // a victory theme took the music (and the Entity fell)
    entity.currentHP = 0;
    audio.currentMusicKey = 'music_run_win';
    await vi.advanceTimersByTimeAsync(ENTITY_FINALE.silenceMs + 10);
    expect(audio.playStinger).not.toHaveBeenCalled();
    expect(audio.playMusic).not.toHaveBeenCalledWith(
      ENTITY_FINALE.track,
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('stops the hinge if the battle ends while the violin plays', async () => {
    const { audio, entity, ctrl } = makeEntityScene();
    const voice = { startTime: 3, stop: vi.fn() };
    let finish;
    audio.playStinger.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(voice);
        }),
    );
    startEntity(ctrl);
    entity.currentHP = 70;
    ctrl.onCombatResolved();
    await vi.advanceTimersByTimeAsync(ENTITY_FINALE.silenceMs + 10);
    audio.currentMusicKey = 'music_defeat';
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(voice.stop).toHaveBeenCalled();
    expect(audio.playMusic).not.toHaveBeenCalledWith(
      ENTITY_FINALE.track,
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('destroy() cancels a pending hinge', async () => {
    const { audio, entity, ctrl } = makeEntityScene();
    startEntity(ctrl);
    entity.currentHP = 70;
    ctrl.onCombatResolved();
    ctrl.destroy();
    await vi.advanceTimersByTimeAsync(ENTITY_FINALE.silenceMs + 10);
    expect(audio.playStinger).not.toHaveBeenCalled();
  });

  it('other bosses never enter the finale', () => {
    const { audio, entity, ctrl } = makeEntityScene();
    ctrl.create({ act: 'act4', isBoss: true, bossName: 'The Emperor' });
    entity.currentHP = 1;
    ctrl.onCombatResolved();
    expect(ctrl.entityStage).toBeNull();
    expect(audio.stopMusic).not.toHaveBeenCalled();
  });

  it('maps HP to the hum level and reads the Entity among the enemies', () => {
    expect(entityHumGain(1)).toBe(1);
    expect(entityHumGain(0.3)).toBeCloseTo(0.3);
    expect(entityHumGain(-1)).toBe(0);
    expect(entityHumGain(NaN)).toBe(1);
    expect(entityHealth([{ stats: { HP: 10 }, currentHP: 3 }])).toBeNull();
    expect(entityHealth([{ isEntity: true, stats: { HP: 50 }, currentHP: 60 }])).toEqual({
      current: 50,
      max: 50,
      ratio: 1,
    });
    expect(entityHealth([{ isEntity: true, stats: {}, currentHP: 5 }])).toBeNull();
    expect(entityHealth(null)).toBeNull();
  });
});
