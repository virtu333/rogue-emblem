// WarpStrikeController — Blink Strike (docs/specs/phase3.md 3E), the one action that leads
// into an attack. Today every ability ends the action (BattleActionSettlement.settleAndPresent
// always finishes it); this one hands over to the ordinary attack.
//
//   Ability → Blink Strike
//     1. destination   free tiles of Blink's diamond from which the EQUIPPED weapon reaches a
//                      seen foe (engine/ActionAbilitySystem findWarpStrikeOptions)
//     2. foe           the foes that destination reaches
//     3. forecast      the ordinary attack forecast, computed from the destination
//                      (AttackFlowController.atWarpDestination), no weapon to cycle, no art
//     4. Confirm       the warp and the attack are ONE action
//
// Cancel steps back one stage (forecast → foe → destination → the action menu). NOTHING moves
// until Confirm: the unit stands where it stood, so every cancel leaves the state exactly as it
// was. Steps 1 and 2 are SELECTING_ABILITY_TILE (Blink's state, already in every cancel / input
// list); step 3 is the attack's own SHOWING_FORECAST, with `scene._warpStrike` set so the
// forecast, its Confirm and its Cancel know they belong to a warp.
//
// The seam. The attack is `BattleScene.executeCombat`, not `settleAndPresent`: it kills through
// removeUnit, awards XP, may level up. So Confirm
//   1. validates the whole pair again (planWarpStrike, against what the player knows),
//   2. settles the warp in the domain (settleWarpStrike: the use is spent and the unit is on
//      its destination), and in the SAME synchronous turn
//   3. calls `executeCombat(unit, foe, { warpStrike })`, whose first act is the intent
//      checkpoint. That checkpoint already holds the warped unit, the spent use and the intent,
//      so the warp never has a durable state of its own: a refresh anywhere after Confirm
//      replays the attack from the destination, a rewind restores the position before it.
//      The warp is DRAWN (a fade, as Blink's) only once that checkpoint is saved.
//   4. The attack's resolved-action checkpoint then closes the action (one rewind row, "Before
//      X's Blink Strike on Y"), with no Canto.
//
// A unit the fog hid standing on the destination is only known to the REAL board: the choices
// never saw it. Then the warp fails: the use is spent, the unit stays where it is and its
// action ends (a failed warp is still a try), through settleAndPresent as any ability.
import { settleAndPresent } from './BattleActionSettlement.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';
import { presentSettledMoves } from './ActionMovementPresentation.js';
import { battleSession, isCurrentBattleSession } from './BattleSession.js';
import { observeHistoryAction } from './BattleHistoryRecorder.js';
import {
  findWarpStrikeOptions,
  planWarpStrike,
  settleWarpStrike,
} from '../engine/ActionAbilitySystem.js';
import { orderAttackTargets } from '../engine/AttackOptions.js';
import { combatDistance, getFootprint } from '../engine/EntitySystem.js';
import { seenTileOccupant } from '../engine/BattleInformation.js';
import { playerKnowledgeOf } from './battleKnowledge.js';
import { UI_HEX, UI_PALETTE } from '../utils/uiStyles.js';

const DESTINATION_COLOR = UI_HEX.lineStrong;
const MARK_FILL = UI_HEX.warn;
const MARK_EDGE = UI_HEX.accentText;

const sameTile = (a, b) => Boolean(a && b && a.col === b.col && a.row === b.row);

/**
 * `getUnitAt` for choosing Blink Strike's destination, from what the player knows: a fogged
 * tile counts as taken (BattleInformation.seenTileOccupant) and so does one a known unit other
 * than `unit` stands on. A unit the fog hides is never consulted.
 */
export function knownTileOccupant(scene, unit) {
  const known = playerKnowledgeOf(scene).occupied(unit);
  return seenTileOccupant(scene.grid, (col, row) => known.has(`${col},${row}`));
}

export class WarpStrikeController {
  /** @param {import('./AbilityController.js').AbilityController} abilities */
  constructor(abilities) {
    this.abilities = abilities;
  }

  get scene() {
    return this.abilities.scene;
  }

  // --- What the player knows ---

  /**
   * The board as the player knows it, in the shape the engine finder reads: a tile is taken
   * when a unit the player knows stands on it (PlayerKnowledge) or the fog hides it, and the
   * foes are the seen ones. Never the real board: that decides only at execution.
   */
  context(unit) {
    const scene = this.scene;
    return {
      grid: scene.grid,
      getUnitAt: knownTileOccupant(scene, unit),
      enemies: this.abilities._seenHostiles(unit),
      skillsData: scene.gameData?.skills,
    };
  }

  /** Destinations and, for each, the foes it reaches. */
  options(unit, skill) {
    return findWarpStrikeOptions(unit, skill.actionAbility, this.context(unit));
  }

