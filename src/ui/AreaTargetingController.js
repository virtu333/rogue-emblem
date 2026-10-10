// AreaTargetingController — a chosen-center weapon art (Stormcall), from the art picker to
// the strike (docs/specs/aoe-weapon-arts.md §6).
//
//   begin(unit, weapon, art)  SELECTING_AREA_CENTER: the legal centers are tinted and the
//                             cursor starts on the nearest seen foe in reach
//   aim(tile)                 hover / cursor: the preview (seen units only) follows
//   lock(tile)                click / tap / confirm on a legal tile opens the prompt
//                             [Fire] [Back]; the same tile again fires
//   fire()                    the strike (execute)
//   back()                    prompt → aiming on the same tile → the art picker
//   cycle(dir)                Q/E, L1/R1, the phone's ◀ Foe ▶: the next seen foe in reach
//
// One state, SELECTING_AREA_CENTER, registered wherever SELECTING_ABILITY_TILE is; the
// prompt is a menu registered under that same state (as Canto's confirm is), so the
// cursor keeps moving under it and confirming the locked tile fires.
//
// The strike is an attack action, so it follows executeCombat, not settleAndPresent: it
// kills through removeUnit (gold, deeds, Deathburst, last words), which is async, so it
// cannot settle synchronously. Its intent is saved first (`area_strike`, before any
// cost, shot or blow; resume replays it from the saved state, so a replay spends them
// once), then the blows, XP for every victim, removals, the sweep and the defeat check,
// the swap away from a Breachbolt that just fired its last shot (after the deaths, as
// executeCombat: kill credit and remains read the weapon that struck), and the `combat`
// continuation that level-ups save and completeResolvedAction finishes. Every step is
// behind the battle session the action started in.

import {
  areaStrikeCenters,
  areaStrikeEffects,
  areaStrikeMods,
  canStartAreaStrike,
  isAreaStrikeCenter,
} from '../engine/AreaStrike.js';
import { areaForecastLines, previewAreaArt } from '../engine/AreaPreview.js';
import { canAttackWithWeapon } from '../engine/AttackOptions.js';
import { AREA_XP_LIVE } from '../engine/BattleXp.js';
import { hasBattleDefeat } from '../engine/BattleDefeat.js';
import { canInspectUnit } from '../engine/BattleInformation.js';
import { deedsFor } from './DeedController.js';
import { findBattleEntity } from '../engine/BattleEntityIdentity.js';
import { spendAreaStrikeShot } from '../engine/PerBattleWeapons.js';
import { equipWeapon } from '../engine/UnitManager.js';
import { getFootprint } from '../engine/EntitySystem.js';
import {
  applyWeaponArtCost,
  canUseWeaponArt,
  getEffectiveWeaponArtHpCost,
  getWeaponArtTargeting,
  recordWeaponArtUse,
  weaponArtRunOptions,
} from '../engine/WeaponArtSystem.js';
import { AreaPreviewController } from './AreaPreviewController.js';
import { BattleBeatsController } from './BattleBeatsController.js';
import { completeBattleAction } from './BattleActionCompletion.js';
import { historyUnitVisible, observeHistoryAction } from './BattleHistoryRecorder.js';
import { completeResolvedAction, presentQueuedProgress } from './BattlePresentationCheckpoint.js';
import { battleSession, isCurrentBattleSession } from './BattleSession.js';
import { playerKnowledgeOf } from './battleKnowledge.js';
import { menuRow, railOwnsMenus } from './battleMenuModel.js';
import { resolveWeaponArtIds } from './WeaponArtVisibility.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';
import { showMinorHint } from './HintDisplay.js';
import { reportAsyncError } from '../utils/errorReporter.js';
import { UI_HEX, UI_PALETTE } from '../utils/uiStyles.js';

export const AREA_CENTER_STATE = 'SELECTING_AREA_CENTER';
const CENTER_TINT = UI_HEX.lineStrong;
const key = (tile) => `${tile.col},${tile.row}`;
const sameTile = (a, b) => Boolean(a && b && a.col === b.col && a.row === b.row);
const distance = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);

export class AreaTargetingController {
  constructor(scene) {
    this.scene = scene;
    this.session = battleSession(scene);
    /** { unit, weapon, art, centers, keys, aim, locked } while aiming, else null. */
    this.pending = null;
    this._preview = null;
  }

