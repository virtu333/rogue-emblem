// The scene-change veil must never hold a screen hostage: it is off unless switched on,
// never raised under Reduce motion, opens for the transition that closed it, and opens
// by itself if the next scene never reports in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function fakeDocument() {
  const made = [];
  const element = () => {
    const classes = new Set();
    const el = {
      className: '',
      style: { props: {}, setProperty: (k, v) => (el.style.props[k] = v) },
      isConnected: false,
      offsetWidth: 0,
      children: [],
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
      },
      setAttribute() {},
      append: (...kids) => el.children.push(...kids),
    };
    made.push(el);
    return el;
  };
  return {
    made,
    createElement: element,
    body: {
      append: (el) => {
        el.isConnected = true;
      },
    },
  };
}

const sceneWith = (reduceMotion) => ({
  registry: { get: () => ({ getReduceMotion: () => reduceMotion }) },
});

function emitter() {
  const handlers = {};
  return {
    once: (name, fn) => (handlers[name] = fn),
    emit: (name) => handlers[name]?.(),
  };
}

describe('sceneVeil', () => {
  let veil;
  let doc;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    doc = fakeDocument();
    vi.stubGlobal('document', doc);
    vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 16));
    veil = await import('../src/utils/sceneVeil.js');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does nothing until it is switched on (tests, tools and the harness never switch it on)', async () => {
    await expect(veil.closeSceneVeil(sceneWith(false))).resolves.toBe(0);
    expect(doc.made).toHaveLength(0);
  });

  it('is never raised under Reduce motion and adds no wait', async () => {
    veil.enableSceneVeil();
    await expect(veil.closeSceneVeil(sceneWith(true))).resolves.toBe(0);
    expect(doc.made).toHaveLength(0);
  });

  it('closes within its budget, then opens for the transition that closed it', async () => {
    veil.enableSceneVeil();
    const closing = veil.closeSceneVeil(sceneWith(false));
    const el = doc.made[0];
    expect(el.classList.contains('is-closed')).toBe(true);
    await vi.advanceTimersByTimeAsync(veil.SCENE_VEIL.closeMs);
    const token = await closing;
    expect(token).toBeGreaterThan(0);
    veil.openSceneVeil(token);
    expect(el.classList.contains('is-closed')).toBe(false);
    expect(el.classList.contains('is-open')).toBe(true);
  });

  it("an earlier transition cannot open a later one's veil", async () => {
    veil.enableSceneVeil();
    const first = veil.closeSceneVeil(sceneWith(false));
    await vi.advanceTimersByTimeAsync(veil.SCENE_VEIL.closeMs);
    const a = await first;
    const second = veil.closeSceneVeil(sceneWith(false));
    await vi.advanceTimersByTimeAsync(veil.SCENE_VEIL.closeMs);
    const b = await second;
    veil.openSceneVeil(a);
    expect(doc.made[0].classList.contains('is-closed')).toBe(true);
    veil.openSceneVeil(b);
    expect(doc.made[0].classList.contains('is-closed')).toBe(false);
  });

  it('opens by itself when the next scene never reports in', async () => {
    veil.enableSceneVeil();
    veil.closeSceneVeil(sceneWith(false));
    await vi.advanceTimersByTimeAsync(veil.SCENE_VEIL.maxHoldMs + 1);
    expect(doc.made[0].classList.contains('is-closed')).toBe(false);
  });

  it('waits for the started scene to be created before opening', async () => {
    veil.enableSceneVeil();
    const closing = veil.closeSceneVeil(sceneWith(false));
    await vi.advanceTimersByTimeAsync(veil.SCENE_VEIL.closeMs);
    const token = await closing;
    const events = emitter();
    veil.openSceneVeilWhenReady(token, { get: () => ({ events }) }, 'Title');
    await vi.advanceTimersByTimeAsync(100);
    expect(doc.made[0].classList.contains('is-closed')).toBe(true);
    events.emit('create');
    await vi.advanceTimersByTimeAsync(20);
    expect(doc.made[0].classList.contains('is-closed')).toBe(false);
  });

  it('holds a battle for its terrain, but only for so long', async () => {
    veil.enableSceneVeil();
    const closing = veil.closeSceneVeil(sceneWith(false));
    await vi.advanceTimersByTimeAsync(veil.SCENE_VEIL.closeMs);
    const token = await closing;
    const events = emitter();
    const battle = { events, _battlefieldTerrain: { ready: new Promise(() => {}) } };
    veil.openSceneVeilWhenReady(token, { get: () => battle }, 'Battle');
    events.emit('create');
    await vi.advanceTimersByTimeAsync(veil.SCENE_VEIL.battleHoldMs - 50);
    expect(doc.made[0].classList.contains('is-closed')).toBe(true);
    await vi.advanceTimersByTimeAsync(60);
    expect(doc.made[0].classList.contains('is-closed')).toBe(false);
  });

  it('opens at once when the scene manager cannot hand back the scene', async () => {
    veil.enableSceneVeil();
    const closing = veil.closeSceneVeil(sceneWith(false));
    await vi.advanceTimersByTimeAsync(veil.SCENE_VEIL.closeMs);
    const token = await closing;
    veil.openSceneVeilWhenReady(token, { get: () => null }, 'Nowhere');
    expect(doc.made[0].classList.contains('is-closed')).toBe(false);
  });
});
