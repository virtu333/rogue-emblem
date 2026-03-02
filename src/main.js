// Emblem Rogue - Entry Point

import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { supabase, signUp, signIn, getSession } from './cloud/supabaseClient.js';
import { fetchAllToLocalStorage, getCloudSyncStatus } from './cloud/CloudSync.js';
import { getStartupFlags } from './utils/runtimeFlags.js';
import { MobileControls } from './utils/MobileControls.js';
import {
  getStartupTelemetry,
  initStartupTelemetry,
  markStartup,
} from './utils/startupTelemetry.js';
import { reportAsyncError } from './utils/errorReporter.js';
import { createStartupViewportGuard } from './utils/startupViewportGuard.js';
import { createViewportReconciler } from './utils/viewportReconciler.js';
import { requireAuthUser } from './auth/requireAuthUser.js';

// Module-level cloud state accessible by scenes via import
export let cloudState = null;
const GAME_BOOT_FLAG = '__emblemRogueGameBooted';
const GAME_INSTANCE_KEY = '__emblemRogueGame';
const SHARED_AUDIO_CTX_KEY = '__emblemRogueSharedAudioContext';
const STARTUP_FLAG_STORAGE_KEY = 'emblem_rogue_startup_flags';
const startupFlags = getStartupFlags();
const CLOUD_SYNC_TIMEOUT_MS = startupFlags.mobileSafeBoot ? 1200 : 1500;
const BOOT_WATCHDOG_TIMEOUT_MS = startupFlags.mobileSafeBoot ? 30000 : 22000;
const STARTUP_VIEWPORT_GUARD_TIMEOUT_MS = Math.max(
  BOOT_WATCHDOG_TIMEOUT_MS,
  startupFlags.mobileSafeBoot ? 18000 : 14000,
);
const startupQuery = new URLSearchParams(globalThis?.location?.search || '');
const devStartupRequested = startupQuery.has('qaStep') || startupQuery.has('devScene');

initStartupTelemetry({
  isMobile: startupFlags.isMobile,
  isIOSSafari: startupFlags.isIOSSafari,
  mobileSafeBoot: startupFlags.mobileSafeBoot,
  reducedPreload: startupFlags.reducedPreload,
  startupViewportGuard: startupFlags.startupViewportGuard,
});

const startupViewportGuard = createStartupViewportGuard({
  enabled: startupFlags.startupViewportGuard,
  timeoutMs: STARTUP_VIEWPORT_GUARD_TIMEOUT_MS,
  mark: markStartup,
  gameGetter: () => window[GAME_INSTANCE_KEY],
});
let startupActivationWindowOpen = true;

function hasGameBootStarted() {
  return !!(window[GAME_BOOT_FLAG] || window[GAME_INSTANCE_KEY]);
}

function closeStartupActivationWindow() {
  startupActivationWindowOpen = false;
}

function activateStartupViewportGuard(reason) {
  const gameBootStarted = hasGameBootStarted();
  if (!startupActivationWindowOpen || gameBootStarted) {
    markStartup('startup_viewport_guard_activate_skipped', {
      reason,
      startupWindowOpen: startupActivationWindowOpen,
      gameBootStarted,
    });
    return false;
  }
  return startupViewportGuard.activate(reason);
}

function shouldIgnoreLateSessionRestore() {
  return !startupActivationWindowOpen || hasGameBootStarted();
}

