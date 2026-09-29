// GuidanceController — one-time, contextual field notes during a battle.
//
// Watches the battle (a cheap key per frame; conditions run only when the key
// changes) and shows at most one GuidanceNote at a time, each note once per save
// slot (HintManager), filtered by the Guidance setting (engine/Guidance.js):
//
//   guide_first_turn        first player phase: select a unit; red eyes = reach
//   guide_fragile_in_reach  a healer / thin unit was moved where enemies reach it
//   guide_healer_heals      a healer is selected while an ally is hurt, or while
//                           only an NPC ally (caravan, recruit) is hurt and this
//                           healer's staff can mend it this turn (names it)
//   guide_no_attack         a unit ended its move with nobody in weapon reach
//   guide_commander_low_hp  the commander starts a player phase at half HP or less
//   guide_recruit_on_map    a recruitable (green) unit is on the map: names the recruit
//                           and how to win them (the recruit battle's only intro note)
//   guide_zombie_remains    the first Zombie remains the player sees: the countdown,
//                           Smash, and Light (points at the bone pile)
//
// A note about one unit's moment (fragile / no attack / healer: Guidance.noteScope)
// steps aside when that moment ends — Wait, another unit, Back to another tile, the
// enemy phase — without being marked read, so an unread one can still teach later.
//
// Also answers BattleScene's action menu: with Guidance on Full, a unit with no
// target in reach shows a greyed "Attack" with the reason instead of no Attack.
//
// Presentation only: reads battle state, never changes it, no RNG. Tutorial
// battles use their own coach and get no notes.

import { canInspectUnit } from '../engine/BattleInformation.js';
import { findCommander } from '../engine/Commander.js';
import { isNpcAlly, isRecruitNpc } from '../engine/RecruitNpc.js';
import { isHealStaff } from '../engine/StatusConditionSystem.js';
import { getAttackRange, getAttackWeapons } from '../engine/AttackOptions.js';
import { isUnarmed } from '../engine/UnitManager.js';
import {
  canUseStaff,
  guidanceAllows,
  guidanceText,
  isFragileUnit,
  isVeteranMeta,
  noTargetReason,
  noteScope,
  unarmedReason,
  noteTier,
  reachFromRanges,
  resolveGuidance,
} from '../engine/Guidance.js';
import { hasDOMHost } from '../utils/domUI.js';
import { TILE_SIZE } from '../utils/constants.js';
import { showGuidanceNote } from './GuidanceNote.js';

const COACH_NOTES_PER_BATTLE = 2;
// The unit's own planning: selected, walking to a tile, choosing an action.
const UNIT_TURN_STATES = new Set(['UNIT_SELECTED', 'UNIT_MOVING', 'UNIT_ACTION_MENU']);

export class GuidanceController {
  constructor(scene) {
    this.scene = scene;
    this.note = null;
    this.scope = null; // the unit moment an open unit-scoped note is about
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
    // The weapons and ranges targeting uses (BattleScene.findAttackTargets): proficient,
    // not silenced, uses left, skill range bonuses (Foresight) included.
    const weapons = getAttackWeapons(unit);
    if (!weapons.length) return null;
    const foes = (s.enemyUnits || []).some((e) => e.currentHP > 0 && canInspectUnit(s.grid, e));
    if (!foes) return null;
    const skillsData = s.gameData?.skills || null;
    return noTargetReason(
      reachFromRanges(weapons.map((w) => getAttackRange(unit, w, { skillsData }))),
    );
  }

