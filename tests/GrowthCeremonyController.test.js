import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import dialogue from '../data/dialogue.json';
import {
  GrowthCeremonyController,
  growthCeremonies,
  figureSize,
  spriteScale,
} from '../src/ui/GrowthCeremonyController.js';
import { CeremonyController } from '../src/ui/CeremonyController.js';
import { promotionPathContent } from '../src/ui/growthContent.js';
import { _resetInputFocus, activeInputOwner, dispatchInputAction } from '../src/utils/inputFocus.js'; // prettier-ignore
import { hasOpenOverlay, cancelTopOverlay } from '../src/utils/overlayStack.js';
import { InputAction } from '../src/utils/InputActions.js';
import { DOM_UI_DEPTHS } from '../src/utils/uiDepths.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';

const gameData = { ...loadGameData(), dialogue };
const cls = (name) => gameData.classes.find((c) => c.name === name);

function makeScene({ reduceMotion = false, speed = 'normal', battle = false } = {}) {
  const handlers = new Map();
  const listeners = (name) => handlers.get(name) || handlers.set(name, new Set()).get(name);
  const audio = { playSFX: vi.fn() };
  const scene = {
    gameData,
    textures: { exists: () => false },
    registry: {
      get: (key) =>
        key === 'settings'
          ? { getReduceMotion: () => reduceMotion, getBattleSpeed: () => speed }
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
    audio,
  };
  if (battle) {
    scene._getCeremonies = () => (scene._ceremonies ||= new CeremonyController(scene));
    scene._playLevelUpSfx = vi.fn();
    scene._stopLevelUpSfx = vi.fn();
  }
  return scene;
}

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

function promotedMyrmidon(target = 'Duelist') {
  const unit = createRecruitUnit({ name: 'Ilse', level: 10 }, cls('Myrmidon'), gameData.weapons);
  unit.level = 10;
  const content = promotionPathContent(unit, cls(target), gameData);
  const before = { ...unit, stats: { ...unit.stats } };
  unit.className = target;
  unit.tier = 'promoted';
  return { unit, content, before };
}

describe('promotion rite', () => {
  it('stages the class change over its frame and dismisses in two presses', async () => {
    const scene = makeScene({ battle: true });
    const growth = new GrowthCeremonyController(scene);
    const { unit, content, before } = promotedMyrmidon();
    let settled = false;
    const done = growth
      .showPromotionRite({ unit, content, beforeUnit: before })
      .then(() => (settled = true));
    const rite = layers()[0];
    expect(rite.classList.contains('gr-rite-layer')).toBe(true);
    expect(rite.getAttribute('role')).toBe('dialog');
    expect(rite.getAttribute('aria-label')).toBe('Promotion');
    expect(rite.style.zIndex).toBe(String(DOM_UI_DEPTHS.RITE));
    expect(rite.querySelector('.gr-name--from').textContent).toBe('Myrmidon');
    expect(rite.querySelector('.gr-name--to').textContent).toBe('Duelist');
    expect(rite.querySelectorAll('.re-crest')).toHaveLength(2);
    expect(rite.querySelectorAll('.gr-stat')).toHaveLength(content.stats.length);
    const seals = rite.querySelectorAll('.gr-seal');
    expect(seals.length).toBe(2 + content.skills.length); // Sword P→M, new Lance, skills
    // Skill glyphs are a placeholder hook for the icon study.
    for (const glyph of rite.querySelectorAll('.gr-glyph--skill'))
      expect(glyph.dataset.glyphHook).toBe('skill-icon');
    expect(rite.querySelectorAll('.gr-glyph--weapon')).toHaveLength(2);
    // The battle's story input is held (rail inert, grid ignored) while it shows.
    expect(scene._ceremonies.isBlocking()).toBe(true);
    expect(scene._playLevelUpSfx).toHaveBeenCalledTimes(1);
    expect(hasOpenOverlay(scene)).toBe(true);
    const button = rite.querySelector('.gr-continue');
    expect(button.getAttribute('aria-label')).toBe('Skip');
    vi.advanceTimersByTime(250);
    pointer(rite); // first press: the end state at once
    expect(rite.classList.contains('is-static')).toBe(true);
    expect(rite.classList.contains('is-done')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Continue');
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);
    pointer(rite); // second press: continue
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    // Released at once for assistive tech and input, faded out after.
    expect(rite.getAttribute('role')).toBeNull();
    expect(scene._ceremonies.isBlocking()).toBe(false);
    expect(activeInputOwner()).toBeNull();
    expect(hasOpenOverlay(scene)).toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect(layers()).toHaveLength(0);
    expect(scene._stopLevelUpSfx).toHaveBeenCalledTimes(1);
    expect(dom.win.listenerCount('keydown')).toBe(0);
  });

  it('reveals by itself at normal speed; Instant and reduced motion open revealed', async () => {
    const { unit, content, before } = promotedMyrmidon('Swordmaster');
    const normal = new GrowthCeremonyController(makeScene());
    void normal.showPromotionRite({ unit, content, beforeUnit: before });
    expect(layers()[0].classList.contains('is-done')).toBe(false);
    await vi.advanceTimersByTimeAsync(6000);
    expect(layers()[0].classList.contains('is-done')).toBe(true);
    normal.destroy();
    for (const prefs of [{ speed: 'instant' }, { reduceMotion: true }]) {
      const g = new GrowthCeremonyController(makeScene(prefs));
      void g.showPromotionRite({ unit, content, beforeUnit: before });
      const rite = layers()[0];
      expect(rite.classList.contains('is-static')).toBe(true);
      expect(rite.classList.contains('is-done')).toBe(true);
      g.destroy();
    }
  });

  it.each([
    ['Enter', () => dom.key('Enter')],
    ['Escape', () => dom.key('Escape')],
    ['gamepad confirm', () => dispatchInputAction(InputAction.CONFIRM)],
    ['rail Back / pad B', (scene) => cancelTopOverlay(scene)],
  ])('%s drives both stages', async (_label, press) => {
    const scene = makeScene();
    const growth = new GrowthCeremonyController(scene);
    const { unit, content, before } = promotedMyrmidon();
    let settled = false;
    void growth.showPromotionRite({ unit, content, beforeUnit: before }).then(() => (settled = true)); // prettier-ignore
    press(scene); // inside the accidental-tap guard: ignored
    expect(layers()[0].classList.contains('is-done')).toBe(false);
    vi.advanceTimersByTime(250);
    press(scene);
    expect(layers()[0].classList.contains('is-done')).toBe(true);
    press(scene);
    await vi.advanceTimersByTimeAsync(500);
    expect(settled).toBe(true);
    expect(layers()).toHaveLength(0);
  });

  it('scene shutdown mid-rite removes DOM, listeners, scopes and resolves once', async () => {
    const scene = makeScene({ battle: true });
    const growth = growthCeremonies(scene);
    expect(growthCeremonies(scene)).toBe(growth);
    const { unit, content, before } = promotedMyrmidon();
    let resolved = 0;
    void growth.showPromotionRite({ unit, content, beforeUnit: before }).then(() => resolved++);
    expect(dom.win.listenerCount('keydown')).toBe(1);
    scene.events.emit('shutdown');
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(1);
    expect(layers()).toHaveLength(0);
    expect(dom.win.listenerCount('keydown')).toBe(0);
    expect(dom.win.listenerCount('resize')).toBe(0);
    expect(activeInputOwner()).toBeNull();
    expect(growth.destroyed).toBe(true);
    expect(scene._growthCeremonies).toBeNull();
    await vi.advanceTimersByTimeAsync(8000);
    expect(resolved).toBe(1);
  });

  it('never consumes the battle RNG', async () => {
    const { unit, content, before } = promotedMyrmidon(); // fixture rolls growths
    const spy = vi.spyOn(Math, 'random');
    const growth = new GrowthCeremonyController(makeScene());
    void growth.showPromotionRite({ unit, content, beforeUnit: before });
    await vi.advanceTimersByTimeAsync(6000);
    growth.destroy();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('effects quality', () => {
  it('Low keeps the sequence but drops sparks and glows', () => {
    const scene = makeScene();
    const settings = scene.registry.get('settings');
    scene.registry.get = (key) =>
      key === 'settings' ? { ...settings, getEffectsQuality: () => 'low' } : null;
    const growth = new GrowthCeremonyController(scene);
    const { unit, content, before } = promotedMyrmidon();
    void growth.showPromotionRite({ unit, content, beforeUnit: before });
    const rite = layers()[0];
    expect(rite.classList.contains('is-low-fx')).toBe(true);
    expect(rite.classList.contains('is-static')).toBe(false);
    growth.destroy();
  });
});

describe('level-up card', () => {
  const unit = { name: 'Edric', className: 'Lord', faction: 'player', isLord: true, stats: { HP: 20, STR: 6, MAG: 2, SKL: 7, SPD: 9, DEF: 5, RES: 3, LCK: 6 } }; // prettier-ignore

  it('ignites the gained pips (one ember tick each), then holds for a press', async () => {
    const scene = makeScene();
    const growth = new GrowthCeremonyController(scene);
    let settled = false;
    void growth
      .showLevelUp({
        unit,
        result: { newLevel: 5, gains: { HP: 1, STR: 1, SPD: 1 } },
        learnedNames: ['Vantage'],
      }) // prettier-ignore
      .then(() => (settled = true));
    const card = layers()[0];
    expect(card.getAttribute('aria-label')).toBe('Level up');
    expect(card.querySelectorAll('.gr-level-row')).toHaveLength(8);
    expect(card.querySelectorAll('.gr-level-row.is-gain')).toHaveLength(3);
    expect(card.querySelectorAll('.re-gain')).toHaveLength(3);
    expect(card.querySelectorAll('.gr-seal--skill')).toHaveLength(1);
    expect(card.querySelector('.gr-lv-to').textContent).toBe('5');
    expect(card.querySelector('.gr-continue').getAttribute('aria-label')).toBe('Reveal gains');
    await vi.advanceTimersByTimeAsync(2000);
    const ticks = scene.audio.playSFX.mock.calls.filter(([k]) => k === 'sfx_cursor');
    expect(ticks).toHaveLength(3);
    expect(card.classList.contains('is-done')).toBe(true);
    expect(settled).toBe(false);
    pointer(card);
    await vi.advanceTimersByTimeAsync(300);
    expect(settled).toBe(true);
    expect(layers()).toHaveLength(0);
  });

  it('a perfect level and a lean level each get their own beat', () => {
    const all = Object.fromEntries(['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'].map((s) => [s, 1])); // prettier-ignore
    const growth = new GrowthCeremonyController(makeScene({ speed: 'instant' }));
    void growth.showLevelUp({ unit, result: { newLevel: 5, gains: all } });
    expect(layers()[0].classList.contains('gr-level-layer--perfect')).toBe(true);
    expect(layers()[0].querySelector('.gr-beat-word').textContent).toBe('A PERFECT LEVEL');
    growth.destroy();
    const lean = new GrowthCeremonyController(makeScene({ speed: 'instant' }));
    void lean.showLevelUp({ unit, result: { newLevel: 5, gains: { DEF: 1 } } });
    expect(layers()[0].classList.contains('gr-level-layer--blank')).toBe(true);
    lean.destroy();
  });

  it('Instant speed: revealed at once, no ticks, one press continues, no exit wait', async () => {
    const scene = makeScene({ speed: 'instant' });
    const growth = new GrowthCeremonyController(scene);
    let settled = false;
    void growth.showLevelUp({ unit, result: { newLevel: 5, gains: { HP: 1 } } }).then(() => (settled = true)); // prettier-ignore
    const card = layers()[0];
    expect(card.classList.contains('is-static')).toBe(true);
    expect(card.querySelector('.gr-continue').getAttribute('aria-label')).toBe('Continue');
    vi.advanceTimersByTime(200);
    pointer(card);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect(layers()).toHaveLength(0);
    expect(scene.audio.playSFX).not.toHaveBeenCalledWith('sfx_cursor');
  });

  it('an outside cancel (popup destroyed) closes it and settles', async () => {
    const growth = new GrowthCeremonyController(makeScene());
    const handle = {};
    let settled = 0;
    void growth.showLevelUp({ unit, result: { newLevel: 5, gains: { HP: 1 } }, handle }).then(() => settled++); // prettier-ignore
    handle.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(1);
    expect(layers()).toHaveLength(0);
    expect(activeInputOwner()).toBeNull();
    handle.cancel();
    expect(settled).toBe(1);
  });
});

describe('joins your army', () => {
  it('shows portrait, crest, name and line; leaves by itself or on a tap', async () => {
    const scene = makeScene({ battle: true });
    const growth = new GrowthCeremonyController(scene);
    const unit = { name: 'Kira', className: 'Tactician', level: 3, isLord: true, faction: 'npc' };
    let done = false;
    void growth.showRecruit({ unit, kind: 'recruit' }).then(() => (done = true));
    const card = layers()[0];
    expect(card.getAttribute('aria-label')).toBe('Kira joins your army');
    expect(card.querySelector('.gr-join-name').textContent).toBe('Kira');
    expect(card.querySelector('.gr-join-crest')).toBeTruthy();
    expect(dialogue.lordRecruitLines.Kira.map((l) => `“${l}”`)).toContain(
      card.querySelector('.gr-join-line').textContent,
    );
    expect(scene._ceremonies.isBlocking()).toBe(true);
    await vi.advanceTimersByTimeAsync(4200);
    expect(done).toBe(true);
    expect(layers()).toHaveLength(0);
    expect(scene._ceremonies.isBlocking()).toBe(false);
    void growth.showRecruit({ unit, kind: 'boss', line: 'For the thread.' });
    expect(layers()[0].querySelector('.gr-join-line').textContent).toBe('“For the thread.”');
    vi.advanceTimersByTime(250);
    pointer(layers()[0]);
    await vi.advanceTimersByTimeAsync(400);
    expect(layers()).toHaveLength(0);
  });
});

describe('sealed beat', () => {
  it('stamps one gain without taking input, then leaves', async () => {
    const scene = makeScene();
    const growth = new GrowthCeremonyController(scene);
    growth.showSealed({ title: 'Rowan learned Vantage', detail: 'New skill', skillId: 'vantage' });
    const band = layers()[0];
    expect(band.classList.contains('is-blocking')).toBe(false);
    expect(band.getAttribute('role')).toBe('status');
    expect(band.querySelector('.gr-glyph--skill').dataset.skillId).toBe('vantage');
    expect(hasOpenOverlay(scene)).toBe(false);
    await vi.advanceTimersByTimeAsync(2500);
    expect(layers()).toHaveLength(0);
  });
});

describe('without a DOM host', () => {
  it('reports unavailable so callers keep their canvas fallback', async () => {
    vi.unstubAllGlobals();
    installFakeDom(vi, { wrapper: false });
    expect(GrowthCeremonyController.available()).toBe(false);
    expect(growthCeremonies(makeScene())).toBeNull();
    const growth = new GrowthCeremonyController(makeScene());
    await expect(growth.showLevelUp({ unit: {}, result: {} })).resolves.toBe(false);
  });

  it('sprites draw at integer scales', () => {
    expect(spriteScale(64, 112)).toBe(2);
    expect(spriteScale(96, 112)).toBe(1);
    expect(spriteScale(0, 112)).toBe(112);
    expect(figureSize(620, 390)).toBe(192); // phone map frame: 1×
    expect(figureSize(1066, 800)).toBe(384); // desktop letterbox: 2×
    expect(figureSize(445, 375)).toBe(178); // compact phone: fit, never overlap
  });
});
