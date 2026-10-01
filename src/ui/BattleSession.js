// Phaser reuses a Scene object: shutdown and init can run in the same stack.
// An operation must carry the session it started in, rather than inspect only
// the new session's active flag after an await.
export function battleSession(scene) {
  return scene?._battleSession;
}

export function isCurrentBattleSession(scene, session = battleSession(scene)) {
  return Boolean(
    scene &&
    session === battleSession(scene) &&
    !scene._sceneShutdownCleanedUp &&
    // Phaser marks settings.active in start(), before create() reaches RUNNING.
    // Initial resume recovery may legitimately persist during that create phase.
    (scene.sys?.isActive?.() !== false || scene.sys?.settings?.active === true),
  );
}
