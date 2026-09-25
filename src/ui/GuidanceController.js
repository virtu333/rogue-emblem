// GuidanceController — one-time, contextual field notes during a battle.
//
// Watches the battle (a cheap key per frame; conditions run only when the key
// changes) and shows at most one GuidanceNote at a time, each note once per save
// slot (HintManager), filtered by the Guidance setting (engine/Guidance.js):
//
//   guide_first_turn        first player phase: select a unit; red eyes = reach
//   guide_fragile_in_reach  a healer / thin unit was moved where enemies reach it
//   guide_healer_heals      a healer is selected while an ally is hurt
//   guide_no_attack         a unit ended its move with nobody in weapon reach
//   guide_commander_low_hp  the commander starts a player phase at half HP or less
//   guide_recruit_on_map    a recruitable (green) unit is on the map
//
// Also answers BattleScene's action menu: with Guidance on Full, a unit with no
// target in reach shows a greyed "Attack" with the reason instead of no Attack.
//
// Presentation only: reads battle state, never changes it, no RNG. Tutorial
// battles use their own coach and get no notes.

import { canInspectUnit } from '../engine/BattleInformation.js';
import { findCommander } from '../engine/Commander.js';
import { parseRange } from '../engine/Combat.js';
import { getCombatWeapons } from '../engine/UnitManager.js';
import {
  canUseStaff,
  guidanceAllows,
  guidanceText,
  isFragileUnit,
  isVeteranMeta,
  noTargetReason,
  noteTier,
  reachText,
  resolveGuidance,
} from '../engine/Guidance.js';
import { hasDOMHost } from '../utils/domUI.js';
import { showGuidanceNote } from './GuidanceNote.js';

const COACH_NOTES_PER_BATTLE = 2;

export class GuidanceController {
  constructor(scene) {
    this.scene = scene;
    this.note = null;
    this.coachShown = 0;
    this._key = '';
    this.destroyed = false;
    this._tick = () => this.sync();
  }

  create() {
    this.scene.events?.on?.('update', this._tick);
    this.scene.events?.once?.('shutdown', () => this.destroy());
    return this;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events?.off?.('update', this._tick);
    this.note?.close(false);
    this.note = null;
  }

  /** Effective level: 'full' | 'light' | 'off'. */
  level() {
    const s = this.scene;
    if (s.battleParams?.tutorialMode) return 'off';
    const settings = s.registry?.get?.('settings');
    if (settings?.getHints?.() === false) return 'off';
    return resolveGuidance(settings?.getGuidance?.() || 'auto', {
      veteran: isVeteranMeta(s.registry?.get?.('meta')),
    });
  }

  allows(id) {
    const hints = this.scene.registry?.get?.('hints');
    if (!hints || hints.hasSeen?.(id)) return false;
    return guidanceAllows(this.level(), noteTier(id));
  }

  /** Reason for a greyed Attack row, or null to keep Fire Emblem's hidden Attack. */
  noTargetAttackReason(unit, targets = []) {
    const s = this.scene;
    if (!unit || unit.faction !== 'player' || targets.length) return null;
    if (this.level() !== 'full') return null;
    const weapons = getCombatWeapons(unit).filter((w) => w?.type !== 'Staff');
    if (!weapons.length) return null;
    const foes = (s.enemyUnits || []).some((e) => e.currentHP > 0 && canInspectUnit(s.grid, e));
    if (!foes) return null;
    return noTargetReason(reachText(weapons, parseRange));
  }

  covered() {
    const s = this.scene;
    return Boolean(
      s.pauseOverlay?.visible ||
      s.visionDialog ||
      s.unitDetailOverlay?.visible ||
      s._ceremonies?.isBlocking?.() ||
      ['TUTORIAL_HINT', 'BATTLE_END', 'DEPLOY_SELECTION', 'PAUSED'].includes(s.battleState) ||
      globalThis.document?.querySelector?.('.re-modal-shield, .mr-sheet'),
    );
  }

  sync() {
    if (this.destroyed || this.note || !hasDOMHost()) return;
    const s = this.scene;
    const unit = s.selectedUnit;
    const key = [
      s.battleState,
      s.turnManager?.currentPhase,
      s.turnManager?.turnNumber,
      unit?.name,
      unit?.col,
      unit?.row,
      s._threatSight?.current?.result?.count ?? '',
      (s.npcUnits || []).length,
    ].join('|');
    const now = globalThis.performance?.now?.() ?? Date.now();
    if (key === this._key && (!this._blocked || now < this._retryAt)) return;
    this._key = key;
    this._blocked = false;
    // Covered by a modal / sheet, or Guidance off: look again a little later
    // (settings reads parse storage, so never every frame).
    if (this.level() === 'off' || this.covered()) {
      this._blocked = true;
      this._retryAt = now + 300;
      return;
    }
    const candidate = this.pick();
    if (candidate) this.show(candidate);
  }

