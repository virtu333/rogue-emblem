// AbilityController — the "Ability" action-menu surface for utility abilities
// (action-trigger skills with structured `actionAbility` data: Blink, Rally
// Cry, Healing Circle, Ensnare). Owns the ability submenu (patterned on
// WeaponArtController.showWeaponArtPicker), the SELECTING_ABILITY_TILE flow
// for Blink, the confirm prompt for self-centered AOE abilities, and effect
// execution. State lives on the scene (abilityTiles/_pendingAbility) so the
// shared ESC/cancel recovery paths in BattleScene can clean it up.
import { TILE_SIZE } from '../utils/constants.js';
import {
  getActionAbilities,
  getAbilityUsageCount,
  canUseAbility,
  markUsed,
  getBlinkTiles,
  collectAffected,
  abilityHasTargets,
} from '../engine/ActionAbilitySystem.js';
import { applyCondition } from '../engine/StatusConditionSystem.js';
import { CombatFxController } from './CombatFxController.js';

const BLINK_TILE_COLOR = 0x66ccff;
const ALLY_AOE_COLOR = 0x44ff88;
const ENEMY_AOE_COLOR = 0xff8844;

export class AbilityController {
  constructor(scene) {
    this.scene = scene;
  }

  create() {
    // No persistent UI — menus are built on demand via scene.actionMenu.
  }

  // --- Availability ---

  _getAbilityEntries(unit) {
    const scene = this.scene;
    const skillsData = scene.gameData?.skills || [];
    return getActionAbilities(unit, skillsData).map((skill) => {
      const check = canUseAbility(unit, skill);
      const hasTargets = abilityHasTargets(unit, skill, {
        grid: scene.grid,
        getUnitAt: (col, row) => scene.getUnitAt(col, row),
        allies: scene.getDivineChargeAllies(unit),
        enemies: scene._getTier5HostileUnitsFor(unit),
      });
      return { skill, canUse: check.ok, reason: check.reason, hasTargets };
    });
  }

  /** True when the unit should see an "Ability" entry in the action menu. */
  hasUsableAbilities(unit) {
    if (!unit) return false;
    return this._getAbilityEntries(unit).some((entry) => entry.canUse && entry.hasTargets);
  }

  _getAbilityById(unit, skillId) {
    const skillsData = this.scene.gameData?.skills || [];
    return getActionAbilities(unit, skillsData).find((skill) => skill.id === skillId) || null;
  }

  _reasonLabel(entry) {
    if (entry.reason === 'per_map_limit') return 'Used this battle';
    if (entry.reason === 'silenced') return 'Silenced';
    if (!entry.hasTargets) return 'No valid targets';
    return 'Unavailable';
  }

