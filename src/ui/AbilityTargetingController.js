// AbilityTargetingController — the abilities that pick one adjacent unit
// (action skills with `actionAbility.kind` push_enemy / transfer_hp / steal_item: Smite,
// Transfuse, Steal).
// AbilityController owns the menu and routes here; this owns the target step and the
// action itself. Targets are chosen in SELECTING_ABILITY_TILE (the state Blink uses,
// already in every cancel / input / Vision-rewind list), on the target unit's own tile,
// with scene.abilityTiles / scene._pendingAbility as the shared state so ESC and a
// rewind clean it up the same way.
//
// The rules live in engine/ActionAbilitySystem.js (findSmiteTargets,
// findTransfuseTargets, findStealTargets, settleSmite, settleTransfuse) and engine/Steal.js
// (settleSteal: one atomic transfer of the carried item). This file only reads what the
// player knows to build the preview (seen foes, fogged tiles taken, a slide over the
// units known: ui/forcedMoveProbes.js), settles over the real board through
// settleAndPresent (the checkpoint is durable before anything is drawn) and draws.
import { settleAndPresent } from './BattleActionSettlement.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';
import { presentSettledMoves } from './ActionMovementPresentation.js';
import { battleSession, isCurrentBattleSession } from './BattleSession.js';
import { observeHistoryAction } from './BattleHistoryRecorder.js';
import { CombatFxController } from './CombatFxController.js';
import { UI_HEX, UI_PALETTE } from '../utils/uiStyles.js';
import { forcedMoveProbes } from './forcedMoveProbes.js';
import {
  findSmiteTargets,
  findStealTargets,
  findTransfuseTargets,
  stealStatus,
  markUsed,
  settleSmite,
  settleTransfuse,
} from '../engine/ActionAbilitySystem.js';
import { STEAL_ABILITY_KIND, settleSteal, stealReasonLabel } from '../engine/Steal.js';

const FOE_TILE_COLOR = UI_HEX.warn;
const ALLY_TILE_COLOR = UI_HEX.hpHigh;

export class AbilityTargetingController {
  /** @param {import('./AbilityController.js').AbilityController} abilities */
  constructor(abilities) {
    this.abilities = abilities;
  }

  get scene() {
    return this.abilities.scene;
  }

  /** What the player knows, in the shape the engine finders read. */
  _context(unit, skill) {
    const scene = this.scene;
    const { grid, getUnitAt, slideUnitAt } = forcedMoveProbes(scene).preview;
    return {
      grid,
      getUnitAt,
      slideUnitAt,
      enemies: this.abilities._seenHostiles(unit),
      allies: this.abilities._allyPool(unit, skill.actionAbility?.kind),
      affixes: scene.gameData?.affixes,
      // Steal's room check: the convoy takes the item when the thief's own bag cannot.
      canAddToConvoy: (item) => Boolean(scene.runManager?.canAddToConvoy?.(item)),
    };
  }

  /** Legal targets right now: [{ unit, ... }], empty when the skill is not a targeted one. */
  find(unit, skill) {
    const ability = skill?.actionAbility;
    if (ability?.kind === 'push_enemy')
      return findSmiteTargets(unit, ability, this._context(unit, skill));
    if (ability?.kind === 'transfer_hp')
      return findTransfuseTargets(unit, ability, this._context(unit, skill));
    if (ability?.kind === STEAL_ABILITY_KIND)
      return findStealTargets(unit, ability, this._context(unit, skill));
    return [];
  }

  /** Highlight the legal targets and wait for a tap on one. */
  begin(unit, skill) {
    const scene = this.scene;
    scene.hideActionMenu();
    scene.inEquipMenu = false;
    scene.battleState = 'SELECTING_ABILITY_TILE';
    const targets = this.find(unit, skill);
    const tiles = targets.map((target) => ({ col: target.unit.col, row: target.unit.row }));
    scene.abilityTiles = tiles;
    scene._pendingAbility = { unitName: unit.name, skillId: skill.id };
    const hostile = ['push_enemy', STEAL_ABILITY_KIND].includes(skill.actionAbility.kind);
    scene.grid.showAttackRange(tiles, hostile ? FOE_TILE_COLOR : ALLY_TILE_COLOR, 0.4);
  }

  /** A tap while aiming: act on the target standing on that tile. */
  handleClick(unit, skill, gp) {
    const scene = this.scene;
    const target = this.find(unit, skill).find(
      (entry) => entry.unit.col === gp.col && entry.unit.row === gp.row,
    );
    if (!target) {
      if (skill.actionAbility?.kind === STEAL_ABILITY_KIND)
        this._explainRefusedSteal(unit, skill, gp);
      return;
    }
    scene.registry.get('audio')?.playSFX('sfx_confirm');
    scene.grid.clearAttackHighlights();
    scene.abilityTiles = [];
    scene._pendingAbility = null;
    void this.execute(unit, skill, target);
  }

