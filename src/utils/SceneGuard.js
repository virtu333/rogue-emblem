// SceneGuard — Lightweight scene lifecycle instrumentation.
// Exposes window.__sceneState for Playwright E2E tests and dev debugging.
// Hooks Phaser scene create/shutdown events, tracks active scene,
// transition history, sound/tween counts, battle state, overlay visibility,
// and runtime invariants.

import { cleanupScene } from './sceneCleanup.js';

// --- Overlay registries per scene (property → detection strategy) ---
// 'visible'  = object with .visible boolean (persistent or null-pattern with .visible)
// 'truthy'   = null when closed, truthy object when open (no .visible)
// 'boolean'  = plain boolean flag
const OVERLAY_PROPS = {
  Battle: {
    inspectionPanel:    'visible',
    unitDetailOverlay:  'visible',
    dangerZone:         'visible',
    pauseOverlay:       'visible',   // PauseOverlay has .visible flag
    lootSettingsOverlay:'visible',   // SettingsOverlay has .visible flag
    dialogueOverlay:    'visible',   // persistent object, uses .visible
    visionDialog:       'truthy',    // plain object, nulled on close
    lootGroup:          'truthy',    // Phaser group, nulled on close
    debugOverlay:       'visible',   // DebugOverlay has .visible flag (dev-only)
    actionMenu:         'truthy',    // nulled on close
    lootRosterVisible:  'boolean',
  },
  NodeMap: {
    pauseOverlay:    'visible',   // PauseOverlay has .visible flag
    settingsOverlay: 'visible',   // SettingsOverlay has .visible flag
    rosterOverlay:   'visible',   // RosterOverlay has .visible flag
    debugOverlay:    'visible',   // DebugOverlay has .visible flag
    shopOverlay:     'truthy',    // nulled on close
    churchOverlay:   'truthy',    // nulled on close
    forgePicker:     'truthy',    // nulled on close
    unitPicker:      'truthy',    // nulled on close
  },
};

// Invariant dedup window (ms) and cap
const DEDUP_WINDOW = 5_000;
const MAX_ERRORS = 50;
const STUCK_THRESHOLD_MS = 15_000;
const SOUND_LEAK_THRESHOLD = 3;
const SOUND_LEAK_TRANSITION_THRESHOLD = 3; // absolute check after scene transition
const SNAPSHOT_INTERVAL = 30; // frames between periodic checks

// Ring buffer capacity for crash trace
const RING_BUFFER_CAP = 50;

// Per-scene tween tolerance for transition leak detection
// (some scenes have heavier entry animations)
const TRANSITION_TWEEN_TOLERANCE = {
  Battle: 15,   // deploy screen animations
  Title: 20,    // animated background, menu entry animations
  _default: 10,
};

// Module-level guard — prevents duplicate crash dump listeners across
// multiple installSceneGuard() calls (defensive, normally called once).
let _crashDumpInstalled = false;

// Battle states considered "blocking" (game shouldn't show overlays during these)
const BLOCKING_STATES = new Set([
  'COMBAT_RESOLVING', 'HEAL_RESOLVING', 'UNIT_MOVING', 'ENEMY_PHASE',
  'ENEMY_MOVING', 'ENEMY_ATTACKING',
]);

/**
 * Install SceneGuard on a Phaser Game instance.
 * Call once in BootScene.create() after registry setup.
 * @param {Phaser.Game} game
 */
