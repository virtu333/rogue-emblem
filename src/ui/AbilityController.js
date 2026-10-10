import { settleAndPresent } from './BattleActionSettlement.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';
import { presentSettledMoves } from './ActionMovementPresentation.js';
import { battleSession, isCurrentBattleSession } from './BattleSession.js';
import { observeHistoryAction } from './BattleHistoryRecorder.js';
// AbilityController — the "Ability" action-menu surface for utility abilities
// (action-trigger skills with structured `actionAbility` data: Blink, Rally
// Cry, Healing Circle, Ensnare, Smite, Transfuse, Steal, Great Sacrifice, Goddess Dance,
// Blink Strike). Owns the ability submenu (patterned on
// WeaponArtController.showWeaponArtPicker), the SELECTING_ABILITY_TILE flow for Blink,
// the confirm prompt for self-centered abilities (the AOEs, Great Sacrifice, Goddess
// Dance), and effect execution; the adjacent-target abilities (Smite, Transfuse,
// Steal) hand their target step and action to AbilityTargetingController, and Blink
// Strike, the one ability that leads into an attack, to WarpStrikeController.
// State lives on the scene (abilityTiles/_pendingAbility) so the shared
// ESC/cancel recovery paths in BattleScene can clean it up.
import { TILE_SIZE, XP_BASE_DANCE } from '../utils/constants.js';
import { hasRoomRightOf } from '../utils/boardOrientation.js';
import {
  getActionAbilities,
  getAbilityUsageCount,
  canUseAbility,
  markUsed,
  settleBlink,
  settleRally,
  settleHealingCircle,
  settleEnsnare,
  settleGreatSacrifice,
  settleGoddessDance,
  sacrificeAmount,
  sacrificeTargets,
  findDanceRefreshTargets,
  getBlinkTiles,
  collectAffected,
  abilityHasTargets,
  TARGETED_ABILITY_KINDS,
  stealStatus,
} from '../engine/ActionAbilitySystem.js';
import { STEAL_ABILITY_KIND, stealReasonLabel } from '../engine/Steal.js';
import { stealRunOptions } from '../engine/ShrineBoons.js';
import { AbilityTargetingController } from './AbilityTargetingController.js';
import { WarpStrikeController, knownTileOccupant } from './WarpStrikeController.js';
import { presentRefreshSparkle } from './MovementActionController.js';
import { staffAllyCandidates } from '../engine/RecruitNpc.js';
import { canInspectUnit, seenTileOccupant } from '../engine/BattleInformation.js';
import { deedsFor } from './DeedController.js';
import { CombatFxController } from './CombatFxController.js';
import { UI_PALETTE, UI_HEX } from '../utils/uiStyles.js';
import { menuRow, railOwnsMenus, rowText } from './battleMenuModel.js';

const BLINK_TILE_COLOR = UI_HEX.lineStrong;
const ALLY_AOE_COLOR = UI_HEX.hpHigh;
const ENEMY_AOE_COLOR = UI_HEX.warn;
/** Kinds that mend whoever a heal staff can (the army plus the NPC allies the caster sees). */
const HEALS_LIKE_A_STAFF = new Set(['aoe_heal', 'sacrifice_heal']);
/** Self-centered kinds: no pick, a confirm prompt naming who is affected. */
const SELF_CENTERED_KINDS = [
  'ally_buff',
  'aoe_heal',
  'aoe_root',
  'sacrifice_heal',
  'refresh_adjacent',
];

export class AbilityController {
  constructor(scene) {
    this.scene = scene;
    this.session = battleSession(scene);
  }

  create() {
    // No persistent UI — menus are built on demand via scene.actionMenu.
  }

  // --- Availability ---