  /** The most useful note for this moment, or null. */
  pick() {
    const s = this.scene;
    if (s.turnManager?.currentPhase && s.turnManager.currentPhase !== 'player') return null;
    const state = s.battleState;
    const unit = s.selectedUnit;
    const touch = Boolean(s.isMobileInput);
    const commander = findCommander(s.playerUnits || []);
    const coachLeft = this.coachShown < COACH_NOTES_PER_BATTLE;
    const coach = (id) => coachLeft && this.allows(id);

    if (state === 'UNIT_ACTION_MENU' && unit && !unit._movementCommitted && !unit.hasActed) {
      const moved =
        s.preMoveLoc && (s.preMoveLoc.col !== unit.col || s.preMoveLoc.row !== unit.row);
      const threat = s._threatSight?.current;
      const count =
        threat && threat.col === unit.col && threat.row === unit.row ? threat.result.count : 0;
      if (moved && count > 0 && isFragileUnit(unit) && coach('guide_fragile_in_reach'))
        return { id: 'guide_fragile_in_reach', context: { unit, count, touch }, anchor: unit };
      if (
        moved &&
        coach('guide_no_attack') &&
        this.noTargetAttackReason(unit, s.findAttackTargets?.(unit) || [])
      )
        return { id: 'guide_no_attack', context: { unit, touch }, anchor: unit };
    }
    if (
      (state === 'UNIT_SELECTED' || state === 'UNIT_ACTION_MENU') &&
      unit &&
      !unit.hasActed &&
      canUseStaff(unit) &&
      (s.getUsableStaves?.(unit) || []).length &&
      (s.playerUnits || []).some(
        (u) => u !== unit && u.currentHP > 0 && u.currentHP < u.stats?.HP,
      ) &&
      coach('guide_healer_heals')
    )
      return { id: 'guide_healer_heals', context: { unit, commander, touch }, anchor: unit };
    if (state !== 'PLAYER_IDLE') return null;
    if (
      commander &&
      commander.currentHP > 0 &&
      commander.currentHP <= commander.stats?.HP / 2 &&
      this.allows('guide_commander_low_hp')
    )
      return { id: 'guide_commander_low_hp', context: { commander, touch }, anchor: commander };
    const npc = (s.npcUnits || []).find((u) => u.currentHP > 0 && canInspectUnit(s.grid, u));
    if (npc && this.allows('guide_recruit_on_map'))
      return { id: 'guide_recruit_on_map', context: { npc, touch }, anchor: npc };
    if ((s.turnManager?.turnNumber ?? 1) <= 1 && coach('guide_first_turn'))
      return { id: 'guide_first_turn', context: { touch }, anchor: commander };
    return null;
  }

  screenPoint(unit) {
    const s = this.scene;
    if (!unit || !s.grid || typeof s._worldToScreen !== 'function') return null;
    const world = s.grid.gridToPixel(unit.col, unit.row);
    const p = s._worldToScreen(world.x, world.y);
    const rect = s.game?.canvas?.getBoundingClientRect?.();
    if (!p || !rect || !s.scale?.width) return null;
    return {
      x: rect.left + (p.x * rect.width) / s.scale.width,
      y: rect.top + (p.y * rect.height) / s.scale.height,
    };
  }

  show({ id, context, anchor }) {
    const s = this.scene;
    const text = guidanceText(id, context);
    if (!text) return;
    const hints = s.registry.get('hints');
    const settings = s.registry.get('settings');
    const handle = showGuidanceNote(s, {
      id,
      text,
      anchor: this.screenPoint(anchor),
      // Keep the army and the enemies it is about to meet in view.
      avoid: () =>
        [...(s.playerUnits || []), ...(s.enemyUnits || [])]
          .filter((u) => u.currentHP > 0 && canInspectUnit(s.grid, u))
          .map((u) => this.screenPoint(u)),
      reduceMotion: Boolean(s._reduceMotion?.()),
      onRead: () => hints?.markSeen?.(id),
      onFewerTips: settings?.setGuidance ? () => settings.setGuidance('light') : null,
    });
    if (!handle) return;
    if (noteTier(id) === 'coach') this.coachShown += 1;
    this.note = handle;
    handle.onClose = () => {
      if (this.note === handle) this.note = null;
      this._key = ''; // let the next moment be considered
    };
  }
}
