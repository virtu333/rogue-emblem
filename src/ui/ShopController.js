import { weaponArtScrollText } from './weaponArtDisplay.js';
// Shop lifecycle and stock management. ShopMenu owns rendering and input.
import { ShopMenu } from './ShopMenu.js';
import { saveServiceRun } from './serviceSave.js';
import {
  SHOP_REROLL_COST,
  SHOP_REROLL_ESCALATION,
  RUINS_SHOP_ITEM_COUNT,
  RUINS_SHOP_ITEM_COUNT_FINAL,
  RUINS_SHOP_MARKUP,
  AMBUSH_SHOP_DISCOUNT,
  CARAVAN_SHOP_ITEM_COUNT_RANGE,
} from '../utils/constants.js';
import { generateShopInventory } from '../engine/LootSystem.js';
import { isImbueStone, getImbueStoneDetailText } from '../engine/ImbueSystem.js';
import { MUSIC, getMusicKey, pickTrack } from '../utils/musicConfig.js';
import { showImportantHint, showMinorHint } from './HintDisplay.js';
import { formatAccessoryDetail } from '../utils/accessoryText.js';
import { formatUses, getConsumableDescription } from '../utils/consumableText.js';
import { getWeaponArtTooltipLines } from './WeaponArtVisibility.js';
import { UI_PALETTE } from '../utils/uiStyles.js';
function getWeaponArtCatalogForScene(scene) {
  return scene?._getWeaponArtCatalog?.() || scene?.gameData?.weaponArts?.arts || [];
}
export class ShopController {
  constructor(scene) {
    this.scene = scene;
  }
  handleShop(node, options = {}) {
    const scene = this.scene;
    const ruins = options?.ruins === true;
    // Caravan reward shop: not tied to a node (the player picks it up on
    // whichever node they're standing on when it opens), no reroll/forge/
    // markup/skip-first-shop/ambush-discount interplay.
    const caravan = options?.caravan === true && !node;
    const pendingAmbush = !caravan && scene._isPendingAmbushNode?.(node) === true;
    const ambushDiscount =
      !caravan &&
      (options?.ambushDiscount === true ||
        pendingAmbush ||
        (node?.isAmbush === true && node?.ambushCleared === true));
    if (!ruins && !caravan && scene.runManager.consumeSkipFirstShop()) {
      showMinorHint(scene, 'Blessing effect: first shop skipped.');
      scene.runManager.markNodeComplete(node.id);
      if (pendingAmbush) scene._clearPendingAmbushForNode?.(node);
      this._persistVisit();
      scene.checkActComplete();
      return;
    }

    const audio = scene.registry.get('audio');
    if (audio) audio.playMusic(pickTrack(MUSIC.shop), scene, 300);

    const rm = scene.runManager;
    const cachedShop = caravan ? rm.activeCaravanShop?.shopState : rm.getShopState?.(node.id);
    const shopActId = caravan ? options?.caravanActId || rm.currentAct : rm.currentAct;
    let shopItems;
    if (cachedShop) {
      shopItems = cachedShop.items;
    } else {
      const shopItemDelta = caravan ? 0 : rm.getShopItemCountDelta();
      shopItems = generateShopInventory(
        shopActId,
        scene.gameData.lootTables,
        scene.gameData.weapons,
        scene.gameData.consumables,
        scene.gameData.accessories,
        rm.roster,
        rm.getWeaponArtSpawnConfig(),
        {
          itemCountBonus: shopItemDelta,
          recentItemNames: caravan
            ? []
            : Object.values(rm.shopStateByNodeId || {}).flatMap((state) =>
                (state.items || []).map((entry) => entry.item?.name).filter(Boolean),
              ),
          shopCureGating: rm.difficultyModifiers?.shopCureGating,
          ...(ruins ? { itemCountRange: this._getRuinsItemCountRange(rm.currentAct) } : {}),
          ...(caravan ? { itemCountRange: CARAVAN_SHOP_ITEM_COUNT_RANGE, rareBias: true } : {}),
        },
      );
      shopItems = scene.applyDifficultyShopPricing(shopItems);
      if (ruins) {
        shopItems = scene.applyRuinsMarkup(shopItems);
      }
      if (ambushDiscount) {
        shopItems = scene.applyAmbushDiscount(shopItems);
      }
    }
    scene.showShopOverlay(node, shopItems, {
      ambushDiscount: cachedShop?.ambushDiscountActive ?? ambushDiscount,
      pendingAmbush: !cachedShop && pendingAmbush,
      ruins,
      caravan,
      cachedShop,
    });
    if (caravan) {
      rm.activeCaravanShop = { actId: shopActId, shopState: null };
      rm.pendingCaravanShop = null;
    }
    this._saveShopState();
    this._persistVisit();
  }