  create() {
    return this;
  }

  destroy() {
    this.clear();
    this._preview?.destroy();
    this._preview = null;
    this.scene = null;
  }

  get active() {
    return Boolean(this.pending) && this.scene?.battleState === AREA_CENTER_STATE;
  }

  /** The prompt's tile, or null while aiming. */
  get locked() {
    return this.pending?.locked || null;
  }

  _world() {
    return this.scene._postCombatWorld();
  }

  _costOptions() {
    return {
      ...weaponArtRunOptions(this.scene.runManager),
      marksData: this.scene.gameData?.marks,
    };
  }

  /** May the menu offer this art: a weapon that can strike and a center in reach. */
  canBegin(unit, weapon, art) {
    return canStartAreaStrike(unit, weapon, art, this._world());
  }

  // ── Aiming ─────────────────────────────────────────────────────

  begin(unit, weapon, art) {
    const scene = this.scene;
    if (!unit || !weapon || !art || !this.canBegin(unit, weapon, art)) return false;
    scene.hideActionMenu();
    scene.inEquipMenu = false;
    scene.battleState = AREA_CENTER_STATE;
    const centers = areaStrikeCenters(unit, art, this._world(), weapon);
    this.pending = {
      unit,
      weapon,
      art,
      centers,
      keys: new Set(centers.map(key)),
      aim: null,
      locked: null,
    };
    this.redrawCenters();
    const start = this._startTile(unit, centers);
    this.aim(start);
    // Keyboard and pad aim from here; snapping refreshes the tile info (and aims again).
    scene._gridCursor?.snapTo(start.col, start.row);
    scene.refreshEndTurnControl?.();
    scene._emitMobileContext?.();
    return true;
  }

  /**
   * Tint the legal centers. Inspecting a unit while aiming keeps them, and closing the
   * inspection (which clears the board's marks) draws them again.
   */
  redrawCenters() {
    const p = this.pending;
    const scene = this.scene;
    if (!p || scene?.battleState !== AREA_CENTER_STATE) return;
    safeBattlePresentation(
      'area centers',
      () => scene.grid.showAttackRange(p.centers, CENTER_TINT, 0.25),
      { scene },
    );
  }

  /** The nearest foe the player sees on a center (its aim tile); else the center nearest the unit. */
  _startTile(unit, centers) {
    const foe = this._seenFoesInReach()
      .map(({ tile }) => tile)
      .sort((a, b) => distance(unit, a) - distance(unit, b) || a.row - b.row || a.col - b.col)[0];
    if (foe) return { col: foe.col, row: foe.row };
    const nearest = centers
      .slice()
      .sort((a, b) => distance(unit, a) - distance(unit, b) || a.row - b.row || a.col - b.col)[0];
    return nearest ? { col: nearest.col, row: nearest.row } : { col: unit.col, row: unit.row };
  }

  /**
   * Foes the player sees with a seen tile on a legal center, as `{ foe, tile, tiles }` in
   * board order of `tile`. `tile` is where aiming at that foe lands: for the Entity (3×3),
   * the seen center tile of its body nearest the caster; `tiles` is every tile of the
   * body that counts as that foe. A body tile the fog hides is never offered.
   */
  _seenFoesInReach() {
    const p = this.pending;
    const scene = this.scene;
    if (!p) return [];
    const grid = scene.grid;
    // Seer's Eye shows every foe whole (grid.foesShown): its fogged body tiles count as seen.
    const seen = (t) =>
      !grid?.fogEnabled || grid.foesShown === true || grid.isVisible(t.col, t.row);
    const byNearest = (a, b) =>
      distance(p.unit, a) - distance(p.unit, b) || a.row - b.row || a.col - b.col;
    return (scene._getTier5HostileUnitsFor(p.unit) || [])
      .filter((foe) => foe.currentHP > 0 && canInspectUnit(grid, foe))
      .map((foe) => {
        const tiles = getFootprint(foe).filter((t) => p.keys.has(key(t)) && seen(t));
        return { foe, tiles, tile: tiles.slice().sort(byNearest)[0] || null };
      })
      .filter(({ tile }) => tile)
      .sort((a, b) => a.tile.row - b.tile.row || a.tile.col - b.tile.col);
  }

  isCenter(tile) {
    return Boolean(tile && this.pending?.keys.has(key(tile)));
  }

