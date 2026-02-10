// HintManager — Tracks seen tutorial hints per save slot
// No Phaser deps. Uses localStorage independently of meta/run saves.

const KEY_PREFIX = 'emblem_rogue_slot_';
const KEY_SUFFIX = '_hints';

function getKey(slot) {
  return `${KEY_PREFIX}${slot}${KEY_SUFFIX}`;
}

export class HintManager {
  constructor(slot) {
    this.slot = slot;
    this.seen = new Set();
    try {
      const raw = localStorage.getItem(getKey(slot));
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) arr.forEach(id => this.seen.add(id));
      }
    } catch (_) { /* incognito / corrupt */ }
  }

  /** Returns true on first call for a given id (and marks it seen). False thereafter. */
  shouldShow(id) {
    if (this.seen.has(id)) return false;
    this.markSeen(id);
    return true;
  }

  hasSeen(id) {
    return this.seen.has(id);
  }

  markSeen(id) {
    this.seen.add(id);
    this._save();
  }

  _save() {
    try {
      localStorage.setItem(getKey(this.slot), JSON.stringify([...this.seen]));
    } catch (_) { /* incognito / quota exceeded */ }
  }

  static deleteForSlot(slot) {
    try {
      localStorage.removeItem(getKey(slot));
    } catch (_) { /* ignore */ }
  }
}
