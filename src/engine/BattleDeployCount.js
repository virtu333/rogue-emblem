// How many units a battle deployed (battleParams.deployCount). Map generation sizes
// spawns and enemy counts by it, and the Last deed needs it at victory (DeedController).
// Pure, no Phaser.

/**
 * @param {{tutorialMode?: boolean, deployedRoster?: object[]|null, resuming?: boolean,
 *          recorded?: unknown}} options
 *   recorded: battleParams.deployCount as saved with the battle in progress.
 * @returns {number}
 */
export function battleDeployCount({
  tutorialMode = false,
  deployedRoster = null,
  resuming = false,
  recorded,
} = {}) {
  if (tutorialMode) return 2;
  if (Array.isArray(deployedRoster)) return deployedRoster.length;
  // A resumed battle's units come from its checkpoint, not a deployment: keep the
  // count recorded when the battle began (it was reset to 2, so no resumed battle
  // could ever award the Last).
  const saved = Number(recorded);
  if (resuming && Number.isInteger(saved) && saved > 0) return saved;
  return 2;
}