function installDevDiagnostics() {
  const host = globalThis?.location?.hostname;
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';
  let forced = false;
  try {
    const raw = globalThis?.localStorage?.getItem('emblem_rogue_audio_diag');
    forced = raw === '1' || raw === 'true';
  } catch (_) {}
  if (!isLocalHost && !forced) return;

  window.__emblemDumpStartupTelemetry = (filter = null) => {
    const telemetry = getStartupTelemetry();
    if (!telemetry) {
      console.info('[StartupDiag] telemetry unavailable');
      return null;
    }
    const markers = Array.isArray(telemetry.markers) ? telemetry.markers : [];
    const filtered =
      typeof filter === 'string' && filter.length > 0
        ? markers.filter((m) => String(m?.name || '').includes(filter))
        : markers;
    const rows = filtered.map((m, idx) => ({
      idx,
      name: m?.name || null,
      at: Number.isFinite(m?.at) ? Math.round(m.at) : null,
      data: m?.data || {},
    }));
    console.info('[StartupDiag] markers:', rows);
    return rows;
  };

  window.__emblemDumpAudioDiag = () => {
    const all = window.__emblemDumpStartupTelemetry('audio_diag') || [];
    const asyncErrors = window.__emblemDumpStartupTelemetry('async_error') || [];
    const summary = {
      audioDiagCount: all.length,
      asyncErrorCount: asyncErrors.length,
    };
    console.info('[StartupDiag] audio summary:', summary);
    return { summary, audioDiag: all, asyncErrors };
  };
}
installDevDiagnostics();

