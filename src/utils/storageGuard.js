// storageGuard.js — session-only play when the browser blocks site data.
//
// With site data blocked, merely reading `window.localStorage` (or `sessionStorage`) throws a
// SecurityError, and the save layers' `storage = globalThis.localStorage` defaults threw before
// their own try/catch could run, so the Title screen came up blank. This module is the first
// import of main.js: it probes localStorage once and, if it refuses, installs an in-memory
// Storage in its place. Every later read (saves, settings, the Supabase session) then works for
// the life of the tab, and nothing outlives it. `showSessionOnlyNotice` tells the player.
//
// sessionStorage is deliberately left alone: its one reader (sceneLoader's stale-chunk reload)
// treats a refusal as "do not reload", while an in-memory one would reset its once-per-session
// counter on every reload and wipe the run.
//
// A store that is merely full or read-only (a getter that works, a setItem that throws) is left
// alone: the save layers already handle that, with their own retry prompts.

const STORES = ['localStorage'];

/** The Storage interface over a Map, so callers cannot tell it from the real one. */
export class MemoryStorage {
  #items = new Map();

  get length() {
    return this.#items.size;
  }

  key(index) {
    const keys = [...this.#items.keys()];
    return index >= 0 && index < keys.length ? keys[index] : null;
  }

  getItem(key) {
    const k = String(key);
    return this.#items.has(k) ? this.#items.get(k) : null;
  }

  setItem(key, value) {
    this.#items.set(String(key), String(value));
  }

  removeItem(key) {
    this.#items.delete(String(key));
  }

  clear() {
    this.#items.clear();
  }
}

function storeRefuses(target, name) {
  try {
    return !target[name];
  } catch {
    return true;
  }
}

/**
 * Replace a refused store on `target` with a MemoryStorage. Returns the names replaced
 * (empty when storage works). Safe to call twice: a replaced store reads fine the second time.
 */
export function installSessionStorageFallback(target = globalThis) {
  const replaced = [];
  for (const name of STORES) {
    if (!storeRefuses(target, name)) continue;
    const memory = new MemoryStorage();
    try {
      Object.defineProperty(target, name, { configurable: true, get: () => memory });
    } catch {
      continue; // Not redefinable here: leave it to the save layers' own guards.
    }
    replaced.push(name);
  }
  if (replaced.length) {
    try {
      target.__emblemRogueSessionOnly = true;
    } catch {
      // A frozen global: the notice still shows from the returned list.
    }
  }
  return replaced;
}

export const isSessionOnly = (target = globalThis) => target.__emblemRogueSessionOnly === true;

export const SESSION_ONLY_NOTICE =
  "Browser storage is blocked, so your progress won't be saved if you reload or close this tab.";

/** A small dismissible note at the bottom-left, gone on its own after a while; once per page. */
export const SESSION_ONLY_NOTICE_MS = 20000;

export function showSessionOnlyNotice(doc = globalThis.document) {
  if (!doc?.body || doc.getElementById('session-only-notice')) return null;
  const note = doc.createElement('aside');
  note.id = 'session-only-notice';
  note.className = 'session-only-notice';
  note.setAttribute('role', 'status');
  const text = doc.createElement('span');
  text.textContent = SESSION_ONLY_NOTICE;
  const dismiss = doc.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = '×';
  dismiss.setAttribute('aria-label', 'Dismiss storage notice');
  dismiss.onclick = () => note.remove();
  note.append(text, dismiss);
  doc.body.append(note);
  globalThis.setTimeout?.(() => note.remove(), SESSION_ONLY_NOTICE_MS);
  return note;
}

const replaced = installSessionStorageFallback();
if (replaced.length && typeof document !== 'undefined') {
  const show = () => showSessionOnlyNotice();
  if (document.body) show();
  else document.addEventListener('DOMContentLoaded', show, { once: true });
}