  /** A tap on a carrier Steal cannot rob (the room went, or it is quicker): say why. */
  _explainRefusedSteal(unit, skill, gp) {
    const scene = this.scene;
    const { reason } = stealStatus(unit, skill.actionAbility, this._context(unit, skill));
    const label = stealReasonLabel(reason);
    if (!label) return;
    safeBattlePresentation(
      'steal refusal',
      () => {
        const pos = scene.grid.gridToPixel(gp.col, gp.row);
        scene.showMinorHintAt(pos.x, pos.y, label, UI_PALETTE.bad);
      },
      { scene },
    );
  }

  execute(unit, skill, target) {
    const scene = this.scene;
    const session = battleSession(scene);
    if (session !== this.abilities.session) return false;
    const kind = skill.actionAbility.kind;
    const smite = kind === 'push_enemy';
    const steal = kind === STEAL_ABILITY_KIND;
    const label = smite ? 'ability_smite' : steal ? 'ability_steal' : 'ability_transfuse';
    // The finder is the validator: the target the player chose must still be a legal
    // one, with the landing tile (Smite) it was offered.
    let current = null;
    return settleAndPresent(scene, {
      unit,
      session,
      label,
      validate: () => {
        if (!this.abilities._validateAbility(unit, skill)) return false;
        current =
          this.find(unit, skill).find(
            (entry) =>
              entry.unit === target?.unit &&
              (!smite || (entry.destCol === target.destCol && entry.destRow === target.destRow)),
          ) || null;
        return current !== null;
      },
      settle: () => {
        const ability = skill.actionAbility;
        if (Number(ability.perMapLimit) > 0) markUsed(unit, skill.id);
        if (smite) {
          observeHistoryAction(scene, 'smote', unit, current.unit);
          return { kind, ...settleSmite(current, forcedMoveProbes(scene).world) };
        }
        if (steal) {
          // One atomic transfer (engine/Steal.js): room is checked first, the same item
          // instance moves into the bag or the convoy, and only then does the carrier let go.
          const facts = settleSteal(unit, current.unit, { run: scene.runManager });
          if (!facts) throw new Error('Steal refused after its target was validated');
          observeHistoryAction(scene, 'stole from', unit, facts.carrier, facts.item.name);
          return { kind, ...facts };
        }
        const facts = settleTransfuse(unit, current, ability);
        observeHistoryAction(scene, 'transfused', unit, facts.ally, `${facts.given} HP`, {
          amount: facts.given,
        });
        return { kind, ...facts };
      },
      present: async (facts) => {
        safeBattlePresentation('ability menu', () => scene.hideActionMenu(), { scene });
        if (smite) return this._presentSmite(facts, { session, label });
        if (steal) return this._presentSteal(facts);
        return this._presentTransfuse(facts);
      },
    });
  }

  async _presentSmite({ moves }, { session, label }) {
    const scene = this.scene;
    safeBattlePresentation('smite sound', () => scene.registry.get('audio')?.playSFX('sfx_hit'), {
      scene,
    });
    await presentSettledMoves(scene, moves, { session, label, duration: 120 });
    if (!isCurrentBattleSession(scene, session)) return;
    safeBattlePresentation(
      'smite movement state',
      () => {
        scene.dangerZoneStale = true;
        scene._pinnedThreats?.invalidate();
        scene._refreshPostCombatMovementState(
          moves.map((move) => move.unit),
          { revealFog: false },
        );
      },
      { scene },
    );
  }

  _presentSteal({ thief, carrier, item, destination }) {
    const scene = this.scene;
    safeBattlePresentation(
      'steal sound',
      () => scene.registry.get('audio')?.playSFX('sfx_confirm'),
      {
        scene,
      },
    );
    // The carrier's sack pip goes with the item.
    safeBattlePresentation('steal carrier pip', () => scene.updateAffixPips?.(carrier), { scene });
    safeBattlePresentation(
      'steal banner',
      () => {
        const pos = scene.grid.gridToPixel(thief.col, thief.row);
        scene.showMinorHintAt(
          pos.x,
          pos.y,
          `Stole ${item.name}${destination === 'convoy' ? ' (convoy)' : ''}`,
          UI_PALETTE.good,
        );
      },
      { scene },
    );
  }

  _presentTransfuse({ giver, ally, given, paid }) {
    const scene = this.scene;
    safeBattlePresentation(
      'transfuse sound',
      () => scene.registry.get('audio')?.playSFX('sfx_heal'),
      {
        scene,
      },
    );
    safeBattlePresentation(
      'transfuse ally',
      () => {
        scene.updateHPBar(ally);
        const pos = scene.grid.gridToPixel(ally.col, ally.row);
        (scene._combatFx ||= new CombatFxController(scene)).playHeal(pos.x, pos.y);
        scene.showMinorHintAt(pos.x, pos.y, `+${given}`, UI_PALETTE.good);
      },
      { scene },
    );
    safeBattlePresentation(
      'transfuse giver',
      () => {
        scene.updateHPBar(giver);
        const pos = scene.grid.gridToPixel(giver.col, giver.row);
        scene.showMinorHintAt(pos.x, pos.y, `-${paid}`, UI_PALETTE.bad);
      },
      { scene },
    );
  }
}
