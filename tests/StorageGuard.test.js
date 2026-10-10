import { describe, it, expect } from 'vitest';
import {
  MemoryStorage,
  installSessionStorageFallback,
  showSessionOnlyNotice,
  SESSION_ONLY_NOTICE,
} from '../src/utils/storageGuard.js';
import { readPendingRunSeed, writePendingRunSeed } from '../src/utils/pendingRunSeed.js';
import { getSlotSummary } from '../src/engine/SlotManager.js';

function blockedTarget() {
  const target = {};
  for (const name of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(target, name, {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  }
  return target;
}

describe('storage guard', () => {
  it('replaces getters that throw with a working in-memory store', () => {
    const target = blockedTarget();
    expect(() => target.localStorage).toThrow();
    expect(installSessionStorageFallback(target).sort()).toEqual([
      'localStorage',
      'sessionStorage',
    ]);
    target.localStorage.setItem('a', 1);
    expect(target.localStorage.getItem('a')).toBe('1');
    expect(target.localStorage.getItem('missing')).toBeNull();
    expect(target.localStorage.length).toBe(1);
    expect(target.localStorage.key(0)).toBe('a');
    target.localStorage.removeItem('a');
    expect(target.localStorage.length).toBe(0);
    expect(target.__emblemRogueSessionOnly).toBe(true);
  });

  it('keeps what was written for the session and keeps the stores apart', () => {
    const target = blockedTarget();
    installSessionStorageFallback(target);
    target.localStorage.setItem('k', 'v');
    expect(target.localStorage.getItem('k')).toBe('v');
    expect(target.sessionStorage.getItem('k')).toBeNull();
  });

  it('leaves working storage alone', () => {
    const real = new MemoryStorage();
    const target = { localStorage: real, sessionStorage: new MemoryStorage() };
    expect(installSessionStorageFallback(target)).toEqual([]);
    expect(target.localStorage).toBe(real);
    expect(target.__emblemRogueSessionOnly).toBeUndefined();
  });

  it('lets the save layers read their default storage without throwing', () => {
    const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    try {
      expect(() => getSlotSummary(1)).toThrow(); // the failure this guards against
      installSessionStorageFallback(globalThis);
      expect(() => getSlotSummary(1)).not.toThrow();
      const registry = new Map([['activeSlot', 1]]);
      writePendingRunSeed(registry, 42);
      expect(readPendingRunSeed(registry)).toBe(42);
    } finally {
      if (before) Object.defineProperty(globalThis, 'localStorage', before);
      else delete globalThis.localStorage;
      delete globalThis.__emblemRogueSessionOnly;
    }
  });
});

describe('session-only notice', () => {
  it('adds one dismissible status note', () => {
    const made = [];
    const makeEl = (tag) => {
      const el = {
        tag,
        children: [],
        id: '',
        append(...c) {
          this.children.push(...c);
        },
        setAttribute() {},
        remove() {
          this.removed = true;
        },
      };
      made.push(el);
      return el;
    };
    const body = {
      kids: [],
      append(el) {
        this.kids.push(el);
      },
    };
    const doc = {
      body,
      createElement: makeEl,
      getElementById: (id) => body.kids.find((k) => k.id === id) || null,
    };
    const note = showSessionOnlyNotice(doc);
    expect(note.children[0].textContent).toBe(SESSION_ONLY_NOTICE);
    expect(showSessionOnlyNotice(doc)).toBeNull();
    note.children[1].onclick();
    expect(note.removed).toBe(true);
  });
});