  _persistVisit() {
    const warning = saveServiceRun(this.scene);
    if (warning) showMinorHint(this.scene, warning.trim());
  }

  applyDifficultyShopPricing(items) {
    const scene = this.scene;
    const diffMult = scene.runManager?.getDifficultyModifier?.('shopPriceMultiplier', 1) || 1;
    const blessingDiscount = scene.runManager?.getShopPriceDiscount?.() || 0;
    const multiplier = Math.max(0.1, diffMult * (1 - blessingDiscount));
    if (!Array.isArray(items)) return [];
    return items.map((entry) => ({
      ...entry,
      price: Math.max(1, Math.floor((entry.price || 0) * multiplier)),
    }));
  }

  applyAmbushDiscount(items) {
    if (!Array.isArray(items)) return [];
    return items.map((entry) => ({
      ...entry,
      price: Math.max(1, Math.floor((entry?.price || 0) * AMBUSH_SHOP_DISCOUNT)),
    }));
  }

  applyRuinsMarkup(items) {
    if (!Array.isArray(items)) return [];
    return items.map((entry) => ({
      ...entry,
      price: Math.max(1, Math.floor((entry?.price || 0) * RUINS_SHOP_MARKUP)),
    }));
  }

  _getRuinsItemCountRange(actId) {
    return actId === 'finalBoss' ? RUINS_SHOP_ITEM_COUNT_FINAL : RUINS_SHOP_ITEM_COUNT;
  }

  _getShopTabs() {
    const tabs = [
      { key: 'buy', label: 'Buy' },
      { key: 'sell', label: 'Sell' },
    ];
    if (!this.scene._currentShopIsRuins && !this.scene._currentShopIsCaravan) {
      tabs.push({ key: 'forge', label: 'Forge' });
    }
    return tabs;
  }

  showShopOverlay(node, shopItems, options = {}) {
    const scene = this.scene;
    scene.shopOverlay = [];
    scene.shopContentGroup = [];
    scene.activeShopTab = 'buy';
    const cachedShop = options?.cachedShop;
    scene.shopForgesUsed = cachedShop?.forgesUsed || 0;
    scene._currentShopIsRuins = options?.ruins === true;
    scene._currentShopIsCaravan = options?.caravan === true;
    scene.shopScrollOffsets =
      scene._currentShopIsRuins || scene._currentShopIsCaravan
        ? { buy: 0, sell: 0 }
        : { buy: 0, sell: 0, forge: 0 };
    scene.shopScrollMax = 0;
    scene._shopViewingMap = false;
    scene._currentShopHasAmbushDiscount =
      options?.ambushDiscount === true || options?.pendingAmbush === true;

    scene.shopBuyItems = shopItems.map((entry, i) => ({ ...entry, index: i }));
    scene._shopOriginalSlotCount = cachedShop?.originalSlotCount || scene.shopBuyItems.length;
    scene._shopNode = node;
    scene.shopRerollCount = cachedShop?.rerollCount || 0;

    this.nativeMenu?.destroy();
    this.nativeMenu = new ShopMenu(this);
    const lines = scene.gameData?.dialogue?.shopFlavor?.[scene.runManager.currentAct];
    if (Array.isArray(lines) && lines.length) {
      this.nativeMenu.render(lines[Math.floor(Math.random() * lines.length)]);
    }
  }

  leaveShopNode() {
    const scene = this.scene;
    if (!scene.shopOverlay) return;
    const node = scene._shopNode;
    const isRuins = scene._currentShopIsRuins === true;
    const isCaravan = scene._currentShopIsCaravan === true;
    const audio = scene.registry.get('audio');
    if (audio) audio.playMusic(getMusicKey('nodeMap', scene.runManager.currentAct), scene, 300);
    if (node) this._saveShopState();
    scene.closeShopOverlay();
    if (isCaravan) {
      // Closing is the durable end of this one-time reward visit.
      scene.runManager?.clearPendingCaravanShop?.();
      this._persistVisit();
      return;
    }
    if (isRuins && node) {
      scene.handleRuins(node);
      return;
    }
    if (node) {
      scene._clearPendingAmbushForNode?.(node);
      scene.runManager.markNodeComplete(node.id);
      this._persistVisit();
      scene.checkActComplete();
    }
  }

  _getWeaponArtCatalog() {
    const scene = this.scene;
    return scene.gameData?.weaponArts?.arts || [];
  }

