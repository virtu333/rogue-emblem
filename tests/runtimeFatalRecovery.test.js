import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRuntimeFatalRecovery,
  getSceneGuardRuntimeContext,
} from '../src/utils/SceneGuard.js';
import { isAudioDeviceFault, AUDIO_FAULTS_KEY } from '../src/utils/audioDeviceFaults.js';

function createEventEnv() {
  const listeners = new Map();
  return {
    location: { reload: vi.fn() },
    addEventListener(eventName, handler) {
      if (!listeners.has(eventName)) listeners.set(eventName, new Set());
      listeners.get(eventName).add(handler);
    },
    removeEventListener(eventName, handler) {
      const handlers = listeners.get(eventName);
      if (!handlers) return;
      handlers.delete(handler);
      if (handlers.size === 0) listeners.delete(eventName);
    },
    emit(eventName, payload) {
      for (const handler of Array.from(listeners.get(eventName) || [])) {
        handler(payload);
      }
    },
    listenerCount(eventName) {
      return listeners.get(eventName)?.size || 0;
    },
  };
}

function createDocumentHarness() {
  const elementsById = new Map();
  const register = (el) => {
    if (el?.id) elementsById.set(el.id, el);
  };
  const makeElement = (tagName) => ({
    tagName,
    style: {},
    id: '',
    textContent: '',
    children: [],
    parentNode: null,
    onclick: null,
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      register(child);
      return child;
    },
    remove() {
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      }
      if (this.id) elementsById.delete(this.id);
    },
  });
  const body = makeElement('body');
  return {
    body,
    createElement: (tagName) => makeElement(tagName),
    getElementById: (id) => elementsById.get(id) || null,
  };
}

afterEach(() => {
  delete globalThis[AUDIO_FAULTS_KEY];
  delete globalThis.__sceneState;
  delete globalThis.__sceneTraceTail;
});

describe('runtime fatal recovery', () => {
  it('shows recovery overlay and emits diagnostics when armed', () => {
    const env = createEventEnv();
    const documentRef = createDocumentHarness();
    const mark = vi.fn();
    const report = vi.fn();
    const onReload = vi.fn();
    const onSafeReload = vi.fn();
    const recovery = createRuntimeFatalRecovery({
      env,
      documentRef,
      mark,
      report,
      onReload,
      onSafeReload,
      getSceneContext: () => ({
        sceneKey: 'Battle',
        traceTail: [{ type: 'scene_create' }],
      }),
    });
    recovery.arm();

    env.emit('error', {
      message: 'battle crash',
      filename: 'battle.js',
      lineno: 42,
      colno: 3,
      error: new Error('battle crash'),
    });

    const overlay = documentRef.getElementById('runtime-fatal-overlay');
    expect(overlay).toBeTruthy();
    expect(report).toHaveBeenCalledWith(
      'runtime_fatal',
      expect.any(Error),
      expect.objectContaining({
        kind: 'error',
        sceneKey: 'Battle',
        traceTail: [{ type: 'scene_create' }],
      }),
    );
    expect(mark).toHaveBeenCalledWith(
      'runtime_fatal_detected',
      expect.objectContaining({
        kind: 'error',
        sceneKey: 'Battle',
      }),
    );

    const panel = overlay.children[0];
    const reloadBtn = panel.children.find((child) => child.textContent === 'Reload');
    const safeBtn = panel.children.find((child) => child.textContent === 'Reload Safe Mode');
    expect(reloadBtn).toBeTruthy();
    expect(safeBtn).toBeTruthy();

    reloadBtn.onclick();
    safeBtn.onclick();

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onSafeReload).toHaveBeenCalledTimes(1);
  });

  it('dedupes repeated identical errors and avoids overlay stacking', () => {
    const env = createEventEnv();
    const documentRef = createDocumentHarness();
    const mark = vi.fn();
    const report = vi.fn();
    const recovery = createRuntimeFatalRecovery({
      env,
      documentRef,
      mark,
      report,
    });
    recovery.arm();

    const payload = {
      message: 'same crash',
      filename: 'main.js',
      lineno: 10,
      colno: 1,
      error: new Error('same crash'),
    };

    env.emit('error', payload);
    env.emit('error', payload);

    expect(documentRef.body.children).toHaveLength(1);
    expect(report).toHaveBeenCalledTimes(1);
  });
});