  /**
   * Reason for a greyed Attack row when the unit has nothing to attack with, or null.
   * Full Guidance only, like noTargetAttackReason. Only a unit that could fight
   * (a combat proficiency) and carries no combat weapon it can wield; a healer with
   * only staff ranks keeps Fire Emblem's hidden Attack.
   */
  unarmedAttackReason(unit) {
    if (!unit || unit.faction !== 'player' || this.level() !== 'full') return null;
    return isUnarmed(unit) ? unarmedReason() : null;
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
    if (this.destroyed || !hasDOMHost()) return;
    // A note about one unit's moment steps aside once that moment is over (Wait,
    // another unit, Back to another tile, the enemy phase), read or not.
    if (this.note && this.scope && !this.scopeHolds()) this.cancelScopedNote();
    if (this.note) return;
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
      s._remainsCtrl?.markers?.shown?.length || 0,
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

  /** Is the unit moment the open note talks about still going on? */
  scopeHolds() {
    const scope = this.scope;
    if (!scope) return true;
    const s = this.scene;
    const unit = scope.unit;
    if (s.selectedUnit !== unit || !unit || unit.hasActed || unit.currentHP <= 0) return false;
    if (!UNIT_TURN_STATES.has(s.battleState)) return false;
    if ((s.turnManager?.currentPhase ?? 'player') !== 'player') return false;
    if ((s.turnManager?.turnNumber ?? null) !== scope.turn) return false;
    if (scope.kind === 'tile' && (unit.col !== scope.col || unit.row !== scope.row)) return false;
    return true;
  }

  /**
   * Close the open unit-scoped note without acknowledging it: read (shown long
   * enough) it stays read; unread, it stays unseen and gives back its coaching slot,
   * so a later moment can still teach it.
   */
  cancelScopedNote() {
    const handle = this.note;
    const coach = this.scope?.coach === true;
    this.scope = null;
    if (!handle) return;
    const read = handle.isRead?.() === true;
    handle.close(false);
    if (this.note === handle) this.note = null;
    if (coach && !read) this.coachShown = Math.max(0, this.coachShown - 1);
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
      coach('guide_healer_heals')
    ) {
      const armyHurt = (s.playerUnits || []).some(
        (u) => u !== unit && u.currentHP > 0 && u.currentHP < u.stats?.HP,
      );
      if (armyHurt)
        return { id: 'guide_healer_heals', context: { unit, commander, touch }, anchor: unit };
      const npc = this.npcToMend(unit);
      if (npc)
        return { id: 'guide_healer_heals', context: { unit, commander, touch, npc }, anchor: unit };
    }
    if (state !== 'PLAYER_IDLE') return null;
    if (
      commander &&
      commander.currentHP > 0 &&
      commander.currentHP <= commander.stats?.HP / 2 &&
      this.allows('guide_commander_low_hp')
    )
      return { id: 'guide_commander_low_hp', context: { commander, touch }, anchor: commander };
    // The recruit's gold banner shows through fog (RecruitBeaconController), so the
    // note may name a recruit the fog still hides; other green units must be seen.
    // The merchant caravan is an NPC but never a recruit: it must not spend the note.
    const beaconed = s._recruitBeacon?.npc || null;
    const npc = (s.npcUnits || []).find(
      (u) => isRecruitNpc(u) && (u === beaconed || canInspectUnit(s.grid, u)),
    );
    if (npc && this.allows('guide_recruit_on_map'))
      return { id: 'guide_recruit_on_map', context: { npc, touch }, anchor: npc };
    // Remains the player has seen (drawn by RemainsMarkerController): point at a pile.
    const remains = s._remainsCtrl?.knownTiles?.()[0] || null;
    if (remains && this.allows('guide_zombie_remains'))
      return { id: 'guide_zombie_remains', context: { touch }, anchor: remains };
    if ((s.turnManager?.turnNumber ?? 1) <= 1 && coach('guide_first_turn'))
      return { id: 'guide_first_turn', context: { touch }, anchor: commander };
    return null;
  }