  /**
   * The units an ability of `kind` counts as allies. Healing Circle mends whoever
   * a heal staff can (HealController.findHealTargets): for a player caster, the
   * army plus the living NPC allies it can see. Rally Cry and the rest keep the
   * caster's own side.
   */
  _allyPool(unit, kind) {
    const scene = this.scene;
    const allies = scene.getDivineChargeAllies(unit);
    if (!HEALS_LIKE_A_STAFF.has(kind) || unit?.faction !== 'player') return allies;
    return staffAllyCandidates(allies, scene.npcUnits).filter((ally) =>
      canInspectUnit(scene.grid, ally),
    );
  }

  /**
   * Foes the menu and the confirm prompt may count: only those the player sees. A
   * unit that moved next to the fog hasn't lifted it yet (revealSettledVision), so an
   * unfiltered count would name what hides there. The effect itself still lands on
   * everyone in its radius.
   */
  _seenHostiles(unit) {
    const scene = this.scene;
    return scene._getTier5HostileUnitsFor(unit).filter((foe) => canInspectUnit(scene.grid, foe));
  }

  _getAbilityEntries(unit) {
    const scene = this.scene;
    const skillsData = scene.gameData?.skills || [];
    return getActionAbilities(unit, skillsData).map((skill) => {
      const check = canUseAbility(unit, skill);
      const ctx = {
        grid: scene.grid,
        // Blink Strike's choices read the player's knowledge, never the real board.
        getUnitAt:
          skill.actionAbility?.kind === 'warp_strike'
            ? knownTileOccupant(scene, unit)
            : seenTileOccupant(scene.grid, (col, row) => scene.getUnitAt(col, row)),
        allies: this._allyPool(unit, skill.actionAbility?.kind),
        enemies: this._seenHostiles(unit),
        affixes: scene.gameData?.affixes,
        skillsData,
        canAddToConvoy: (item) => Boolean(scene.runManager?.canAddToConvoy?.(item)),
        // Cutpurse's Luck: a player thief's speed check is waived (ShrineBoons.stealRunOptions).
        ...stealRunOptions(scene.runManager, unit),
      };
      const hasTargets = abilityHasTargets(unit, skill, ctx);
      // Steal says why it is greyed beside a carrier: "Too slow", "Bag and convoy full".
      const stealReason =
        skill.actionAbility?.kind === STEAL_ABILITY_KIND && !hasTargets
          ? stealStatus(unit, skill.actionAbility, ctx).reason
          : null;
      return { skill, canUse: check.ok, reason: check.reason, hasTargets, stealReason };
    });
  }

  /** True when the unit should see an "Ability" entry in the action menu. */
  hasAbilities(unit) {
    return getActionAbilities(unit, this.scene.gameData?.skills || []).length > 0;
  }

  _getAbilityById(unit, skillId) {
    const skillsData = this.scene.gameData?.skills || [];
    return getActionAbilities(unit, skillsData).find((skill) => skill.id === skillId) || null;
  }

  _reasonLabel(entry, unit = null) {
    if (entry.reason === 'per_map_limit') return 'Used this battle';
    if (entry.reason === 'silenced') return 'Silenced';
    if (!entry.hasTargets && entry.stealReason) return stealReasonLabel(entry.stealReason);
    if (!entry.hasTargets) {
      // Great Sacrifice never takes the last HP: say so rather than "no targets".
      if (entry.skill.actionAbility?.kind === 'sacrifice_heal' && (unit?.currentHP ?? 2) <= 1)
        return 'Too little HP';
      return 'No valid targets';
    }
    return 'Unavailable';
  }

  _statusLine(unit, entry) {
    const ability = entry.skill.actionAbility;
    const limit = Math.max(0, Math.trunc(Number(ability.perMapLimit) || 0));
    const used = getAbilityUsageCount(unit, entry.skill.id);
    const usesLabel =
      limit > 0 ? `${Math.max(0, limit - used)}/${limit} uses left` : 'Unlimited uses';
    const status =
      !entry.canUse || !entry.hasTargets ? this._reasonLabel(entry, unit) : 'Ends unit action';
    return `${usesLabel} · ${status}`;
  }

  // --- Ability submenu (one row per ability) ---