function enableSafeBootAndReload() {
  try {
    const raw = localStorage.getItem(STARTUP_FLAG_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const next = {
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
      mobileSafeBoot: true,
      reducedPreload: true,
    };
    localStorage.setItem(STARTUP_FLAG_STORAGE_KEY, JSON.stringify(next));
    delete globalThis.__emblemRogueStartupFlags;
    markStartup('startup_safe_mode_enabled', next);
  } catch (_) {
    markStartup('startup_safe_mode_enable_failed');
  }
  window.location.reload();
}

function showBootRecoveryOverlay(message) {
  if (document.getElementById('boot-recovery-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'boot-recovery-overlay';
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.background = 'rgba(0, 0, 0, 0.78)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = '99999';

  const panel = document.createElement('div');
  panel.style.background = '#111627';
  panel.style.border = '1px solid #3a4a6b';
  panel.style.padding = '16px';
  panel.style.maxWidth = '420px';
  panel.style.fontFamily = 'monospace';
  panel.style.color = '#e0e0e0';
  panel.style.textAlign = 'center';
  const heading = document.createElement('div');
  heading.style.cssText = 'font-size:16px; color:#ffcc88; margin-bottom:8px;';
  heading.textContent = 'Startup Taking Too Long';
  panel.appendChild(heading);

  const body = document.createElement('div');
  body.style.cssText = 'font-size:12px; color:#bbbbbb; margin-bottom:12px;';
  body.textContent = message;
  panel.appendChild(body);

  const retryBtn = document.createElement('button');
  retryBtn.textContent = 'Reload';
  retryBtn.style.margin = '0 8px';
  retryBtn.style.padding = '8px 12px';
  retryBtn.style.fontFamily = 'monospace';
  retryBtn.style.cursor = 'pointer';
  retryBtn.onclick = () => {
    markStartup('boot_watchdog_reload');
    window.location.reload();
  };

  const safeBtn = document.createElement('button');
  safeBtn.textContent = 'Reload Safe Mode';
  safeBtn.style.margin = '0 8px';
  safeBtn.style.padding = '8px 12px';
  safeBtn.style.fontFamily = 'monospace';
  safeBtn.style.cursor = 'pointer';
  safeBtn.onclick = () => {
    markStartup('boot_watchdog_safe_reload');
    enableSafeBootAndReload();
  };

  panel.appendChild(retryBtn);
  panel.appendChild(safeBtn);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

function hideBootRecoveryOverlay() {
  const overlay = document.getElementById('boot-recovery-overlay');
  if (overlay) overlay.remove();
}

function hasReachedStartupTarget() {
  const telemetry = getStartupTelemetry();
  const markers = telemetry?.markers || [];
  const reachedTitle = markers.some(
    (m) => m.name === 'title_scene_create' || m.name === 'first_interactive_frame',
  );
  if (reachedTitle) return true;
  if (!devStartupRequested) return false;

  return markers.some((m) => {
    if (m?.name === 'boot_dev_route') return true;
    if (m?.name !== 'scene_lazy_load_complete') return false;
    const key = typeof m?.data?.key === 'string' ? m.data.key : '';
    return key.length > 0 && key !== 'Title';
  });
}

function installStartupErrorHooks() {
  window.addEventListener('error', (event) => {
    markStartup('window_error', {
      message: event?.message || 'unknown',
      file: event?.filename || null,
      line: event?.lineno || null,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    markStartup('window_unhandled_rejection', {
      message: reason?.message || String(reason || 'unknown'),
    });
  });
}

function installBootWatchdog() {
  const monitor = window.setInterval(() => {
    if (!hasReachedStartupTarget()) return;
    startupViewportGuard.stop('startup_target_reached');
    hideBootRecoveryOverlay();
    window.clearInterval(monitor);
  }, 1000);

  window.setTimeout(() => {
    if (hasReachedStartupTarget()) {
      startupViewportGuard.stop('startup_target_reached');
      window.clearInterval(monitor);
      return;
    }
    startupViewportGuard.stop('boot_watchdog_timeout');
    markStartup('boot_watchdog_timeout', { timeoutMs: BOOT_WATCHDOG_TIMEOUT_MS });
    const timeoutMessage = devStartupRequested
      ? 'The game did not reach the requested startup scene in time. Try reload or safe mode.'
      : 'The game did not reach the title screen in time. Try reload or safe mode.';
    showBootRecoveryOverlay(timeoutMessage);
    const recover = window.setInterval(() => {
      if (!hasReachedStartupTarget()) return;
      markStartup('boot_watchdog_recovered_after_timeout');
      hideBootRecoveryOverlay();
      window.clearInterval(recover);
      window.clearInterval(monitor);
    }, 1000);
  }, BOOT_WATCHDOG_TIMEOUT_MS);
}
installStartupErrorHooks();

// Create Web Audio context early so Phaser always reuses it (starts suspended).
// Call unlockAudio() during a user gesture to resume it before Phaser boots.
const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
const sharedAudioContext =
  window[SHARED_AUDIO_CTX_KEY] || (AudioContextCtor ? new AudioContextCtor() : null);
if (sharedAudioContext) window[SHARED_AUDIO_CTX_KEY] = sharedAudioContext;

function unlockAudio() {
  if (sharedAudioContext?.state === 'suspended') {
    sharedAudioContext.resume();
  }
}

async function startCloudPull(userId, mode) {
  markStartup('cloud_sync_gate_start', { mode, timeoutMs: CLOUD_SYNC_TIMEOUT_MS });
  const result = await fetchAllToLocalStorage(userId, { timeoutMs: CLOUD_SYNC_TIMEOUT_MS });
  markStartup('cloud_sync_gate_done', { mode });
  return result;
}

function bootGame(user) {
  if (hasGameBootStarted()) return false;
  // Ensure the guard is active at boot time even if a long pre-boot gate
  // outlived a prior activation window.
  activateStartupViewportGuard('boot_game_preflight');
  closeStartupActivationWindow();
  window[GAME_BOOT_FLAG] = true;
  markStartup('phaser_boot_start', { hasUser: !!user });
  installBootWatchdog();

  if (user) {
    cloudState = {
      userId: user.id,
      displayName: user.user_metadata?.display_name || 'Player',
      syncStatus: getCloudSyncStatus(),
    };
  }

  // Stop auth screen animation + music before Phaser takes over
  startupViewportGuard.beforeBootGame();
  if (window.stopAuthScreen) window.stopAuthScreen();

  // Remove auth listeners to prevent stale handlers from re-triggering
  authSkip.removeEventListener('click', handleSkip);
  authForm.removeEventListener('submit', handleSubmit);

  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('game-wrapper').style.display = 'flex';
  document.getElementById('game-container').style.display = 'block';

  const config = {
    type: Phaser.AUTO,
    width: 640,
    height: 480,
    pixelArt: true,
    backgroundColor: '#0a0c1e',
    parent: 'game-container',
    scene: [BootScene],
    audio: sharedAudioContext
      ? {
          disableWebAudio: false,
          context: sharedAudioContext,
        }
      : {
          disableWebAudio: true,
        },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  };

  window[GAME_INSTANCE_KEY] = new Phaser.Game(config);
  startupViewportGuard.reconcileNow('phaser_boot_complete');
  if (startupFlags.isMobile) {
    new MobileControls(window[GAME_INSTANCE_KEY]).show();
  }
  const viewportReconciler = createViewportReconciler({
    enabled: startupFlags.isMobile,
    gameGetter: () => window[GAME_INSTANCE_KEY],
    mark: markStartup,
  });
  viewportReconciler.start();
  markStartup('phaser_boot_complete');
  return true;
}

// --- Auth UI ---

const authOverlay = document.getElementById('auth-overlay');
const authForm = document.getElementById('auth-form');
const authUsername = document.getElementById('auth-username');
const authPassword = document.getElementById('auth-password');
const authSubmit = document.getElementById('auth-submit');
const authError = document.getElementById('auth-error');
const authToggle = document.getElementById('auth-toggle');
const authSkip = document.getElementById('auth-skip');

let isRegisterMode = false;

if (!supabase) {
  // No Supabase configured - boot directly in offline mode
  authOverlay.style.display = 'none';
  markStartup('supabase_unavailable_boot_offline');
  bootGame(null);
} else {
  // Check existing session
  getSession()
    .then(async (session) => {
      if (session) {
        if (shouldIgnoreLateSessionRestore()) {
          markStartup('session_restore_ignored_after_boot');
          return;
        }
        activateStartupViewportGuard('session_restore');
        let pullResult;
        try {
          pullResult = await startCloudPull(session.user.id, 'session');
        } catch (_) {
          markStartup('cloud_sync_gate_fallback', { mode: 'session' });
        }
        if (shouldIgnoreLateSessionRestore()) {
          markStartup('session_restore_ignored_after_boot');
          return;
        }
        const didBoot = bootGame(session.user);
        if (!didBoot) {
          markStartup('session_restore_ignored_after_boot');
          return;
        }
        if (pullResult?.rejectedCount > 0) {
          fetchAllToLocalStorage(session.user.id, { timeoutMs: CLOUD_SYNC_TIMEOUT_MS }).catch(
            (err) => {
              reportAsyncError('cloud_sync_background_session', err, { mode: 'session' });
            },
          );
        }
      }
      // else: show auth overlay (already visible)
    })
    .catch(() => {
      // Supabase unreachable - show auth overlay
      markStartup('session_check_failed');
    });
}

authToggle.addEventListener('click', () => {
  isRegisterMode = !isRegisterMode;
  authSubmit.textContent = isRegisterMode ? 'Register' : 'Log In';
  authToggle.textContent = isRegisterMode
    ? 'Already have an account? Log In'
    : "Don't have an account? Register";
  authError.textContent = '';
});

function handleSkip() {
  unlockAudio();
  activateStartupViewportGuard('offline_skip');
  bootGame(null);
}

async function handleSubmit(e) {
  e.preventDefault();
  unlockAudio();
  activateStartupViewportGuard(isRegisterMode ? 'register_submit' : 'login_submit');
  authError.textContent = '';
  authSubmit.disabled = true;
  authSubmit.textContent = 'Loading...';

  const username = authUsername.value.trim();
  const password = authPassword.value;

  try {
    let result;
    if (isRegisterMode) {
      result = await signUp(username, password);
    } else {
      result = await signIn(username, password);
    }

    const user = requireAuthUser(result);
    let cloudPullResult;
    try {
      cloudPullResult = await startCloudPull(user.id, 'login');
    } catch (_) {
      markStartup('cloud_sync_gate_fallback', { mode: 'login' });
    }
    const didBoot = bootGame(user);
    if (didBoot && cloudPullResult?.rejectedCount > 0) {
      fetchAllToLocalStorage(user.id, { timeoutMs: CLOUD_SYNC_TIMEOUT_MS }).catch((err) => {
        reportAsyncError('cloud_sync_background_login', err, { mode: 'login' });
      });
    }
  } catch (err) {
    startupViewportGuard.stop('auth_submit_error');
    authError.textContent = err.message || 'Authentication failed';
    authSubmit.disabled = false;
    authSubmit.textContent = isRegisterMode ? 'Register' : 'Log In';
  }
}

authSkip.addEventListener('click', handleSkip);
authForm.addEventListener('submit', handleSubmit);
