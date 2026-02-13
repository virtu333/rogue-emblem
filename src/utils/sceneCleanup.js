// sceneCleanup.js — Generic scene shutdown safety net.
// Kills orphaned tweens and timers. Scenes keep their own specific cleanup
// (music release, input unbind, RNG restore); this adds the generic layer.

export function cleanupScene(scene) {
  try { scene.tweens?.killAll(); } catch (_) {}
  try { scene.time?.removeAllEvents(); } catch (_) {}
  // NEVER touch scene.input.keyboard — Phaser shares the keyboard manager
  // across scenes. Named .off() calls belong in each scene's own handler.
}