  showAbilityPicker(unit) {
    const scene = this.scene;
    scene.hideActionMenu();
    scene.inEquipMenu = true;
    scene.battleState = 'UNIT_ACTION_MENU';

    const entries = this._getAbilityEntries(unit);
    if (entries.length <= 0) {
      scene.inEquipMenu = false;
      scene.showActionMenu(unit);
      return;
    }

    // The menu as rows (battleMenuModel): the canvas and the phone rail both render them.
    const rows = [
      ...entries.map((entry) => {
        const usable = entry.canUse && entry.hasTargets;
        return menuRow({
          id: `ability:${entry.skill.id}`,
          label: entry.skill.name,
          status: this._statusLine(unit, entry),
          description: entry.skill.description,
          disabled: !usable,
          color: usable ? UI_PALETTE.text : UI_PALETTE.muted,
          invoke: () => {
            // Re-check at click time — usage/silence may have changed since render
            const latest = this._getAbilityEntries(unit).find((e) => e.skill.id === entry.skill.id);
            if (!latest || !latest.canUse || !latest.hasTargets) {
              this.showAbilityPicker(unit);
              return;
            }
            const audio = scene.registry.get('audio');
            if (audio) audio.playSFX('sfx_confirm');
            this._selectAbility(unit, latest.skill);
          },
        });
      }),
      // A real menu entry keeps confirm/navigation usable even when every skill is disabled.
      menuRow({
        id: 'back',
        label: 'Back',
        color: UI_PALETTE.text,
        invoke: () => scene.requestCancel({ allowPause: false }),
      }),
    ];

    scene.actionMenu = [];
    if (!railOwnsMenus(scene)) this._drawCanvasRows(unit, rows, entries);
    scene._registerActionMenu(rows);
  }

  /** The desktop canvas menu for the picker's rows (the phone rail renders its own). */
  _drawCanvasRows(unit, rows, entries) {
    const scene = this.scene;
    const pos = scene.grid.gridToPixel(unit.col, unit.row);
    const menuWidth = 280;
    const menuX = hasRoomRightOf(scene.grid, unit.col, unit.row)
      ? pos.x + TILE_SIZE
      : pos.x - TILE_SIZE - menuWidth;
    const menuY = pos.y - 10;
    const itemHeight = scene.isMobileInput ? 46 : 42;
    const menuHeight = rows.length * itemHeight + 12;
    const menuPos = scene._clampMenuPosition(menuX, menuY, menuWidth, menuHeight);

    const bg = scene.add
      .rectangle(
        menuPos.x + menuWidth / 2,
        menuPos.y + menuHeight / 2,
        menuWidth,
        menuHeight,
        0x000000,
        0.9,
      )
      .setDepth(400)
      .setStrokeStyle(1, UI_HEX.line);
    scene.actionMenu.push(bg);

    rows.forEach((row, i) => {
      const skill = entries[i]?.skill || null;
      const text = scene._makeMenuTextButton(
        menuPos.x + 8,
        menuPos.y + 6 + i * itemHeight + itemHeight / 2,
        rowText(row),
        skill
          ? { fontFamily: 'monospace', fontSize: '10px', color: row.color, lineSpacing: 1 }
          : { fontFamily: 'monospace', fontSize: '12px', color: row.color },
        row.color,
        () => row.invoke(),
        {
          originX: 0,
          originY: 0.5,
          hitWidth: menuWidth - 12,
          hitHeight: itemHeight,
          disabled: row.disabled,
        },
      );
      text._rowId = row.id;
      if (skill) this._wireAbilityTooltip(text, skill);
      scene.actionMenu.push(text);
    });
    scene._pinToScreen(scene.actionMenu);
  }

  _wireAbilityTooltip(text, skill) {
    const scene = this.scene;
    // Reuse the weapon-art tooltip surface — it only reads name/description.
    scene._wireWeaponArtTooltip?.(text, {
      name: skill.name,
      description: skill.description,
    });
  }

