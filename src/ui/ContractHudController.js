// ContractHudController — the open contract on the battle HUD (create()/destroy() controller;
// docs/specs/event-nodes-phase2.md §2E).
//
// A contract applies to the NEXT battle won, so a player racing par wants it in sight during that
// battle: "Contract · Under par", and "— missed" the moment a victory would break it. The line is
// derived on every read from the run and the live battle (engine/ContractStanding.js: the same
// verdict, losses and node rule the victory commit settles with) and nothing is stored, so a
// suspend/resume, a Vision rewind and a par bump from reinforcements are reflected for free.
// With no contract, or in a battle that settles none, there is no line and no object.
//
// Desktop: one Press Start 2P line in the reliquary status plate (DesktopBattleHud lays it out),
// its terms in a tooltip on hover (like the turn/par counter's). Phone: the DOM HUD reads model()
// into its counters row, where a tap opens the terms.

import { UI_FONT_FAMILIES, UI_PALETTE, applyTextResolution } from '../utils/uiStyles.js';
import { UI_DEPTHS } from '../utils/uiDepths.js';
import { withPresentationRandom } from '../utils/presentationRandom.js';
import { describeContract } from '../engine/Contracts.js';
import { contractStanding } from '../engine/ContractStanding.js';
import { contractHudModel } from './contractHudModel.js';

const TIP_WIDTH = 260;

/**
 * Every unit still in the army, as the victory commit counts survivors
 * (PostCombatController): the units in play and the escaped, the benched who sat the battle out.
 * A unit already dead and fading out is gone for the contract too: its removal is certain.
 */
export function liveSurvivorsOf(scene) {
  const inPlay = [...(scene?.playerUnits || []), ...(scene?.escapedUnits || [])].filter(
    (unit) => !(unit.currentHP <= 0),
  );
  return [...inPlay, ...(scene?.nonDeployedUnits || [])];
}

/** The open contract's standing in this scene's battle, or null (none, or none to settle). */
export function sceneContractStanding(scene) {
  const run = scene?.runManager;
  if (!run?.contract) return null;
  return contractStanding(run, {
    nodeId: scene.nodeId,
    turnCount: scene.turnManager?.turnNumber,
    turnPar: scene.turnPar,
    survivors: liveSurvivorsOf(scene),
    battleRecruits: scene._battleRecruits,
  });
}

/** The HUD line's model for this scene, or null (see contractHudModel). */
export function sceneContractHud(scene) {
  const standing = sceneContractStanding(scene);
  return standing ? contractHudModel(describeContract(scene.runManager), standing) : null;
}

export class ContractHudController {
  constructor(scene) {
    this.scene = scene;
    this.text = null;
    this.tip = null;
    this.signature = null;
    this._onPostUpdate = null;
    this.destroyed = false;
  }

  create() {
    const s = this.scene;
    if (!s?.runManager?.contract) return this;
    if (!s._mobileBattleHud && s.add?.text) {
      withPresentationRandom(() => {
        this.text = s.add
          .text(8, 80, '', {
            fontFamily: UI_FONT_FAMILIES.pixel,
            fontSize: '8px',
            color: UI_PALETTE.accentText,
          })
          .setOrigin(0, 0)
          .setDepth(UI_DEPTHS.SCREEN_UI + 1)
          .setVisible(false);
        this.tip = s.add
          .text(0, 0, '', {
            fontFamily: UI_FONT_FAMILIES.body,
            fontSize: '11px',
            color: UI_PALETTE.text,
            wordWrap: { width: TIP_WIDTH },
          })
          .setOrigin(0, 0)
          .setDepth(UI_DEPTHS.SCREEN_UI + 1)
          .setVisible(false);
      });
      applyTextResolution(this.text);
      applyTextResolution(this.tip);
      s._pinToScreen?.(this.text);
      s._pinToScreen?.(this.tip);
      this.text.setInteractive({ useHandCursor: false });
      this.text.on('pointerover', () => this.showTip(true));
      this.text.on('pointerout', () => this.showTip(false));
      s.contractHudText = this.text;
      s.contractTipText = this.tip;
    }
    this._onPostUpdate = () => this.sync();
    s.events?.on?.('postupdate', this._onPostUpdate);
    this.sync();
    return this;
  }

  /** The line and its terms right now, or null. */
  model() {
    return this.destroyed ? null : sceneContractHud(this.scene);
  }

  /** Current line text ('' when there is none). */
  label() {
    return this.model()?.text || '';
  }

  showTip(on) {
    if (!this.tip) return;
    const model = on ? this.model() : null;
    this.tip.setText(model?.title || '');
    this.tip.setVisible(Boolean(model));
  }

  sync() {
    if (this.destroyed || !this.text) return;
    const model = this.model();
    const signature = model ? `${model.status}|${model.text}` : '';
    if (signature === this.signature) return;
    this.signature = signature;
    this.text.setText(model?.text || '');
    this.text.setColor(model?.missed ? UI_PALETTE.bad : UI_PALETTE.accentText);
    this.text.setVisible(Boolean(model) && !this.scene._mobileBattleHud);
    // A tooltip left open follows the line (a turn passing par while the pointer rests on it).
    if (this.tip?.visible) this.showTip(true);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this._onPostUpdate) this.scene?.events?.off?.('postupdate', this._onPostUpdate);
    this._onPostUpdate = null;
    if (this.scene?.contractHudText === this.text) this.scene.contractHudText = null;
    if (this.scene?.contractTipText === this.tip) this.scene.contractTipText = null;
    this.text?.destroy?.();
    this.tip?.destroy?.();
    this.text = null;
    this.tip = null;
  }
}