  _statusLine(unit, entry) {
    if (!entry.canUse || !entry.hasTargets) return this._reasonLabel(entry);
    const ability = entry.skill.actionAbility;
    const limit = Math.max(0, Math.trunc(Number(ability.perMapLimit) || 0));
    const used = getAbilityUsageCount(unit, entry.skill.id);
    const mapLabel = limit > 0 ? `Map ${used}/${limit}` : 'Map -';
    return `${mapLabel}  No counter, ends turn`;
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

    const pos = scene.grid.gridToPixel(unit.col, unit.row);
    const menuWidth = 280;
    const menuX =
      unit.col < scene.grid.cols - 3 ? pos.x + TILE_SIZE : pos.x - TILE_SIZE - menuWidth;
    const menuY = pos.y - 10;

    scene.actionMenu = [];
    const itemHeight = scene.isMobileInput ? 46 : 42;
    const menuHeight = entries.length * itemHeight + 12;
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
      .setStrokeStyle(1, 0x666666);
    scene.actionMenu.push(bg);

    entries.forEach((entry, i) => {
      const rowY = menuPos.y + 6 + i * itemHeight + itemHeight / 2;
      const usable = entry.canUse && entry.hasTargets;
      const color = usable ? '#e0e0e0' : '#888888';
      const label = `${entry.skill.name}\n   ${this._statusLine(unit, entry)}`;
      const text = scene._makeMenuTextButton(
        menuPos.x + 8,
        rowY,
        label,
        {
          fontFamily: 'monospace',
          fontSize: '10px',
          color,
          lineSpacing: 1,
        },
        color,
        () => {
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
        { originX: 0, originY: 0.5, hitWidth: menuWidth - 12, hitHeight: itemHeight },
      );
      this._wireAbilityTooltip(text, entry.skill);
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
    this._showConfirmPrompt(unit, skill);
  }

  // --- Blink: tile targeting (SELECTING_ABILITY_TILE) ---

  startBlinkTileSelection(unit, skill) {
    const scene = this.scene;
    scene.hideActionMenu();
    scene.inEquipMenu = false;
    scene.battleState = 'SELECTING_ABILITY_TILE';
    const tiles = getBlinkTiles(unit, skill.actionAbility.range, scene.grid, (col, row) =>
      scene.getUnitAt(col, row),
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
    const audio = scene.registry.get('audio');
    if (audio) audio.playSFX('sfx_confirm');
    scene.grid.clearAttackHighlights();
    scene.abilityTiles = [];
    scene._pendingAbility = null;
    void this.executeBlink(unit, skill, tile);
  }

  /** Shared cleanup for ESC/right-click out of SELECTING_ABILITY_TILE. */
  cancelTileSelection() {
    const scene = this.scene;
    scene.grid.clearAttackHighlights();
    scene.abilityTiles = [];
    scene._pendingAbility = null;
  }

  async executeBlink(unit, skill, tile) {
    const scene = this.scene;
    scene.commitVisionSnapshotIfPending();
    scene.hideActionMenu();
    markUsed(unit, skill.id);
    try {
      const targets = [
        unit.graphic,
        unit.label,
        unit.factionIndicator,
        unit.hpBar?.bg,
        unit.hpBar?.fill,
      ].filter(Boolean);
      if (targets.length > 0) {
        await scene._awaitSceneTween(
          { targets, alpha: 0, duration: 180 },
          { label: 'ability_blink_fade_out' },
        );
      }
      unit.col = tile.col;
      unit.row = tile.row;
      scene.updateUnitPosition(unit);
      if (targets.length > 0) {
        await scene._awaitSceneTween(
          { targets, alpha: 1, duration: 180 },
          { label: 'ability_blink_fade_in' },
        );
      }
      // A teleport is movement: refresh fog/visibility + mark danger zone stale
      scene._refreshPostCombatMovementState([unit]);
      scene.finishUnitAction(unit);
    } catch (err) {
      scene._recoverUnitActionError(unit, 'ability_blink', err);
    }
  }

  // --- Self-centered AOE (Rally Cry / Healing Circle / Ensnare) ---

  _showConfirmPrompt(unit, skill) {
    const scene = this.scene;
    scene.hideActionMenu();
    scene.inEquipMenu = true;
    scene.battleState = 'UNIT_ACTION_MENU';

    const ability = skill.actionAbility;
    const hostile = ability.kind === 'aoe_root';
    const pool = hostile ? scene._getTier5HostileUnitsFor(unit) : scene.getDivineChargeAllies(unit);
    const affected = collectAffected(unit, ability, pool);
    const tiles = affected.map((target) => ({ col: target.col, row: target.row }));
    scene.grid.showAttackRange(tiles, hostile ? ENEMY_AOE_COLOR : ALLY_AOE_COLOR, 0.4);

    const pos = scene.grid.gridToPixel(unit.col, unit.row);
    const menuWidth = 240;
    const menuX =
      unit.col < scene.grid.cols - 3 ? pos.x + TILE_SIZE : pos.x - TILE_SIZE - menuWidth;
    const menuY = pos.y - 10;

    scene.actionMenu = [];
    // Sentinel: whenever this confirm menu is dismissed through ANY path
    // (confirm, ESC -> showActionMenu -> hideActionMenu, scene shutdown),
    // hideActionMenu destroys menu entries — clear the AOE preview with it.
    scene.actionMenu.push({ destroy: () => scene.grid?.clearAttackHighlights?.() });

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
      .setStrokeStyle(1, 0x666666);
    scene.actionMenu.push(bg);

    const targetNoun = hostile
      ? affected.length === 1
        ? 'enemy'
        : 'enemies'
      : affected.length === 1
        ? 'ally'
        : 'allies';
    const confirmLabel = `Use ${skill.name} (${affected.length} ${targetNoun})`;
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

    makeRow(0, confirmLabel, '#a6ffb0', () => {
      const latest = canUseAbility(unit, skill);
      if (!latest.ok) {
        this.showAbilityPicker(unit);
        return;
      }
      const audio = scene.registry.get('audio');
      if (audio) audio.playSFX('sfx_confirm');
      void this.executeSelfCentered(unit, skill);
    });
    makeRow(1, 'Cancel', '#e0e0e0', () => {
      const audio = scene.registry.get('audio');
      if (audio) audio.playSFX('sfx_cancel');
      this.showAbilityPicker(unit);
    });
    scene._pinToScreen(scene.actionMenu);
  }

  async executeSelfCentered(unit, skill) {
    const scene = this.scene;
    scene.commitVisionSnapshotIfPending();
    scene.hideActionMenu(); // sentinel clears the AOE preview highlights
    scene.inEquipMenu = false;
    markUsed(unit, skill.id);
    try {
      const kind = skill.actionAbility?.kind;
      if (kind === 'ally_buff') {
        await this._applyRally(unit, skill);
      } else if (kind === 'aoe_heal') {
        await this._applyHealingCircle(unit, skill);
      } else if (kind === 'aoe_root') {
        await this._applyEnsnare(unit, skill);
      }
      scene.finishUnitAction(unit);
    } catch (err) {
      scene._recoverUnitActionError(unit, 'ability', err);
    }
  }

  async _applyRally(unit, skill) {
    const scene = this.scene;
    const ability = skill.actionAbility;
    const audio = scene.registry.get('audio');
    if (audio) audio.playSFX('sfx_heal');
    const affected = collectAffected(unit, ability, scene.getDivineChargeAllies(unit));
    // Buff FX before the stat application hints (dance playBuff precedent)
    for (const ally of affected) {
      const pos = scene.grid.gridToPixel(ally.col, ally.row);
      (scene._combatFx ||= new CombatFxController(scene)).playBuff(pos.x, pos.y);
    }
    // Reuse the tier-5 timed-buff pipeline: entries land in
    // unit._battleTimedWeaponArtBuffs and expire via the shared phase sweep.
    await scene._applyTier5AllyBuffStep(
      {
        artId: `ability::${skill.id}`,
        range: ability.radius,
        stats: ability.stats,
        durationPhases: ability.durationPhases,
        includeSelf: ability.includeSelf === true,
      },
      unit,
    );
  }

  async _applyHealingCircle(unit, skill) {
    const scene = this.scene;
    const ability = skill.actionAbility;
    const amount = Math.max(0, Math.trunc(Number(ability.amount) || 0));
    const affected = collectAffected(unit, ability, scene.getDivineChargeAllies(unit));
    const audio = scene.registry.get('audio');
    if (audio) audio.playSFX('sfx_heal');
    for (const ally of affected) {
      const maxHp = Math.max(1, Math.trunc(Number(ally.stats?.HP) || 1));
      const oldHP = Number(ally.currentHP) || 0;
      ally.currentHP = Math.min(maxHp, oldHP + amount);
      const healed = ally.currentHP - oldHP;
      if (healed <= 0) continue;
      scene.updateHPBar(ally);
      const pos = scene.grid.gridToPixel(ally.col, ally.row);
      (scene._combatFx ||= new CombatFxController(scene)).playHeal(pos.x, pos.y);
      scene.showMinorHintAt(pos.x, pos.y, `+${healed}`, '#66ff88');
    }
  }

  async _applyEnsnare(unit, skill) {
    const scene = this.scene;
    const ability = skill.actionAbility;
    const duration = Math.max(1, Math.trunc(Number(ability.durationPhases) || 1));
    const affected = collectAffected(unit, ability, scene._getTier5HostileUnitsFor(unit));
    let anyRooted = false;
    for (const enemy of affected) {
      const pos = scene.grid.gridToPixel(enemy.col, enemy.row);
      // durationPhases = full phases the target stays rooted; recovery
      // decrements at the start of the afflicted side's phase before it
      // acts, hence the +1 (same convention as weapon-art tier2 statuses).
      const applied = applyCondition(enemy, 'root', duration + 1, { recoveryChance: 0 });
      if (!applied) {
        // statusImmunity accessory blocked it
        scene.showMinorHintAt(pos.x, pos.y, 'Immune!', '#88ffcc');
        continue;
      }
      anyRooted = true;
      scene._addConditionIcon(enemy, 'root');
      (scene._combatFx ||= new CombatFxController(scene)).playStatus(pos.x, pos.y);
      scene.showMinorHintAt(pos.x, pos.y, 'Rooted!', '#cc88ff');
    }
    // Rooted enemies can't move — their threat ranges shrink
    if (anyRooted) scene.dangerZoneStale = true;
  }

  destroy() {
    this.scene = null;
  }
}
