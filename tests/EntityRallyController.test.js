// The Entity rally as portrait cards: what a player sees and can do while the finale plays.
// Failure modes covered: a card off its musical beat, a fallen speaker's line still said, a card that
// outlives its speaker or the battle, Skip leaving a timer or a layer behind, a tap or key on the
// card reaching the board, Cancel taken from a menu that is open, a stray timer after destroy().
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { BattleBeatsController } from '../src/ui/BattleBeatsController.js';
import EntityRallyController from '../src/ui/EntityRallyController.js';

let dom;
beforeEach(() => {
  vi.useFakeTimers();
  dom = installFakeDom(vi);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const unit = (name, extra = {}) => ({
  name,
  className: 'Lord',
  isLord: true,
  faction: 'player',
  currentHP: 20,
  stats: { HP: 20 },
  col: 2,
  row: 3,
  ...extra,
});

const rallyOf = (...units) =>
  units.map((u, i) => ({ unit: u, speaker: u.name, line: `Line ${i + 1} from ${u.name}.` }));

function makeScene(extra = {}) {
  return {
    game: { canvas: dom.canvas },
    gameData: { lords: [{ name: 'Edric' }, { name: 'Kira' }, { name: 'Sera' }], classes: [] },
    battleState: 'PLAYER_IDLE',
    playerUnits: [],
    enemyUnits: [],
    grid: { gridToPixel: () => ({ x: 100, y: 100 }) },
    _reduceMotion: () => false,
    ...extra,
  };
}

const layers = () => dom.doc.body.querySelectorAll('.ce-rally-layer');
const card = () => dom.doc.body.querySelector('.rc-card');
const shown = () => (card() && !card().hidden ? card() : null);
const text = (cls) => dom.doc.body.querySelector(cls)?.textContent;

describe('the timetable', () => {
  it('lands the first card on the downbeat and one more every two bars', () => {
    const [a, b, c] = [unit('Edric'), unit('Kira'), unit('Sera')];
    const rally = new EntityRallyController(makeScene());
    rally.start(rallyOf(a, b, c), { leadMs: 3000, barMs: 1765 });
    vi.advanceTimersByTime(2999);
    expect(layers()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(text('.rc-name')).toBe('Edric');
    expect(text('.rc-line')).toBe('Line 1 from Edric.');
    expect(text('.rc-count')).toBe('1 / 3');
    vi.advanceTimersByTime(3529);
    expect(text('.rc-name')).toBe('Edric');
    vi.advanceTimersByTime(1);
    expect(text('.rc-name')).toBe('Kira');
    expect(text('.rc-count')).toBe('2 / 3');
    vi.advanceTimersByTime(3530);
    expect(text('.rc-name')).toBe('Sera');
    // one card for the whole rally: a beat swaps its words, it does not stack another
    expect(layers()).toHaveLength(1);
  });

  it('holds the last card for one more beat, fades it, then takes the layer down', () => {
    const rally = new EntityRallyController(makeScene());
    rally.start(rallyOf(unit('Edric'), unit('Sera')), { leadMs: 0, barMs: 1000 });
    vi.advanceTimersByTime(2000); // Sera's card is up
    expect(text('.rc-name')).toBe('Sera');
    vi.advanceTimersByTime(1999);
    expect(card().classList.contains('is-leaving')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(card().classList.contains('is-leaving')).toBe(true);
    vi.advanceTimersByTime(400);
    expect(layers()).toHaveLength(0);
    expect(rally.cardVisible).toBe(false);
    // nothing left running once the rally is over
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cuts instead of fading when motion is reduced', () => {
    const rally = new EntityRallyController(makeScene({ _reduceMotion: () => true }));
    rally.start(rallyOf(unit('Edric')), { leadMs: 0, barMs: 1000 });
    vi.advanceTimersByTime(0);
    expect(layers()[0].classList.contains('is-static')).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(card()?.classList.contains('is-leaving') ?? false).toBe(false);
    expect(rally.cardVisible).toBe(false);
  });
});

describe('who speaks', () => {
  it("leaves a fallen speaker's line unsaid and ends the card before it", () => {
    const [a, b, c] = [unit('Edric'), unit('Kira'), unit('Sera')];
    const rally = new EntityRallyController(makeScene());
    rally.start(rallyOf(a, b, c), { leadMs: 0, barMs: 1000 });
    vi.advanceTimersByTime(0);
    expect(text('.rc-name')).toBe('Edric');
    b.currentHP = 0; // Kira falls before her beat
    vi.advanceTimersByTime(2000);
    expect(shown()).toBeNull(); // Edric's card ended on the beat; Kira's was never shown
    expect(rally.cardVisible).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(text('.rc-name')).toBe('Sera'); // the rally goes on for the rest
    expect(text('.rc-count')).toBe('3 / 3');
  });

  it('ends a card the moment its speaker falls, and the next card still comes', () => {
    const [a, b] = [unit('Edric'), unit('Kira')];
    const rally = new EntityRallyController(makeScene());
    rally.start(rallyOf(a, b), { leadMs: 0, barMs: 1000 });
    vi.advanceTimersByTime(0);
    expect(rally.cardVisible).toBe(true);
    a.currentHP = 0;
    vi.advanceTimersByTime(200);
    expect(rally.cardVisible).toBe(false);
    vi.advanceTimersByTime(1800);
    expect(text('.rc-name')).toBe('Kira');
  });

  it('takes the layer down when the last speaker has fallen by its beat', () => {
    const [a, b] = [unit('Edric'), unit('Sera')];
    const rally = new EntityRallyController(makeScene());
    rally.start(rallyOf(a, b), { leadMs: 0, barMs: 1000 });
    vi.advanceTimersByTime(0);
    b.currentHP = 0;
    vi.advanceTimersByTime(2000);
    expect(layers()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends everything when the battle does', () => {
    const scene = makeScene();
    const rally = new EntityRallyController(scene);
    rally.start(rallyOf(unit('Edric'), unit('Kira')), { leadMs: 0, barMs: 1000 });
    vi.advanceTimersByTime(0);
    scene.battleState = 'BATTLE_END';
    vi.advanceTimersByTime(200);
    expect(layers()).toHaveLength(0);
    vi.advanceTimersByTime(10000);
    expect(layers()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("marks the speaker's tile on the board as each card lands", () => {
    const marked = [];
    const scene = makeScene({
      add: {
        graphics: () => {
          const g = { setDepth: () => g, setPosition: (x, y) => (marked.push([x, y]), g) };
          return Object.assign(g, {
            lineStyle() {},
            beginPath() {},
            moveTo() {},
            lineTo() {},
            strokePath() {},
            fillStyle() {},
            fillRect() {},
            setAlpha: () => g,
            setScale: () => g,
            destroy() {},
          });
        },
      },
      tweens: { add: () => {} },
      time: { delayedCall: () => {} },
    });
    scene.grid.gridToPixel = (c, r) => ({ x: c * 10, y: r * 10 });
    const rally = new EntityRallyController(scene);
    rally.start(rallyOf(unit('Edric', { col: 1, row: 2 }), unit('Kira', { col: 4, row: 5 })), {
      leadMs: 0,
      barMs: 1000,
    });
    vi.advanceTimersByTime(0);
    expect(marked[0]).toEqual([10, 20]);
    vi.advanceTimersByTime(2000);
    expect(marked.some(([x, y]) => x === 40 && y === 50)).toBe(true);
  });
});

describe('Skip', () => {
  const start = (extra = {}) => {
    const scene = makeScene(extra);
    const rally = new EntityRallyController(scene);
    rally.start(rallyOf(unit('Edric'), unit('Kira'), unit('Sera')), { leadMs: 0, barMs: 1000 });
    vi.advanceTimersByTime(0);
    return { scene, rally };
  };

  it('the button drops every remaining line, every timer and the card', () => {
    const { rally } = start();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    dom.doc.body.querySelector('.rc-skip').click();
    expect(layers()).toHaveLength(0);
    expect(rally.skipped).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(20000);
    expect(layers()).toHaveLength(0); // nothing comes back on a later beat
  });

  it("Escape on the focused button skips too, and does not reach the scene's keys", () => {
    start();
    const reached = vi.fn();
    dom.win.addEventListener('keydown', reached);
    const event = new dom.FakeEvent('keydown', { key: 'Escape' });
    dom.doc.body.querySelector('.rc-skip').dispatchEvent(event);
    expect(layers()).toHaveLength(0);
    expect(reached).not.toHaveBeenCalled();
  });

  it('a press on the button never reaches the board', () => {
    start();
    const reached = vi.fn();
    for (const type of ['pointerdown', 'pointerup', 'click', 'touchstart'])
      dom.win.addEventListener(type, reached);
    const skip = dom.doc.body.querySelector('.rc-skip');
    for (const type of ['pointerdown', 'pointerup', 'touchstart'])
      skip.dispatchEvent(new dom.FakeEvent(type));
    expect(reached).not.toHaveBeenCalled();
  });

  it('is click-through everywhere but the button', () => {
    start();
    // the layer is a ceremony layer: not blocking, so its CSS leaves the map's taps alone
    expect(layers()[0].classList.contains('is-blocking')).toBe(false);
  });

  it('skip() returns whether there was anything to dismiss, and is idempotent', () => {
    const { rally } = start();
    expect(rally.skip()).toBe(true);
    expect(rally.skip()).toBe(false);
  });

  it('a skipped rally cannot be started again (once per battle)', () => {
    const { rally } = start();
    rally.skip();
    rally.start(rallyOf(unit('Edric')), { leadMs: 0, barMs: 1000 });
    vi.advanceTimersByTime(5000);
    expect(layers()).toHaveLength(0);
  });
});

describe('Cancel', () => {
  it('goes to the card only while it is up and nothing else has something to close', () => {
    const rally = new EntityRallyController(makeScene());
    rally.start(rallyOf(unit('Edric'), unit('Kira')), { leadMs: 1000, barMs: 1000 });
    // before the first card there is nothing to dismiss: Cancel keeps its usual job
    expect(rally.yieldsCancel(false)).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(rally.yieldsCancel(false)).toBe(true);
    // a menu, forecast, selection or overlay is open: it keeps Cancel
    expect(rally.yieldsCancel(true)).toBe(false);
  });

  it('BattleBeatsController.skipRallyOnCancel dismisses only when the card yields', () => {
    const scene = makeScene({
      gameData: {
        ...makeScene().gameData,
        dialogue: {
          finaleRally: {
            lords: { Edric: { open: ['Together.'] }, Kira: { lines: ['Every piece.'] } },
            recruits: {},
          },
        },
      },
      playerUnits: [unit('Edric'), unit('Kira')],
      runManager: { getStartingLordNames: () => ['Edric'], runSeed: 3, fallenUnits: [] },
    });
    const beats = new BattleBeatsController(scene, () => 0);
    expect(beats.skipRallyOnCancel(false)).toBe(false); // no rally yet
    const rally = beats.entityRally({ leadMs: 0, barMs: 1000 });
    expect(rally).toHaveLength(2);
    vi.advanceTimersByTime(0);
    expect(beats.rallyActive()).toBe(true);
    expect(beats.skipRallyOnCancel(true)).toBe(false);
    expect(beats.rallyActive()).toBe(true);
    expect(beats.skipRallyOnCancel(false)).toBe(true);
    expect(beats.rallyActive()).toBe(false);
    expect(layers()).toHaveLength(0);
    // once per battle: a skipped rally is not composed again
    expect(beats.entityRally({ leadMs: 0 })).toEqual([]);
  });
});

describe('destroy', () => {
  it('removes the card and every timer, including lines still to come', () => {
    const rally = new EntityRallyController(makeScene());
    rally.start(rallyOf(unit('Edric'), unit('Kira'), unit('Sera')), { leadMs: 0, barMs: 1000 });
    vi.advanceTimersByTime(0);
    expect(layers()).toHaveLength(1);
    rally.destroy();
    expect(layers()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(20000);
    expect(layers()).toHaveLength(0);
  });

  it('BattleBeatsController.destroy() takes the rally down with it', () => {
    const scene = makeScene({
      gameData: {
        ...makeScene().gameData,
        dialogue: { finaleRally: { lords: { Edric: { open: ['Together.'] } }, recruits: {} } },
      },
      playerUnits: [unit('Edric')],
      runManager: { getStartingLordNames: () => ['Edric'], runSeed: 3, fallenUnits: [] },
    });
    const beats = new BattleBeatsController(scene, () => 0);
    beats.entityRally({ leadMs: 0, barMs: 1000 });
    vi.advanceTimersByTime(0);
    expect(layers()).toHaveLength(1);
    beats.destroy();
    expect(layers()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('without a DOM host', () => {
  it('falls back to the floating line for each speaker, on the same beats', () => {
    vi.unstubAllGlobals(); // no document: a headless host
    const said = [];
    const rally = new EntityRallyController(makeScene(), {
      fallback: (u, line) => said.push([u.name, line]),
    });
    rally.start(rallyOf(unit('Edric'), unit('Kira')), { leadMs: 500, barMs: 1000 });
    vi.advanceTimersByTime(499);
    expect(said).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(said).toEqual([['Edric', 'Line 1 from Edric.']]);
    vi.advanceTimersByTime(2000);
    expect(said).toHaveLength(2);
    expect(rally.cardVisible).toBe(false);
  });
});
