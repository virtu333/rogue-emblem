import { TILE_SIZE } from '../utils/constants.js';
import { TOOLTIP_HOVER_DELAY_MS, TOOLTIP_LONG_PRESS_MS } from '../utils/tooltipTiming.js';
import {
  canUseWeaponArt,
  getEffectiveWeaponArtHpCost,
  isWeaponArtCompatibleWithWeapon,
  getWeaponArtCombatMods,
  getWeaponArtTier2Effects,
  getWeaponArtMissEffects,
  getWeaponArtKillEffects,
} from '../engine/WeaponArtSystem.js';
import { resolveWeaponArtIds } from './WeaponArtVisibility.js';
import { equipWeapon } from '../engine/UnitManager.js';
import { isStaff } from '../engine/Combat.js';

const HIDDEN_WEAPON_ART_REASONS = new Set([
  'legendary_weapon_required',
  'owner_scope_mismatch',
  'faction_mismatch',
  'wrong_weapon_type',
  'invalid_owner_scope_config',
  'invalid_faction_config',
  'invalid_legendary_weapon_ids_config',
  'invalid_unlock_act_config',
  'invalid_input',
]);

export class WeaponArtController {
  constructor(scene) {
    this.scene = scene;
  }

  showWeaponArtPicker(unit) {
    const scene = this.scene;
    scene.hideActionMenu();
    scene.inEquipMenu = true;
    scene.battleState = 'UNIT_ACTION_MENU';

    const choices = this._getWeaponArtChoices(unit, unit.weapon, { isInitiating: true });
    if (choices.length <= 0) {
      this._setSelectedWeaponArt(unit, null);
      scene.showActionMenu(unit);
      return;
    }

    const pos = scene.grid.gridToPixel(unit.col, unit.row);
    const menuX = unit.col < scene.grid.cols - 3 ? pos.x + TILE_SIZE : pos.x - TILE_SIZE - 280;
    const menuY = pos.y - 10;

    scene.actionMenu = [];
    const menuWidth = 280;
    const itemHeight = scene.isMobileInput ? 46 : 42;
    const menuHeight = (choices.length + 1) * itemHeight + 12;
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

    const current =
      scene._selectedWeaponArt?.unitName === unit.name ? scene._selectedWeaponArt : null;

    const noneY = menuPos.y + 6 + itemHeight / 2;
    const noneColor = current ? '#e0e0e0' : '#ffdd44';
    const noneText = scene._makeMenuTextButton(
      menuPos.x + 8,
      noneY,
      `${current ? '  ' : '> '}Normal Attack`,
      {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: noneColor,
      },
      noneColor,
      () => {
        const audio = scene.registry.get('audio');
        if (audio) audio.playSFX('sfx_confirm');
        this._setSelectedWeaponArt(unit, null);
        scene.inEquipMenu = false;
        scene._beginAttackSelection(unit);
      },
      { originX: 0, originY: 0.5, hitWidth: menuWidth - 12, hitHeight: itemHeight },
    );
    scene.actionMenu.push(noneText);

    choices.forEach(({ weapon, art, canUse, reason }, i) => {
      const rowY = menuPos.y + 6 + (i + 1) * itemHeight + itemHeight / 2;
      const weaponIndex = Array.isArray(unit.inventory) ? unit.inventory.indexOf(weapon) : -1;
      const isActive = Boolean(
        current &&
        current.artId === art.id &&
        Number.isInteger(current.weaponIndex) &&
        current.weaponIndex === weaponIndex,
      );
      const marker = isActive ? '> ' : '  ';
      const status = this._getWeaponArtStatusLine(unit, art, { canUse, reason });
      const color = canUse ? (isActive ? '#ffdd44' : '#e0e0e0') : '#888888';
      const weaponName = weapon?.name || weapon?.id || art.weaponType;
      const label = `${marker}${art.name} (${weaponName})
   ${status}`;

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
          const latest = canUseWeaponArt(unit, weapon, art, {
            turnNumber: scene.turnManager?.turnNumber,
            isInitiating: true,
            weaponArtHpCostDelta:
              scene.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0,
          });
          if (!latest.ok) {
            this.showWeaponArtPicker(unit);
            return;
          }
          const audio = scene.registry.get('audio');
          if (audio) audio.playSFX('sfx_confirm');
          if (unit.weapon !== weapon) equipWeapon(unit, weapon);
          this._setSelectedWeaponArt(unit, art.id, weapon);
          scene.inEquipMenu = false;
          scene._beginAttackSelection(unit);
        },
        {
          originX: 0,
          originY: 0.5,
          hitWidth: menuWidth - 12,
          hitHeight: itemHeight,
          clickOnPointerUp: true,
        },
      );
      this._wireWeaponArtTooltip(text, art);

      scene.actionMenu.push(text);
    });
    scene._pinToScreen(scene.actionMenu);
  }

  _showWeaponArtTooltip(anchorText, art) {
    const scene = this.scene;
    if (!anchorText || !art) return;
    scene._hideMenuTooltip();
    const summary = art?.description || 'No description';
    const lines = [art.name, summary];
    const body = lines.join('\n');
    const padding = 8;
    const maxWidth = 220;
    const txt = scene.add
      .text(0, 0, body, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#e0e0e0',
        wordWrap: { width: maxWidth - padding * 2 },
      })
      .setDepth(450);
    const bg = scene.add
      .rectangle(0, 0, txt.width + padding * 2, txt.height + padding * 2, 0x222222, 0.95)
      .setOrigin(0)
      .setStrokeStyle(1, 0x666666)
      .setDepth(449);
    const box = scene.add.container(0, 0, [bg, txt]).setDepth(449);
    txt.setPosition(padding, padding);

    const b = anchorText.getBounds();
    let x = b.right + 8;
    let y = b.top - 4;
    if (x + bg.width > scene.cameras.main.width - 4) x = b.left - bg.width - 8;
    if (x < 4) x = 4;
    if (y + bg.height > scene.cameras.main.height - 4)
      y = scene.cameras.main.height - bg.height - 4;
    if (y < 4) y = 4;
    box.setPosition(x, y);
    scene._pinToScreen(box);
    scene._menuTooltip = box;
  }

  _wireWeaponArtTooltip(text, art) {
    const scene = this.scene;
    if (!text || !art) return;
    text.on('pointerover', () => {
      scene._clearMenuTooltipTimer('_menuTooltipHoverTimer');
      scene._menuTooltipHoverTimer = scene.time.delayedCall(TOOLTIP_HOVER_DELAY_MS, () => {
        scene._menuTooltipHoverTimer = null;
        this._showWeaponArtTooltip(text, art);
      });
    });
    text.on('pointerout', () => scene._hideMenuTooltip());
    text.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      scene._clearMenuTooltipTimer('_menuTooltipPressTimer');
      scene._menuTooltipPressTimer = scene.time.delayedCall(TOOLTIP_LONG_PRESS_MS, () => {
        scene._menuTooltipPressTimer = null;
        text._suppressNextClick = true;
        this._showWeaponArtTooltip(text, art);
      });
    });
    text.on('pointerup', () => scene._clearMenuTooltipTimer('_menuTooltipPressTimer'));
  }

  _resolveWeaponArtCostValues(unit, art) {
    const scene = this.scene;
    const baseCost = Math.max(0, Number(art?.hpCost) || 0);
    const artOpts = {
      weaponArtHpCostDelta: scene.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0,
    };
    const effectiveCost = getEffectiveWeaponArtHpCost(unit, art, artOpts);
    return { baseCost, effectiveCost };
  }

  _formatWeaponArtCostLabel(unit, art) {
    const { baseCost, effectiveCost } = this._resolveWeaponArtCostValues(unit, art);
    if (baseCost > 0 && effectiveCost !== baseCost) return `${effectiveCost} (base ${baseCost})`;
    return `${effectiveCost}`;
  }

  _getWeaponArtCatalog() {
    const scene = this.scene;
    return scene.gameData?.weaponArts?.arts || [];
  }

  _collectWeaponBoundArts(weapon) {
    if (!weapon) return [];
    const allArts = this._getWeaponArtCatalog();
    if (allArts.length <= 0) return [];
    const byId = new Map(allArts.filter((art) => art?.id).map((art) => [art.id, art]));
    return resolveWeaponArtIds(weapon, allArts)
      .map((id) => byId.get(id))
      .filter(Boolean);
  }

  _getAvailableWeaponArtEntriesForUnit(unit) {
    if (!unit) return [];
    const inventory =
      Array.isArray(unit.inventory) && unit.inventory.length > 0
        ? unit.inventory
        : unit.weapon
          ? [unit.weapon]
          : [];
    const entries = [];
    for (const weapon of inventory) {
      if (!weapon || !weapon.type || isStaff(weapon)) continue;
      for (const art of this._collectWeaponBoundArts(weapon)) {
        if (!art || !isWeaponArtCompatibleWithWeapon(art, weapon)) continue;
        entries.push({ weapon, art });
      }
    }
    return entries;
  }

  _getAvailableWeaponArtCatalogForUnit(unit) {
    return this._getAvailableWeaponArtEntriesForUnit(unit).map((entry) => entry.art);
  }

  _getWeaponArtHpAfterCost(unit, art) {
    const scene = this.scene;
    if (!unit || !art) return unit?.currentHP;
    const hp = Number(unit.currentHP) || 0;
    const artOpts = {
      weaponArtHpCostDelta: scene.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0,
    };
    const cost = getEffectiveWeaponArtHpCost(unit, art, artOpts);
    return Math.max(1, hp - cost);
  }

  _setSelectedWeaponArt(unit, artId = null, weapon = null) {
    const scene = this.scene;
    if (!unit || !artId) {
      scene._selectedWeaponArt = null;
      return;
    }
    const inventory = Array.isArray(unit.inventory) ? unit.inventory : [];
    const activeWeapon = weapon || unit.weapon || null;
    const weaponIndex = activeWeapon ? inventory.indexOf(activeWeapon) : -1;
    scene._selectedWeaponArt = {
      unitName: unit.name,
      artId,
      weaponIndex,
    };
  }

  _clearSelectedWeaponArt() {
    const scene = this.scene;
    scene._selectedWeaponArt = null;
  }

  _resolveSelectedWeaponArtEntry(unit) {
    const scene = this.scene;
    const selected = scene._selectedWeaponArt;
    if (!unit || !selected || selected.unitName !== unit.name) return null;
    const entries = this._getAvailableWeaponArtEntriesForUnit(unit);
    if (entries.length <= 0) return null;

    if (
      Number.isInteger(selected.weaponIndex) &&
      selected.weaponIndex >= 0 &&
      Array.isArray(unit.inventory) &&
      selected.weaponIndex < unit.inventory.length
    ) {
      const selectedWeapon = unit.inventory[selected.weaponIndex];
      const strict = entries.find(
        (entry) => entry.art.id === selected.artId && entry.weapon === selectedWeapon,
      );
      if (strict) return strict;
    }

    return entries.find((entry) => entry.art.id === selected.artId) || null;
  }

  _getSelectedWeaponArtForUnit(unit, context = {}) {
    const scene = this.scene;
    const selectedEntry = this._resolveSelectedWeaponArtEntry(unit);
    if (!selectedEntry) return null;

    const { weapon, art } = selectedEntry;
    const valid = canUseWeaponArt(unit, weapon, art, {
      turnNumber: scene.turnManager?.turnNumber,
      isInitiating: true,
      weaponArtHpCostDelta: scene.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0,
      ...context,
    });
    if (!valid.ok) return null;

    if (unit.weapon !== weapon) {
      equipWeapon(unit, weapon);
    }
    return art;
  }

  _clearSelectedWeaponArtIfInvalid(unit, context = {}) {
    const scene = this.scene;
    if (!scene._selectedWeaponArt || !unit || scene._selectedWeaponArt.unitName !== unit.name)
      return;
    const selectedEntry = this._resolveSelectedWeaponArtEntry(unit);
    if (!selectedEntry) {
      this._clearSelectedWeaponArt();
      return;
    }
    const valid = canUseWeaponArt(unit, selectedEntry.weapon, selectedEntry.art, {
      turnNumber: scene.turnManager?.turnNumber,
      isInitiating: true,
      weaponArtHpCostDelta: scene.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0,
      ...context,
    });
    if (!valid.ok) this._clearSelectedWeaponArt();
  }

  _getWeaponArtChoices(unit, weapon = null, context = {}, options = {}) {
    const scene = this.scene;
    if (!unit) return [];
    const restrictToWeapon = Boolean(options?.restrictToWeapon && weapon);
    const entries = this._getAvailableWeaponArtEntriesForUnit(unit).filter(
      (entry) => !restrictToWeapon || entry.weapon === weapon,
    );

    return entries
      .map(({ weapon: sourceWeapon, art }) => {
        const check = canUseWeaponArt(unit, sourceWeapon, art, {
          turnNumber: scene.turnManager?.turnNumber,
          isInitiating: true,
          actorFaction: unit.faction,
          weaponArtHpCostDelta:
            scene.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0,
          ...context,
        });
        return { weapon: sourceWeapon, art, canUse: check.ok, reason: check.reason };
      })
      .filter((entry) => !(entry.canUse === false && HIDDEN_WEAPON_ART_REASONS.has(entry.reason)));
  }

  _hasUsableWeaponArtTargets(unit, weapon = null, context = {}) {
    const scene = this.scene;
    const usableChoices = this._getWeaponArtChoices(unit, weapon, context).filter(
      (entry) => entry.canUse,
    );
    return usableChoices.some(({ weapon: sourceWeapon, art }) => {
      const targets = scene.findAttackTargets(unit, { weapon: sourceWeapon, weaponArt: art });
      return targets.length > 0;
    });
  }

  _scoreEnemyWeaponArt(unit, art) {
    const scene = this.scene;
    const mods = getWeaponArtCombatMods(art);
    const artOpts = {
      weaponArtHpCostDelta: scene.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0,
    };
    const hpCost = getEffectiveWeaponArtHpCost(unit, art, artOpts);
    const effectivenessScore =
      mods.effectiveness?.multiplier > 1 ? (mods.effectiveness.multiplier - 1) * 4 : 0;
    const rangeOverrideScore = mods.rangeOverride
      ? (Math.max(mods.rangeOverride.min, mods.rangeOverride.max) - 1) * 1.5
      : 0;
    const statusCount = getWeaponArtTier2Effects(art).inflictStatus.length;
    const { selfDamageOnMiss } = getWeaponArtMissEffects(art);
    const { killBuff } = getWeaponArtKillEffects(art);
    return (
      mods.atkBonus * 3 +
      mods.hitBonus * 0.35 +
      mods.critBonus * 0.25 +
      mods.spdBonus * 0.5 +
      mods.avoidBonus * 0.15 +
      mods.defBonus * 0.1 +
      effectivenessScore +
      (mods.rangeBonus || 0) * 1.2 +
      rangeOverrideScore +
      (mods.preventCounter ? 3.5 : 0) +
      (mods.targetsRES ? 2.5 : 0) +
      (mods.halfPhysicalDamage ? 2.5 : 0) +
      (mods.vengeance ? 4 : 0) +
      statusCount * 3 +
      (mods.damageMultiplier > 1 ? (mods.damageMultiplier - 1) * 6 : 0) +
      (mods.ignoreWeaponTriangle ? 1.5 : 0) +
      (mods.ignoreRES ? 3 : 0) +
      (killBuff ? 1 : 0) -
      (selfDamageOnMiss ? selfDamageOnMiss * 0.3 : 0) -
      hpCost * 0.75
    );
  }

  _getEnemyWeaponArtDifficultyId() {
    const scene = this.scene;
    return scene.battleParams?.difficultyId || scene.runManager?.difficultyId || null;
  }

  _getEnemyWeaponArtTuning() {
    const rawDifficulty = this._getEnemyWeaponArtDifficultyId();
    if (!rawDifficulty) return { minScore: 0.75, useChance: 1.0 };
    const difficultyId = String(rawDifficulty).toLowerCase();
    if (difficultyId === 'normal') return { minScore: 2.25, useChance: 0.6 };
    if (difficultyId === 'lunatic') return { minScore: 0.25, useChance: 1.0 };
    return { minScore: 0.75, useChance: 0.9 };
  }

  _selectEnemyWeaponArt(unit, target) {
    const scene = this.scene;
    if (!unit?.weapon) return null;
    const tuning = this._getEnemyWeaponArtTuning();
    const choices = this._getWeaponArtChoices(unit, unit.weapon, {
      isAI: true,
      isInitiating: true,
      actorFaction: unit.faction,
      targetFaction: target?.faction,
    }).filter((entry) => entry.canUse);
    if (choices.length <= 0) return null;
    const scored = choices
      .map((choice) => ({ art: choice.art, score: this._scoreEnemyWeaponArt(unit, choice.art) }))
      .filter((entry) => entry.score >= tuning.minScore);
    if (scored.length <= 0) return null;
    if (tuning.useChance < 1 && this._rollEnemyWeaponArtChance() > tuning.useChance) return null;
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const sortArtOpts = {
        weaponArtHpCostDelta: scene.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0,
      };
      const aCost = getEffectiveWeaponArtHpCost(unit, a.art, sortArtOpts);
      const bCost = getEffectiveWeaponArtHpCost(unit, b.art, sortArtOpts);
      if (aCost !== bCost) return aCost - bCost;
      const aId = String(a.art?.id || '');
      const bId = String(b.art?.id || '');
      return aId.localeCompare(bId);
    });
    return scored[0].art;
  }

  _rollEnemyWeaponArtChance() {
    const scene = this.scene;
    const roll =
      typeof scene._enemyWeaponArtRandom === 'function'
        ? Number(scene._enemyWeaponArtRandom())
        : Math.random();
    if (!Number.isFinite(roll)) return 1;
    return Math.min(1, Math.max(0, roll));
  }

  _weaponArtReasonLabel(reason) {
    switch (reason) {
      case 'insufficient_rank':
        return 'Rank too low';
      case 'insufficient_hp':
        return 'Not enough HP';
      case 'per_turn_limit':
        return 'Turn limit reached';
      case 'per_map_limit':
        return 'Map limit reached';
      case 'wrong_weapon_type':
        return 'Wrong weapon type';
      case 'no_proficiency':
        return 'No proficiency';
      case 'initiation_only':
        return 'Player phase only';
      case 'owner_scope_mismatch':
        return 'Unavailable';
      case 'faction_mismatch':
        return 'Unavailable';
      case 'legendary_weapon_required':
        return 'Legendary weapon required';
      case 'ai_disabled':
        return 'Unavailable';
      case 'ai_hp_floor':
        return 'Unavailable';
      case 'invalid_owner_scope_config':
        return 'Unavailable';
      case 'invalid_faction_config':
        return 'Unavailable';
      case 'invalid_legendary_weapon_ids_config':
        return 'Unavailable';
      case 'invalid_unlock_act_config':
        return 'Unavailable';
      case 'invalid_input':
        return 'Unavailable';
      default:
        return 'Unavailable';
    }
  }

  _getWeaponArtUsageCounts(unit, art) {
    const scene = this.scene;
    const usage = unit?._battleWeaponArtUsage || {};
    const mapCount = usage.map?.[art.id] || 0;
    const currentTurnKey = String(scene.turnManager?.turnNumber ?? '');
    const turnCount = usage.turnKey === currentTurnKey ? usage.turn?.[art.id] || 0 : 0;
    return { mapCount, turnCount };
  }

  _getWeaponArtStatusLine(unit, art, availability = null) {
    const scene = this.scene;
    const check =
      availability ||
      canUseWeaponArt(unit, unit?.weapon, art, {
        turnNumber: scene.turnManager?.turnNumber,
        isInitiating: true,
        weaponArtHpCostDelta: scene.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0,
      });
    if (check?.ok === false || check?.canUse === false)
      return this._weaponArtReasonLabel(check.reason);
    const hpCostLabel = this._formatWeaponArtCostLabel(unit, art);
    const hpNow = Math.max(0, Number(unit?.currentHP) || 0);
    const hpAfter = this._getWeaponArtHpAfterCost(unit, art);
    const { mapCount, turnCount } = this._getWeaponArtUsageCounts(unit, art);
    const mapLimit = Number(art?.perMapLimit) > 0 ? `${mapCount}/${art.perMapLimit}` : '-';
    const turnLimit = Number(art?.perTurnLimit) > 0 ? `${turnCount}/${art.perTurnLimit}` : '-';
    return `HP-${hpCostLabel} (${hpNow}->${hpAfter})  Turn ${turnLimit}  Map ${mapLimit}`;
  }

  destroy() {
    this.scene = null;
  }
}
