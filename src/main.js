// Emblem Rogue — Entry Point

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

// Module-level cloud state accessible by scenes via import
export let cloudState = null;

// Create Web Audio context early so Phaser always reuses it (starts suspended).
// Call unlockAudio() during a user gesture to resume it before Phaser boots.
const sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();

function unlockAudio() {
  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume();
  }
}

function bootGame(user) {
  if (user) {
    cloudState = {
      userId: user.id,
      displayName: user.user_metadata?.display_name || 'Player',
    };
  }

  // Stop auth screen animation + music before Phaser takes over
  if (window.stopAuthScreen) window.stopAuthScreen();

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
    audio: {
      disableWebAudio: false,
      context: sharedAudioContext,
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  };

  new Phaser.Game(config);
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
  // No Supabase configured — boot directly in offline mode
  authOverlay.style.display = 'none';
  bootGame(null);
} else {
  // Check existing session
  getSession().then(async (session) => {
    if (session) {
      try {
        await fetchAllToLocalStorage(session.user.id);
      } catch (_) { /* offline fallback — localStorage has stale data */ }
      bootGame(session.user);
    }
    // else: show auth overlay (already visible)
  }).catch(() => {
    // Supabase unreachable — show auth overlay
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

authSkip.addEventListener('click', () => {
  unlockAudio();
  bootGame(null);
});

authForm.addEventListener('submit', async (e) => {
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
      await fetchAllToLocalStorage(user.id);
    } catch (_) { /* offline — proceed with whatever localStorage has */ }
    bootGame(user);
  } catch (err) {
    authError.textContent = err.message || 'Authentication failed';
    authSubmit.disabled = false;
    authSubmit.textContent = isRegisterMode ? 'Register' : 'Log In';
  }
});
