// The coded sound effects (tools/sfx/build.py) and how the game reaches them.
//
// Ways this can fail, a test (or a group) each:
//   1. a key in the catalog has no file, a stale copy in public/, or no hashed manifest entry
//      (the packaged game asks for a URL that 404s; Phaser drops the sound silently);
//   2. a generator cue is never registered, or a shipped file belongs to no list (dead bytes);
//   3. a fallback points at a cue that is itself deferred or missing (the fallback never plays);
//   4. a menu cue is loaded at boot (blocks the boot screen) or never queued for the warm-up;
//   5. playSFX plays nothing (or throws) for a cue still warming, instead of its fallback;
//   6. a menu whoosh doubles the press's own confirm or cancel, or plays both open and close;
//   7. a hook plays the wrong key (the miss, a zero-damage blow, the phase bell, the stone, the
//      steal, a menu, a reference page) or plays nothing at all;
//   8. a sound hook draws on Math.random (the battle stream).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/main.js', () => ({ cloudState: null }));

import {
  ALL_SFX,
  COMBAT_SFX,
  ESSENTIAL_SFX,
  SFX_FALLBACKS,
  SOFT_SFX,
  SOFT_SFX_YIELD_MS,
  UI_SFX,
  resolveSfxKey,
  strikeContactSfx,
} from '../src/utils/sfxConfig.js';
import { AudioManager } from '../src/utils/AudioManager.js';
import { audioAssetUrl } from '../src/utils/audioAssets.js';
import { BootScene } from '../src/scenes/BootScene.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import RevivalStoneController from '../src/ui/RevivalStoneController.js';
import { AbilityTargetingController } from '../src/ui/AbilityTargetingController.js';
import { MenuSurface } from '../src/ui/MenuSurface.js';
import { ReferenceMenu } from '../src/ui/ReferenceMenu.js';
import { installFakeDom } from './helpers/fakeDom.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const manifest = JSON.parse(readFileSync(join(ROOT, 'src/utils/AudioAssetManifest.json'), 'utf8'));
const NEW_CUES = [
  'sfx_miss',
  'sfx_nodamage',
  'sfx_shatter',
  'sfx_purchase',
  'sfx_equip',
  'sfx_menu_open',
  'sfx_menu_close',
  'sfx_steal',
  'sfx_turn',
  'sfx_chime',
  'sfx_loot',
  'sfx_page',
  'sfx_ward_break',
  'sfx_hammerfall',
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete globalThis.__emblemRogueStartupFlags;
});

describe('the SFX catalog and its files', () => {
  it('lists each key once, in one list', () => {
    expect(new Set(ALL_SFX).size).toBe(ALL_SFX.length);
    expect(ALL_SFX.length).toBe(ESSENTIAL_SFX.length + COMBAT_SFX.length + UI_SFX.length);
    for (const key of NEW_CUES) expect(ALL_SFX).toContain(key);
  });

  it.each(ALL_SFX)('%s ships in assets/, public/ and the hashed manifest', (key) => {
    const source = join(ROOT, 'assets/audio/sfx', `${key}.mp3`);
    const copy = join(ROOT, 'public/assets/audio/sfx', `${key}.mp3`);
    expect(existsSync(source), source).toBe(true);
    expect(existsSync(copy), `${copy} (npm run sync-assets)`).toBe(true);
    expect(sha256(copy)).toBe(sha256(source));
    const entry = manifest.entries[key];
    expect(entry, `${key} missing from the audio manifest (npm run build:audio)`).toBeTruthy();
    expect(entry.sha256).toBe(sha256(source));
    expect(entry.url).toBe(`assets/audio/versioned/sfx/${key}-${entry.sha256}.mp3`);
    expect(audioAssetUrl(key)).toContain(entry.sha256);
  });

  it('ships no sound effect that belongs to no list', () => {
    const shipped = readdirSync(join(ROOT, 'assets/audio/sfx'))
      .filter((name) => name.endsWith('.mp3'))
      .map((name) => name.slice(0, -4));
    expect(shipped.filter((key) => !ALL_SFX.includes(key))).toEqual([]);
  });

  it('registers every cue the generator writes, and the generator writes every coded cue', () => {
    const source = readFileSync(join(ROOT, 'tools/sfx/build.py'), 'utf8');
    const generated = [...source.matchAll(/^def (sfx_\w+)\(\):/gm)].map((m) => m[1]);
    expect(generated.sort()).toEqual([...NEW_CUES].sort());
  });

  it('keeps the coded cues short and small (the boot budget and the app download)', () => {
    for (const key of NEW_CUES) {
      const bytes = readFileSync(join(ROOT, 'assets/audio/sfx', `${key}.mp3`)).length;
      expect(bytes, key).toBeLessThan(12 * 1024);
    }
  });
});