  /** The tiles of a foe's body (an Entity covers nine). */
  _bodyTiles(foes) {
    return foes.flatMap((foe) => getFootprint(foe).map(({ col, row }) => ({ col, row })));
  }

  // --- Step 1: the destination ---

  /** Ability → Blink Strike. False (nothing opened) when no destination is in reach. */
  begin(unit, skill) {
    const scene = this.scene;
    const options = this.options(unit, skill);
    if (options.length === 0) return false;
    scene.hideActionMenu();
    scene.inEquipMenu = false;
    // A plain attack: never a weapon art (a picked art would bend the forecast).
    scene._clearSelectedWeaponArt?.();
    scene.battleState = 'SELECTING_ABILITY_TILE';
    this.showDestinations(unit, skill, options);
    return true;
  }

  showDestinations(unit, skill, options = this.options(unit, skill)) {
    const scene = this.scene;
    const tiles = options.map(({ col, row }) => ({ col, row }));
    scene._warpStrike = null;
    scene.attackTargets = [];
    scene.abilityTiles = tiles;
    scene._pendingAbility = { unitName: unit.name, skillId: skill.id, step: 'destination' };
    scene.grid.showAttackRange(tiles, DESTINATION_COLOR, 0.4);
  }

  // --- Step 2: the foe ---

  chooseDestination(unit, skill, option) {
    const scene = this.scene;
    scene._pendingAbility = {
      unitName: unit.name,
      skillId: skill.id,
      step: 'target',
      destination: { col: option.col, row: option.row },
    };
    this._showTargets(option);
  }

  /** The chosen tile outlined, the foes it reaches tinted. */
  _showTargets(option) {
    const scene = this.scene;
    const tiles = this._bodyTiles(option.targets);
    scene.abilityTiles = tiles;
    scene.grid.showRelocateGuide({ col: option.col, row: option.row }, tiles, {
      reduceMotion: Boolean(scene._reduceMotion?.()),
      fill: MARK_FILL,
      edge: MARK_EDGE,
    });
  }

  /** A tap while choosing: a destination, then a foe. */
  handleClick(unit, skill, gp) {
    const scene = this.scene;
    const pending = scene._pendingAbility;
    const options = this.options(unit, skill);
    if (pending?.step === 'target') {
      const option = options.find((entry) => sameTile(entry, pending.destination));
      if (!option) {
        // The board changed under the choice (a foe fell): choose the destination again.
        this.showDestinations(unit, skill, options);
        return;
      }
      const target = option.targets.find((foe) =>
        getFootprint(foe).some((tile) => sameTile(tile, gp)),
      );
      if (!target) return;
      scene.registry.get('audio')?.playSFX('sfx_confirm');
      this.openForecast(unit, skill, option, target);
      return;
    }
    const option = options.find((entry) => sameTile(entry, gp));
    if (!option) return;
    scene.registry.get('audio')?.playSFX('sfx_confirm');
    this.chooseDestination(unit, skill, option);
  }

  // --- Step 3: the forecast, from the destination ---

  openForecast(unit, skill, option, target) {
    const scene = this.scene;
    const destination = { col: option.col, row: option.row };
    // The foes this destination reaches are the forecast's targets (◀ ▶ / ▲ ▼ cycle them).
    scene.attackTargets = orderAttackTargets(unit, option.targets, (foe) =>
      combatDistance(destination, foe),
    );
    scene._warpStrike = { unit, skillId: skill.id, destination };
    return scene._attackFlow().openForecast(unit, target);
  }

  // --- Cancel: one stage back ---

  /** ESC at the foe step goes back to the destination step. True when it did. */
  backFromTarget() {
    const scene = this.scene;
    const pending = scene._pendingAbility;
    if (pending?.step !== 'target') return false;
    const unit = scene.selectedUnit;
    const skill = unit ? this.abilities._getAbilityById(unit, pending.skillId) : null;
    if (!unit || !skill || unit.name !== pending.unitName) return false;
    const options = this.options(unit, skill);
    if (options.length === 0) return false;
    this.showDestinations(unit, skill, options);
    return true;
  }

  /** The forecast's Cancel goes back to the foe step on the same destination. */
  backFromForecast() {
    const scene = this.scene;
    const warp = scene._warpStrike;
    if (!warp) return false;
    // The forecast closes unconfirmed: the rules it showed are read, the roll session of the
    // planned combat dropped, the reticle gone. The unit never moved.
    scene.hideForecast({ acknowledge: true, cancelled: true });
    scene._clearCombatRollSession?.();
    scene._attackFlowController?.hideReticle?.();
    scene.attackTargets = [];
    const skill = this.abilities._getAbilityById(warp.unit, warp.skillId);
    const option = skill
      ? this.options(warp.unit, skill).find((entry) => sameTile(entry, warp.destination))
      : null;
    scene.battleState = 'SELECTING_ABILITY_TILE';
    if (!option) {
      // The destination is no longer offered (a foe fell): start from the destinations.
      if (skill && this.options(warp.unit, skill).length > 0)
        this.showDestinations(warp.unit, skill);
      else this.abandon(warp.unit);
      return false;
    }
    scene._pendingAbility = {
      unitName: warp.unit.name,
      skillId: skill.id,
      step: 'target',
      destination: warp.destination,
    };
    this._showTargets(option);
    return true;
  }

