// The battle's EXP gauge on a fake DOM (src/ui/XpGaugeController.js). Failure modes:
//   - the count ends somewhere other than the XP the unit now holds;
//   - a speed or motion setting ignored (Fast fill, Instant / Reduce motion static);
//   - a tap, key or pad press that does not skip, or a skip that leaves the gauge up;
//   - a press on the map that the board then reads as a tap on a tile;
//   - a press on a DOM control (the rail) that skips but loses the control's click, or
//     whose click then lands on something the skip opened under the finger; the rail
//     going dead (inert, dimmed) under a gauge that blocks nothing;
//   - a gauge whose timers never fire hangs the action (the watchdog);
//   - a gauge opened headless, at the cap, or after the controller is gone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { installFakeDom } from './helpers/fakeDom.js';
import { XpGaugeController, gaugeSpeed, xpGaugeFor } from '../src/ui/XpGaugeController.js';
import { xpGaugeRecord } from '../src/ui/xpGaugeModel.js';
import { applyXpGain } from '../src/engine/BattleXp.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';
import {
  _resetInputFocus,
  dispatchInputAction,
  hasInputFocus,
  popInputScope,
  pushInputScope,
} from '../src/utils/inputFocus.js';
import { MobileBattleHUD } from '../src/ui/MobileBattleHUD.js';
import { InputAction } from '../src/utils/InputActions.js';
import { DOM_UI_DEPTHS } from '../src/utils/uiDepths.js';
import { bindCancelablePress } from '../src/utils/cancelablePress.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const fighter = data.classes.find((c) => c.name === 'Fighter');

function record(level, xp, amount) {
  const unit = createRecruitUnit({ name: 'Ilse', level }, fighter, data.weapons);
  unit.level = level;
  unit.xp = xp;
  unit.battleEntityId = 'u2';
  const { before, after, result } = applyXpGain(unit, amount, { classes: data.classes });
  return { unit, record: xpGaugeRecord(unit, { before, after, levelUps: result.levelUps }) };
}

