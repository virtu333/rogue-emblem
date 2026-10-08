// The fog's saved state and its overlays, for the scene's Grid and any grid-like object a
// checkpoint restore or a Vision rewind is handed (the suspend checkpoint captures the same
// three sets in BattleCheckpointAdapter).
import { safeBattlePresentation } from './safeBattlePresentation.js';

/** Shade each fog overlay from the grid's visible and ever-seen sets. */
export function paintFogOverlays(grid) {
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const key = `${col},${row}`;
      const fog = grid.fogOverlays?.[row]?.[col];
      if (!fog) continue;
      safeBattlePresentation(
        'fog overlay',
        () => {
          if (grid.visibleSet.has(key)) {
            fog.setAlpha(0); // fully visible
          } else if (grid.everSeenSet.has(key)) {
            fog.setAlpha(0.3); // seen before
          } else {
            fog.setAlpha(0.7); // never seen
          }
        },
        { scene: grid.scene },
      );
    }
  }
}

/** The fog as a Vision rewind snapshot saves it (the suspend checkpoint: BattleCheckpointAdapter). */
export function gridFogState(grid) {
  return {
    visible: [...(grid.visibleSet || [])],
    everSeen: [...(grid.everSeenSet || [])],
    contacts: [...(grid.contactSet || [])],
  };
}

/** Put back a saved fog state; one saved before contacts (Grid.revealContact) existed has none. */
export function applyGridFogState(grid, fog) {
  if (!grid?.fogEnabled || !fog) return;
  grid.visibleSet = new Set(fog.visible || []);
  grid.everSeenSet = new Set(fog.everSeen || []);
  grid.contactSet = new Set(fog.contacts || []);
  paintFogOverlays(grid);
}