  /** Hover / cursor: preview the blast on a legal tile (the prompt holds its own tile). */
  aim(tile) {
    const p = this.pending;
    if (!p || this.scene?.battleState !== AREA_CENTER_STATE || p.locked) return null;
    if (!this.isCenter(tile)) {
      p.aim = null;
      this._preview?.clear();
      return null;
    }
    p.aim = { col: tile.col, row: tile.row };
    return this._showPreview(p.aim);
  }

  /** What the player would see land on `tile`: their knowledge of the board only. */
  previewAt(tile) {
    const p = this.pending;
    if (!p || !this.isCenter(tile)) return null;
    return previewAreaArt({
      attacker: p.unit,
      art: p.art,
      center: tile,
      knowledge: playerKnowledgeOf(this.scene),
      world: this._world(),
      strikeMods: areaStrikeMods(p.unit, p.art, p.weapon),
      weapon: p.weapon,
    });
  }

  _showPreview(tile) {
    const preview = this.previewAt(tile);
    const scene = this.scene;
    safeBattlePresentation(
      'area preview',
      () => (this._preview ||= new AreaPreviewController(scene)).show(preview, { numbers: true }),
      { scene },
    );
    return preview;
  }

  /** Step to the previous / next seen foe in reach (wraps). */
  cycle(direction) {
    const p = this.pending;
    if (!this.active || p.locked) return false;
    const foes = this._seenFoesInReach();
    if (!foes.length) return false;
    // The aim on any tile of a foe's body (the Entity) counts as that foe.
    const at = foes.findIndex(({ tiles }) => tiles.some((t) => sameTile(t, p.aim)));
    const next =
      at === -1
        ? direction > 0
          ? 0
          : foes.length - 1
        : (at + (direction > 0 ? 1 : -1) + foes.length) % foes.length;
    const tile = { col: foes[next].tile.col, row: foes[next].tile.row };
    this.scene._gridCursor?.snapTo(tile.col, tile.row);
    this.aim(tile);
    return true;
  }

  // ── The prompt ─────────────────────────────────────────────────

  /** A click / tap / confirm on `tile`. An illegal tile does nothing. */
  lock(tile) {
    const p = this.pending;
    if (!this.active || !this.isCenter(tile)) return false;
    if (sameTile(p.locked, tile)) {
      void this.fire();
      return true;
    }
    p.locked = null;
    this.aim(tile);
    p.locked = { col: tile.col, row: tile.row };
    this.scene.registry?.get?.('audio')?.playSFX?.('sfx_confirm');
    this._showPrompt();
    // Fire / Back replace ◀ Foe ▶ on the phone's context bar.
    this.scene._emitMobileContext?.();
    return true;
  }

  /** The prompt's lines: the art, its HP cost, and what it lands on that the player sees. */
  promptLines() {
    const p = this.pending;
    if (!p?.locked) return null;
    const hp = Math.max(0, Number(p.unit.currentHP) || 0);
    const cost = getEffectiveWeaponArtHpCost(p.unit, p.art, this._costOptions());
    const preview = this.previewAt(p.locked);
    const area = areaForecastLines(preview, { onHit: false, max: 3 });
    return {
      fire: `Fire ${p.art.name}`,
      hp: `HP ${hp}→${Math.max(0, hp - cost)}`,
      area: area.length ? area : ['No known foes in the blast'],
    };
  }

  _showPrompt() {
    const scene = this.scene;
    const p = this.pending;
    const lines = this.promptLines();
    scene.hideActionMenu();
    scene.actionMenu = [];
    const rows = [
      menuRow({
        id: 'area:fire',
        label: lines.fire,
        status: [lines.hp, ...lines.area].join(' · '),
        color: UI_PALETTE.good,
        invoke: () => void this.fire(),
      }),
      menuRow({
        id: 'area:back',
        label: 'Back',
        color: UI_PALETTE.text,
        invoke: () => this.back(),
      }),
    ];
    if (!railOwnsMenus(scene)) scene._drawActionMenuRows(p.unit, rows);
    scene._registerActionMenu(rows, { state: AREA_CENTER_STATE });
  }

