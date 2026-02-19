// Shared audio unlock utility — waits for Phaser's WebAudio context to be unlocked.
// Cleans up the 'unlocked' listener and timeout to avoid leaks.

/**
 * Wait for Phaser's audio system to unlock (user gesture required on mobile).
 * Resolves immediately if already unlocked or after timeoutMs.
 * @param {Phaser.Scene} scene
 * @param {number} [timeoutMs=200]
 */
export async function ensureAudioUnlocked(scene, timeoutMs = 200) {
  const sound = scene.sound;
  if (!sound?.locked) return;
  await new Promise((resolve) => {
    let settled = false;
    let unlockHandler = null;
    let timer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (unlockHandler && typeof sound.off === 'function') {
        sound.off('unlocked', unlockHandler);
      }
      if (timer) {
        try {
          timer.remove?.();
        } catch (_) {}
      }
      resolve();
    };
    if (typeof sound.once === 'function') {
      unlockHandler = finish;
      sound.once('unlocked', unlockHandler);
    }
    try {
      if (typeof sound.unlock === 'function') sound.unlock();
    } catch (_) {}
    timer = scene.time?.delayedCall?.(timeoutMs, finish) || null;
  });
}