  _selectAbility(unit, skill) {
    const kind = skill.actionAbility?.kind;
    if (kind === 'teleport_self') {
      this.startBlinkTileSelection(unit, skill);
      return;
    }
    if (TARGETED_ABILITY_KINDS.has(kind)) {
      this._targeting().begin(unit, skill);
      return;
    }
    if (kind === 'warp_strike') {
      // Nothing to pick: the picker only offered Blink Strike with a destination in reach.
      if (!this._warpStrike().begin(unit, skill)) this.showAbilityPicker(unit);
      return;
    }
    this._showConfirmPrompt(unit, skill);
  }

  /** Smite / Transfuse: pick an adjacent unit (AbilityTargetingController). */
  _targeting() {
    return (this._targetingController ||= new AbilityTargetingController(this));
  }

  /** Blink Strike: destination, target, forecast, one action (WarpStrikeController). */
  _warpStrike() {
    return (this._warpStrikeController ||= new WarpStrikeController(this));
  }

  // --- Blink: tile targeting (SELECTING_ABILITY_TILE) ---

  startBlinkTileSelection(unit, skill) {
    const scene = this.scene;
    scene.hideActionMenu();
    scene.inEquipMenu = false;
    scene.battleState = 'SELECTING_ABILITY_TILE';
    const tiles = getBlinkTiles(
      unit,
      skill.actionAbility.range,
      scene.grid,
      seenTileOccupant(scene.grid, (col, row) => scene.getUnitAt(col, row)),
    );
    scene.abilityTiles = tiles;
    scene._pendingAbility = { unitName: unit.name, skillId: skill.id };
    scene.grid.showAttackRange(tiles, BLINK_TILE_COLOR, 0.4);
  }

  handleAbilityTileClick(gp) {
    const scene = this.scene;
    const unit = scene.selectedUnit;
    const pending = scene._pendingAbility;
    if (!unit || !pending || pending.unitName !== unit.name) return;
    const tile = (scene.abilityTiles || []).find((t) => t.col === gp.col && t.row === gp.row);
    if (!tile) return;
    const skill = this._getAbilityById(unit, pending.skillId);
    if (!skill || !canUseAbility(unit, skill).ok) return;
    if (TARGETED_ABILITY_KINDS.has(skill.actionAbility?.kind)) {
      this._targeting().handleClick(unit, skill, gp);
      return;
    }
    if (skill.actionAbility?.kind === 'warp_strike') {
      this._warpStrike().handleClick(unit, skill, gp);
      return;
    }
    const audio = scene.registry.get('audio');
    if (audio) audio.playSFX('sfx_confirm');
    scene.grid.clearAttackHighlights();
    scene.abilityTiles = [];
    scene._pendingAbility = null;
    void this.executeBlink(unit, skill, tile);
  }

  /**
   * Shared cleanup for ESC/right-click out of SELECTING_ABILITY_TILE. Blink Strike's second
   * step (the foe) steps back to its first (the destination) and stays in the state: it
   * returns true, so the caller does not reopen the action menu. Everything else clears.
   * @returns {boolean} true when it stepped back and the state stays
   */
  cancelTileSelection() {
    const scene = this.scene;
    if (this._warpStrikeController?.backFromTarget()) return true;
    scene.grid.clearAttackHighlights();
    scene.abilityTiles = [];
    scene._pendingAbility = null;
    return false;
  }

