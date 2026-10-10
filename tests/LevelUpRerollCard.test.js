// The level-up card's Reroll (Branching Threads): GrowthCeremonyController's card and
// LevelUpPopup's canvas fallback. The card only draws: the handle it is given commits (and
// saves) the reroll and hands back the level's record with its new gains.
//
// Ways this can fail, one test (or more) each:
//   - the button shown before the gains are revealed, or without rerolls at all
//   - a tap on the card (not the button) rerolling, or the button's own tap also continuing
//   - Enter / the pad's confirm on the focused Reroll continuing instead, or Esc rerolling
//   - the pad unable to reach the button (no focus move)
//   - the new gains not shown, the reveal not replayed, the count not updated
//   - a failed reroll redrawing the card as if it had changed
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import dialogue from '../data/dialogue.json';
import { GrowthCeremonyController } from '../src/ui/GrowthCeremonyController.js';
import { _resetInputFocus, dispatchInputAction } from '../src/utils/inputFocus.js';
import { InputAction } from '../src/utils/InputActions.js';
import { LevelUpPopup } from '../src/ui/LevelUpPopup.js';
import { levelUpRerollButtonState } from '../src/ui/rewardRerollButton.js';

const gameData = { ...loadGameData(), dialogue };
const STATS = ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'];
const gainsOf = (list) => Object.fromEntries(STATS.map((s) => [s, list.includes(s) ? 1 : 0]));

function makeScene({ speed = 'normal', reduceMotion = false } = {}) {
  const audio = { playSFX: vi.fn() };
  const handlers = new Map();
  const listeners = (name) => handlers.get(name) || handlers.set(name, new Set()).get(name);
  return {
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
    },
    audio,
  };
}

/** A handle like ui/LevelUpRerollController.js's: `left` charges, each run rerolls to `next`. */
function handle(record, { left = 2, nexts = [['SPD', 'DEF', 'LCK']], fail = false } = {}) {
  const h = {
    left,
    runs: 0,
    state: () => levelUpRerollButtonState({ granted: 3, left: h.left, block: h.left ? '' : 'spent' }), // prettier-ignore
    run: vi.fn(() => {
      h.runs++;
      if (fail) return { ok: false, message: 'Could not save the reroll: nothing changed.' };
      Object.assign(record.gains, gainsOf(nexts[(h.runs - 1) % nexts.length]));
      h.left--;
      return { ok: true, result: record };
    }),
  };
  return h;
}

const unit = { name: 'Edric', className: 'Lord', faction: 'player', isLord: true, stats: { HP: 20, STR: 6, MAG: 2, SKL: 7, SPD: 9, DEF: 5, RES: 3, LCK: 6 } }; // prettier-ignore

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

const layer = () => dom.doc.querySelectorAll('.ce-layer')[0];
const press = (node) =>
  node.dispatchEvent(new dom.FakeEvent('pointerdown', { button: 0, pointerId: 1 }));
const tapButton = (node) => {
  press(node);
  node.dispatchEvent(new dom.FakeEvent('click', { button: 0, detail: 1 }));
};
const key = (k) => dom.key(k);
const gainRows = () => layer().querySelectorAll('.gr-level-row.is-gain').length;

function open({ speed = 'normal', ...opts } = {}) {
  const scene = makeScene({ speed });
  const growth = new GrowthCeremonyController(scene);
  const record = { newLevel: 5, gains: gainsOf(['HP']) };
  const h = opts.none ? null : handle(record, opts);
  let settled = false;
  void growth.showLevelUp({ unit, result: record, reroll: h }).then(() => (settled = true));
  return { scene, h, record, settled: () => settled };
}

