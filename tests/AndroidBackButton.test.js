// The Android app's system Back: Cancel on the input bus, except at the title's
// root menu (send the app to the background). Never installed off Android.
import { describe, expect, it, vi } from 'vitest';

import {
  androidCapacitor,
  backButtonOutcome,
  installAndroidBackButton,
} from '../src/utils/androidBackButton.js';
import { InputAction } from '../src/utils/InputActions.js';

function fakeWin({ platform = 'android', native = true, plugins = ['App'] } = {}) {
  const listeners = [];
  const calls = [];
  const win = {
    Capacitor: {
      isNativePlatform: () => native,
      getPlatform: () => platform,
      PluginHeaders: plugins.map((name) => ({ name })),
      nativePromise: (plugin, method, options) => {
        calls.push({ plugin, method, options });
        return Promise.resolve();
      },
      addListener: (plugin, event, fn) => {
        const handle = { plugin, event, fn, removed: false };
        handle.remove = async () => {
          handle.removed = true;
        };
        listeners.push(handle);
        return handle;
      },
    },
  };
  const press = () => {
    for (const l of listeners) if (l.event === 'backButton' && !l.removed) l.fn({});
  };
  return { win, listeners, calls, press };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Android back button', () => {
  it('is installed only in the Android app with the App plugin', () => {
    expect(androidCapacitor(fakeWin().win)).not.toBeNull();
    expect(androidCapacitor(fakeWin({ platform: 'ios' }).win)).toBeNull();
    expect(androidCapacitor(fakeWin({ native: false, platform: 'web' }).win)).toBeNull();
    expect(androidCapacitor(fakeWin({ plugins: ['Filesystem'] }).win)).toBeNull();
    expect(androidCapacitor({})).toBeNull();

    for (const env of [fakeWin({ platform: 'ios' }), fakeWin({ native: false })]) {
      installAndroidBackButton({ win: env.win, dispatch: () => {} });
      expect(env.listeners).toHaveLength(0);
    }
  });

  it('sends Cancel to whatever holds focus (a battle, an overlay)', async () => {
    const env = fakeWin();
    const dispatch = vi.fn();
    const battle = {};
    installAndroidBackButton({ win: env.win, dispatch, getOwner: () => battle });
    env.press();
    await flush();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(InputAction.CANCEL);
    expect(env.calls).toHaveLength(0);
  });

  it('sends the app to the background at the title root, never exiting it', async () => {
    const env = fakeWin();
    const dispatch = vi.fn();
    const title = { isAtRootMenu: () => true };
    installAndroidBackButton({ win: env.win, dispatch, getOwner: () => title });
    env.press();
    await flush();
    expect(dispatch).not.toHaveBeenCalled();
    expect(env.calls).toEqual([{ plugin: 'App', method: 'minimizeApp', options: {} }]);
  });

  it('cancels when the title has a menu open, or when the owner check throws', () => {
    expect(backButtonOutcome({ isAtRootMenu: () => false })).toBe('cancel');
    expect(
      backButtonOutcome({
        isAtRootMenu: () => {
          throw new Error('torn down');
        },
      }),
    ).toBe('cancel');
    expect(backButtonOutcome(null)).toBe('cancel');
    expect(backButtonOutcome({ isAtRootMenu: () => true })).toBe('minimize');
  });

  it('uninstalls its listener', async () => {
    const env = fakeWin();
    const dispatch = vi.fn();
    const uninstall = installAndroidBackButton({ win: env.win, dispatch, getOwner: () => null });
    uninstall();
    await flush();
    env.press();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