  /** Leave the flow for the action menu, as every other cancel does. */
  abandon(unit) {
    const scene = this.scene;
    scene._warpStrike = null;
    scene.attackTargets = [];
    scene.abilityTiles = [];
    scene._pendingAbility = null;
    scene._clearCombatRollSession?.();
    scene.grid.clearAttackHighlights();
    scene.showActionMenu(unit);
  }

  // --- Step 4: Confirm ---

  /** The forecast's Confirm (BattleScene.confirmForecastCombat). */
  confirm() {
    const scene = this.scene;
    const warp = scene._warpStrike;
    const target = scene.forecastTarget;
    if (!warp || !target) return false;
    const skill = this.abilities._getAbilityById(warp.unit, warp.skillId);
    // The forecast is read: it closes (this also drops `_warpStrike`). Its roll session stays:
    // the attack reads the Gambler's Coin modifier the forecast showed, as any attack does.
    scene.hideForecast({ acknowledge: true });
    if (!skill) {
      this.abandon(warp.unit);
      return false;
    }
    return this.execute(warp.unit, skill, warp.destination, target);
  }

  /**
   * Settle a confirmed Blink Strike as one action (see the file's header).
   * @returns {Promise<boolean>|boolean}
   */
  execute(unit, skill, destination, target) {
    const scene = this.scene;
    const session = battleSession(scene);
    if (session !== this.abilities.session) return false;
    const plan = this._plan(unit, skill, destination, target);
    if (!plan) {
      // What was offered no longer holds (the board changed): back to the menu, nothing spent.
      this.abandon(unit);
      return false;
    }
    const real = (col, row) => scene.getUnitAt(col, row);
    // The real board decides whether anyone stands on the destination (the choices only
    // knew what the player knows).
    const blocker = real(destination.col, destination.row);
    if (blocker && blocker !== unit) return this._failWarp(unit, skill, plan, real, session);

    scene.commitVisionSnapshotIfPending?.();
    scene.attackTargets = [];
    scene.abilityTiles = [];
    scene._pendingAbility = null;
    scene._clearSelectedWeaponArt?.();
    observeHistoryAction(scene, 'relocated', unit, null, skill.name);
    const facts = settleWarpStrike(unit, skill, plan, { occupantAt: real });
    return scene.executeCombat(unit, target, {
      warpStrike: {
        present: async () => {
          await presentSettledMoves(scene, facts.moves, {
            session,
            label: 'ability_blink_strike',
            fade: true,
          });
          if (!isCurrentBattleSession(scene, session)) return;
          safeBattlePresentation(
            'blink strike movement state',
            () => scene._refreshPostCombatMovementState([unit], { revealFog: false }),
            { scene },
          );
        },
      },
    });
  }

  /** The pair, validated against what the player knows now; null when it no longer holds. */
  _plan(unit, skill, destination, target) {
    if (!this.abilities._validateAbility(unit, skill)) return null;
    const plan = planWarpStrike(unit, skill.actionAbility, destination, target, this.context(unit));
    return plan.ok ? plan : null;
  }

  /**
   * A unit the fog hid stands on the destination: the warp fails. The use is spent, the unit
   * stays, the action ends (no Canto: nothing was struck) under one checkpoint.
   */
  _failWarp(unit, skill, plan, real, session) {
    const scene = this.scene;
    return settleAndPresent(scene, {
      unit,
      session,
      label: 'ability_blink_strike_blocked',
      validate: () => this._validateOnPlan(unit, skill, plan),
      settle: () => {
        scene.attackTargets = [];
        scene.abilityTiles = [];
        scene._pendingAbility = null;
        return settleWarpStrike(unit, skill, plan, { occupantAt: real });
      },
      present: ({ blocker }) => {
        safeBattlePresentation('ability menu', () => scene.hideActionMenu(), { scene });
        safeBattlePresentation(
          'blink strike blocked',
          () => {
            const pos = scene.grid.gridToPixel(blocker.col, blocker.row);
            scene.showMinorHintAt(pos.x, pos.y, 'Blocked!', UI_PALETTE.bad);
          },
          { scene },
        );
      },
      continuation: {
        kind: 'finish',
        unitName: unit.name,
        ...(unit.battleEntityId ? { unitId: unit.battleEntityId } : {}),
        skipCanto: true,
      },
    });
  }

  _validateOnPlan(unit, skill, plan) {
    return this._plan(unit, skill, plan.destination, plan.target) !== null;
  }
}