function makeScene({ speed = 'normal', reduceMotion = false, effects = 'high', phase } = {}) {
  const handlers = new Map();
  return {
    registry: {
      get: (key) =>
        key === 'settings'
          ? {
              getBattleSpeed: () => speed,
              getReduceMotion: () => reduceMotion,
              getEffectsQuality: () => effects,
            }
          : null,
    },
    turnManager: { currentPhase: phase || 'player' },
    events: {
      once: (name, fn) => handlers.set(name, fn),
      off: (name) => handlers.delete(name),
      emit: (name) => handlers.get(name)?.(),
    },
    playerUnits: [],
  };
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

const layer = () => dom.doc.querySelector('.xg-layer');
const meter = () => layer()?.querySelector('.xg-track');
const settle = async (promise) => {
  let done = false;
  void promise.then(() => (done = true));
  await vi.advanceTimersByTimeAsync(0);
  return () => done;
};

describe('a gauge plays one gain', () => {
  it('fills from the held XP to the new XP, holds, closes; the count ends at the saved XP', async () => {
    // Lv 7, 72 XP, +12: 108 ms of fill, a 350 ms hold.
    const { unit, record: gain } = record(7, 72, 12);
    const scene = makeScene();
    const gauge = new XpGaugeController(scene);
    const played = gauge.play(gain);
    const root = layer();
    expect(root.style.zIndex).toBe(String(DOM_UI_DEPTHS.XP_GAUGE));
    expect(root.classList.contains('is-blocking')).toBe(false);
    expect(root.dataset).toMatchObject({ fillMs: '108', holdMs: '350' });
    const track = meter();
    expect(track.getAttribute('role')).toBe('meter');
    expect(track.getAttribute('aria-valuenow')).toBe('72');
    expect(root.querySelector('.xg-plus').textContent).toBe('+12');
    await vi.advanceTimersByTimeAsync(60);
    const mid = Number(track.getAttribute('aria-valuenow'));
    expect(mid).toBeGreaterThan(72);
    expect(mid).toBeLessThan(84);
    await vi.advanceTimersByTimeAsync(80);
    expect(track.getAttribute('aria-valuenow')).toBe(String(unit.xp));
    expect(track.getAttribute('aria-valuetext')).toBe('84 of 100 EXP');
    expect(layer()).toBeTruthy(); // holding
    await vi.advanceTimersByTimeAsync(360);
    expect(await played).toBe(true);
    expect(layer()).toBeNull();
    expect(gauge.isShowing()).toBe(false);
  });

  it('a wrap reads LV↑ in the medallion for its beat, then counts on at the new level', async () => {
    // Lv 7, 72 XP, +43: 252 ms to the wrap, a 300 ms beat, 135 ms to 15.
    const { record: gain } = record(7, 72, 43);
    const gauge = new XpGaugeController(makeScene());
    const played = gauge.play(gain);
    await vi.advanceTimersByTimeAsync(300);
    const node = layer().querySelector('.xg-gauge');
    expect(node.classList.contains('is-beat')).toBe(true);
    expect(node.classList.contains('is-flash')).toBe(true);
    expect(layer().querySelector('.xg-value').textContent).toBe('');
    await vi.advanceTimersByTimeAsync(400);
    expect(node.classList.contains('is-beat')).toBe(false);
    expect(meter().getAttribute('aria-valuenow')).toBe('15');
    await vi.advanceTimersByTimeAsync(400);
    expect(await played).toBe(true);
  });

  it('at Fast every wait is halved; holding fast-forward in the enemy phase counts as Fast', () => {
    const { record: gain } = record(7, 72, 12);
    void new XpGaugeController(makeScene({ speed: 'fast' })).play(gain);
    // 12 × 4.5 = 54 ms of fill, 175 ms of hold.
    expect(layer().dataset).toMatchObject({ fillMs: '54', holdMs: '175' });
    const held = makeScene({ phase: 'enemy' });
    held._holdBattleFast = true;
    expect(gaugeSpeed(held)).toBe('fast');
    held.turnManager.currentPhase = 'player';
    expect(gaugeSpeed(held)).toBe('normal');
  });

  it('Instant: the final state at once, held 400 ms', async () => {
    const { record: gain } = record(7, 72, 43);
    const played = new XpGaugeController(makeScene({ speed: 'instant' })).play(gain);
    expect(layer().classList.contains('is-static')).toBe(true);
    expect(layer().dataset).toMatchObject({ fillMs: '0', holdMs: '400' });
    expect(meter().getAttribute('aria-valuenow')).toBe('15');
    // The wrap still shows: LV↑ over the count.
    expect(layer().querySelector('.xg-gauge').classList.contains('is-wrapped')).toBe(true);
    expect(layer().querySelector('.xg-value').textContent).toBe('15');
    const done = await settle(played);
    await vi.advanceTimersByTimeAsync(390);
    expect(done()).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(done()).toBe(true);
    expect(layer()).toBeNull();
  });

  it('Reduce motion: no fill or flash, the final state held 600 ms; Low effects marks the layer', async () => {
    const { record: gain } = record(7, 72, 12);
    const played = new XpGaugeController(makeScene({ reduceMotion: true, effects: 'low' })).play(
      gain,
    );
    expect(layer().classList.contains('is-static')).toBe(true);
    expect(layer().classList.contains('is-low-fx')).toBe(true);
    expect(meter().getAttribute('aria-valuenow')).toBe('84');
    const done = await settle(played);
    await vi.advanceTimersByTimeAsync(590);
    expect(done()).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(done()).toBe(true);
  });

  it('reaching the cap ends on MAX', async () => {
    const { record: gain } = record(19, 90, 30);
    const played = new XpGaugeController(makeScene({ speed: 'instant' })).play(gain);
    expect(meter().getAttribute('aria-valuenow')).toBe('100');
    expect(meter().getAttribute('aria-valuetext')).toBe('EXP MAX, at the level cap');
    expect(layer().querySelector('.xg-value').textContent).toBe('MAX');
    await vi.advanceTimersByTimeAsync(500);
    expect(await played).toBe(true);
  });
});

describe('skipping', () => {
  it('a press anywhere skips to the end state and closes; on the map it is not a tile tap', async () => {
    const { record: gain } = record(7, 10, 60);
    const scene = makeScene();
    scene.game = { canvas: dom.canvas };
    const played = new XpGaugeController(scene).play(gain);
    await vi.advanceTimersByTimeAsync(50);
    const track = meter();
    expect(Number(track.getAttribute('aria-valuenow'))).toBeLessThan(70);
    const mapClick = vi.fn();
    dom.canvas.addEventListener('click', mapClick);
    dom.canvas.dispatchEvent(new dom.FakeEvent('pointerdown', { button: 0, pointerId: 1 }));
    expect(track.getAttribute('aria-valuenow')).toBe('70');
    expect(layer()).toBeNull();
    // The board reads the block on the release (InputController) and never selects.
    expect(scene._uiClickBlocked).toBe(true);
    dom.canvas.dispatchEvent(new dom.FakeEvent('pointerup', { button: 0, pointerId: 1 }));
    expect(scene._uiClickBlocked).toBe(true);
    // And the press's click is swallowed, wherever it lands.
    dom.canvas.dispatchEvent(new dom.FakeEvent('click', { button: 0, detail: 1 }));
    expect(mapClick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(await played).toBe(true);
  });

  it('Enter, and the pad’s Confirm or Cancel, skip too', async () => {
    for (const press of [
      () => dom.key('Enter'),
      () => dispatchInputAction(InputAction.CONFIRM),
      () => dispatchInputAction(InputAction.CANCEL),
    ]) {
      const { record: gain } = record(7, 10, 60);
      const played = new XpGaugeController(makeScene()).play(gain);
      await vi.advanceTimersByTimeAsync(30);
      press();
      expect(layer()).toBeNull();
      await vi.advanceTimersByTimeAsync(0);
      expect(await played).toBe(true);
    }
  });

  // Decision (review, 2026-10-05; exp-bars.md §2.3): a skip key only skips. The gauge
  // plays while the action resolves, where Esc / Pause open nothing (pause needs a
  // planning state) but would still reach the prologue's gate (requestCancel →
  // rejectStep: a coach nudge, or a blocking note on canvas builds), so passing them on
  // would turn "skip the bar" into a scolding.
  it('a skip key only skips: Esc and the pad’s Cancel / Pause never reach the battle', async () => {
    const battleKey = vi.fn();
    dom.win.addEventListener('keydown', battleKey); // Phaser's keyboard (window, bubble)
    for (const press of [
      () => dom.key('Escape'),
      () => dom.key(' '),
      () => dispatchInputAction(InputAction.CANCEL),
      () => dispatchInputAction(InputAction.PAUSE),
      () => dispatchInputAction(InputAction.CONFIRM),
    ]) {
      const scene = makeScene();
      const battleAction = vi.fn();
      pushInputScope(scene, battleAction);
      const played = new XpGaugeController(scene).play(record(7, 10, 60).record);
      press();
      expect(layer()).toBeNull();
      expect(await played).toBe(true);
      expect(battleAction).not.toHaveBeenCalled();
      // The gauge is gone: the next press is the battle's.
      dispatchInputAction(InputAction.PAUSE);
      expect(battleAction).toHaveBeenCalledWith(InputAction.PAUSE, undefined);
      popInputScope(scene);
    }
    expect(battleKey).not.toHaveBeenCalled();
  });

  it('other keys pass by; a scope opened over the gauge keeps its own keys', async () => {
    const battleKey = vi.fn();
    dom.win.addEventListener('keydown', battleKey);
    const played = new XpGaugeController(makeScene()).play(record(7, 10, 60).record);
    dom.key('d');
    expect(layer()).not.toBeNull();
    expect(battleKey).toHaveBeenCalledTimes(1);
    // A modal over the gauge (nothing a gauge opens, but a scope can): its Esc.
    const modal = vi.fn();
    pushInputScope('modal', modal);
    const esc = dom.key('Escape');
    dispatchInputAction(InputAction.CANCEL);
    expect(layer()).not.toBeNull();
    expect(esc.defaultPrevented).toBe(false);
    expect(battleKey).toHaveBeenCalledTimes(2);
    expect(modal).toHaveBeenCalledWith(InputAction.CANCEL, undefined);
    popInputScope('modal');
    dom.key('Escape');
    expect(layer()).toBeNull();
    expect(await played).toBe(true);
  });

  it('a press on the map lifted off it leaves the next map click alone', () => {
    const scene = makeScene();
    scene.game = { canvas: dom.canvas };
    void new XpGaugeController(scene).play(record(7, 10, 60).record);
    dom.canvas.dispatchEvent(new dom.FakeEvent('pointerdown', { button: 0, pointerId: 3 }));
    expect(scene._uiClickBlocked).toBe(true);
    // Another finger's release changes nothing; this one's, off the map, clears the block.
    dom.host.dispatchEvent(new dom.FakeEvent('pointerup', { pointerId: 4 }));
    expect(scene._uiClickBlocked).toBe(true);
    dom.host.dispatchEvent(new dom.FakeEvent('pointerup', { pointerId: 3 }));
    expect(scene._uiClickBlocked).toBe(false);
    // Released on the map, the board consumes the block itself (InputController).
    void new XpGaugeController(scene).play(record(7, 10, 60).record);
    dom.canvas.dispatchEvent(new dom.FakeEvent('pointerdown', { button: 0, pointerId: 5 }));
    dom.canvas.dispatchEvent(new dom.FakeEvent('pointerup', { pointerId: 5 }));
    expect(scene._uiClickBlocked).toBe(true);
  });

  // A rail control as MobileBattleHUD.button builds it: activated by its click
  // (bindCancelablePress), with a label inside it.
  function railButton() {
    const rail = dom.doc.createElement('aside');
    const button = dom.doc.createElement('button');
    const label = dom.doc.createElement('span');
    button.append(label);
    rail.append(button);
    dom.host.append(rail);
    const activated = vi.fn();
    bindCancelablePress(button, activated);
    return { rail, button, label, activated };
  }
  const at = { button: 0, pointerId: 7, isPrimary: true, clientX: 20, clientY: 20 };
  const tap = (node, { clickOn = node } = {}) => {
    node.dispatchEvent(new dom.FakeEvent('pointerdown', at));
    node.dispatchEvent(new dom.FakeEvent('pointerup', at));
    clickOn.dispatchEvent(new dom.FakeEvent('click', { button: 0, detail: 1 }));
  };

  it('a press on a rail control skips the gauge and the control still takes it, once', async () => {
    const { record: gain } = record(7, 10, 60);
    const scene = makeScene();
    scene.game = { canvas: dom.canvas };
    const { label, activated } = railButton();
    const played = new XpGaugeController(scene).play(gain);
    await vi.advanceTimersByTimeAsync(30);
    label.dispatchEvent(new dom.FakeEvent('pointerdown', at));
    expect(layer()).toBeNull();
    label.dispatchEvent(new dom.FakeEvent('pointerup', at));
    label.dispatchEvent(new dom.FakeEvent('click', { button: 0, detail: 1 }));
    expect(activated).toHaveBeenCalledTimes(1);
    // Not a map press: the board's next tap is its own.
    expect(scene._uiClickBlocked).toBeUndefined();
    expect(await played).toBe(true);
    // Nothing left listening: the next tap is an ordinary one.
    tap(label);
    expect(activated).toHaveBeenCalledTimes(2);
  });

  it('a press released off the control (the click goes to an ancestor) activates nothing', async () => {
    const scene = makeScene();
    scene.game = { canvas: dom.canvas };
    const { rail, label, activated } = railButton();
    const railClick = vi.fn();
    rail.addEventListener('click', railClick);
    void new XpGaugeController(scene).play(record(7, 10, 60).record);
    tap(label, { clickOn: rail });
    expect(layer()).toBeNull();
    expect(activated).not.toHaveBeenCalled();
    // The ancestor sees the click it would have seen without a gauge.
    expect(railClick).toHaveBeenCalledTimes(1);
  });

  it('a click that lands on something the skip opened under the finger is swallowed', async () => {
    const scene = makeScene();
    scene.game = { canvas: dom.canvas };
    const { label, activated } = railButton();
    void new XpGaugeController(scene).play(record(7, 10, 60).record);
    label.dispatchEvent(new dom.FakeEvent('pointerdown', at));
    // A card opened by the skip, before the lift, takes the click instead.
    const card = dom.doc.createElement('button');
    dom.host.append(card);
    const cardClick = vi.fn();
    card.addEventListener('click', cardClick);
    label.dispatchEvent(new dom.FakeEvent('pointerup', at));
    card.dispatchEvent(new dom.FakeEvent('click', { button: 0, detail: 1 }));
    expect(cardClick).not.toHaveBeenCalled();
    expect(activated).not.toHaveBeenCalled();
    // The card's own next tap counts.
    card.dispatchEvent(new dom.FakeEvent('pointerdown', at));
    card.dispatchEvent(new dom.FakeEvent('click', { button: 0, detail: 1 }));
    expect(cardClick).toHaveBeenCalledTimes(1);
  });

  it('a press on the gauge itself only skips', async () => {
    const scene = makeScene();
    scene.game = { canvas: dom.canvas };
    const hostClick = vi.fn();
    dom.host.addEventListener('click', hostClick);
    void new XpGaugeController(scene).play(record(7, 10, 60).record);
    const gauge = layer().querySelector('.xg-gauge');
    gauge.dispatchEvent(new dom.FakeEvent('pointerdown', at));
    expect(layer()).toBeNull();
    expect(scene._uiClickBlocked).toBeUndefined();
    dom.host.dispatchEvent(new dom.FakeEvent('pointerup', at));
    dom.host.dispatchEvent(new dom.FakeEvent('click', { button: 0, detail: 1 }));
    expect(hostClick).not.toHaveBeenCalled();
  });

  it('a secondary button press neither skips nor touches the click', async () => {
    const scene = makeScene();
    scene.game = { canvas: dom.canvas };
    const { label, activated } = railButton();
    void new XpGaugeController(scene).play(record(7, 10, 60).record);
    label.dispatchEvent(new dom.FakeEvent('pointerdown', { ...at, button: 2 }));
    expect(layer()).not.toBeNull();
    tap(label);
    expect(layer()).toBeNull();
    expect(activated).toHaveBeenCalledTimes(1);
  });
});

describe('the rail under a gauge', () => {
  // MobileBattleHUD.available on a scene whose rail nothing else holds: the rail is live
  // (and not inert) exactly when this is true.
  const railAvailable = (scene) =>
    Boolean(MobileBattleHUD.prototype.available.call({ scene, modal: null }));
  const battleScene = () => {
    const scene = makeScene();
    scene.game = { canvas: dom.canvas };
    scene.isStoryInputLocked = () => false;
    pushInputScope(scene, () => {});
    return scene;
  };

  it('stays live while a gauge holds the pad it took from the battle', async () => {
    const scene = battleScene();
    expect(railAvailable(scene)).toBe(true);
    const played = xpGaugeFor(scene).play(record(7, 10, 60).record);
    // The gauge has the pad (Confirm / Cancel skip it)...
    expect(hasInputFocus(scene)).toBe(false);
    expect(scene._xpGauge.holdsFocusOf(scene)).toBe(true);
    // ...but blocks nothing: the rail is as live as it was.
    expect(railAvailable(scene)).toBe(true);
    scene._xpGauge.skip();
    expect(await played).toBe(true);
    expect(scene._xpGauge.holdsFocusOf(scene)).toBe(false);
    expect(railAvailable(scene)).toBe(true);
  });

  it('a gauge over something that already held the rail back never frees it', async () => {
    const scene = battleScene();
    // A modal over the battle (the roster, a picker) took the focus first.
    const modal = { modal: true };
    pushInputScope(modal, () => {});
    expect(railAvailable(scene)).toBe(false);
    void xpGaugeFor(scene).play(record(7, 10, 60).record);
    expect(scene._xpGauge.holdsFocusOf(scene)).toBe(false);
    expect(railAvailable(scene)).toBe(false);
    // Something opened over the gauge holds the rail back too.
    popInputScope(modal);
    const scene2 = battleScene();
    void xpGaugeFor(scene2).play(record(7, 10, 60).record);
    expect(railAvailable(scene2)).toBe(true);
    pushInputScope(modal, () => {});
    expect(railAvailable(scene2)).toBe(false);
  });
});

describe('lifecycle', () => {
  it('a gauge whose clock never fires is closed by the watchdog', async () => {
    const { record: gain } = record(7, 72, 12);
    const scene = makeScene({ speed: 'instant' });
    // A scene clock that never calls back.
    scene.sys = { isActive: () => true };
    scene.time = { delayedCall: () => ({ remove() {} }) };
    const played = new XpGaugeController(scene).play(gain);
    const done = await settle(played);
    await vi.advanceTimersByTimeAsync(2000);
    expect(done()).toBe(false);
    await vi.advanceTimersByTimeAsync(500); // 0 fill + 400 hold + 2000 slack
    expect(done()).toBe(true);
    expect(layer()).toBeNull();
  });

  it('scene shutdown closes the gauge and settles its promise', async () => {
    const { record: gain } = record(7, 72, 12);
    const scene = makeScene();
    const gauge = xpGaugeFor(scene);
    expect(scene._xpGauge).toBe(gauge);
    const played = gauge.play(gain);
    scene.events.emit('shutdown');
    expect(layer()).toBeNull();
    expect(await played).toBe(true);
    expect(gauge.destroyed).toBe(true);
    expect(scene._xpGauge).toBeNull();
    expect(await gauge.play(gain)).toBe(false);
  });

  it('one at a time: a new gauge closes the one on screen', async () => {
    const gauge = new XpGaugeController(makeScene());
    const first = gauge.play(record(7, 72, 12).record);
    void gauge.play(record(3, 0, 20).record);
    expect(await first).toBe(true);
    expect(dom.doc.querySelectorAll('.xg-layer')).toHaveLength(1);
  });

  it('shows nothing headless or without a gain', async () => {
    const gauge = new XpGaugeController(makeScene());
    expect(await gauge.play(null)).toBe(false);
    expect(await gauge.play({ gained: 0, segments: [] })).toBe(false);
    vi.unstubAllGlobals();
    expect(xpGaugeFor(makeScene())).toBeNull();
    expect(await new XpGaugeController(makeScene()).play(record(7, 72, 12).record)).toBe(false);
  });
});
