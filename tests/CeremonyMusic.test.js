import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { CeremonyController } from '../src/ui/CeremonyController.js';
import { bossCardCue, levelUpCue, playCue } from '../src/ui/ceremonyMusic.js';
import { levelUpKind } from '../src/ui/growthContent.js';
import { BOSS_CARD_CUES, STINGER_PRELOAD } from '../src/utils/musicConfig.js';
import { MUSIC_STINGERS } from '../src/utils/musicStingers.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';

const gameData = loadGameData();

function makeAudio() {
  return {
    playSFX: vi.fn(),
    playStinger: vi.fn(async () => ({ stop: vi.fn() })),
    stopStingers: vi.fn(),
    duckMusic: vi.fn(() => true),
  };
}

function makeScene(audio = makeAudio()) {
  const handlers = new Map();
  const listeners = (name) => handlers.get(name) || handlers.set(name, new Set()).get(name);
  return {
    gameData,
    audio,
    textures: { exists: () => false },
    registry: {
      get: (key) =>
        key === 'settings'
          ? { getReduceMotion: () => false, getBattleSpeed: () => 'normal' }
          : key === 'audio'
            ? audio
            : null,
    },
    events: {
      once: (name, fn) => listeners(name).add(fn),
      off: (name, fn) => listeners(name).delete(fn),
      emit: (name) => {
        const fns = [...listeners(name)];
        listeners(name).clear();
        for (const fn of fns) fn();
      },
    },
  };
}

describe('ceremony cue catalogue', () => {
  it('maps every level-up kind to its cue', () => {
    expect(levelUpCue('normal')).toBe('levelup');
    expect(levelUpCue('perfect')).toBe('levelup_perfect');
    expect(levelUpCue('blank')).toBe('levelup_blank');
    expect(levelUpCue('unknown')).toBe('levelup');
    const all = { HP: 1, STR: 1, MAG: 1, SKL: 1, SPD: 1, DEF: 1, RES: 1, LCK: 1 };
    expect(levelUpKind({ gains: all })).toBe('perfect');
    expect(levelUpKind({ gains: { STR: 1 } })).toBe('blank');
    expect(levelUpKind({ gains: { STR: 1, SPD: 1, HP: 1 } })).toBe('normal');
  });

  it('gives every named boss a rendered card cue, and the Entity silence', () => {
    const bossNames = new Set(
      Object.values(gameData.enemies.bosses)
        .flat()
        .map((b) => b.name),
    );
    for (const [name, cue] of Object.entries(BOSS_CARD_CUES)) {
      expect(bossNames.has(name), `${name} is a boss`).toBe(true);
      if (cue === null) continue;
      expect(MUSIC_STINGERS[cue], `${cue} is rendered`).toBeTruthy();
    }
    for (const name of bossNames)
      expect(name in BOSS_CARD_CUES, `${name} has a card cue`).toBe(true);
    expect(bossCardCue('The Entity')).toBeNull();
    expect(bossCardCue('Someone New')).toBe('boss_card');
    expect(MUSIC_STINGERS.boss_card?.keyed).toBe(true);
  });

  it('has every ceremony cue the game asks for', () => {
    const wanted = [
      ...STINGER_PRELOAD,
      'levelup',
      'levelup_perfect',
      'levelup_blank',
      'promotion_gather',
      'promotion_crown',
      'recruit',
      'sealed',
      'deed',
      'arrival',
      'boss_felled',
      'lord_fallen',
      'rewind',
      'eclipse',
      ...['act1', 'act2', 'act3', 'act4', 'finalBoss'].map((a) => `act_card_${a}`),
    ];
    for (const name of wanted) expect(MUSIC_STINGERS[name], name).toBeTruthy();
  });

  it('falls back to the sound effect when there is no stinger system', async () => {
    const audio = { playSFX: vi.fn() };
    const voice = await playCue(makeScene(audio), 'levelup', { fallbackSfx: 'sfx_levelup' });
    expect(voice).toBeNull();
    expect(audio.playSFX).toHaveBeenCalledWith('sfx_levelup');
  });
});

let dom;
beforeEach(() => {
  vi.useFakeTimers();
  dom = installFakeDom(vi);
  _resetInputFocus();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _resetInputFocus();
});

const layers = () => dom.doc.querySelectorAll('.ce-layer');
const pointer = (node) =>
  node.dispatchEvent(new dom.FakeEvent('pointerdown', { button: 0, pointerId: 1 }));

describe('ceremony music', () => {
  it("plays a boss's own motif on its encounter card and fades it when skipped", async () => {
    const scene = makeScene();
    const c = new CeremonyController(scene);
    const done = c.showBossIntro({
      unit: { name: 'Iron Captain', className: 'Cavalier', isBoss: true, faction: 'enemy' },
      actId: 'act1',
    });
    expect(scene.audio.playStinger).toHaveBeenCalledWith('boss_iron_captain', {
      waitMs: 600,
      duck: 0.2,
    });
    expect(scene.audio.duckMusic).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250); // past the skip guard
    pointer(layers()[0]);
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(scene.audio.stopStingers).toHaveBeenCalled();
  });

  it("drains the music for the Entity's card instead of playing a motif", async () => {
    const scene = makeScene();
    const c = new CeremonyController(scene);
    const done = c.showBossIntro({
      unit: { name: 'The Entity', className: 'Entity', isEntity: true, isBoss: true },
      actId: 'finalBoss',
    });
    expect(scene.audio.playStinger).not.toHaveBeenCalled();
    expect(scene.audio.duckMusic).toHaveBeenCalledWith(0.06, expect.any(Object));
    await vi.advanceTimersByTimeAsync(6000);
    await done;
    // and the music comes back when the card is gone
    expect(scene.audio.duckMusic).toHaveBeenLastCalledWith(1, expect.any(Object));
  });

  it('cues the act title card in its own act', () => {
    const scene = makeScene();
    new CeremonyController(scene).showActCard({ actId: 'act3' });
    expect(scene.audio.playStinger).toHaveBeenCalledWith('act_card_act3', expect.any(Object));
  });

  it('cues the vanquished and reinforcement bands', () => {
    const scene = makeScene();
    const c = new CeremonyController(scene);
    c.showBossFelled({ objective: 'rout', remaining: 3 });
    c.showArrival({ count: 3 });
    const names = scene.audio.playStinger.mock.calls.map(([name]) => name);
    expect(names).toContain('boss_felled');
    expect(names).toContain('arrival');
  });
});
