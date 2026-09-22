// EscapeObjectiveController — Escape battle objective (markers + escape flow).
//
// Victory rule (hybrid): every living lord must exit via an escape square —
// the battle ends the moment the last living lord escapes. Non-lord units MAY
// exit early for an act-scaled gold bonus, trading their presence on the field
// for guaranteed survival and cash. Units still on the field when the final
// lord escapes auto-retreat safely (they are merged back as survivors).
//
// State stays on BattleScene (scene.escapedUnits holds units that left the
// field); the controller owns only its Phaser marker objects.

import { ESCAPE_EVAC_GOLD_BY_ACT, TILE_SIZE } from '../utils/constants.js';
import { UI_DEPTHS } from '../utils/uiDepths.js';
import { UI_HEX, UI_PALETTE, applyTextResolution } from '../utils/uiStyles.js';

export class EscapeObjectiveController {
  constructor(scene) {
    this.scene = scene;
    this.markers = [];
  }

  /** Persistent markers stay legible over terrain, fog and movement highlights. */
  create() {
    const scene = this.scene;
    for (const tile of scene.battleConfig?.escapeTiles || []) {
      const pos = scene.grid.gridToPixel(tile.col, tile.row);
      const highlight = scene.add
        .rectangle(pos.x, pos.y, TILE_SIZE - 2, TILE_SIZE - 2, UI_HEX.good, 0.3)
        .setStrokeStyle(2, UI_HEX.accent, 1)
        .setDepth(UI_DEPTHS.OBJECTIVE_TILE);
      const label = applyTextResolution(
        scene.add
          .text(pos.x, pos.y - 9, 'EXIT', {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: UI_PALETTE.accent,
            backgroundColor: UI_PALETTE.bg,
            padding: { x: 2, y: 1 },
            fontStyle: 'bold',
          })
          .setOrigin(0.5)
          .setDepth(UI_DEPTHS.OBJECTIVE_LABEL),
      );
      this.markers.push(highlight, label);
    }
  }

  /** Show the whole route without changing selection, movement or turn state. */
  showExits() {
    if (!this.scene.battleConfig?.escapeTiles?.length) return false;
    return this.scene.resetBattleCameraView?.() ?? false;
  }

  isOnEscapeTile(unit) {
    const tiles = this.scene.battleConfig?.escapeTiles || [];
    return tiles.some((t) => t.col === unit.col && t.row === unit.row);
  }

  getEvacGold() {
    const act = this.scene.battleParams?.act || 'act1';
    return ESCAPE_EVAC_GOLD_BY_ACT[act] ?? ESCAPE_EVAC_GOLD_BY_ACT.act1;
  }

  /** Living lords that still need to exit (field) vs already out. */
  getLordProgress() {
    const scene = this.scene;
    const fieldLords = scene.playerUnits.filter((u) => u.isLord).length;
    const escapedLords = (scene.escapedUnits || []).filter((u) => u.isLord).length;
    return { fieldLords, escapedLords, totalLords: fieldLords + escapedLords };
  }

  getObjectiveLabel() {
    const scene = this.scene;
    const { escapedLords, totalLords } = this.getLordProgress();
    let label = `Escape: Only Lords must exit (${escapedLords}/${totalLords})`;
    label += '\nMove onto an EXIT tile, then choose Escape.';
    const fieldOthers = scene.playerUnits.some((u) => !u.isLord);
    if (fieldOthers) {
      label += `\nOthers are safe; may exit early (+${this.getEvacGold()}g)`;
    }
    return label;
  }

  /**
   * Execute the Escape action for a unit standing on an escape square.
   * Removing the final living lord ends the battle in victory via
   * checkBattleEnd; any other unit leaves the field into scene.escapedUnits.
   */
  executeEscape(unit) {
    const scene = this.scene;
    scene.commitVisionSnapshotIfPending();
    scene._clearCombatRollSession?.();
    scene._clearSelectedWeaponArt?.();
    scene.grid.clearAttackHighlights();

    scene.removeUnitGraphic(unit);
    const idx = scene.playerUnits.indexOf(unit);
    if (idx !== -1) scene.playerUnits.splice(idx, 1);
    unit.hasActed = true;
    unit.hasMoved = true;
    scene.escapedUnits = scene.escapedUnits || [];
    scene.escapedUnits.push(unit);

    if (!unit.isLord) {
      const bonus = this.getEvacGold();
      scene.goldEarned = (scene.goldEarned || 0) + bonus;
      this._showEscapeFloat(unit, `Escaped! +${bonus}g`);
    } else {
      this._showEscapeFloat(unit, `${unit.name} escaped!`);
    }

    scene.selectedUnit = null;
    scene.preMoveLoc = null;
    scene.battleState = 'PLAYER_IDLE';
    scene.dangerZoneStale = true;
    scene._pinnedThreats?.invalidate();
    scene.updateObjectiveText();

    // Last living lord out → victory (checkBattleEnd owns the rule)
    if (scene.checkBattleEnd()) return;

    // Same ordering contract as finishUnitAction: lock the resolved action
    // into the suspend checkpoint before the phase may flip to enemy replay.
    scene._timelineBoundary = 'player_action';
    scene._timelineFacts = [...(scene._timelineFacts || []), `${unit.name} escaped.`];
    scene._captureSuspendCheckpoint?.();
    scene.turnManager.unitActed(unit);
  }

  _showEscapeFloat(unit, message) {
    const scene = this.scene;
    try {
      const pos = scene.grid.gridToPixel(unit.col, unit.row);
      const txt = scene.add
        .text(pos.x, pos.y - 16, message, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#a6ffb0',
          fontStyle: 'bold',
          backgroundColor: '#00000088',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5)
        .setDepth(320);
      if (scene._reduceMotion?.()) {
        scene.time.delayedCall(700, () => txt.destroy());
      } else {
        scene.tweens.add({
          targets: txt,
          y: pos.y - 36,
          alpha: 0,
          duration: 1100,
          onComplete: () => txt.destroy(),
        });
      }
    } catch (_) {
      /* cosmetic only */
    }
  }

  destroy() {
    for (const obj of this.markers) {
      try {
        this.scene?.tweens?.killTweensOf?.(obj);
        obj.destroy();
      } catch (_) {
        /* already destroyed */
      }
    }
    this.markers = [];
    this.scene = null;
  }
}
