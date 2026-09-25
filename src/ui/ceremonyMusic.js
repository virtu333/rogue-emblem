// ceremonyMusic — the ceremonies' side of the stinger system.
//
// Every ceremony reaches the audio manager the same way: a cue by name, in
// the key of the music playing (AudioManager.playStinger), with the old
// sound effect as its fallback, and never an exception (sound is decoration).

import { BOSS_CARD_CUES } from '../utils/musicConfig.js';

const LEVEL_UP_CUES = Object.freeze({
  normal: 'levelup',
  perfect: 'levelup_perfect',
  blank: 'levelup_blank',
});

/** Stinger for a level-up of `kind` (see growthContent.levelUpKind). */
export function levelUpCue(kind) {
  return LEVEL_UP_CUES[kind] || LEVEL_UP_CUES.normal;
}

/** Stinger for a boss's encounter card, or null (the Entity gets silence). */
export function bossCardCue(bossName) {
  // null is a real answer (silence), so only an unlisted boss gets the generic card
  return Object.hasOwn(BOSS_CARD_CUES, bossName) ? BOSS_CARD_CUES[bossName] : 'boss_card';
}

function audioOf(scene) {
  try {
    return scene?.registry?.get?.('audio') || null;
  } catch {
    return null;
  }
}

/**
 * Play a cue; resolves to its voice (stop(fadeMs)) or null. Without the
 * stinger system the fallback sound effect plays, as before.
 */
export function playCue(scene, name, opts = {}) {
  const audio = audioOf(scene);
  try {
    if (typeof audio?.playStinger === 'function') {
      return audio.playStinger(name, opts).catch(() => null);
    }
    if (opts.fallbackSfx) audio?.playSFX?.(opts.fallbackSfx);
  } catch {
    /* sound is decoration */
  }
  return Promise.resolve(null);
}

/** Fade every cue out (a ceremony closed or was skipped). */
export function stopCues(scene, fadeMs) {
  try {
    audioOf(scene)?.stopStingers?.(fadeMs);
  } catch {
    /* sound is decoration */
  }
}

/** Lower the music for a while (the Entity's card is heard as a hole). */
export function duckMusic(scene, level, opts) {
  try {
    return Boolean(audioOf(scene)?.duckMusic?.(level, opts));
  } catch {
    return false;
  }
}