  _getShopItemDetailText(entry) {
    const scene = this.scene;
    const item = entry?.item || {};
    const entryType = entry?.type || item.type;

    if (entryType === 'accessory' || item.type === 'Accessory') {
      return formatAccessoryDetail(item, { fallback: 'Accessory' }) || 'Accessory';
    }

    if (entryType === 'consumable' || item.type === 'Consumable') {
      const description = getConsumableDescription(item);
      if (description) {
        const usesText = formatUses(item);
        return usesText ? `${description} (${usesText})` : description;
      }
      return item.special || 'Consumable';
    }

    if (item.teachesWeaponArtId)
      return weaponArtScrollText(item, scene.gameData?.weaponArts?.arts || []);

    if (entryType === 'scroll' || item.type === 'Scroll') {
      const header = item.special || 'Teaches a skill';
      const skillDef = scene.gameData?.skills?.find((s) => s.id === item.skillId);
      const desc = skillDef?.description || '';
      return desc ? `${header}\n${desc}` : header;
    }

    if (item.type === 'Whetstone') {
      if (isImbueStone(item)) {
        return getImbueStoneDetailText(item, scene.gameData?.imbues) || 'Imbue a weapon';
      }
      if (item.forgeStat === 'choice') return 'Forge: choose a stat boost';
      if (item.forgeStat === 'might') return 'Forge: +1 Mt';
      if (item.forgeStat === 'crit') return 'Forge: +5 Crit';
      if (item.forgeStat === 'hit') return 'Forge: +5 Hit';
      if (item.forgeStat === 'weight') return 'Forge: -1 Wt';
      return 'Forge item';
    }

    const mt = Number.isFinite(Number(item.might)) ? Number(item.might) : 0;
    const hit = Number.isFinite(Number(item.hit)) ? Number(item.hit) : 0;
    const crt = Number.isFinite(Number(item.crit)) ? Number(item.crit) : 0;
    const wt = Number.isFinite(Number(item.weight)) ? Number(item.weight) : 0;
    const rng = item.range ?? '1';
    const artCatalog = getWeaponArtCatalogForScene(scene);

    const lines = [];
    if (item.type) lines.push(item.type);
    lines.push(`Mt: ${mt}   Hit: ${hit}   Crt: ${crt}`);
    lines.push(`Wt: ${wt}   Rng: ${rng}`);
    if (item.special) lines.push(`Special: ${item.special}`);
    lines.push(...getWeaponArtTooltipLines(item, artCatalog));
    return lines.join('\n');
  }

  _saveShopState() {
    const scene = this.scene;
    const node = scene._shopNode;
    const state = {
      items: (scene.shopBuyItems || []).map(({ index, ...rest }) => rest),
      forgesUsed: scene.shopForgesUsed || 0,
      rerollCount: scene.shopRerollCount || 0,
      originalSlotCount: scene._shopOriginalSlotCount || 0,
      ambushDiscountActive: scene._currentShopHasAmbushDiscount || false,
    };
    if (scene._currentShopIsCaravan && scene.runManager.activeCaravanShop) {
      scene.runManager.activeCaravanShop.shopState = state;
    } else if (node) scene.runManager?.saveShopState?.(node.id, state);
  }

  refreshShop() {
    this.nativeMenu?.render();
    this._saveShopState();
  }

