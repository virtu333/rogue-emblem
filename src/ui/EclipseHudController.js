// EclipseHudController — the battle's Eclipse projection (create()/destroy() controller).
//
// Shows how much shadow a victory *this turn* would commit: "Shadow +2", or "Sun holds"
// while the clear is still inside the grace window. The act's pressure (what takes the
// land) gathers all of it; when the sun's meter is at or near its cap only part reaches
// the sun, and the label says so: "Shadow +6 (sun +2)" / "Shadow +6 (land only)".
// It is a pure function of the turn
// number and the battle's par (RunManager.projectShadowGain), recomputed on postupdate,
// so Vision rewind, suspend/resume and reinforcement par bumps are reflected for free.
// Nothing is written to the run here: shadow is only committed at victory.
//
// Desktop: one Press Start 2P line in the reliquary status plate (DesktopBattleHud lays
// it out). Phone: the DOM HUD reads label() into its counters row. Never touches the
// turn/par string that battleSidebarDisplay.sidebarCounters parses.

import { UI_FONT_FAMILIES, UI_PALETTE, applyTextResolution } from '../utils/uiStyles.js';
import { UI_DEPTHS } from '../utils/uiDepths.js';
import { withPresentationRandom } from '../utils/presentationRandom.js';
import { showContextualHint } from './HintDisplay.js';
import { shadowProjectionLabel, shadowProjectionTone } from './eclipseContent.js';
import { projectedMeterGain } from '../engine/EclipseSystem.js';

const TONE_COLORS = {
  held: UI_PALETTE.accentText,
  rising: UI_PALETTE.warn,
  dark: UI_PALETTE.bad,
};

/** True when this battle belongs to a run whose clock is the Eclipse. */
export function isEclipseClock(scene) {
  return (
    !scene?.battleParams?.tutorialMode &&
    typeof scene?.runManager?.isEclipseActive === 'function' &&
    scene.runManager.isEclipseActive() === true
  );
}

/** Projected shadow for a victory at the scene's current turn (0 when off). */
export function projectedShadow(scene) {
  if (!isEclipseClock(scene)) return null;
  const turn = Math.max(0, Math.trunc(Number(scene.turnManager?.turnNumber) || 0));
  if (turn <= 0) return 0;
  return scene.runManager.projectShadowGain(turn, scene.turnPar);
}

/**
 * Of the projected gain, what the run's global meter would take (the cap stops the
 * rest, which still darkens this act's land). null when the Eclipse is off.
 */
export function projectedMeterShadow(scene, gain = projectedShadow(scene)) {
  if (gain == null) return null;
  const rm = scene.runManager;
  return projectedMeterGain(rm.eclipse, gain, rm.getEclipseConfig?.());
}

/** Shadow an act boss's fall lifts at this victory (0 for other battles or when off). */
export function projectedRelief(scene) {
  if (!isEclipseClock(scene) || !scene.isBoss) return 0;
  const relief = Number(scene.runManager.getEclipseConfig?.()?.bossRelief);
  return Number.isFinite(relief) ? Math.max(0, Math.trunc(relief)) : 0;
}

export class EclipseHudController {
  constructor(scene) {
    this.scene = scene;
    this.text = null;
    this.gain = null;
    this.meterGain = null;
    this._onPostUpdate = null;
    this.destroyed = false;
  }

  create() {
    const s = this.scene;
    if (!isEclipseClock(s)) return this;
    if (!s._mobileBattleHud && s.add?.text) {
      withPresentationRandom(() => {
        this.text = s.add
          .text(8, 64, '', {
            fontFamily: UI_FONT_FAMILIES.pixel,
            fontSize: '8px',
            color: UI_PALETTE.accentText,
          })
          .setOrigin(0, 0)
          .setDepth(UI_DEPTHS.SCREEN_UI + 1);
      });
      applyTextResolution(this.text);
      s._pinToScreen?.(this.text);
      s.eclipseHudText = this.text;
    }
    this._onPostUpdate = () => this.sync();
    s.events?.on?.('postupdate', this._onPostUpdate);
    this.sync();
    return this;
  }

  /** Current projection text ('' when the Eclipse is off). */
  label() {
    return this.gain == null ? '' : shadowProjectionLabel(this.gain, this.meterGain);
  }

  tone() {
    return this.gain == null ? null : shadowProjectionTone(this.gain);
  }

  sync() {
    if (this.destroyed) return;
    const gain = projectedShadow(this.scene);
    const meterGain = projectedMeterShadow(this.scene, gain);
    if (gain === this.gain && meterGain === this.meterGain) return;
    const rose = gain > 0 && !(this.gain > 0);
    this.gain = gain;
    this.meterGain = meterGain;
    if (this.text) {
      this.text.setText(this.label());
      this.text.setColor(TONE_COLORS[this.tone()] || UI_PALETTE.text);
      this.text.setVisible(gain != null && !this.scene._mobileBattleHud);
    }
    if (rose && this.scene?.registry?.get) {
      showContextualHint(
        this.scene,
        'eclipse_projection',
        // Short enough to stay a passing note (no modal mid-battle).
        meterGain != null && meterGain < gain
          ? `The land darkens: win now and this act gathers ${gain} shadow.`
          : `The sun darkens: win now and the run gains ${gain} shadow.`,
      );
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this._onPostUpdate) this.scene?.events?.off?.('postupdate', this._onPostUpdate);
    this._onPostUpdate = null;
    if (this.scene?.eclipseHudText === this.text) this.scene.eclipseHudText = null;
    this.text?.destroy?.();
    this.text = null;
  }
}