describe('the card’s Reroll', () => {
  it('appears only once the gains are revealed, with the shared count', async () => {
    const { h } = open();
    const button = layer().querySelector('.gr-reroll');
    expect(button.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(layer().classList.contains('is-done')).toBe(true);
    expect(button.hidden).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Reroll (2)');
    expect(button.disabled).toBe(false);
    expect(h.run).not.toHaveBeenCalled();
  });

  it('is absent without rerolls (no handle) and hidden when the handle says so', async () => {
    open({ none: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(layer().querySelector('.gr-reroll')).toBeNull();
  });

  it('a tap rerolls: new gains shown, the reveal replays, the count drops, a sound plays', async () => {
    const { h, scene, settled } = open();
    await vi.advanceTimersByTimeAsync(2000);
    expect(gainRows()).toBe(1);
    tapButton(layer().querySelector('.gr-reroll'));
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(scene.audio.playSFX).toHaveBeenCalledWith('sfx_confirm');
    expect(gainRows()).toBe(3);
    // The reveal plays again: Reroll hidden, Continue reads "Reveal gains".
    expect(layer().classList.contains('is-done')).toBe(false);
    expect(layer().querySelector('.gr-reroll').hidden).toBe(true);
    expect(layer().querySelector('.gr-continue').getAttribute('aria-label')).toBe('Reveal gains');
    await vi.advanceTimersByTimeAsync(2000);
    expect(layer().querySelector('.gr-reroll').getAttribute('aria-label')).toBe('Reroll (1)');
    expect(layer().querySelector('.gr-level-status').textContent).toMatch(/New gains rolled/);
    expect(settled()).toBe(false);
  });

  it('a tap on the card itself still continues (and never rerolls)', async () => {
    const { h, settled } = open();
    await vi.advanceTimersByTimeAsync(2000);
    press(layer());
    await vi.advanceTimersByTimeAsync(300);
    expect(settled()).toBe(true);
    expect(h.run).not.toHaveBeenCalled();
  });

  it('keyboard: Enter on the focused Reroll rerolls; Esc continues', async () => {
    const { h, settled } = open({ speed: 'instant' });
    await vi.advanceTimersByTimeAsync(300);
    layer().querySelector('.gr-reroll').focus();
    key('Enter');
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(settled()).toBe(false);
    // Instant speed: revealed at once, and the focus stays on Reroll.
    expect(dom.doc.activeElement).toBe(layer().querySelector('.gr-reroll'));
    key('Escape');
    await vi.advanceTimersByTimeAsync(10);
    expect(settled()).toBe(true);
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it('gamepad: the d-pad reaches Reroll, confirm rerolls, confirm on Continue continues', async () => {
    const { h, settled } = open({ speed: 'instant' });
    await vi.advanceTimersByTimeAsync(300);
    expect(dom.doc.activeElement).toBe(layer().querySelector('.gr-continue'));
    dispatchInputAction(InputAction.NAVIGATE, { dx: -1, dy: 0 });
    expect(dom.doc.activeElement).toBe(layer().querySelector('.gr-reroll'));
    dispatchInputAction(InputAction.CONFIRM);
    expect(h.run).toHaveBeenCalledTimes(1);
    dispatchInputAction(InputAction.NAVIGATE, { dx: 1, dy: 0 });
    expect(dom.doc.activeElement).toBe(layer().querySelector('.gr-continue'));
    dispatchInputAction(InputAction.CONFIRM);
    await vi.advanceTimersByTimeAsync(10);
    expect(settled()).toBe(true);
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it('spent: shown disabled as "No rerolls left"; a tap does nothing', async () => {
    const { h } = open({ speed: 'instant', left: 0 });
    await vi.advanceTimersByTimeAsync(300);
    const button = layer().querySelector('.gr-reroll');
    expect(button.hidden).toBe(false);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('No rerolls left');
    tapButton(button);
    expect(h.run).not.toHaveBeenCalled();
  });

  it('a failed reroll says so and keeps the card as it was', async () => {
    const { h } = open({ speed: 'instant', fail: true });
    await vi.advanceTimersByTimeAsync(300);
    tapButton(layer().querySelector('.gr-reroll'));
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(gainRows()).toBe(1);
    expect(layer().querySelector('.gr-level-status').textContent).toBe(
      'Could not save the reroll: nothing changed.',
    );
    expect(layer().classList.contains('is-done')).toBe(true);
  });
});

describe('the canvas fallback (no DOM host)', () => {
  function canvasScene() {
    const texts = [];
    const object = (text = '') => {
      const handlers = {};
      return {
        text,
        handlers,
        interactive: false,
        setDepth() {
          return this;
        },
        setOrigin() {
          return this;
        },
        setStrokeStyle() {
          return this;
        },
        setInteractive() {
          this.interactive = true;
          return this;
        },
        on(event, cb) {
          handlers[event] = cb;
          return this;
        },
        once(event, cb) {
          handlers[event] = cb;
          return this;
        },
        destroy: vi.fn(function () {
          this.destroyed = true;
        }),
      };
    };
    return {
      texts,
      cameras: { main: { width: 640, height: 480 } },
      add: {
        rectangle: () => object(),
        text: (_x, _y, text) => {
          const t = object(text);
          texts.push(t);
          return t;
        },
      },
      events: { once: vi.fn(), off: vi.fn() },
      registry: { get: () => null },
    };
  }

  it('shows "[ Reroll (N) ]", rerolls in place and redraws the new gains', async () => {
    vi.stubGlobal('document', undefined);
    const scene = canvasScene();
    const record = { newLevel: 5, gains: gainsOf(['HP']) };
    const h = handle(record);
    const popup = new LevelUpPopup(scene, unit, record, false, [], null, { reroll: h });
    let settled = false;
    void popup.show().then(() => (settled = true));
    const live = () => scene.texts.filter((t) => !t.destroyed);
    const button = live().find((t) => t.text === '[ Reroll (2) ]');
    expect(button.interactive).toBe(true);
    button.handlers.pointerdown({}, 0, 0, { stopPropagation: vi.fn() });
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(live().some((t) => t.text === '[ Reroll (1) ]')).toBe(true);
    expect(live().filter((t) => /\+1$/.test(t.text))).toHaveLength(3);
    await Promise.resolve();
    expect(settled).toBe(false);
  });
});
