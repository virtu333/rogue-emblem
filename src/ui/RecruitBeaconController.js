// RecruitBeaconController — marks the recruit on a recruit battle from turn 1
// (docs/specs/strategy-layer.md, "show on the map which unit is the recruit").
//
// A gilt banner on a pole above the recruit with a pixel "RECRUIT" label and a slow
// verdigris halo on its tile. It stays readable through fog (it sits above the fog
// layer, like the old "?" marker it replaces), follows the recruit, and goes away the
// moment the recruit joins or falls. `sync()` re-derives everything from
// scene.npcUnits, so Talk, a death, a Vision rewind or a resume all just work.
// Rendering only: no game state lives here. BattleScene owns one instance
// (create / sync from update / destroy), per the controller extraction rule.
//
// It never opens a dialog. Who the recruit is and how to win them over is taught by
// the Guidance field note `guide_recruit_on_map` (GuidanceController): non-blocking,
// once per save slot, and silent with Guidance Off (playtest 4).

import { TILE_SIZE } from '../utils/constants.js';
import { UI_FONT_FAMILIES, UI_HEX, UI_PALETTE } from '../utils/uiStyles.js';

// Above fog (3) and unit sprites (10+) and HP bars (12/13), below menus and banners.
export const RECRUIT_BEACON_DEPTH = 14;
const HALO_DEPTH = 4;

/** The line the objective panel shows while a recruit is waiting. */
export function recruitObjectiveLine(npc) {
  if (!npc) return null;
  return `Recruit: reach ${npc.name} with a lord · Talk`;
}

export class RecruitBeaconController {
  constructor(scene) {
    this.scene = scene;
    this.objects = [];
    this.npc = null;
    this.tile = null;
    this.visible = null;
  }

  /** Build the beacon for the battle's recruit and name them in the objective line. */
  create() {
    this.sync();
    if (!this.npc) return;
    // The objective line was drawn before the recruit existed; name them now.
    try {
      this.scene?.updateObjectiveText?.();
    } catch {
      /* the HUD may not be built in headless scenes */
    }
  }

  /** Cheap per-frame reconciliation with scene.npcUnits. */
  sync() {
    const scene = this.scene;
    if (!scene) return;
    const npc = (scene.npcUnits || []).find((u) => u && u.currentHP > 0 && !u._removing) || null;
    if (!npc) {
      if (this.objects.length) this._clear();
      this.npc = null;
      return;
    }
    if (npc !== this.npc || npc.col !== this.tile?.col || npc.row !== this.tile?.row) {
      this._clear();
      this.npc = npc;
      this.tile = { col: npc.col, row: npc.row };
      this._render();
    }
  }

  getObjectiveSuffix() {
    return recruitObjectiveLine(this.npc);
  }

  _render() {
    const scene = this.scene;
    const npc = this.npc;
    if (!npc || !scene?.grid?.gridToPixel || !scene.add) return;
    try {
      const { x, y } = scene.grid.gridToPixel(npc.col, npc.row);
      const half = TILE_SIZE / 2;
      const halo = scene.add.rectangle(x, y, TILE_SIZE - 4, TILE_SIZE - 4, UI_HEX.good, 0.2);
      halo.setStrokeStyle?.(1, UI_HEX.good, 0.7);
      halo.setDepth?.(HALO_DEPTH);
      // A gilt banner on a short pole over the recruit's head.
      const poleX = x + half - 6;
      const pole = scene.add
        .rectangle(poleX, y - half - 2, 2, 16, UI_HEX.accentText ?? UI_HEX.accent, 1)
        .setDepth(RECRUIT_BEACON_DEPTH);
      const flag = scene.add
        .triangle?.(poleX + 1, y - half - 9, 0, 0, 0, 8, 9, 4, UI_HEX.accent, 1)
        ?.setOrigin?.(0, 0)
        ?.setDepth?.(RECRUIT_BEACON_DEPTH);
      const label = scene.add
        .text(x, y - half - 14, 'RECRUIT', {
          fontFamily: UI_FONT_FAMILIES.pixel,
          fontSize: '7px',
          color: UI_PALETTE.accentText,
          backgroundColor: '#140f14cc',
          padding: { x: 2, y: 1 },
        })
        .setOrigin(0.5, 1)
        .setDepth(RECRUIT_BEACON_DEPTH);
      label.name = 'recruit-beacon-label';
      this.objects.push(...[halo, pole, flag, label].filter(Boolean));
      if (!scene._reduceMotion?.()) {
        scene.tweens?.add?.({
          targets: halo,
          alpha: 0.35,
          duration: 1100,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
      // Pinned-UI camera filters need to learn about new world objects.
      scene._cameraFilterDirty = true;
    } catch {
      /* cosmetic only */
    }
  }

  _clear() {
    for (const obj of this.objects) {
      try {
        this.scene?.tweens?.killTweensOf?.(obj);
        obj.destroy?.();
      } catch {
        /* already destroyed */
      }
    }
    this.objects = [];
    this.tile = null;
  }

  destroy() {
    this._clear();
    this.npc = null;
    this.scene = null;
  }
}