describe('fallbacks and loading', () => {
  it('falls back only to a cue the boot loads with the battle sounds or before', () => {
    for (const [key, fallback] of Object.entries(SFX_FALLBACKS)) {
      expect(ALL_SFX, key).toContain(key);
      expect([...ESSENTIAL_SFX, ...COMBAT_SFX], `${key} -> ${fallback}`).toContain(fallback);
      expect(SFX_FALLBACKS[fallback], `${fallback} must not chain`).toBeUndefined();
    }
    for (const key of SOFT_SFX) {
      expect(UI_SFX).toContain(key);
      expect(SFX_FALLBACKS[key], 'a whoosh never stands in as another sound').toBeUndefined();
    }
  });

  it('resolves a missing cue to its fallback, else to silence', () => {
    const has = (loaded) => (key) => loaded.includes(key);
    expect(resolveSfxKey('sfx_purchase', has(['sfx_purchase', 'sfx_gold']))).toBe('sfx_purchase');
    expect(resolveSfxKey('sfx_purchase', has(['sfx_gold']))).toBe('sfx_gold');
    expect(resolveSfxKey('sfx_purchase', has([]))).toBeNull();
    expect(resolveSfxKey('sfx_miss', has(['sfx_hit']))).toBeNull();
  });

  function bootLoads({ reducedPreload }) {
    globalThis.__emblemRogueStartupFlags = { reducedPreload, mobileSafeBoot: reducedPreload };
    const scene = Object.create(BootScene.prototype);
    const loaded = [];
    scene.load = {
      on() {},
      once() {},
      image() {},
      atlas() {},
      audio: (key, urls) => loaded.push({ key, urls: [].concat(urls) }),
    };
    scene.events = { once() {} };
    scene.textures = { exists: () => false };
    scene._installPreloadStallWatch = () => {};
    scene.preload();
    const sfx = (list) => list.filter((a) => a.key.startsWith('sfx_'));
    return {
      boot: sfx(loaded).map((a) => a.key),
      deferred: sfx(scene._deferredAssets.filter((a) => a.type === 'audio')),
      groups: scene._deferredAssetGroups,
    };
  }

  it('never loads the menu cues at boot; the warm-up queue holds each at its hashed URL', () => {
    for (const reducedPreload of [false, true]) {
      const { boot, deferred, groups } = bootLoads({ reducedPreload });
      for (const key of UI_SFX) expect(boot, key).not.toContain(key);
      for (const key of UI_SFX)
        expect(deferred.find((a) => a.key === key)).toEqual({
          type: 'audio',
          key,
          src: [audioAssetUrl(key)],
          group: 'ui_sfx',
        });
      expect(groups).toContain('ui_sfx');
      for (const key of ESSENTIAL_SFX) expect(boot).toContain(key);
      for (const key of COMBAT_SFX)
        if (reducedPreload) expect(deferred.map((a) => a.key)).toContain(key);
        else expect(boot).toContain(key);
    }
  });
});

function makeAudio(loadedKeys = ALL_SFX) {
  const loaded = new Set(loadedKeys);
  const sound = {
    sounds: [],
    play: vi.fn(),
    get: () => null,
    once() {},
    game: { cache: { audio: { has: (key) => loaded.has(key) } } },
  };
  return { audio: new AudioManager(sound), played: () => sound.play.mock.calls.map((c) => c[0]) };
}
const flush = () => new Promise((done) => setTimeout(done, 0));