  rerollShop() {
    const scene = this.scene;
    const cost = SHOP_REROLL_COST + scene.shopRerollCount * SHOP_REROLL_ESCALATION;
    if (!scene.runManager.spendGold(cost)) return false;
    scene.shopRerollCount++;
    const targetCount = Math.max(
      0,
      Number(scene._shopOriginalSlotCount) || scene.shopBuyItems.length || 0,
    );
    const currentItems = Array.isArray(scene.shopBuyItems) ? scene.shopBuyItems.slice() : [];
    const hasPurchasedAny = currentItems.length < targetCount;
    const baseItems = hasPurchasedAny ? currentItems : [];
    const itemKey = (entry) =>
      `${entry?.type || entry?.item?.type || ''}|${entry?.item?.name || ''}`;
    const generatePricedItems = () => {
      const generated = generateShopInventory(
        scene.runManager.currentAct,
        scene.gameData.lootTables,
        scene.gameData.weapons,
        scene.gameData.consumables,
        scene.gameData.accessories,
        scene.runManager.roster,
        scene.runManager.getWeaponArtSpawnConfig(),
        {
          shopCureGating: scene.runManager.difficultyModifiers?.shopCureGating,
        },
      );
      let priced = scene.applyDifficultyShopPricing(generated);
      if (scene._currentShopIsRuins) {
        priced = scene.applyRuinsMarkup(priced);
      }
      if (scene._currentShopHasAmbushDiscount) {
        priced = scene.applyAmbushDiscount(priced);
      }
      return Array.isArray(priced) ? priced : [];
    };

    const fillToTarget = (items, preferUnique, fallbackSeedItems = []) => {
      const result = items.slice(0, targetCount);
      const deferred = [];
      const seen = new Set(result.map((entry) => itemKey(entry)).filter(Boolean));
      const uniquePasses = Math.max(4, targetCount * 4);
      for (let pass = 0; result.length < targetCount && pass < uniquePasses; pass++) {
        const batch = generatePricedItems();
        for (const entry of batch) {
          if (result.length >= targetCount) break;
          const key = itemKey(entry);
          if (preferUnique && key && seen.has(key)) {
            deferred.push(entry);
            continue;
          }
          result.push(entry);
          if (key) seen.add(key);
        }
      }
      while (result.length < targetCount && deferred.length > 0) {
        result.push(deferred.shift());
      }
      const fallbackPasses = Math.max(4, targetCount * 4);
      for (let pass = 0; result.length < targetCount && pass < fallbackPasses; pass++) {
        const batch = generatePricedItems();
        for (const entry of batch) {
          if (result.length >= targetCount) break;
          result.push(entry);
        }
      }
      if (result.length < targetCount) {
        const seedSource = result.length > 0 ? result : fallbackSeedItems;
        if (seedSource.length > 0) {
          const seed = seedSource[0];
          while (result.length < targetCount) {
            result.push({ ...seed, item: seed?.item ? { ...seed.item } : seed.item });
          }
        }
      }
      return result.slice(0, targetCount);
    };

    const nextItems = fillToTarget(baseItems, hasPurchasedAny, currentItems);
    scene.shopBuyItems = nextItems.map((entry, i) => ({ ...entry, index: i }));
    const audio = scene.registry.get('audio');
    if (audio) audio.playSFX('sfx_gold');
    scene.refreshShop();
    scene.showShopBanner('Shop restocked!', UI_PALETTE.info);
    return true;
  }

  showShopBanner(msg) {
    if (this.nativeMenu) return this.nativeMenu.render(msg);
    return showMinorHint(this.scene, msg);
  }

  showWeaponArtsUnlockedBanner(artIds = []) {
    const scene = this.scene;
    if (!Array.isArray(artIds) || artIds.length <= 0) return;
    const catalog = scene.gameData?.weaponArts?.arts || [];
    const names = artIds
      .map((id) => catalog.find((art) => art?.id === id)?.name || id)
      .filter(Boolean);
    if (names.length <= 0) return;
    const suffix = names.length > 1 ? 's' : '';
    const label =
      names.length > 2
        ? `${names.slice(0, 2).join(', ')} +${names.length - 2} more`
        : names.join(', ');
    scene.showShopBanner(`Weapon Art${suffix} unlocked: ${label}`, UI_PALETTE.info);
  }

  async _showSkillDisplacementWarning(displacedSkills) {
    const scene = this.scene;
    if (!displacedSkills || Object.keys(displacedSkills).length === 0) return;
    const skillsData = scene.gameData?.skills || [];
    const getName = (id) => skillsData.find((s) => s.id === id)?.name || id;
    const lines = Object.entries(displacedSkills).map(
      ([unitName, { displaced, replacedBy }]) =>
        `${unitName}: ${getName(replacedBy)} replaced ${getName(displaced)}`,
    );
    const message = `Personal skills restored!\n${lines.join('\n')}`;
    await showImportantHint(scene, message);
  }

  closeShopOverlay() {
    this.nativeMenu?.destroy();
    this.nativeMenu = null;
    const scene = this.scene;
    scene._shopViewingRoster = false;
    scene._touchPreviewedShopEntry = null;
    if (scene.shopOverlay) {
      scene.shopOverlay.forEach((o) => o.destroy());
      scene.shopOverlay = null;
    }
    if (scene.shopContentGroup) {
      scene.shopContentGroup.forEach((o) => o.destroy());
      scene.shopContentGroup = null;
    }
    if (scene.shopTabObjects) {
      scene.shopTabObjects.forEach((o) => o.destroy());
      scene.shopTabObjects = null;
    }
    scene._shopViewingMap = false;
    scene._shopOriginalSlotCount = 0;
    scene._shopNode = null;
    scene._currentShopHasAmbushDiscount = false;
    scene._currentShopIsRuins = false;
    scene._currentShopIsCaravan = false;
  }
  destroy() {
    this.closeShopOverlay();
    this.scene = null;
  }
}
