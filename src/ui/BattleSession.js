// Phaser reuses a Scene object: shutdown and init can run in the same stack.
// An operation must carry the session it started in, rather than inspect only
// the new session's active flag after an await.
export function battleSession(scene) {
  return scene?._battleSession;
}

export function isCurrentBattleSession(scene, session) {
  return Boolean(
    scene &&
    Number.isInteger(session) &&
    session === battleSession(scene) &&
    !scene._sceneShutdownCleanedUp,
  );
}