describe('AudioManager.playSFX', () => {
  it('plays the cue at the sound-effect volume, its fallback while it warms, else nothing', () => {
    const ready = makeAudio();
    ready.audio.setSFXVolume(1);
    ready.audio.playSFX('sfx_purchase');
    expect(ready.played()).toEqual(['sfx_purchase']);
    const muted = makeAudio();
    muted.audio.setSFXVolume(0);
    muted.audio.playSFX('sfx_purchase');
    expect(muted.audio.sound.play).toHaveBeenCalledWith('sfx_purchase', { volume: 0 });
    const warming = makeAudio(ESSENTIAL_SFX);
    warming.audio.playSFX('sfx_purchase');
    warming.audio.playSFX('sfx_turn'); // no fallback: silent, as the phase banner was
    expect(warming.played()).toEqual(['sfx_gold']);
  });

  it('a menu whoosh waits for the press and gives way to its confirm, in either order', async () => {
    const { audio, played } = makeAudio();
    audio.playSFX('sfx_menu_open');
    expect(played()).toEqual([]); // not yet: the press's other handlers come first
    await flush();
    expect(played()).toEqual(['sfx_menu_open']);

    const after = makeAudio();
    after.audio.playSFX('sfx_menu_open');
    after.audio.playSFX('sfx_confirm');
    await flush();
    expect(after.played()).toEqual(['sfx_confirm']);

    const before = makeAudio();
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    before.audio.playSFX('sfx_cancel');
    clock.mockReturnValue(1000 + SOFT_SFX_YIELD_MS - 10);
    before.audio.playSFX('sfx_menu_close');
    await flush();
    expect(before.played()).toEqual(['sfx_cancel']);
    clock.mockReturnValue(1000 + SOFT_SFX_YIELD_MS * 3);
    before.audio.playSFX('sfx_menu_close');
    await flush();
    expect(before.played()).toEqual(['sfx_cancel', 'sfx_menu_close']);
  });

  it('of a menu closing and another opening on one press, only the opening is heard', async () => {
    for (const order of [
      ['sfx_menu_close', 'sfx_menu_open'],
      ['sfx_menu_open', 'sfx_menu_close'],
    ]) {
      const { audio, played } = makeAudio();
      for (const key of order) audio.playSFX(key);
      await flush();
      expect(played()).toEqual(['sfx_menu_open']);
    }
  });
});

describe('strike sounds', () => {
  it('a blow that lands for nothing clanks; a critical and a hit keep their sounds', () => {
    expect(strikeContactSfx({ miss: false, damage: 0, isCrit: false })).toBe('sfx_nodamage');
    expect(strikeContactSfx({ miss: false, damage: 0, isCrit: true })).toBe('sfx_nodamage');
    expect(strikeContactSfx({ miss: false, damage: 7, isCrit: false })).toBe('sfx_hit');
    expect(strikeContactSfx({ miss: false, damage: 21, isCrit: true })).toBe('sfx_crit');
    // A blow that broke a stone or met the banner did its damage; it lands.
    expect(strikeContactSfx({ damage: 0, stoneBroken: true })).toBe('sfx_hit');
    expect(strikeContactSfx({ miss: true, damage: 0 })).toBeNull();
  });

  function strikeScene() {
    const scene = Object.create(BattleScene.prototype);
    const strikeSounds = [];
    Object.assign(scene, {
      _battleSession: 1,
      gameData: { skills: [] },
      registry: { get: (key) => (key === 'audio' ? { playSFX: vi.fn() } : null) },
      _reduceMotion: () => true,
      _getWeaponArtCatalog: () => [],
      _procBanner: { showStrikeProcChips() {}, showCutIn: async () => {} },
      _combatFx: { playStrikeSound: (key) => strikeSounds.push(key) },
      // The choreography's contract: the swing's sound, then a miss or the contact.
      _combatChoreo: {
        playStrike: async (s) => {
          s.onStrikeSound();
          if (s.event.miss) s.onMiss();
          else s.onContact();
        },
      },
      _showStrikeMiss: vi.fn(),
      _showStrikeResult: vi.fn(),
      _battleBeats: { onCritStrike() {} },
    });
    return { scene, strikeSounds };
  }
  const striker = {
    name: 'Edric',
    faction: 'player',
    weapon: { type: 'Sword', name: 'Iron Sword' },
  };
  const target = { name: 'Brigand', faction: 'enemy' };
  const strike = (fields) => ({ attackerSide: 'attacker', skillActivations: [], ...fields });

  it.each([
    ['a miss whooshes past (no weapon swing, no hit)', { miss: true, damage: 0 }, ['sfx_miss']],
    [
      'a zero-damage blow swings and clanks',
      { miss: false, damage: 0 },
      ['sfx_sword', 'sfx_nodamage'],
    ],
    ['a hit swings and lands', { miss: false, damage: 6 }, ['sfx_sword', 'sfx_hit']],
  ])('%s', async (_label, fields, expected) => {
    const { scene, strikeSounds } = strikeScene();
    const random = vi.spyOn(Math, 'random');
    await scene.animateStrike(strike(fields), striker, target);
    expect(strikeSounds).toEqual(expected);
    expect(random).not.toHaveBeenCalled();
  });

  it('every phase banner rings the phase bell', () => {
    const scene = Object.create(BattleScene.prototype);
    const playSFX = vi.fn();
    const text = {
      setOrigin: () => text,
      setAlpha: () => text,
      setDepth: () => text,
      destroy() {},
    };
    Object.assign(scene, {
      registry: { get: (key) => (key === 'audio' ? { playSFX } : null) },
      cameras: { main: { centerX: 320, centerY: 240, width: 640 } },
      add: { text: () => text },
      _pinToScreen() {},
      _reduceMotion: () => true,
      time: { delayedCall() {} },
    });
    scene.showPhaseBanner('player', 2);
    scene.showPhaseBanner('enemy', 2);
    expect(playSFX.mock.calls).toEqual([['sfx_turn'], ['sfx_turn']]);
  });
});