export function installSceneGuard(game) {
  const state = {
    activeScene: null,
    history: [],      // last 20 transitions: { from, to, ts, reason?, pre?, post? }
    sounds: 0,        // currently playing sound count
    tweens: 0,        // active tween count in current scene
    errors: [],       // invariant violation strings (capped at MAX_ERRORS)
    ready: true,      // game booted successfully

    // Battle state tracking
    battle: {
      state: null,       // current battleState string (null when not in Battle)
      prevState: null,   // previous battleState
      stateChangedAt: null,
    },

    // Overlay visibility map — true = visible/open
    overlays: {},

    // NodeMap composite state
    nodeMap: {
      state: null,         // IDLE | SHOP | CHURCH | ROSTER | PAUSED | SETTINGS | DEBUG | FORGE_PICKER | UNIT_PICKER
      activeShopTab: null, // 'buy' | 'sell' | 'forge' | null
    },

    // Transition metadata (set by sceneLoader, consumed in create handler)
    _pendingTransitionMeta: null,

    // Ring buffer for crash trace
    _ringBuffer: [],
  };
  window.__sceneState = state;

  // Baseline sound count recorded at each scene create
  let soundBaseline = 0;
  // Last error timestamps for dedup (bounded, append-only)
  const recentErrors = new Map(); // key → last timestamp

  const hooked = new Set();

  // --- Ring buffer ---

  function pushEvent(type, data) {
    state._ringBuffer.push({ type, ts: Date.now(), d: data });
    if (state._ringBuffer.length > RING_BUFFER_CAP) {
      state._ringBuffer.shift();
    }
  }

  // --- Crash dump (one-shot per page lifecycle) ---

  function installCrashDump() {
    if (_crashDumpInstalled) return;
    _crashDumpInstalled = true;
    const dump = () => {
      const trace = state._ringBuffer.slice();
      const tail = trace.slice(-10);
      console.error('[SceneGuard] Crash trace (last 10):', tail);
      console.error('[SceneGuard] Full trace:', trace);
      window.__sceneTrace = trace;
      window.__sceneTraceTail = tail;
    };
    window.addEventListener('error', dump);
    window.addEventListener('unhandledrejection', dump);
  }
  installCrashDump();

  // --- Helpers ---

  function countPlayingSounds() {
    try {
      return game.sound?.sounds?.filter(s => s && s.isPlaying)?.length || 0;
    } catch (_) {
      return -1;
    }
  }

  function snapshot(scene) {
    state.sounds = countPlayingSounds();
    try {
      state.tweens = scene?.tweens?.getTweens()?.length || 0;
    } catch (_) {
      state.tweens = -1;
    }
  }

  function pushError(key, message) {
    if (state.errors.length >= MAX_ERRORS) return;
    const now = Date.now();
    const last = recentErrors.get(key);
    if (last && now - last < DEDUP_WINDOW) return;
    recentErrors.set(key, now);
    state.errors.push(message);
    pushEvent('invariant_error', { key, message });
  }

  // --- Overlay snapshot ---

  function snapshotOverlays(scene, sceneKey) {
    const registry = OVERLAY_PROPS[sceneKey];
    if (!registry) return;
    const map = {};
    for (const [prop, strategy] of Object.entries(registry)) {
      const val = scene[prop];
      if (strategy === 'visible') {
        // Works for both persistent objects and null-pattern objects:
        // null?.visible === undefined, so this returns false for nulled overlays
        map[prop] = val?.visible === true;
      } else if (strategy === 'boolean') {
        map[prop] = val === true;
      } else {
        // 'truthy' — null/undefined = closed, any object = open
        map[prop] = val != null;
      }
    }
    state.overlays = map;
  }

  // --- NodeMap composite state derivation (visibility-aware) ---

  function deriveNodeMapState(scene) {
    // Priority matches requestCancel() order — use .visible where available
    if (scene.pauseOverlay?.visible) return 'PAUSED';
    if (scene.settingsOverlay?.visible) return 'SETTINGS';
    if (scene.debugOverlay?.visible) return 'DEBUG';
    if (scene.forgePicker) return 'FORGE_PICKER';
    if (scene.unitPicker || scene.unitPickerState) return 'UNIT_PICKER';
    if (scene.rosterOverlay?.visible) return 'ROSTER';
    if (scene.shopOverlay) return 'SHOP';
    if (scene.churchOverlay) return 'CHURCH';
    return 'IDLE';
  }

  function updateNodeMapState(scene) {
    state.nodeMap.state = deriveNodeMapState(scene);
    state.nodeMap.activeShopTab = scene.activeShopTab || null;
  }

  // --- Battle state proxy ---

  function installBattleStateProxy(scene) {
    // Safety: check descriptor before proxy install
    const existing = Object.getOwnPropertyDescriptor(scene, 'battleState');
    if (existing && !existing.configurable) {
      // Non-configurable — can't redefine. Fall back to read-only polling.
      state.battle.state = scene.battleState || null;
      state.battle.prevState = null;
      state.battle.stateChangedAt = Date.now();
      return false; // signal: proxy not installed, use polling fallback
    }

    // Re-sync on scene re-entry — capture current value fresh
    let _val = scene.battleState;
    state.battle.state = _val || null;
    state.battle.prevState = null;
    state.battle.stateChangedAt = Date.now();

    Object.defineProperty(scene, 'battleState', {
      get() { return _val; },
      set(v) {
        const prev = _val;
        _val = v;
        state.battle.state = v;
        state.battle.prevState = prev;
        state.battle.stateChangedAt = Date.now();
        checkBattleInvariants(scene, prev, v);
        pushEvent('battle_state', { from: prev, to: v });
      },
      configurable: true,
      enumerable: true,
    });
    return true; // proxy installed
  }

  // --- Invariant checks ---

  function checkBattleInvariants(scene, prevState, newState) {
    // Invariant: entering blocking state while pause overlay is visible
    if (BLOCKING_STATES.has(newState) && scene.pauseOverlay?.visible) {
      pushError(
        'blocking_with_overlay',
        `blocking_with_overlay: entered ${newState} while pauseOverlay active (from ${prevState})`
      );
    }
  }

  function checkPeriodicInvariants(scene, sceneKey) {
    // Sound leak (delta from baseline)
    const current = countPlayingSounds();
    state.sounds = current;
    if (current >= 0 && current - soundBaseline > SOUND_LEAK_THRESHOLD) {
      pushError(
        'sound_leak_periodic',
        `sound_leak_periodic: ${current} sounds playing (baseline ${soundBaseline}) in ${sceneKey}`
      );
    }

    // Stuck in blocking battle state > 15s
    if (sceneKey === 'Battle' && state.battle.state && state.battle.stateChangedAt) {
      if (BLOCKING_STATES.has(state.battle.state)) {
        const elapsed = Date.now() - state.battle.stateChangedAt;
        if (elapsed > STUCK_THRESHOLD_MS) {
          pushError(
            'stuck_blocking',
            `stuck_blocking: ${state.battle.state} for ${Math.round(elapsed / 1000)}s`
          );
        }
      }
    }
  }

  // --- Transition leak detection (Chunk 3) ---

  function checkTransitionLeaks(sceneKey, mergedMeta) {
    if (!mergedMeta?.pre) return; // No pre-snapshot — skip check

    const soundDelta = state.sounds - mergedMeta.pre.sounds;
    const tweenTolerance = TRANSITION_TWEEN_TOLERANCE[sceneKey]
      || TRANSITION_TWEEN_TOLERANCE._default;

    if (soundDelta > SOUND_LEAK_TRANSITION_THRESHOLD) {
      pushError('transition_sound_leak',
        `transition_sound_leak: +${soundDelta} sounds after ` +
        `${mergedMeta.from} -> ${sceneKey} (reason: ${mergedMeta.reason || 'none'})`);
    }
    if (state.tweens > tweenTolerance) {
      pushError('transition_tween_leak',
        `transition_tween_leak: ${state.tweens} tweens (tolerance ${tweenTolerance}) ` +
        `after ${mergedMeta.from} -> ${sceneKey} (reason: ${mergedMeta.reason || 'none'})`);
    }
  }

  // --- Scene hooks ---

  function hookScene(scene) {
    const key = scene.sys?.settings?.key;
    if (!key || hooked.has(key)) return;
    hooked.add(key);

    let frameCounter = 0;
    let proxyInstalled = false;

    scene.events.on('create', () => {
      const prev = state.activeScene;
      state.activeScene = key;
      state.history.push({ from: prev, to: key, ts: Date.now() });
      if (state.history.length > 20) state.history.shift();

      // Record sound baseline at scene entry
      soundBaseline = countPlayingSounds();
      if (soundBaseline < 0) soundBaseline = 0;
      snapshot(scene);

      // Invariant: excessive sounds after transition
      if (state.sounds > SOUND_LEAK_TRANSITION_THRESHOLD) {
        pushError('sound_leak', `sound_leak: ${state.sounds} playing after transition to ${key}`);
      }

      // Merge transition metadata from sceneLoader (Chunk 1)
      // Token + from/to match prevents stale meta from a prior transition
      let mergedMeta = null;
      const meta = state._pendingTransitionMeta;
      if (meta && meta.token && meta.to === key && meta.from === prev) {
        const last = state.history[state.history.length - 1];
        last.reason = meta.reason;
        last.pre = meta.pre;
        last.post = { sounds: state.sounds, tweens: state.tweens };
        mergedMeta = meta;
      }
      // Always clear — stale meta must never survive to next transition
      state._pendingTransitionMeta = null;

      // Transition leak detection (Chunk 3)
      checkTransitionLeaks(key, mergedMeta);

      // Ring buffer event
      pushEvent('scene_create', { scene: key, from: prev, reason: mergedMeta?.reason });

      // Immediate overlay snapshot on create
      snapshotOverlays(scene, key);

      // Battle state proxy
      if (key === 'Battle') {
        proxyInstalled = installBattleStateProxy(scene);
      }

      // NodeMap state
      if (key === 'NodeMap') {
        updateNodeMapState(scene);
      }

      // Periodic update handler
      frameCounter = 0;
      scene.events.off('update', periodicUpdate); // clean old listener
      scene.events.on('update', periodicUpdate);

      // Register cleanup AFTER scene's own shutdown handler
      // (scene registers its handler in create, we register ours after)
      scene.events.once('shutdown', () => {
        cleanupScene(scene);
      });
    });

    function periodicUpdate() {
      frameCounter++;
      // Immediate overlay snapshot every frame for the first 5 frames after create
      // (catches rapid setup), then throttle to every SNAPSHOT_INTERVAL frames
      if (frameCounter <= 5 || frameCounter % SNAPSHOT_INTERVAL === 0) {
        snapshotOverlays(scene, key);

        if (key === 'NodeMap') {
          updateNodeMapState(scene);
        }

        // Battle state read-only polling fallback (if proxy failed)
        if (key === 'Battle' && !proxyInstalled) {
          const cur = scene.battleState;
          if (cur !== state.battle.state) {
            state.battle.prevState = state.battle.state;
            state.battle.state = cur;
            state.battle.stateChangedAt = Date.now();
          }
        }

        // Periodic invariants (only on throttle interval, not every frame)
        if (frameCounter > 5 && frameCounter % SNAPSHOT_INTERVAL === 0) {
          checkPeriodicInvariants(scene, key);
        }
      }
    }

    scene.events.on('shutdown', () => {
      scene.events.off('update', periodicUpdate);
      snapshot(scene);
      pushEvent('scene_shutdown', { scene: key });

      // Null out scene-specific state
      if (key === 'Battle') {
        state.battle.state = null;
        state.battle.prevState = null;
        state.battle.stateChangedAt = null;
      }
      if (key === 'NodeMap') {
        state.nodeMap.state = null;
        state.nodeMap.activeShopTab = null;
      }
      state.overlays = {};
    });
  }

  // Hook all scenes already registered (Boot at minimum)
  game.scene.scenes.forEach(hookScene);

  // Monkey-patch scene manager add() to hook lazily-loaded scenes
  const origAdd = game.scene.add.bind(game.scene);
  game.scene.add = function (addKey, sceneConfig, autoStart, data) {
    const result = origAdd(addKey, sceneConfig, autoStart, data);
    try {
      const added = game.scene.getScene(addKey);
      if (added) hookScene(added);
    } catch (_) { /* defensive */ }
    return result;
  };
}