  /**
   * A hurt NPC ally (the caravan, a recruit) this healer's heal staff would mend this
   * turn, or null. Uses the Heal command's own target rules (BattleScene.findHealTargets:
   * seen through the fog, hurt, a heal worth a use, in staff reach), measured from
   * every tile the healer can still end its move on while choosing where to go, or
   * from where it stands once at the action menu. The note never promises a heal the
   * Heal command would not offer.
   */
  npcToMend(unit) {
    const s = this.scene;
    if (!(s.npcUnits || []).some(isNpcAlly) || typeof s.findHealTargets !== 'function') return null;
    const staves = (s.getUsableStaves?.(unit) || []).filter(isHealStaff);
    if (!staves.length) return null;
    const tiles = [];
    if (s.battleState === 'UNIT_SELECTED' && s.movementRange instanceof Map) {
      for (const [key, entry] of s.movementRange) {
        if (entry?.stoppable === false) continue;
        const [col, row] = key.split(',').map(Number);
        tiles.push({ col, row });
      }
    }
    if (!tiles.length) tiles.push({ col: unit.col, row: unit.row });
    for (const staff of staves) {
      for (const from of tiles) {
        const npc = s.findHealTargets(unit, staff, { from }).find((t) => t.faction === 'npc');
        if (npc) return npc;
      }
    }
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

  /** Desktop canvas HUD plates and the action menu: points to keep clear. */
  hudPoints() {
    const s = this.scene;
    const rect = s.game?.canvas?.getBoundingClientRect?.();
    if (!rect || !s.scale?.width) return [];
    const points = [];
    const menuPlate = Array.isArray(s.actionMenu) ? s.actionMenu[0] : null;
    for (const label of [
      s.turnCounterText,
      s.infoText,
      s.objectiveText,
      s.visionHudText,
      menuPlate,
    ]) {
      if (!label?.visible || !label.getBounds) continue;
      if (label !== menuPlate && !label.text) continue;
      const b = label.getBounds();
      const kx = rect.width / s.scale.width;
      const ky = rect.height / s.scale.height;
      for (const [x, y] of [
        [b.x, b.y],
        [b.x + b.width, b.y],
        [b.x, b.y + b.height],
        [b.x + b.width, b.y + b.height],
        [b.x + b.width / 2, b.y + b.height / 2],
      ])
        points.push({ x: rect.left + x * kx, y: rect.top + y * ky });
    }
    return points;
  }

  /** Screen rect (CSS px) of the visible battlefield tiles, or null. */
  battlefieldRect() {
    const s = this.scene;
    const g = s.grid;
    if (!g || typeof s._worldToScreen !== 'function') return null;
    const rect = s.game?.canvas?.getBoundingClientRect?.();
    if (!rect || !s.scale?.width) return null;
    const toCss = (x, y) => {
      const p = s._worldToScreen(x, y);
      return p
        ? {
            x: rect.left + (p.x * rect.width) / s.scale.width,
            y: rect.top + (p.y * rect.height) / s.scale.height,
          }
        : null;
    };
    const a = toCss(g.offsetX, g.offsetY);
    const b = toCss(
      g.offsetX + (g.mapPixelWidth ?? g.cols * TILE_SIZE),
      g.offsetY + (g.mapPixelHeight ?? g.rows * TILE_SIZE),
    );
    if (!a || !b) return null;
    return { left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y };
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
      bounds: () => this.battlefieldRect(),
      // Keep the army and the enemies it is about to meet in view.
      avoid: () => [
        ...[...(s.playerUnits || []), ...(s.enemyUnits || [])]
          .filter((u) => u.currentHP > 0 && canInspectUnit(s.grid, u))
          .map((u) => this.screenPoint(u)),
        ...this.hudPoints(),
      ],
      reduceMotion: Boolean(s._reduceMotion?.()),
      onRead: () => hints?.markSeen?.(id),
      onFewerTips: settings?.setGuidance ? () => settings.setGuidance('light') : null,
    });
    if (!handle) return;
    const coach = noteTier(id) === 'coach';
    if (coach) this.coachShown += 1;
    this.note = handle;
    const kind = noteScope(id);
    const unit = context?.unit || null;
    this.scope =
      kind && unit
        ? {
            kind,
            unit,
            col: unit.col,
            row: unit.row,
            turn: s.turnManager?.turnNumber ?? null,
            coach,
          }
        : null;
    handle.onClose = () => {
      if (this.note === handle) {
        this.note = null;
        this.scope = null;
      }
      this._key = ''; // let the next moment be considered
    };
  }
}