  executeBlink(unit, skill, tile) {
    const scene = this.scene;
    const session = battleSession(scene);
    if (session !== this.session) return false;
    return settleAndPresent(scene, {
      unit,
      session,
      label: 'ability_blink',
      validate: () =>
        this._validateAbility(unit, skill) &&
        skill.actionAbility.kind === 'teleport_self' &&
        getBlinkTiles(
          unit,
          skill.actionAbility.range,
          scene.grid,
          seenTileOccupant(scene.grid, (col, row) => scene.getUnitAt(col, row)),
        ).some((entry) => entry.col === tile?.col && entry.row === tile?.row),
      settle: () => {
        observeHistoryAction(scene, 'relocated', unit, null, skill.name);
        return settleBlink(unit, skill, tile);
      },
      present: async ({ moves }) => {
        safeBattlePresentation('ability menu', () => scene.hideActionMenu(), { scene });
        await presentSettledMoves(scene, moves, { session, label: 'ability_blink', fade: true });
        if (!isCurrentBattleSession(scene, session)) return;
        safeBattlePresentation(
          'ability movement state',
          () => scene._refreshPostCombatMovementState([unit], { revealFog: false }),
          { scene },
        );
      },
    });
  }

  _validateAbility(unit, skill) {
    const scene = this.scene;
    return (
      !!unit &&
      scene.playerUnits.includes(unit) &&
      unit.currentHP > 0 &&
      !unit.hasActed &&
      this._getAbilityById(unit, skill?.id) === skill &&
      canUseAbility(unit, skill).ok
    );
  }

  // --- Self-centered abilities (Rally Cry / Healing Circle / Ensnare / Great Sacrifice /
  //     Goddess Dance): a confirm prompt naming who is affected ---

  /**
   * The units a self-centered ability would affect right now, as the player knows them:
   * the AOEs' radius, Great Sacrifice's hurt and healable allies in range, Goddess Dance's
   * adjacent allies who have acted.
   */
  _affectedBy(unit, skill) {
    const ability = skill.actionAbility;
    if (ability.kind === 'aoe_root')
      return collectAffected(unit, ability, this._seenHostiles(unit));
    const pool = this._allyPool(unit, ability.kind);
    if (ability.kind === 'sacrifice_heal') return sacrificeTargets(unit, ability, pool);
    if (ability.kind === 'refresh_adjacent') return findDanceRefreshTargets(unit, pool);
    return collectAffected(unit, ability, pool);
  }

  _showConfirmPrompt(unit, skill) {
    const scene = this.scene;
    scene.hideActionMenu();
    scene.inEquipMenu = true;
    scene.battleState = 'UNIT_ACTION_MENU';

    const ability = skill.actionAbility;
    const hostile = ability.kind === 'aoe_root';
    const affected = this._affectedBy(unit, skill);
    const tiles = affected.map((target) => ({ col: target.col, row: target.row }));
    scene.grid.showAttackRange(tiles, hostile ? ENEMY_AOE_COLOR : ALLY_AOE_COLOR, 0.4);

    const pos = scene.grid.gridToPixel(unit.col, unit.row);
    const menuWidth = 240;
    const menuX = hasRoomRightOf(scene.grid, unit.col, unit.row)
      ? pos.x + TILE_SIZE
      : pos.x - TILE_SIZE - menuWidth;
    const menuY = pos.y - 10;

    scene.actionMenu = [];
    // Owned by menu teardown, including cancel, replacement and shutdown.
    scene._actionMenuCleanup = () => scene.grid?.clearAttackHighlights?.();

    const itemHeight = scene.isMobileInput ? 40 : 32;
    const rows = 2;
    const menuHeight = rows * itemHeight + 12;
    const menuPos = scene._clampMenuPosition(menuX, menuY, menuWidth, menuHeight);

    const bg = scene.add
      .rectangle(
        menuPos.x + menuWidth / 2,
        menuPos.y + menuHeight / 2,
        menuWidth,
        menuHeight,
        0x000000,
        0.9,
      )
      .setDepth(400)
      .setStrokeStyle(1, UI_HEX.line);
    scene.actionMenu.push(bg);

    const targetNoun = hostile
      ? affected.length === 1
        ? 'enemy'
        : 'enemies'
      : affected.length === 1
        ? 'ally'
        : 'allies';
    // Great Sacrifice names what it costs: the HP the user pays is what each ally heals.
    const cost =
      ability.kind === 'sacrifice_heal'
        ? `-${sacrificeAmount(unit, ability, this._allyPool(unit, ability.kind))} HP, `
        : '';
    const confirmLabel = `Use ${skill.name} (${cost}${affected.length} ${targetNoun})`;
    const makeRow = (rowIndex, label, color, onClick) => {
      const rowY = menuPos.y + 6 + rowIndex * itemHeight + itemHeight / 2;
      const text = scene._makeMenuTextButton(
        menuPos.x + 8,
        rowY,
        label,
        {
          fontFamily: 'monospace',
          fontSize: '11px',
          color,
        },
        color,
        onClick,
        { originX: 0, originY: 0.5, hitWidth: menuWidth - 12, hitHeight: itemHeight },
      );
      scene.actionMenu.push(text);
    };

    makeRow(0, confirmLabel, UI_PALETTE.good, () => {
      const latest = canUseAbility(unit, skill);
      if (!latest.ok) {
        this.showAbilityPicker(unit);
        return;
      }
      const audio = scene.registry.get('audio');
      if (audio) audio.playSFX('sfx_confirm');
      void this.executeSelfCentered(unit, skill);
    });
    makeRow(1, 'Cancel', UI_PALETTE.text, () => {
      const audio = scene.registry.get('audio');
      if (audio) audio.playSFX('sfx_cancel');
      this.showAbilityPicker(unit);
    });
    scene._pinToScreen(scene.actionMenu);
    scene._registerActionMenu();
  }

