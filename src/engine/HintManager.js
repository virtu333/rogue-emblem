// HintManager — Tracks seen tutorial hints per save slot
// No Phaser deps. Seen-state is mirrored locally and persisted with slot meta.

const KEY_PREFIX = 'emblem_rogue_slot_';
const KEY_SUFFIX = '_hints';

function getKey(slot) {
  return `${KEY_PREFIX}${slot}${KEY_SUFFIX}`;
}

export class HintManager {
  constructor(slot, enabled = () => true, meta = null) {
    this.meta = meta;
    this.enabled = enabled;
    this.slot = slot;
    this.seen = new Set();
    this.isNew = true;
    try {
      const raw = localStorage.getItem(getKey(slot));
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          this.isNew = false;
          arr.forEach((id) => this.seen.add(id));
        }
      }
    } catch (_) {
      /* incognito / corrupt */
    }
    if (Array.isArray(meta?.hintState?.seen)) {
      this.seen = new Set(meta.hintState.seen.filter((id) => typeof id === 'string'));
      this.isNew = false;
    } else if (meta && !this.isNew) {
      this._save(); // Migrate this slot's existing lessons into its cloud meta.
    }
  }

  _adoptPersisted() {
    this.meta?._adoptForeignDiskStateIfNewer?.();
    const state = this.meta?.hintState;
    if (Array.isArray(state?.seen) && Number(state.updatedAt || 0) > Number(this.updatedAt || 0)) {
      this.seen = new Set(state.seen.filter((id) => typeof id === 'string'));
      this.updatedAt = state.updatedAt;
      this.isNew = false;
    }
  }

  /** Returns true on first call for a given id (and marks it seen). False thereafter. */
  shouldShow(id) {
    this._adoptPersisted();
    if (!this.enabled() || this.seen.has(id)) return false;
    this.markSeen(id);
    return true;
  }

  reset() {
    this._adoptPersisted();
    this.isNew = false;
    this.seen.clear();
    this._save();
  }

  hasSeen(id) {
    this._adoptPersisted();
    return this.seen.has(id);
  }

  markSeen(id) {
    this._adoptPersisted();
    this.isNew = false;
    this.seen.add(id);
    this._save();
  }

  _save() {
    if (this.meta) {
      this.meta.hintState = {
        seen: [...this.seen],
        updatedAt: Math.max(Date.now(), Number(this.meta.hintState?.updatedAt || 0) + 1),
      };
      this.updatedAt = this.meta.hintState.updatedAt;
      this.meta._save();
    }
    try {
      localStorage.setItem(getKey(this.slot), JSON.stringify([...this.seen]));
    } catch (_) {
      /* incognito / quota exceeded */
    }
  }

  static deleteForSlot(slot) {
    try {
      localStorage.removeItem(getKey(slot));
    } catch (_) {
      /* ignore */
    }
  }
}