describe('getSceneGuardRuntimeContext', () => {
  it('returns active scene and ring-buffer tail', () => {
    globalThis.__sceneState = {
      activeScene: 'Battle',
      _ringBuffer: [{ idx: 1 }, { idx: 2 }, { idx: 3 }],
    };

    const ctx = getSceneGuardRuntimeContext({ tailSize: 2 });
    expect(ctx.sceneKey).toBe('Battle');
    expect(ctx.traceTail).toEqual([{ idx: 2 }, { idx: 3 }]);
  });

  describe('audio device faults', () => {
    function webkitRefusal() {
      const error = new Error('Failed to start the audio device');
      error.name = 'InvalidStateError';
      return error;
    }
    function armed() {
      const env = createEventEnv();
      const documentRef = createDocumentHarness();
      const mark = vi.fn();
      const report = vi.fn();
      const recovery = createRuntimeFatalRecovery({
        env,
        documentRef,
        mark,
        report,
        getSceneContext: () => ({ sceneKey: 'Battle', traceTail: [] }),
      });
      recovery.arm();
      return { env, documentRef, mark, report, recovery };
    }

    it('passes over the WebKit refusal as a rejection: no modal, recorded locally', () => {
      const { env, documentRef, mark, report, recovery } = armed();
      const preventDefault = vi.fn();
      env.emit('unhandledrejection', { reason: webkitRefusal(), preventDefault });
      expect(documentRef.getElementById('runtime-fatal-overlay')).toBeNull();
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(report).not.toHaveBeenCalled();
      expect(mark).toHaveBeenCalledWith(
        'runtime_nonfatal_audio',
        expect.objectContaining({
          message: 'Failed to start the audio device',
          sceneKey: 'Battle',
        }),
      );
      const faults = globalThis[AUDIO_FAULTS_KEY];
      expect(faults).toHaveLength(1);
      expect(faults[0]).toMatchObject({
        source: 'unhandledrejection',
        name: 'InvalidStateError',
        message: 'Failed to start the audio device',
        sceneKey: 'Battle',
      });
      recovery.destroy();
    });

    it('passes over the refusal as an error event and as a bare message', () => {
      const { env, documentRef, recovery } = armed();
      env.emit('error', { message: 'InvalidStateError: Failed to start the audio device' });
      env.emit('error', { error: webkitRefusal(), message: 'Failed to start the audio device' });
      env.emit('unhandledrejection', { reason: 'Failed to start the audio device' });
      expect(documentRef.getElementById('runtime-fatal-overlay')).toBeNull();
      recovery.destroy();
    });

    it('still shows the modal for a real game error after an audio fault', () => {
      const { env, documentRef, report, recovery } = armed();
      env.emit('unhandledrejection', { reason: webkitRefusal() });
      env.emit('unhandledrejection', { reason: new TypeError("reading 'context' of undefined") });
      expect(documentRef.getElementById('runtime-fatal-overlay')).toBeTruthy();
      expect(report).toHaveBeenCalledTimes(1);
      recovery.destroy();
    });

    it('recognises audio engine failures only', () => {
      const dom = (name, message) => Object.assign(new Error(message), { name });
      expect(isAudioDeviceFault(webkitRefusal())).toBe(true);
      expect(isAudioDeviceFault(dom('Error', 'Failed to resume the audio device'))).toBe(true);
      expect(
        isAudioDeviceFault(dom('InvalidStateError', 'Cannot resume a closed AudioContext.')),
      ).toBe(true);
      expect(
        isAudioDeviceFault(dom('NotAllowedError', 'The AudioContext was not allowed to start.')),
      ).toBe(true);
      // An InvalidStateError that is not about audio is a game error.
      expect(
        isAudioDeviceFault(dom('InvalidStateError', 'The object is in an invalid state.')),
      ).toBe(false);
      expect(isAudioDeviceFault(dom('TypeError', 'audio context is undefined'))).toBe(false);
      expect(isAudioDeviceFault(new Error('battle crash'))).toBe(false);
      expect(isAudioDeviceFault(null)).toBe(false);
      expect(isAudioDeviceFault(undefined)).toBe(false);
    });
  });
});
