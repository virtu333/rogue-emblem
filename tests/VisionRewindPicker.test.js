import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { VisionRewindPicker } from '../src/ui/VisionRewindPicker.js';
import { _resetInputFocus, dispatchInputAction } from '../src/utils/inputFocus.js';
import { InputAction } from '../src/utils/InputActions.js';

let dom;
beforeEach(() => {
  dom = installFakeDom(vi);
  _resetInputFocus();
});
afterEach(() => {
  vi.unstubAllGlobals();
  _resetInputFocus();
});

const row = (id, turnNumber, extra = {}) => ({
  id,
  turnNumber,
  kind: 'action',
  title: `Before Unit${id}’s attack on Knight`,
  action: {
    actor: `Unit${id}`,
    actorId: `u${id}`,
    className: 'Lord',
    verb: 'attack',
    target: 'Knight',
  },
  chips: [{ text: 'Missed', tone: 'miss' }],
  available: true,
  reason: '',
  currentTurn: turnNumber === 2,
  ...extra,
});
const listing = (
  rows = [row(5, 2), row(4, 2, { kind: 'turn_start', title: 'Before Unit9’s wait' }), row(2, 1)],
) => ({
  rows,
  currentTurn: 2,
  granularity: 'action',
  earlierUnavailable: false,
});
function scene() {
  return {
    events: { once() {}, off() {} },
    gameData: {},
    textures: { exists: () => false },
  };
}
function open(options = {}) {
  const session = {
    attach: vi.fn(),
    show: vi.fn((frame, t, done) => done(true)),
    hide: vi.fn(),
    fit: vi.fn(),
  };
  const callbacks = { onClose: vi.fn(), onConfirm: vi.fn(), onHistory: vi.fn() };
  const picker = new VisionRewindPicker(scene(), {
    listing: listing(),
    charges: 2,
    policy: 'fixed-v1',
    session,
    frameFor: (r) => ({ id: r.id }),
    ...callbacks,
    ...options,
  });
  return { picker, session, ...callbacks };
}
const tap = (node) => {
  node.dispatchEvent(
    new dom.FakeEvent('pointerdown', {
      button: 0,
      pointerId: 1,
      pointerType: 'touch',
      clientX: 1,
      clientY: 1,
    }),
  );
  node.dispatchEvent(
    new dom.FakeEvent('pointerup', {
      button: 0,
      pointerId: 1,
      pointerType: 'touch',
      clientX: 1,
      clientY: 1,
    }),
  );
  node.dispatchEvent(new dom.FakeEvent('click', { button: 0, detail: 1 }));
};
const rows = () => dom.doc.querySelectorAll('.vr-row');
const selected = () => rows().find((r) => r.getAttribute('aria-selected') === 'true');

describe('VisionRewindPicker', () => {
  it('opens on the newest point with turn groups, cost and a live preview', () => {
    const { picker, session } = open();
    expect(dom.doc.querySelectorAll('.vr-turn').map((h) => h.textContent)).toEqual([
      'Turn 2 · this turn',
      'Turn 1',
    ]);
    expect(rows().map((r) => r.querySelector('.vr-title').textContent)).toEqual([
      'Before Unit5’s attack on Knight',
      'Start of turn 2',
      'Before Unit2’s attack on Knight',
    ]);
    expect(rows()[1].querySelector('.vr-sub').textContent).toBe('before Unit9’s wait');
    expect(selected()).toBe(rows()[0]);
    expect(dom.doc.activeElement).toBe(rows()[0]);
    expect(picker.confirm.textContent).toBe('Rewind here · 1 charge');
    expect(picker.confirm.disabled).toBe(false);
    expect(picker.status.textContent).toBe('Undoes the last action. Same moves, same outcomes.');
    expect(dom.doc.querySelector('.vr-charges').textContent).toContain('2 left');
    expect(session.attach).toHaveBeenCalledWith(picker.map);
    expect(session.show).toHaveBeenCalledOnce();
    expect(session.show.mock.calls[0][0]).toEqual({ id: 5 });
    expect(session.show.mock.calls[0][1].beats[0].actorId).toBe('u5');
    expect(session.fit).toHaveBeenCalledOnce();
  });

  it('a tap previews without spending; the Rewind button spends once', () => {
    const { picker, session, onConfirm } = open();
    tap(rows()[2]);
    expect(selected()).toBe(rows()[2]);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(session.show).toHaveBeenCalledTimes(2);
    expect(picker.status.textContent).toBe(
      'Returns to turn 1; everything after is undone. Same moves, same outcomes.',
    );
    expect(picker.ribbon.textContent).toBe('Turn 1 · before Unit2’s attack on Knight');
    tap(rows()[1]);
    expect(picker.status.textContent).toMatch(/^Undoes the last 2 actions\./);
    tap(picker.confirm);
    tap(picker.confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith(4);
  });

  it('explains unavailable points and no charges; preview still works', () => {
    const { picker, onConfirm } = open({
      listing: listing([
        row(5, 2),
        row(3, 2, { available: false, reason: 'This difficulty rewinds to turn starts only.' }),
      ]),
    });
    tap(rows()[1]);
    expect(picker.confirm.disabled).toBe(true);
    expect(picker.confirm.textContent).toBe('Rewind here');
    expect(picker.status.textContent).toBe('This difficulty rewinds to turn starts only.');
    expect(rows()[1].querySelector('.vr-sub').textContent).toBe(
      'This difficulty rewinds to turn starts only.',
    );
    picker.confirmSelected();
    expect(onConfirm).not.toHaveBeenCalled();
    picker.destroy();
    const broke = open({ charges: 0 });
    expect(broke.picker.confirm.disabled).toBe(true);
    expect(broke.picker.status.textContent).toMatch(/No rewind charges left/);
  });

  it('keyboard: arrows move the selection, Enter goes to the button, Escape closes', () => {
    const { picker, onClose, onConfirm } = open();
    dom.key('ArrowDown');
    expect(selected()).toBe(rows()[1]);
    dom.key('ArrowDown');
    dom.key('ArrowDown');
    expect(selected()).toBe(rows()[2]);
    dom.key('ArrowUp');
    expect(selected()).toBe(rows()[1]);
    dom.key('Enter');
    expect(dom.doc.activeElement).toBe(picker.confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    dom.key('PageDown');
    expect(selected()).toBe(rows()[2]);
    dom.key('Escape');
    expect(onClose).toHaveBeenCalledOnce();
    expect(picker.destroyed).toBe(true);
  });

  it('controller input: NAVIGATE moves, CONFIRM on a row focuses the button', () => {
    const { picker } = open();
    dispatchInputAction(InputAction.NAVIGATE, { dx: 0, dy: 1 });
    expect(selected()).toBe(rows()[1]);
    dispatchInputAction(InputAction.CONFIRM);
    expect(dom.doc.activeElement).toBe(picker.confirm);
  });

  it('empty history explains itself; History opens the full timeline', () => {
    const { picker, onHistory } = open({ listing: listing([]) });
    expect(dom.doc.querySelector('.vr-empty').textContent).toMatch(/Nothing to rewind yet/);
    expect(picker.confirm.disabled).toBe(true);
    tap(dom.doc.querySelector('.vr-history'));
    expect(onHistory).toHaveBeenCalledOnce();
  });

  it('fatal: Back returns to the decision; no preview frame shows the fallback', () => {
    const { picker } = open({ fatal: true, frameFor: () => null });
    expect(dom.doc.querySelector('.vr-back').textContent).toBe('Back to decision');
    expect(picker.map.classList.contains('vr-map--missing')).toBe(true);
  });
});