  /** Esc / right-click / Back: prompt → aiming on its tile; aiming → the art picker. */
  back() {
    const scene = this.scene;
    const p = this.pending;
    if (!p) return false;
    scene.registry?.get?.('audio')?.playSFX?.('sfx_cancel');
    if (p.locked) {
      const tile = p.locked;
      scene.hideActionMenu();
      p.locked = null;
      scene.battleState = AREA_CENTER_STATE;
      this.aim(tile);
      scene._emitMobileContext?.();
      return true;
    }
    const unit = p.unit;
    this.clear();
    scene.showWeaponArtPicker(unit);
    return true;
  }

  /** Drop the flow's board marks and state (the caller picks the next state). */
  clear() {
    this.pending = null;
    this._preview?.clear();
    this.scene?.grid?.clearAttackHighlights?.();
  }

  // ── Input ──────────────────────────────────────────────────────

  /**
   * Desktop keyboard while aiming: arrows move the cursor (as the pad's D-pad does),
   * Enter / Space / Z lock (and on the locked tile fire), Q / E cycle seen foes.
   * Esc reaches back() through the scene's cancel route.
   */
  handleKey(event) {
    if (!this.active || !event || event.defaultPrevented) return false;
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    if (event.target?.closest?.('input, textarea, select, button, [contenteditable="true"]'))
      return false;
    const cursor = this.scene._gridCursor;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[event.key]) {
      event.preventDefault?.();
      cursor?.move(...arrows[event.key]);
      return true;
    }
    const k = String(event.key).toLowerCase();
    if ((event.key === 'Enter' || event.key === ' ' || k === 'z') && !event.repeat) {
      event.preventDefault?.();
      if (!cursor) return false;
      return this.lock({ col: cursor.cursorCol, row: cursor.cursorRow });
    }
    if (k === 'q' || k === 'e') {
      event.preventDefault?.();
      return this.cycle(k === 'q' ? -1 : 1);
    }
    return false;
  }

  /** Pad: L1/R1 cycle seen foes; the D-pad and A drive the grid cursor as everywhere. */
  handleInputAction(action, InputAction) {
    if (!this.active) return false;
    if (action === InputAction.PREV_UNIT || action === InputAction.NEXT_UNIT) {
      this.cycle(action === InputAction.PREV_UNIT ? -1 : 1);
      return true;
    }
    return false;
  }

  // ── The strike ─────────────────────────────────────────────────

  async fire() {
    const p = this.pending;
    if (!this.active || !p?.locked) return false;
    const { unit, weapon, art } = p;
    const center = p.locked;
    this.clear();
    this.scene.hideActionMenu();
    return this.execute(unit, weapon, art, center);
  }

  /** Is this strike still legal right now (a resumed intent is checked the same way)? */
  _legal(unit, weapon, art, center) {
    const scene = this.scene;
    if (!unit || !weapon || !art || !center) return false;
    if (!scene.playerUnits?.includes(unit) || !(unit.currentHP > 0) || unit.hasActed) return false;
    if (getWeaponArtTargeting(art) !== 'chosen_center') return false;
    if (!(unit.inventory || []).includes(weapon) && unit.weapon !== weapon) return false;
    if (!resolveWeaponArtIds(weapon, scene._getWeaponArtCatalog?.() || []).includes(art.id))
      return false;
    const check = canUseWeaponArt(unit, weapon, art, {
      turnNumber: scene.turnManager?.turnNumber,
      isInitiating: true,
      actorFaction: unit.faction,
      ...this._costOptions(),
    });
    if (!check.ok || !canAttackWithWeapon(unit, weapon)) return false;
    return isAreaStrikeCenter(unit, art, center, this._world(), weapon);
  }

  /**
   * Save the strike before anything about it is applied (readCommittedAction's
   * `area_strike`): a refresh replays exactly this strike from the saved state.
   */
  commitIntent(unit, weapon, art, center) {
    const scene = this.scene;
    const session = battleSession(scene);
    scene._pendingCommittedAction = null;
    if (!scene.runManager?.battleInProgress) return;
    if (unit?.faction !== 'player' || scene.turnManager?.currentPhase !== 'player') return;
    if (!unit.battleEntityId) return;
    const weaponIndex = Array.isArray(unit.inventory) ? unit.inventory.indexOf(weapon) : -1;
    scene._pendingCommittedAction = {
      kind: 'area_strike',
      unitId: unit.battleEntityId,
      unitName: unit.name,
      center: { col: center.col, row: center.row },
      weaponArt: {
        artId: art.id,
        weaponIndex,
        ...(typeof weapon.uid === 'string' && weapon.uid ? { weaponUid: weapon.uid } : {}),
      },
    };
    scene._captureSuspendCheckpoint?.({ commitIntent: true, session });
  }

  /** Resume a saved `area_strike` intent (BattleSuspendController), or drop it. */
  resumeIntent(intent) {
    const scene = this.scene;
    const unit = findBattleEntity(scene, { unitId: intent?.unitId }, ['playerUnits']);
    const inventory = Array.isArray(unit?.inventory) ? unit.inventory : [];
    const weapon =
      (intent?.weaponArt?.weaponUid &&
        inventory.find((w) => w?.uid === intent.weaponArt.weaponUid)) ||
      inventory[intent?.weaponArt?.weaponIndex] ||
      null;
    const art =
      (scene._getWeaponArtCatalog?.() || []).find((a) => a?.id === intent?.weaponArt?.artId) ||
      null;
    if (!this._legal(unit, weapon, art, intent?.center)) {
      scene._pendingCommittedAction = null;
      return false;
    }
    scene.selectedUnit = unit;
    scene.battleState = 'COMBAT_RESOLVING';
    scene.refreshEndTurnControl?.();
    // As a resumed attack says it.
    try {
      Promise.resolve(showMinorHint(scene, 'Battle resumed. Finishing your attack.')).catch(
        () => {},
      );
    } catch {
      /* cosmetic only */
    }
    const run = () => this.execute(unit, weapon, art, intent.center);
    if (typeof scene._scheduleSafeDelayedAsync === 'function')
      scene._scheduleSafeDelayedAsync(400, 'resume_committed_area_strike', run, {
        phase: 'player',
        turn: scene.turnManager?.turnNumber,
      });
    else void run();
    return true;
  }

  /**
   * The strike, as executeCombat runs an attack: intent, cost, the blows, XP for every
   * victim, removals, the sweep, defeat, level-ups and the `combat` continuation.
   */
  async execute(unit, weapon, art, center) {
    const scene = this.scene;
    const session = battleSession(scene);
    if (session !== this.session) return false;
    if (!this._legal(unit, weapon, art, center)) {
      scene._pendingCommittedAction = null;
      if (unit && scene.playerUnits?.includes(unit) && unit.currentHP > 0 && !unit.hasActed)
        scene.showActionMenu(unit);
      return false;
    }
    scene.battleState = 'COMBAT_RESOLVING';
    safeBattlePresentation('area highlights', () => scene.grid.clearAttackHighlights(), { scene });
    this.commitIntent(unit, weapon, art, center);
    // As executeCombat: a failed intent save holds the strike under the save-retry
    // prompt. Resolving first would let a refresh undo a blast that had already shown
    // the player foes the fog hid.
    const saveGate = scene._saveRetryGate?.(session);
    if (saveGate) {
      await saveGate;
      if (
        !isCurrentBattleSession(scene, session) ||
        scene.battleState === 'BATTLE_END' ||
        scene._fatalDecision ||
        scene._fatalCapturePending ||
        scene._defeatDecision
      )
        return false;
    }
    scene.resetFortHealStreak?.(unit);
    scene._musicCtrl?.onCombat?.();
    try {
      // The art's weapon is equipped on confirm, as for any art.
      if (unit.weapon !== weapon) equipWeapon(unit, weapon);
      const artCost = applyWeaponArtCost(unit, art, this._costOptions());
      if (artCost.waived) scene.showMarkProc?.(unit, `${artCost.mark.name}: no cost`);
      // The cast is the weapon's strike: one Breachbolt shot, whatever the blast hits.
      spendAreaStrikeShot(weapon);
      recordWeaponArtUse(unit, art, { turnNumber: scene.turnManager?.turnNumber });
      scene._applyRecoilGuardAfterArtUse?.(unit, art);
      safeBattlePresentation('area caster HP', () => scene.updateHPBar(unit), { scene });
      await scene._checkPhoenixBrooch(unit);
      if (!isCurrentBattleSession(scene, session)) return false;
      observeHistoryAction(scene, 'called down', unit, null, art.name);
      const result = {};
      await scene._playPostCombatBeats(
        areaStrikeEffects(
          {
            unit,
            art,
            center,
            world: scene._postCombatWorld(),
            strikeMods: areaStrikeMods(unit, art, weapon),
          },
          result,
        ),
      );
      if (!isCurrentBattleSession(scene, session)) return false;
      // Applied to live state: no later checkpoint may carry the intent.
      scene._pendingCommittedAction = null;
      const credits = result.areaCredits || [];
      deedsFor(scene).onAreaStrike(unit, weapon, credits);
      const facts = credits
        .filter((credit) => historyUnitVisible(scene, credit.victim))
        .map(
          (credit) =>
            `${credit.victim.name} took ${credit.damage}${credit.killed ? ' and fell' : ''}.`,
        );
      if (facts.length) scene._timelineFacts = [...(scene._timelineFacts || []), ...facts];
      for (const { victim } of credits) {
        await scene._checkPhoenixBrooch(victim);
        if (!isCurrentBattleSession(scene, session)) return false;
      }
      if (unit.currentHP > 0 && AREA_XP_LIVE && credits.length) {
        await scene.awardXP(unit, null, false, null, null, { credits });
        if (!isCurrentBattleSession(scene, session)) return false;
      }
      await scene._sweepFallenUnits();
      if (!isCurrentBattleSession(scene, session)) return false;
      if (hasBattleDefeat(scene.playerUnits, scene.escapedUnits)) {
        scene.checkBattleEnd();
        return true;
      }
      if (
        scene._fatalDecision ||
        scene._fatalCapturePending ||
        scene._defeatDecision ||
        scene.battleState === 'BATTLE_END'
      )
        return true;
      // Every death of the blast is settled: a tome that fired its last shot is put away.
      await scene._swapSpentWeapons(unit);
      if (!isCurrentBattleSession(scene, session)) return false;
      await safeBattlePresentation(
        'boss half health',
        () => (scene._battleBeats ||= new BattleBeatsController(scene)).checkBossHalfHealth(),
        { scene },
      );
      if (!isCurrentBattleSession(scene, session)) return false;
      safeBattlePresentation(
        'caster low health',
        () => (scene._battleBeats ||= new BattleBeatsController(scene)).onLowHealth(unit),
        { scene },
      );
      const continuation = {
        kind: 'combat',
        unitName: unit.name,
        ...(unit.battleEntityId ? { unitId: unit.battleEntityId } : {}),
      };
      await presentQueuedProgress(scene, continuation, { session });
      if (!isCurrentBattleSession(scene, session)) return false;
      completeResolvedAction(scene, continuation, { session });
      return true;
    } catch (err) {
      if (!isCurrentBattleSession(scene, session)) return false;
      await this._recover(unit, err, session);
      return false;
    } finally {
      if (isCurrentBattleSession(scene, session)) scene._musicCtrl?.onCombatResolved?.();
    }
  }

  /** executeCombat's recovery: report, settle the dead, consume the action. */
  async _recover(unit, err, session) {
    const scene = this.scene;
    scene._pendingCommittedAction = null;
    reportAsyncError('battle_combat_domain_error', err, {
      battleState: scene.battleState,
      phase: scene.turnManager?.currentPhase,
      turn: scene.turnManager?.turnNumber,
    });
    console.error('[AreaTargetingController] strike error:', err);
    try {
      await scene._sweepFallenUnits();
      if (!isCurrentBattleSession(scene, session)) return;
      scene.checkBattleEnd();
    } catch (cleanupErr) {
      console.error('[AreaTargetingController] strike cleanup error:', cleanupErr);
    }
    if (
      scene.battleState === 'BATTLE_END' ||
      scene._fatalDecision ||
      scene._fatalCapturePending ||
      scene._defeatDecision
    )
      return;
    const consume = unit?.faction === 'player' && unit.currentHP > 0 && !unit.hasActed;
    if (consume) {
      unit.hasActed = true;
      safeBattlePresentation('area dim', () => scene.dimUnit(unit), { scene });
    }
    scene.battleState = 'PLAYER_IDLE';
    safeBattlePresentation('area cleanup', () => scene.grid.clearHighlights(), { scene });
    safeBattlePresentation('area cleanup', () => scene.grid.clearAttackHighlights(), { scene });
    scene.selectedUnit = null;
    if (consume) completeBattleAction(scene, unit, { skipDim: true, session });
  }
}
