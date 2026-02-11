// Emblem Rogue - Entry Point

import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { TitleScene } from './scenes/TitleScene.js';
import { SlotPickerScene } from './scenes/SlotPickerScene.js';
import { HomeBaseScene } from './scenes/HomeBaseScene.js';
import { BattleScene } from './scenes/BattleScene.js';
import { NodeMapScene } from './scenes/NodeMapScene.js';
import { RunCompleteScene } from './scenes/RunCompleteScene.js';
import { supabase, signUp, signIn, getSession } from './cloud/supabaseClient.js';
import { fetchAllToLocalStorage } from './cloud/CloudSync.js';
import { getStartupFlags } from './utils/runtimeFlags.js';
import { initStartupTelemetry, markStartup } from './utils/startupTelemetry.js';

// Module-level cloud state accessible by scenes via import
export let cloudState = null;
const GAME_BOOT_FLAG = '__emblemRogueGameBooted';
const GAME_INSTANCE_KEY = '__emblemRogueGame';
const SHARED_AUDIO_CTX_KEY = '__emblemRogueSharedAudioContext';
const startupFlags = getStartupFlags();
const CLOUD_SYNC_TIMEOUT_MS = startupFlags.mobileSafeBoot ? 1200 : 1500;

initStartupTelemetry({
  isMobile: startupFlags.isMobile,
  mobileSafeBoot: startupFlags.mobileSafeBoot,
  reducedPreload: startupFlags.reducedPreload,
});

// Create Web Audio context early so Phaser always reuses it (starts suspended).
// Call unlockAudio() during a user gesture to resume it before Phaser boots.
const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
const sharedAudioContext = window[SHARED_AUDIO_CTX_KEY]
  || (AudioContextCtor ? new AudioContextCtor() : null);
if (sharedAudioContext) window[SHARED_AUDIO_CTX_KEY] = sharedAudioContext;

function unlockAudio() {
  if (sharedAudioContext?.state === 'suspended') {
    sharedAudioContext.resume();
  }
}

async function startCloudPull(userId, mode) {
  markStartup('cloud_sync_gate_start', { mode, timeoutMs: CLOUD_SYNC_TIMEOUT_MS });
  await fetchAllToLocalStorage(userId, { timeoutMs: CLOUD_SYNC_TIMEOUT_MS });
  markStartup('cloud_sync_gate_done', { mode });
}

function bootGame(user) {
  if (window[GAME_BOOT_FLAG] || window[GAME_INSTANCE_KEY]) return;
  window[GAME_BOOT_FLAG] = true;
  markStartup('phaser_boot_start', { hasUser: !!user });

  if (user) {
    cloudState = {
      userId: user.id,
      displayName: user.user_metadata?.display_name || 'Player',
    };
  }

  // Stop auth screen animation + music before Phaser takes over
  if (window.stopAuthScreen) window.stopAuthScreen();

  // Remove auth listeners to prevent stale handlers from re-triggering
  authSkip.removeEventListener('click', handleSkip);
  authForm.removeEventListener('submit', handleSubmit);

  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('game-container').style.display = 'block';

  const config = {
    type: Phaser.AUTO,
    width: 640,
    height: 480,
    pixelArt: true,
    backgroundColor: '#0a0c1e',
    parent: 'game-container',
    scene: [BootScene, TitleScene, SlotPickerScene, HomeBaseScene, NodeMapScene, BattleScene, RunCompleteScene],
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
  markStartup('phaser_boot_complete');
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
  getSession().then(async (session) => {
    if (session) {
      try {
        await startCloudPull(session.user.id, 'session');
      } catch (_) {
        markStartup('cloud_sync_gate_fallback', { mode: 'session' });
      }
      bootGame(session.user);
      fetchAllToLocalStorage(session.user.id, { timeoutMs: CLOUD_SYNC_TIMEOUT_MS }).catch(() => {});
    }
    // else: show auth overlay (already visible)
  }).catch(() => {
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
  bootGame(null);
}

async function handleSubmit(e) {
  e.preventDefault();
  unlockAudio();
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

    const user = result.user;
    try {
      await startCloudPull(user.id, 'login');
    } catch (_) {
      markStartup('cloud_sync_gate_fallback', { mode: 'login' });
    }
    bootGame(user);
    fetchAllToLocalStorage(user.id, { timeoutMs: CLOUD_SYNC_TIMEOUT_MS }).catch(() => {});
  } catch (err) {
    authError.textContent = err.message || 'Authentication failed';
    authSubmit.disabled = false;
    authSubmit.textContent = isRegisterMode ? 'Register' : 'Log In';
  }
}

authSkip.addEventListener('click', handleSkip);
authForm.addEventListener('submit', handleSubmit);