  executeSelfCentered(unit, skill) {
    const scene = this.scene;
    const session = battleSession(scene);
    if (session !== this.session) return false;
    return settleAndPresent(scene, {
      unit,
      session,
      label: 'ability',
      validate: () =>
        this._validateAbility(unit, skill) &&
        SELF_CENTERED_KINDS.includes(skill.actionAbility.kind) &&
        abilityHasTargets(unit, skill, {
          allies: this._allyPool(unit, skill.actionAbility.kind),
          enemies: this._seenHostiles(unit),
        }),
      settle: () => {
        const ability = skill.actionAbility;
        markUsed(unit, skill.id);
        if (ability.kind === 'ally_buff') {
          const affected = collectAffected(unit, ability, scene.getDivineChargeAllies(unit));
          for (const ally of affected)
            observeHistoryAction(scene, 'rallied', unit, ally, skill.name);
          const beats = settleRally(
            {
              artId: `ability::${skill.id}`,
              range: ability.radius,
              stats: ability.stats,
              durationPhases: ability.durationPhases,
              includeSelf: ability.includeSelf === true,
            },
            unit,
            scene._postCombatWorld(),
          );
          return { kind: ability.kind, affected, beats };
        }
        if (ability.kind === 'aoe_heal') {
          const targets = settleHealingCircle(unit, ability, this._allyPool(unit, ability.kind));
          for (const entry of targets)
            if (entry.healed > 0) {
              deedsFor(scene).onHeal(unit, entry.unit, entry.hpBefore);
              observeHistoryAction(scene, 'healed', unit, entry.unit, `${entry.healed} HP`, {
                amount: entry.healed,
              });
            }
          return { kind: ability.kind, targets };
        }
        if (ability.kind === 'sacrifice_heal') {
          const facts = settleGreatSacrifice(unit, ability, this._allyPool(unit, ability.kind));
          for (const entry of facts.targets)
            if (entry.healed > 0) {
              deedsFor(scene).onHeal(unit, entry.unit, entry.hpBefore);
              observeHistoryAction(scene, 'healed', unit, entry.unit, `${entry.healed} HP`, {
                amount: entry.healed,
              });
            }
          return { kind: ability.kind, ...facts };
        }
        if (ability.kind === 'refresh_adjacent') {
          const targets = findDanceRefreshTargets(unit, this._allyPool(unit, ability.kind));
          settleGoddessDance(targets);
          // Each refresh is a deed and earns Dance XP, as Dance's does (queued, not drawn).
          const xp = [];
          for (const ally of targets) {
            observeHistoryAction(scene, 'danced for', unit, ally, skill.name);
            deedsFor(scene).onRefresh(unit);
            xp.push(scene.awardScaledXP(unit, XP_BASE_DANCE, { present: false }));
          }
          return { kind: ability.kind, refreshed: targets, xp };
        }
        const targets = settleEnsnare(unit, ability, scene._getTier5HostileUnitsFor(unit));
        for (const entry of targets)
          if (entry.rooted) observeHistoryAction(scene, 'rooted', unit, entry.unit, skill.name);
        if (targets.some((entry) => entry.rooted)) scene.dangerZoneStale = true;
        return { kind: ability.kind, targets };
      },
      present: async (facts) => {
        safeBattlePresentation('ability menu', () => scene.hideActionMenu(), { scene });
        scene.inEquipMenu = false;
        if (facts.kind === 'refresh_adjacent') {
          // Goddess Dance: every refreshed ally wakes (its dimming lifts) with Dance's sparkle.
          for (const ally of facts.refreshed) presentRefreshSparkle(scene, ally);
          return;
        }
        if (
          facts.kind === 'ally_buff' ||
          facts.kind === 'aoe_heal' ||
          facts.kind === 'sacrifice_heal'
        )
          safeBattlePresentation(
            'ability sound',
            () => scene.registry.get('audio')?.playSFX('sfx_heal'),
            { scene },
          );
        if (facts.kind === 'sacrifice_heal') {
          // The user's bar drops by what it paid; each mended ally rises like Healing Circle's.
          safeBattlePresentation(
            'great sacrifice cost',
            () => {
              scene.updateHPBar(facts.user);
              const pos = scene.grid.gridToPixel(facts.user.col, facts.user.row);
              scene.showMinorHintAt(pos.x, pos.y, `-${facts.paid}`, UI_PALETTE.bad);
            },
            { scene },
          );
        }
        if (facts.kind === 'ally_buff') {
          for (const ally of facts.affected)
            safeBattlePresentation(
              'rally buff',
              () => {
                const pos = scene.grid.gridToPixel(ally.col, ally.row);
                (scene._combatFx ||= new CombatFxController(scene)).playBuff(pos.x, pos.y);
              },
              { scene },
            );
          await scene._playPostCombatBeats(facts.beats);
          return;
        }
        for (const entry of facts.targets) {
          if (!isCurrentBattleSession(scene, session)) return;
          const target = entry.unit;
          if (facts.kind === 'aoe_heal' || facts.kind === 'sacrifice_heal') {
            if (entry.healed <= 0) continue;
            safeBattlePresentation(
              'healing circle target',
              () => {
                scene.updateHPBar(target);
                const pos = scene.grid.gridToPixel(target.col, target.row);
                (scene._combatFx ||= new CombatFxController(scene)).playHeal(pos.x, pos.y);
                scene.showMinorHintAt(pos.x, pos.y, `+${entry.healed}`, '#66ff88');
              },
              { scene },
            );
          } else {
            safeBattlePresentation(
              'ensnare target',
              () => {
                const pos = scene.grid.gridToPixel(target.col, target.row);
                if (entry.rooted) {
                  scene._addConditionIcon(target, 'root');
                  (scene._combatFx ||= new CombatFxController(scene)).playStatus(
                    pos.x,
                    pos.y,
                    'root',
                  );
                }
                scene.showMinorHintAt(
                  pos.x,
                  pos.y,
                  entry.rooted ? 'Rooted!' : 'Immune!',
                  entry.rooted ? UI_PALETTE.rarityEpic : UI_PALETTE.good,
                );
              },
              { scene },
            );
          }
        }
        if (facts.kind === 'aoe_root')
          safeBattlePresentation(
            'ensnare threat refresh',
            () => scene._pinnedThreats?.invalidate(),
            { scene },
          );
      },
    });
  }

  destroy() {
    this.scene = null;
  }
}