describe('ability and stone sounds', () => {
  it('a broken Revival Stone shatters under its sealed cue (no second fallback sound)', () => {
    const playSFX = vi.fn();
    const playStinger = vi.fn(() => Promise.resolve(null));
    const scene = {
      registry: { get: (key) => (key === 'audio' ? { playSFX, playStinger } : null) },
      updateAffixPips() {},
      updateHPBar() {},
      _reduceMotion: () => true,
      grid: { gridToPixel: () => ({ x: 0, y: 0 }) },
      showMinorHintAt() {},
    };
    new RevivalStoneController(scene).create().playBreak({ col: 1, row: 1, isBoss: false });
    expect(playSFX.mock.calls).toEqual([['sfx_shatter']]);
    expect(playStinger).toHaveBeenCalledWith(
      'sealed',
      expect.not.objectContaining({ fallbackSfx: expect.anything() }),
    );
  });

  it('a steal swipes and jingles', () => {
    const playSFX = vi.fn();
    const scene = {
      registry: { get: (key) => (key === 'audio' ? { playSFX } : null) },
      updateAffixPips() {},
      grid: { gridToPixel: () => ({ x: 0, y: 0 }) },
      showMinorHintAt() {},
    };
    new AbilityTargetingController({ scene })._presentSteal({
      thief: { col: 0, row: 0 },
      carrier: { col: 1, row: 0 },
      item: { name: 'Vulnerary' },
      destination: 'bag',
    });
    expect(playSFX.mock.calls).toEqual([['sfx_steal']]);
  });
});

describe('menus and pages', () => {
  function domScene() {
    installFakeDom(vi);
    const playSFX = vi.fn();
    const handlers = {};
    const scene = {
      registry: { get: (key) => (key === 'audio' ? { playSFX } : null) },
      events: {
        once: (name, fn) => (handlers[name] = fn),
        off: (name) => delete handlers[name],
      },
    };
    return { scene, playSFX, shutdown: () => handlers.shutdown?.() };
  }

  it('a menu whooshes open and closed; a story line or progress note does not', () => {
    const { scene, playSFX } = domScene();
    const menu = new MenuSurface(scene, 'Shop', () => {});
    expect(playSFX.mock.calls).toEqual([['sfx_menu_open']]);
    menu.destroy();
    menu.destroy(); // twice is still one close
    expect(playSFX.mock.calls).toEqual([['sfx_menu_open'], ['sfx_menu_close']]);
    playSFX.mockClear();
    new MenuSurface(scene, 'Story', () => {}, { sound: false }).destroy();
    expect(playSFX).not.toHaveBeenCalled();
  });

  it('a menu torn down with its scene closes silently', () => {
    const { scene, playSFX, shutdown } = domScene();
    new MenuSurface(scene, 'Church', () => {});
    playSFX.mockClear();
    shutdown();
    expect(playSFX).not.toHaveBeenCalled();
  });

  it('a reference page turns with a flick: a new category or entry, never the one open', () => {
    const { scene, playSFX } = domScene();
    const entries = [
      { name: 'Par', lines: ['Target turns.'] },
      { name: 'Fog', lines: ['Sight.'] },
    ];
    const menu = new ReferenceMenu(
      scene,
      'Help',
      [{ label: 'Rules' }, { label: 'Meta' }],
      () => entries,
      () => {},
    );
    const pages = () => playSFX.mock.calls.filter(([key]) => key === 'sfx_page').length;
    const buttons = () => menu.surface.body.querySelectorAll('button');
    const byFocus = (id) => buttons().find((b) => b.dataset.focus === id);
    byFocus('tab-0').onclick(); // already open
    expect(pages()).toBe(0);
    byFocus('tab-1').onclick();
    expect(pages()).toBe(1);
    byFocus('entry-1').onclick();
    expect(pages()).toBe(2);
    byFocus('entry-1').onclick(); // already shown
    expect(pages()).toBe(2);
    menu.changeTab(1);
    expect(pages()).toBe(3);
  });
});
