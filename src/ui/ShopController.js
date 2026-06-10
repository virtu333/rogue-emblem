// ShopController -- shop node overlay flow extracted from NodeMapScene.
// Owns the shop overlay UI (buy/sell/forge tabs, unit picker, forge picker,
// reroll, banners). All overlay state stays on the scene (shopOverlay,
// shopContentGroup, activeShopTab, shopScrollOffsets, ...) because the
// scene's input handlers and cancel logic read it; cross-cutting seams are
// invoked via the scene's delegating wrappers so tests and other systems can
// intercept them on the scene as before.

import Phaser from 'phaser';
import {
  INVENTORY_MAX,
  CONSUMABLE_MAX,
  SHOP_REROLL_COST,
  SHOP_REROLL_ESCALATION,
  SHOP_FORGE_LIMITS,
  FORGE_MAX_LEVEL,
  FORGE_STAT_CAP,
  AMBUSH_SHOP_DISCOUNT,
  SAFE_BOTTOM_Y,
} from '../utils/constants.js';
import { generateShopInventory, getSellPrice } from '../engine/LootSystem.js';
import {
  addToInventory,
  removeFromInventory,
  removeFromConsumables,
  isLastCombatWeapon,
  hasProficiency,
  isProficiencyRelevantItemType,
  addToConsumables,
} from '../engine/UnitManager.js';
import {
  canForge,
  applyForge,
  isForged,
  getForgeCost,
  getStatForgeCount,
} from '../engine/ForgeSystem.js';
import { MUSIC, getMusicKey, pickTrack } from '../utils/musicConfig.js';
import { showImportantHint, showMinorHint } from './HintDisplay.js';
import { formatAccessoryDetail } from '../utils/accessoryText.js';
import { formatUses, getConsumableDescription } from '../utils/consumableText.js';
import { hasWeaponArt, getWeaponArtTooltipLines } from './WeaponArtVisibility.js';
import { isTouchPointer } from '../utils/runtimeFlags.js';
import {
  OVERLAY_PANEL_W,
  OVERLAY_PANEL_H,
  OVERLAY_PANEL_DEPTH,
  OVERLAY_CONTENT_DEPTH,
  SHOP_LIST_TOP_Y,
  SHOP_LIST_BOTTOM_Y,
} from './nodeMapOverlayLayout.js';

function getWeaponArtCatalogForScene(scene) {
  if (scene && typeof scene._getWeaponArtCatalog === 'function') {
    return scene._getWeaponArtCatalog();
  }
  return scene?.gameData?.weaponArts?.arts || [];
}

function isProficiencyCheckRelevant(item) {
  return isProficiencyRelevantItemType(item?.type);
}

function truncateUnitNameForCapacityLabel(name, maxChars = 14) {
  const safeName = String(name || '');
  if (!Number.isInteger(maxChars) || maxChars < 4 || safeName.length <= maxChars) return safeName;
  return `${safeName.slice(0, maxChars - 3)}...`;
}

export class ShopController {
  constructor(scene) {
    this.scene = scene;
  }

  handleShop(node, options = {}) {
    const scene = this.scene;
    const pendingAmbush = scene._isPendingAmbushNode?.(node) === true;
    const ambushDiscount =
      options?.ambushDiscount === true ||
      pendingAmbush ||
      (node?.isAmbush === true && node?.ambushCleared === true);
    if (scene.runManager.consumeSkipFirstShop()) {
      showMinorHint(scene, 'Blessing effect: first shop skipped.');
      scene.runManager.markNodeComplete(node.id);
      if (pendingAmbush) scene._clearPendingAmbushForNode?.(node);
      scene.checkActComplete();
      return;
    }

    const audio = scene.registry.get('audio');
    if (audio) audio.playMusic(pickTrack(MUSIC.shop), scene, 300);

    const rm = scene.runManager;
    const cachedShop = rm.getShopState?.(node.id);
    let shopItems;
    if (cachedShop) {
      shopItems = cachedShop.items;
    } else {
      const shopItemDelta = rm.getShopItemCountDelta();
      shopItems = generateShopInventory(
        rm.currentAct,
        scene.gameData.lootTables,
        scene.gameData.weapons,
        scene.gameData.consumables,
        scene.gameData.accessories,
        rm.roster,
        rm.getWeaponArtSpawnConfig(),
        {
          itemCountBonus: shopItemDelta,
          shopCureGating: rm.difficultyModifiers?.shopCureGating,
        },
      );
      shopItems = scene.applyDifficultyShopPricing(shopItems);
      if (ambushDiscount) {
        shopItems = scene.applyAmbushDiscount(shopItems);
      }
    }
    scene.showShopOverlay(node, shopItems, {
      ambushDiscount: cachedShop?.ambushDiscountActive ?? ambushDiscount,
      pendingAmbush: !cachedShop && pendingAmbush,
      cachedShop,
    });
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

  showShopOverlay(node, shopItems, options = {}) {
    const scene = this.scene;
    scene.shopOverlay = [];
    scene.shopContentGroup = [];
    scene.activeShopTab = 'buy';
    const cachedShop = options?.cachedShop;
    scene.shopForgesUsed = cachedShop?.forgesUsed || 0;
    scene.shopScrollOffsets = { buy: 0, sell: 0, forge: 0 };
    scene.shopScrollMax = 0;
    scene._shopViewingMap = false;
    scene._currentShopHasAmbushDiscount =
      options?.ambushDiscount === true || options?.pendingAmbush === true;

    // Tutorial hint for shop
    const hints = scene.registry.get('hints');
    if (hints?.shouldShow('nodemap_shop')) {
      showMinorHint(scene, 'Buy, Sell, and Forge tabs available.');
    }

    // Dark overlay background
    const bg = scene.add.rectangle(320, 240, 640, 480, 0x000000, 0.9).setDepth(300);
    scene.shopOverlay.push(bg);

    // Centered panel container
    const panel = scene.add
      .rectangle(320, 240, OVERLAY_PANEL_W, OVERLAY_PANEL_H, 0x111111, 0.95)
      .setDepth(OVERLAY_PANEL_DEPTH)
      .setStrokeStyle(2, 0x444444)
      .setInteractive();
    scene.shopOverlay.push(panel);

    // Title
    const titleLabel = scene._currentShopHasAmbushDiscount
      ? 'Village (Liberated - 20% Off)'
      : 'Village';
    const title = scene.add
      .text(320, 30, titleLabel, {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: scene._currentShopHasAmbushDiscount ? '#88ff88' : '#ffdd44',
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH);
    scene.shopOverlay.push(title);

    // Gold display
    scene.shopGoldText = scene.add
      .text(320, 58, `Gold: ${scene.runManager.gold}G`, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffdd44',
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH);
    scene.shopOverlay.push(scene.shopGoldText);

    const viewMapBtn = scene.add
      .text(320, SAFE_BOTTOM_Y - 36, '[ View Map ]', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#aaddff',
        backgroundColor: '#223344',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH)
      .setInteractive({ useHandCursor: true });
    viewMapBtn.on('pointerover', () => viewMapBtn.setColor('#ffdd44'));
    viewMapBtn.on('pointerout', () => viewMapBtn.setColor('#aaddff'));
    viewMapBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      scene._enterShopMapView();
    });
    scene.shopOverlay.push(viewMapBtn);

    // Roster button
    const shopRosterBtn = scene.add
      .text(180, SAFE_BOTTOM_Y, '[ Roster ]', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#aaddff',
        backgroundColor: '#223344',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH)
      .setInteractive({ useHandCursor: true });
    shopRosterBtn.on('pointerover', () => shopRosterBtn.setColor('#ffdd44'));
    shopRosterBtn.on('pointerout', () => shopRosterBtn.setColor('#aaddff'));
    shopRosterBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      scene._touchScrollDrag = null;
      scene._hideForgeTooltip();
      scene._hideShopItemTooltip();
      scene._setShopOverlayVisibility(false);
      scene._shopViewingRoster = true;
      scene._openRoster();
      if (scene.rosterOverlay) {
        const baseOnClose = scene.rosterOverlay.onClose;
        scene.rosterOverlay.onClose = () => {
          if (baseOnClose) baseOnClose();
          scene._shopViewingRoster = false;
          scene._setShopOverlayVisibility(true);
          scene.drawActiveTabContent();
        };
      } else {
        // _openRoster() hit an early return — roll back
        scene._shopViewingRoster = false;
        scene._setShopOverlayVisibility(true);
      }
    });
    scene.shopOverlay.push(shopRosterBtn);

    scene.shopBuyItems = shopItems.map((entry, i) => ({ ...entry, index: i }));
    scene._shopOriginalSlotCount = cachedShop?.originalSlotCount || scene.shopBuyItems.length;
    scene._shopNode = node;
    scene.shopRerollCount = cachedShop?.rerollCount || 0;

    // Tab bar
    scene.drawShopTabs();

    // Draw active tab content
    scene.drawActiveTabContent();

    // Leave button
    const leaveBtn = scene.add
      .text(320, SAFE_BOTTOM_Y, '[ Leave Village ]', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#e0e0e0',
        backgroundColor: '#333333',
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH)
      .setInteractive({ useHandCursor: true });
    leaveBtn.on('pointerover', () => leaveBtn.setColor('#ffdd44'));
    leaveBtn.on('pointerout', () => leaveBtn.setColor('#e0e0e0'));
    leaveBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      scene.leaveShopNode();
    });
    scene.shopOverlay.push(leaveBtn);

    // Shop entry flavor
    try {
      const shopAct = scene.runManager?.currentAct || 'act1';
      const shopPool =
        scene.gameData?.dialogue?.shopFlavor?.[shopAct] ||
        scene.gameData?.dialogue?.shopFlavor?.['act3'];
      if (Array.isArray(shopPool) && shopPool.length > 0) {
        scene.showShopBanner(shopPool[Math.floor(Math.random() * shopPool.length)], '#aabbcc');
      }
    } catch (_) {
      /* best-effort flavor — don't block overlay */
    }
  }

  leaveShopNode() {
    const scene = this.scene;
    if (!scene.shopOverlay) return;
    const node = scene._shopNode;
    const audio = scene.registry.get('audio');
    if (audio) audio.playMusic(getMusicKey('nodeMap', scene.runManager.currentAct), scene, 300);
    scene.closeShopOverlay();
    if (node) {
      scene._clearPendingAmbushForNode?.(node);
      scene.runManager.markNodeComplete(node.id);
      scene.runManager?.clearShopState?.(node.id);
      scene.checkActComplete();
    }
  }

  drawShopTabs() {
    const scene = this.scene;
    // Destroy old tab objects
    if (scene.shopTabObjects) scene.shopTabObjects.forEach((o) => o.destroy());
    scene.shopTabObjects = [];

    const tabs = [
      { key: 'buy', label: 'Buy' },
      { key: 'sell', label: 'Sell' },
      { key: 'forge', label: 'Forge' },
    ];
    const tabY = 80;
    const tabW = 80;
    const startX = 320 - (tabs.length * tabW) / 2 + tabW / 2;

    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const tx = startX + i * tabW;
      const isActive = scene.activeShopTab === tab.key;
      const color = isActive ? '#ffdd44' : '#888888';
      const tabText = scene.add
        .text(tx, tabY, tab.label, {
          fontFamily: 'monospace',
          fontSize: '14px',
          color,
          backgroundColor: isActive ? '#333355' : '#222222',
          padding: { x: 12, y: 4 },
        })
        .setOrigin(0.5)
        .setDepth(OVERLAY_CONTENT_DEPTH)
        .setInteractive({ useHandCursor: true });

      tabText.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        if (scene.activeShopTab === tab.key) return;
        scene.activeShopTab = tab.key;
        scene.drawShopTabs();
        scene.drawActiveTabContent();
      });

      scene.shopTabObjects.push(tabText);
      scene.shopOverlay.push(tabText);
    }
  }

  drawActiveTabContent() {
    const scene = this.scene;
    // Clear previous tab content + reset touch preview latch
    scene._touchPreviewedShopEntry = null;
    scene._hideForgeTooltip();
    scene._hideShopItemTooltip();
    if (scene.shopContentGroup) scene.shopContentGroup.forEach((o) => o.destroy());
    scene.shopContentGroup = [];

    if (scene.activeShopTab === 'buy') {
      scene.drawShopBuyList();
      scene.drawRerollButton();
    } else if (scene.activeShopTab === 'sell') {
      scene.drawShopSellList();
    } else if (scene.activeShopTab === 'forge') {
      scene.drawShopForgeList();
    }

    scene.drawShopScrollHint();
  }

  _getWeaponArtCatalog() {
    const scene = this.scene;
    return scene.gameData?.weaponArts?.arts || [];
  }

  drawShopBuyList() {
    const scene = this.scene;
    const startY = 105;
    const lineH = 24;
    scene.shopScrollMax = Math.max(
      0,
      scene.shopBuyItems.length * lineH - (SHOP_LIST_BOTTOM_Y - SHOP_LIST_TOP_Y),
    );
    if (!scene.shopScrollOffsets) scene.shopScrollOffsets = { buy: 0, sell: 0, forge: 0 };
    scene.shopScrollOffsets.buy = Phaser.Math.Clamp(
      scene.shopScrollOffsets.buy || 0,
      0,
      scene.shopScrollMax,
    );
    const offset = scene.shopScrollOffsets.buy;

    scene.shopBuyItems.forEach((entry, i) => {
      const y = startY + i * lineH - offset;
      if (y < SHOP_LIST_TOP_Y - lineH || y > SHOP_LIST_BOTTOM_Y) return;
      const affordable = scene.runManager.gold >= entry.price;
      const affordableColor = scene._currentShopHasAmbushDiscount ? '#88ff88' : '#e0e0e0';
      const color = affordable ? affordableColor : '#666666';
      const marker = hasWeaponArt(entry?.item, getWeaponArtCatalogForScene(scene)) ? ' *' : '';
      const text = scene.add
        .text(60, y, `${entry.item.name}${marker}  ${entry.price}G`, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color,
        })
        .setDepth(OVERLAY_CONTENT_DEPTH);

      text.setInteractive({ useHandCursor: affordable });
      text.on('pointerover', () => {
        text.setColor('#ffdd44');
        scene._showShopItemTooltip(entry, text.x + text.width + 10, text.y);
      });
      text.on('pointerout', () => {
        text.setColor(color);
        scene._hideShopItemTooltip();
      });
      if (affordable) {
        text.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          if (isTouchPointer(pointer)) {
            scene._touchDownLatchKind = 'shop';
            scene._showShopItemTooltip(entry, text.x + text.width + 10, text.y);
            // Record tap start for scroll-vs-tap validation on pointerup
            text._touchBuyStart = { x: pointer.x, y: pointer.y };
            return;
          }
          scene.onBuyItem(entry);
        });
        text.on('pointerup', (pointer) => {
          if (!isTouchPointer(pointer)) return;
          const start = text._touchBuyStart;
          text._touchBuyStart = null;
          if (!start) return;
          // Reject if finger moved (scroll gesture) — also disarm buy latch
          const dx = pointer.x - start.x;
          const dy = pointer.y - start.y;
          if (dx * dx + dy * dy > 144) {
            scene._touchPreviewedShopEntry = null;
            return;
          }
          // Two-tap: first tap = preview, second tap = buy
          const now = Date.now();
          if (
            scene._touchPreviewedShopEntry === entry &&
            now - (scene._touchPreviewedShopAt || 0) < 3000
          ) {
            scene._touchPreviewedShopEntry = null;
            scene.onBuyItem(entry);
          } else {
            scene._touchPreviewedShopEntry = entry;
            scene._touchPreviewedShopAt = now;
          }
        });
      } else {
        text.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          if (isTouchPointer(pointer)) {
            scene._touchDownLatchKind = 'shop';
            scene._touchPreviewedShopEntry = null; // disarm buy latch on unaffordable tap
            scene._showShopItemTooltip(entry, text.x + text.width + 10, text.y);
          }
        });
      }

      scene.shopContentGroup.push(text);
      scene.shopOverlay.push(text);
    });
  }

  onBuyItem(entry) {
    const scene = this.scene;
    const rm = scene.runManager;
    if (rm.gold < entry.price) return;

    // Path 1: Scrolls go to team pool
    if (entry.type === 'scroll') {
      rm.spendGold(entry.price);
      if (!rm.scrolls) rm.scrolls = [];
      rm.scrolls.push({ ...entry.item });
      const idx = scene.shopBuyItems.indexOf(entry);
      if (idx !== -1) scene.shopBuyItems.splice(idx, 1);
      const audio = scene.registry.get('audio');
      if (audio) audio.playSFX('sfx_gold');
      scene.refreshShop();
      scene.showShopBanner(`Got ${entry.item.name}! Added to Scroll Pool.`, '#88ff88');
      return;
    }

    // Path 2: Accessories go to team pool
    if (entry.type === 'accessory') {
      rm.spendGold(entry.price);
      if (!rm.accessories) rm.accessories = [];
      rm.accessories.push({ ...entry.item });
      const idx = scene.shopBuyItems.indexOf(entry);
      if (idx !== -1) scene.shopBuyItems.splice(idx, 1);
      const audio = scene.registry.get('audio');
      if (audio) audio.playSFX('sfx_gold');
      scene.refreshShop();
      scene.showShopBanner(`Got ${entry.item.name}! Added to Accessory Pool.`, '#88ff88');
      return;
    }

    // Path 3a: Consumables use consumables limit
    if (entry.item.type === 'Consumable') {
      scene.showUnitPicker(
        (unitIndex) => {
          const unit = rm.roster[unitIndex];
          const consumableCount = unit.consumables ? unit.consumables.length : 0;
          if (consumableCount >= CONSUMABLE_MAX) {
            if (!rm.spendGold(entry.price)) {
              scene.showShopBanner('Not enough gold.', '#ff8888');
              return;
            }
            if (!rm.addToConvoy(entry.item)) {
              if (typeof rm.addGold === 'function') rm.addGold(entry.price);
              scene.showShopBanner(`${unit.name}'s consumables are full!`, '#ff8888');
              return;
            }
            const idx = scene.shopBuyItems.indexOf(entry);
            if (idx !== -1) scene.shopBuyItems.splice(idx, 1);
            const audio = scene.registry.get('audio');
            if (audio) audio.playSFX('sfx_gold');
            scene.refreshShop();
            scene.showShopBanner(`${entry.item.name} sent to convoy.`, '#88ccff');
            return;
          }
          rm.spendGold(entry.price);
          addToConsumables(unit, { ...entry.item });
          const idx = scene.shopBuyItems.indexOf(entry);
          if (idx !== -1) scene.shopBuyItems.splice(idx, 1);
          const audio = scene.registry.get('audio');
          if (audio) audio.playSFX('sfx_gold');
          scene.refreshShop();
          scene.showShopBanner(`${unit.name} got ${entry.item.name}!`, '#88ff88');
        },
        { itemTypeContext: 'consumable' },
      );
      return;
    }

    // Path 3b: Weapons/staves use main inventory limit
    scene.showUnitPicker(
      (unitIndex) => {
        const unit = rm.roster[unitIndex];
        if (unit.inventory.length >= INVENTORY_MAX) {
          if (!rm.spendGold(entry.price)) {
            scene.showShopBanner('Not enough gold.', '#ff8888');
            return;
          }
          if (!rm.addToConvoy(entry.item)) {
            if (typeof rm.addGold === 'function') rm.addGold(entry.price);
            scene.showShopBanner(`${unit.name}'s inventory is full!`, '#ff8888');
            return;
          }
          const idx = scene.shopBuyItems.indexOf(entry);
          if (idx !== -1) scene.shopBuyItems.splice(idx, 1);
          const audio = scene.registry.get('audio');
          if (audio) audio.playSFX('sfx_gold');
          scene.refreshShop();
          scene.showShopBanner(`${entry.item.name} sent to convoy.`, '#88ccff');
          return;
        }
        rm.spendGold(entry.price);
        addToInventory(unit, { ...entry.item });
        const idx = scene.shopBuyItems.indexOf(entry);
        if (idx !== -1) scene.shopBuyItems.splice(idx, 1);
        const audio = scene.registry.get('audio');
        if (audio) audio.playSFX('sfx_gold');
        scene.refreshShop();
        scene.showShopBanner(`${unit.name} got ${entry.item.name}!`, '#88ff88');
      },
      { profCheckItem: entry.item, itemTypeContext: 'inventory' },
    );
  }

  drawShopSellList() {
    const scene = this.scene;
    const startY = 105;
    const lineH = 22;
    const rm = scene.runManager;
    const previewAwardedSellGold = (amount) => {
      const normalized = Math.max(0, Math.trunc(Number(amount) || 0));
      return normalized;
    };
    const rowModel = [];
    for (const unit of rm.roster) {
      rowModel.push({ kind: 'unit', unit });
      const inventory = unit.inventory || [];
      const consumables = unit.consumables || [];
      for (const item of inventory) {
        const sellPrice = getSellPrice(item);
        if (sellPrice <= 0) continue;
        rowModel.push({ kind: 'inventory', unit, item, sellPrice });
      }
      for (const item of consumables) {
        const sellPrice = getSellPrice(item);
        if (sellPrice <= 0) continue;
        rowModel.push({ kind: 'consumable', unit, item, sellPrice });
      }
    }
    // Convoy items
    const convoyWeapons = rm.convoy?.weapons || [];
    const convoyConsumables = rm.convoy?.consumables || [];
    const hasConvoySellable =
      convoyWeapons.some((w) => getSellPrice(w) > 0) ||
      convoyConsumables.some((c) => getSellPrice(c) > 0);
    if (hasConvoySellable) {
      rowModel.push({ kind: 'convoy_header' });
      for (let ci = 0; ci < convoyWeapons.length; ci++) {
        const item = convoyWeapons[ci];
        const sellPrice = getSellPrice(item);
        if (sellPrice <= 0) continue;
        rowModel.push({ kind: 'convoy_weapon', item, sellPrice, convoyIndex: ci });
      }
      for (let ci = 0; ci < convoyConsumables.length; ci++) {
        const item = convoyConsumables[ci];
        const sellPrice = getSellPrice(item);
        if (sellPrice <= 0) continue;
        rowModel.push({ kind: 'convoy_consumable', item, sellPrice, convoyIndex: ci });
      }
    }
    const rowTotal = rowModel.length;
    scene.shopScrollMax = Math.max(0, rowTotal * lineH - (SHOP_LIST_BOTTOM_Y - SHOP_LIST_TOP_Y));
    if (!scene.shopScrollOffsets) scene.shopScrollOffsets = { buy: 0, sell: 0, forge: 0 };
    scene.shopScrollOffsets.sell = Phaser.Math.Clamp(
      scene.shopScrollOffsets.sell || 0,
      0,
      scene.shopScrollMax,
    );
    const offset = scene.shopScrollOffsets.sell;

    for (let row = 0; row < rowModel.length; row++) {
      const rowData = rowModel[row];
      const y = startY + row * lineH - offset;
      if (y < SHOP_LIST_TOP_Y - lineH || y > SHOP_LIST_BOTTOM_Y) continue;

      if (rowData.kind === 'unit') {
        const nameText = scene.add
          .text(60, y, `${rowData.unit.name}:`, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#aaaaaa',
          })
          .setDepth(OVERLAY_CONTENT_DEPTH);
        scene.shopContentGroup.push(nameText);
        scene.shopOverlay.push(nameText);
        continue;
      }

      if (rowData.kind === 'inventory') {
        const item = rowData.item;
        const sellPrice = rowData.sellPrice;
        const unit = rowData.unit;
        const locked = isLastCombatWeapon(unit, item);
        const equipped = item === unit.weapon ? '\u25b6' : ' ';
        const marker = hasWeaponArt(item, getWeaponArtCatalogForScene(scene)) ? ' *' : '';
        const wpnColor = locked ? '#666666' : isForged(item) ? '#44ff88' : '#e0e0e0';
        const awardedSellPrice = previewAwardedSellGold(sellPrice);
        const text = scene.add
          .text(
            70,
            y,
            `${equipped}${item.name}${marker}  ${locked ? '(last weapon)' : '+' + awardedSellPrice + 'G'}`,
            {
              fontFamily: 'monospace',
              fontSize: '11px',
              color: wpnColor,
            },
          )
          .setDepth(OVERLAY_CONTENT_DEPTH);

        if (!locked) {
          text.setInteractive({ useHandCursor: true });
          text.on('pointerover', () => text.setColor('#ffdd44'));
          text.on('pointerout', () => text.setColor(wpnColor));
          text.on('pointerdown', (pointer) => {
            if (pointer?.button !== 0) return;
            if (typeof rm.awardGold === 'function') rm.awardGold(sellPrice);
            else rm.addGold(sellPrice);
            removeFromInventory(unit, item);
            const audio = scene.registry.get('audio');
            if (audio) audio.playSFX('sfx_gold');
            scene.refreshShop();
            scene.showShopBanner(`Sold ${item.name} for ${awardedSellPrice}G`, '#ffdd44');
          });
        }

        scene.shopContentGroup.push(text);
        scene.shopOverlay.push(text);
        continue;
      }

      if (rowData.kind === 'consumable') {
        const item = rowData.item;
        const sellPrice = rowData.sellPrice;
        const awardedSellPrice = previewAwardedSellGold(sellPrice);
        const unit = rowData.unit;
        const usesText = Number.isFinite(item.uses) ? ` (${item.uses})` : '';
        const baseColor = '#88ff88';
        const text = scene.add
          .text(70, y, ` ${item.name}${usesText}  +${awardedSellPrice}G`, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: baseColor,
          })
          .setDepth(OVERLAY_CONTENT_DEPTH);
        text.setInteractive({ useHandCursor: true });
        text.on('pointerover', () => text.setColor('#ffdd44'));
        text.on('pointerout', () => text.setColor(baseColor));
        text.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          if (typeof rm.awardGold === 'function') rm.awardGold(sellPrice);
          else rm.addGold(sellPrice);
          removeFromConsumables(unit, item);
          const audio = scene.registry.get('audio');
          if (audio) audio.playSFX('sfx_gold');
          scene.refreshShop();
          scene.showShopBanner(`Sold ${item.name} for ${awardedSellPrice}G`, '#ffdd44');
        });

        scene.shopContentGroup.push(text);
        scene.shopOverlay.push(text);
        continue;
      }

      if (rowData.kind === 'convoy_header') {
        const hdr = scene.add
          .text(60, y, 'Convoy:', {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#aaaaaa',
          })
          .setDepth(OVERLAY_CONTENT_DEPTH);
        scene.shopContentGroup.push(hdr);
        scene.shopOverlay.push(hdr);
        continue;
      }

      if (rowData.kind === 'convoy_weapon') {
        const item = rowData.item;
        const sellPrice = rowData.sellPrice;
        const awardedSellPrice = previewAwardedSellGold(sellPrice);
        const convoyIdx = rowData.convoyIndex;
        const marker = hasWeaponArt(item, getWeaponArtCatalogForScene(scene)) ? ' *' : '';
        const wpnColor = isForged(item) ? '#44ff88' : '#e0e0e0';
        const text = scene.add
          .text(70, y, ` ${item.name}${marker}  +${awardedSellPrice}G`, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: wpnColor,
          })
          .setDepth(OVERLAY_CONTENT_DEPTH);
        text.setInteractive({ useHandCursor: true });
        text.on('pointerover', () => text.setColor('#ffdd44'));
        text.on('pointerout', () => text.setColor(wpnColor));
        text.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          rm.takeFromConvoy('weapon', convoyIdx);
          if (typeof rm.awardGold === 'function') rm.awardGold(sellPrice);
          else rm.addGold(sellPrice);
          const audio = scene.registry.get('audio');
          if (audio) audio.playSFX('sfx_gold');
          scene.refreshShop();
          scene.showShopBanner(`Sold ${item.name} for ${awardedSellPrice}G`, '#ffdd44');
        });
        scene.shopContentGroup.push(text);
        scene.shopOverlay.push(text);
        continue;
      }

      if (rowData.kind === 'convoy_consumable') {
        const item = rowData.item;
        const sellPrice = rowData.sellPrice;
        const awardedSellPrice = previewAwardedSellGold(sellPrice);
        const convoyIdx = rowData.convoyIndex;
        const usesText = Number.isFinite(item.uses) ? ` (${item.uses})` : '';
        const baseColor = '#88ff88';
        const text = scene.add
          .text(70, y, ` ${item.name}${usesText}  +${awardedSellPrice}G`, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: baseColor,
          })
          .setDepth(OVERLAY_CONTENT_DEPTH);
        text.setInteractive({ useHandCursor: true });
        text.on('pointerover', () => text.setColor('#ffdd44'));
        text.on('pointerout', () => text.setColor(baseColor));
        text.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          rm.takeFromConvoy('consumable', convoyIdx);
          if (typeof rm.awardGold === 'function') rm.awardGold(sellPrice);
          else rm.addGold(sellPrice);
          const audio = scene.registry.get('audio');
          if (audio) audio.playSFX('sfx_gold');
          scene.refreshShop();
          scene.showShopBanner(`Sold ${item.name} for ${awardedSellPrice}G`, '#ffdd44');
        });
        scene.shopContentGroup.push(text);
        scene.shopOverlay.push(text);
      }
    }
  }

  drawShopForgeList() {
    const scene = this.scene;
    scene._hideForgeTooltip();
    const startY = 105;
    const lineH = 20;
    const rm = scene.runManager;
    const baseForgeLimit = SHOP_FORGE_LIMITS[rm.currentAct] || 2;
    const forgeLimit = baseForgeLimit + (rm.blessingRuntimeModifiers?.forgeLimitDelta || 0);
    let row = 0;
    let rowTotal = 1.5;
    for (const unit of rm.roster) {
      const forgeableWeapons = unit.inventory.filter((w) => canForge(w));
      if (forgeableWeapons.length === 0) continue;
      rowTotal += 1 + forgeableWeapons.length;
    }
    const convoyForgeWeapons = (rm.convoy?.weapons || []).filter((w) => canForge(w));
    if (convoyForgeWeapons.length > 0) rowTotal += 1 + convoyForgeWeapons.length;
    scene.shopScrollMax = Math.max(0, rowTotal * lineH - (SHOP_LIST_BOTTOM_Y - SHOP_LIST_TOP_Y));
    if (!scene.shopScrollOffsets) scene.shopScrollOffsets = { buy: 0, sell: 0, forge: 0 };
    scene.shopScrollOffsets.forge = Phaser.Math.Clamp(
      scene.shopScrollOffsets.forge || 0,
      0,
      scene.shopScrollMax,
    );
    const offset = scene.shopScrollOffsets.forge;

    // Header: forges remaining
    const headerY = startY - offset;
    if (headerY >= SHOP_LIST_TOP_Y - lineH && headerY <= SHOP_LIST_BOTTOM_Y) {
      const header = scene.add
        .text(60, headerY, `Forges remaining: ${forgeLimit - scene.shopForgesUsed}/${forgeLimit}`, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#ff8844',
        })
        .setDepth(OVERLAY_CONTENT_DEPTH);
      scene.shopContentGroup.push(header);
      scene.shopOverlay.push(header);
    }
    row += 1.5;

    const limitReached = scene.shopForgesUsed >= forgeLimit;

    for (const unit of rm.roster) {
      const forgeableWeapons = unit.inventory.filter((w) => canForge(w));
      if (forgeableWeapons.length === 0) continue;

      const nameY = startY + row * lineH - offset;
      if (nameY >= SHOP_LIST_TOP_Y - lineH && nameY <= SHOP_LIST_BOTTOM_Y) {
        const nameText = scene.add
          .text(60, nameY, `${unit.name}:`, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#aaaaaa',
          })
          .setDepth(OVERLAY_CONTENT_DEPTH);
        scene.shopContentGroup.push(nameText);
        scene.shopOverlay.push(nameText);
      }
      row++;

      for (const wpn of forgeableWeapons) {
        const y = startY + row * lineH - offset;
        const level = wpn._forgeLevel || 0;
        const wpnColor = isForged(wpn) ? '#44ff88' : '#e0e0e0';
        const marker = hasWeaponArt(wpn, getWeaponArtCatalogForScene(scene)) ? ' *' : '';
        const label = `  ${wpn.name}${marker}  [${level}/${FORGE_MAX_LEVEL}]`;
        if (y < SHOP_LIST_TOP_Y - lineH || y > SHOP_LIST_BOTTOM_Y) {
          row++;
          continue;
        }
        const wpnText = scene.add
          .text(70, y, label, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: wpnColor,
          })
          .setDepth(OVERLAY_CONTENT_DEPTH);
        scene.shopContentGroup.push(wpnText);
        scene.shopOverlay.push(wpnText);

        // Hover tooltip for weapon stats (+ touch tap)
        wpnText.setInteractive({ useHandCursor: false });
        wpnText.on('pointerover', () => {
          scene._showForgeTooltip(wpn, wpnText.x + wpnText.width + 10, wpnText.y);
        });
        wpnText.on('pointerout', () => scene._hideForgeTooltip());
        wpnText.on('pointerdown', (pointer) => {
          if (isTouchPointer(pointer)) {
            scene._showForgeTooltip(wpn, wpnText.x + wpnText.width + 10, wpnText.y);
          }
        });

        if (level >= FORGE_MAX_LEVEL) {
          const maxLabel = scene.add
            .text(350, y, 'MAX', {
              fontFamily: 'monospace',
              fontSize: '11px',
              color: '#888888',
            })
            .setDepth(OVERLAY_CONTENT_DEPTH);
          scene.shopContentGroup.push(maxLabel);
          scene.shopOverlay.push(maxLabel);
        } else if (limitReached) {
          const limitLabel = scene.add
            .text(350, y, '(limit)', {
              fontFamily: 'monospace',
              fontSize: '11px',
              color: '#666666',
            })
            .setDepth(OVERLAY_CONTENT_DEPTH);
          scene.shopContentGroup.push(limitLabel);
          scene.shopOverlay.push(limitLabel);
        } else {
          const forgeBtn = scene.add
            .text(350, y, '[ Forge ]', {
              fontFamily: 'monospace',
              fontSize: '11px',
              color: '#ff8844',
              backgroundColor: '#333333',
              padding: { x: 4, y: 1 },
            })
            .setDepth(OVERLAY_CONTENT_DEPTH)
            .setInteractive({ useHandCursor: true });
          forgeBtn.on('pointerover', () => forgeBtn.setColor('#ffdd44'));
          forgeBtn.on('pointerout', () => forgeBtn.setColor('#ff8844'));
          forgeBtn.on('pointerdown', (pointer) => {
            if (pointer?.button !== 0) return;
            scene.showForgeStatPicker(wpn);
          });
          scene.shopContentGroup.push(forgeBtn);
          scene.shopOverlay.push(forgeBtn);
        }

        row++;
      }
    }

    // Convoy forgeable weapons
    if (convoyForgeWeapons.length > 0) {
      const convoyHeaderY = startY + row * lineH - offset;
      if (convoyHeaderY >= SHOP_LIST_TOP_Y - lineH && convoyHeaderY <= SHOP_LIST_BOTTOM_Y) {
        const hdr = scene.add
          .text(60, convoyHeaderY, 'Convoy:', {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#aaaaaa',
          })
          .setDepth(OVERLAY_CONTENT_DEPTH);
        scene.shopContentGroup.push(hdr);
        scene.shopOverlay.push(hdr);
      }
      row++;

      for (const wpn of convoyForgeWeapons) {
        const y = startY + row * lineH - offset;
        const level = wpn._forgeLevel || 0;
        const wpnColor = isForged(wpn) ? '#44ff88' : '#e0e0e0';
        const marker = hasWeaponArt(wpn, getWeaponArtCatalogForScene(scene)) ? ' *' : '';
        const label = `  ${wpn.name}${marker}  [${level}/${FORGE_MAX_LEVEL}]`;
        if (y < SHOP_LIST_TOP_Y - lineH || y > SHOP_LIST_BOTTOM_Y) {
          row++;
          continue;
        }
        const wpnText = scene.add
          .text(70, y, label, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: wpnColor,
          })
          .setDepth(OVERLAY_CONTENT_DEPTH);
        scene.shopContentGroup.push(wpnText);
        scene.shopOverlay.push(wpnText);

        wpnText.setInteractive({ useHandCursor: false });
        wpnText.on('pointerover', () => {
          scene._showForgeTooltip(wpn, wpnText.x + wpnText.width + 10, wpnText.y);
        });
        wpnText.on('pointerout', () => scene._hideForgeTooltip());
        wpnText.on('pointerdown', (pointer) => {
          if (isTouchPointer(pointer)) {
            scene._showForgeTooltip(wpn, wpnText.x + wpnText.width + 10, wpnText.y);
          }
        });

        if (level >= FORGE_MAX_LEVEL) {
          const maxLabel = scene.add
            .text(350, y, 'MAX', {
              fontFamily: 'monospace',
              fontSize: '11px',
              color: '#888888',
            })
            .setDepth(OVERLAY_CONTENT_DEPTH);
          scene.shopContentGroup.push(maxLabel);
          scene.shopOverlay.push(maxLabel);
        } else if (limitReached) {
          const limitLabel = scene.add
            .text(350, y, '(limit)', {
              fontFamily: 'monospace',
              fontSize: '11px',
              color: '#666666',
            })
            .setDepth(OVERLAY_CONTENT_DEPTH);
          scene.shopContentGroup.push(limitLabel);
          scene.shopOverlay.push(limitLabel);
        } else {
          const forgeBtn = scene.add
            .text(350, y, '[ Forge ]', {
              fontFamily: 'monospace',
              fontSize: '11px',
              color: '#ff8844',
              backgroundColor: '#333333',
              padding: { x: 4, y: 1 },
            })
            .setDepth(OVERLAY_CONTENT_DEPTH)
            .setInteractive({ useHandCursor: true });
          forgeBtn.on('pointerover', () => forgeBtn.setColor('#ffdd44'));
          forgeBtn.on('pointerout', () => forgeBtn.setColor('#ff8844'));
          forgeBtn.on('pointerdown', (pointer) => {
            if (pointer?.button !== 0) return;
            scene.showForgeStatPicker(wpn);
          });
          scene.shopContentGroup.push(forgeBtn);
          scene.shopOverlay.push(forgeBtn);
        }

        row++;
      }
    }

    if (row <= 1.5 && convoyForgeWeapons.length === 0) {
      const emptyY = startY + row * lineH - offset;
      if (emptyY >= SHOP_LIST_TOP_Y - lineH && emptyY <= SHOP_LIST_BOTTOM_Y) {
        const emptyText = scene.add
          .text(60, emptyY, 'No forgeable weapons in roster.', {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#888888',
          })
          .setDepth(OVERLAY_CONTENT_DEPTH);
        scene.shopContentGroup.push(emptyText);
        scene.shopOverlay.push(emptyText);
      }
    }
  }

  drawShopScrollHint() {
    const scene = this.scene;
    if (!scene.shopOverlay || !scene.shopContentGroup) return;
    if ((scene.shopScrollMax || 0) <= 0) return;
    const offset = scene.shopScrollOffsets?.[scene.activeShopTab] || 0;
    const percent = scene.shopScrollMax > 0 ? Math.round((offset / scene.shopScrollMax) * 100) : 0;
    const hint = scene.add
      .text(445, 392, `Scroll: ${percent}%`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#888888',
        backgroundColor: '#222222',
        padding: { x: 4, y: 2 },
      })
      .setDepth(OVERLAY_CONTENT_DEPTH);
    scene.shopContentGroup.push(hint);
    scene.shopOverlay.push(hint);
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

    if (entryType === 'scroll' || item.type === 'Scroll') {
      const header = item.special || 'Teaches a skill';
      const skillDef = scene.gameData?.skills?.find((s) => s.id === item.skillId);
      const desc = skillDef?.description || '';
      return desc ? `${header}\n${desc}` : header;
    }

    if (item.type === 'Whetstone') {
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

  _showShopItemTooltip(entry, anchorX, anchorY) {
    const scene = this.scene;
    scene._hideShopItemTooltip();
    const detail = scene._getShopItemDetailText(entry);
    if (!detail) return;
    scene.shopItemTooltip = [];

    const padX = 8;
    const padY = 6;
    const maxTextW = 304; // 320 - padX*2

    // Create text first with wordWrap so Phaser computes accurate dimensions
    const detailText = scene.add
      .text(0, 0, detail, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#e0e0e0',
        lineSpacing: 4,
        wordWrap: { width: maxTextW },
      })
      .setDepth(311);

    const boxW = Phaser.Math.Clamp(detailText.width + padX * 2, 150, 320);
    const boxH = detailText.height + padY * 2;

    let tx = anchorX;
    let ty = anchorY;
    if (tx + boxW > 635) tx = anchorX - boxW - 20;
    if (ty + boxH > 475) ty = 475 - boxH;
    if (tx < 5) tx = 5;
    if (ty < 5) ty = 5;

    const bg = scene.add
      .rectangle(tx + boxW / 2, ty + boxH / 2, boxW, boxH, 0x111122, 0.95)
      .setDepth(310)
      .setStrokeStyle(1, 0x336666);
    detailText.setPosition(tx + padX, ty + padY);

    scene.shopItemTooltip.push(bg, detailText);
  }

  _hideShopItemTooltip() {
    const scene = this.scene;
    if (scene.shopItemTooltip) {
      scene.shopItemTooltip.forEach((o) => o.destroy());
      scene.shopItemTooltip = null;
    }
  }

  showForgeStatPicker(weapon) {
    const scene = this.scene;
    if (scene.forgePicker) scene.forgePicker.forEach((o) => o.destroy());
    scene.forgePicker = [];

    const cx = 320;
    const cy = 240;
    const level = weapon._forgeLevel || 0;

    const pickerBg = scene.add
      .rectangle(cx, cy, 320, 220, 0x222233, 0.97)
      .setDepth(450)
      .setStrokeStyle(2, 0xff8844)
      .setInteractive();
    scene.forgePicker.push(pickerBg);

    const title = scene.add
      .text(cx, cy - 88, `Forge ${weapon.name} (${level}/${FORGE_MAX_LEVEL})`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffdd44',
      })
      .setOrigin(0.5)
      .setDepth(451);
    scene.forgePicker.push(title);

    const stats = [
      { key: 'might', label: '+1 Mt' },
      { key: 'crit', label: '+5 Crit' },
      { key: 'hit', label: '+5 Hit' },
      { key: 'weight', label: '-1 Wt' },
    ];

    const btnStartY = cy - 50;
    const btnH = 32;
    const blessingDiscountRaw = scene.runManager?.getForgeCostDiscount?.() || 0;
    const blessingDiscount = Math.max(0, Math.min(0.95, blessingDiscountRaw));
    const ambushDiscount = scene._currentShopHasAmbushDiscount
      ? 1 - (1 - blessingDiscount) * AMBUSH_SHOP_DISCOUNT
      : blessingDiscount;
    const discount = Math.max(0, Math.min(0.95, ambushDiscount));

    for (let i = 0; i < stats.length; i++) {
      const stat = stats[i];
      const statCount = getStatForgeCount(weapon, stat.key);
      const atStatCap = statCount >= FORGE_STAT_CAP;
      const baseCost = getForgeCost(weapon, stat.key);
      const cost = Math.max(1, Math.floor(baseCost * (1 - discount)));
      const affordable = cost > 0 && scene.runManager.gold >= cost;
      const by = btnStartY + i * btnH;
      const affordableColor = scene._currentShopHasAmbushDiscount ? '#88ff88' : '#e0e0e0';
      const color = atStatCap ? '#666666' : affordable ? affordableColor : '#666666';

      const costLabel = atStatCap ? 'MAX' : `${cost}G`;
      const btn = scene.add
        .text(cx, by, `${stat.label}  (${statCount}/${FORGE_STAT_CAP})  ${costLabel}`, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color,
          backgroundColor: affordable && !atStatCap ? '#444444' : '#333333',
          padding: { x: 16, y: 4 },
        })
        .setOrigin(0.5)
        .setDepth(451);

      if (affordable && !atStatCap) {
        btn.setInteractive({ useHandCursor: true });
        btn.on('pointerover', () => btn.setColor('#ffdd44'));
        btn.on('pointerout', () => btn.setColor(color));
        btn.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          const result = applyForge(weapon, stat.key, discount);
          if (result.success) {
            scene.runManager.spendGold(result.cost);
            scene.shopForgesUsed++;
            const audio = scene.registry.get('audio');
            if (audio) audio.playSFX('sfx_gold');
            scene.closeForgeStatPicker();
            scene.refreshShop();
            scene.showShopBanner(`Forged ${weapon.name}!`, '#ff8844');
          }
        });
      }

      scene.forgePicker.push(btn);
    }

    // Cancel button
    const cancelBtn = scene.add
      .text(cx, btnStartY + stats.length * btnH + 10, 'Cancel', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#888888',
        backgroundColor: '#333333',
        padding: { x: 12, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(451)
      .setInteractive({ useHandCursor: true });
    cancelBtn.on('pointerover', () => cancelBtn.setColor('#ffdd44'));
    cancelBtn.on('pointerout', () => cancelBtn.setColor('#888888'));
    cancelBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      scene.closeForgeStatPicker();
    });
    scene.forgePicker.push(cancelBtn);
  }

  closeForgeStatPicker() {
    const scene = this.scene;
    if (scene.forgePicker) {
      scene.forgePicker.forEach((o) => o.destroy());
      scene.forgePicker = null;
    }
  }

  _showForgeTooltip(wpn, anchorX, anchorY) {
    const scene = this.scene;
    scene._hideForgeTooltip();
    scene.forgeTooltip = [];

    const line1 = `Mt: ${wpn.might}   Hit: ${wpn.hit}   Crt: ${wpn.crit}`;
    const line2 = `Wt: ${wpn.weight}   Rng: ${wpn.range}`;
    const mtCount = getStatForgeCount(wpn, 'might');
    const crCount = getStatForgeCount(wpn, 'crit');
    const htCount = getStatForgeCount(wpn, 'hit');
    const wtCount = getStatForgeCount(wpn, 'weight');
    const line3 = `Forge: Mt(${mtCount}/${FORGE_STAT_CAP}) Cr(${crCount}/${FORGE_STAT_CAP}) Ht(${htCount}/${FORGE_STAT_CAP}) Wt(${wtCount}/${FORGE_STAT_CAP})`;

    const lineDefs = [
      { text: line1, color: '#e0e0e0' },
      { text: line2, color: '#e0e0e0' },
      { text: line3, color: '#ff8844' },
    ];
    if (wpn.special) lineDefs.push({ text: `Special: ${wpn.special}`, color: '#88ccff' });
    const artLines = getWeaponArtTooltipLines(wpn, getWeaponArtCatalogForScene(scene));
    for (const line of artLines) lineDefs.push({ text: line, color: '#ffcc88' });

    const padX = 8;
    const padY = 6;
    const maxTextW = 320;
    const lineSpacing = 3;
    const detailLines = lineDefs.map(({ text, color }) =>
      scene.add
        .text(0, 0, text, {
          fontFamily: 'monospace',
          fontSize: '9px',
          color,
          wordWrap: { width: maxTextW },
        })
        .setDepth(311),
    );
    const textW = detailLines.reduce((max, lineObj) => Math.max(max, lineObj.width || 0), 0);
    const textH =
      detailLines.reduce((sum, lineObj) => sum + (lineObj.height || 0), 0) +
      Math.max(0, detailLines.length - 1) * lineSpacing;
    const boxW = Phaser.Math.Clamp(textW + padX * 2, 220, 340);
    const boxH = textH + padY * 2;

    // Clamp to canvas (640x480)
    let tx = anchorX;
    let ty = anchorY;
    if (tx + boxW > 635) tx = anchorX - boxW - 20;
    if (ty + boxH > 475) ty = 475 - boxH;
    if (tx < 5) tx = 5;
    if (ty < 5) ty = 5;

    const bg = scene.add
      .rectangle(tx + boxW / 2, ty + boxH / 2, boxW, boxH, 0x111122, 0.95)
      .setDepth(310)
      .setStrokeStyle(1, 0x4466aa);
    scene.forgeTooltip.push(bg);
    let lineY = ty + padY;
    for (const lineObj of detailLines) {
      lineObj.setPosition(tx + padX, lineY);
      scene.forgeTooltip.push(lineObj);
      lineY += (lineObj.height || 0) + lineSpacing;
    }
  }

  _hideForgeTooltip() {
    const scene = this.scene;
    if (scene.forgeTooltip) {
      scene.forgeTooltip.forEach((o) => o.destroy());
      scene.forgeTooltip = null;
    }
  }

  _saveShopState() {
    const scene = this.scene;
    const node = scene._shopNode;
    if (!node) return;
    scene.runManager?.saveShopState?.(node.id, {
      items: (scene.shopBuyItems || []).map(({ index, ...rest }) => rest),
      forgesUsed: scene.shopForgesUsed || 0,
      rerollCount: scene.shopRerollCount || 0,
      originalSlotCount: scene._shopOriginalSlotCount || 0,
      ambushDiscountActive: scene._currentShopHasAmbushDiscount || false,
    });
  }

  refreshShop() {
    const scene = this.scene;
    scene._touchPreviewedShopEntry = null;
    scene.shopGoldText.setText(`Gold: ${scene.runManager.gold}G`);
    scene.drawActiveTabContent();
    scene.drawShopTabs();
    scene._saveShopState();
  }

  drawRerollButton() {
    const scene = this.scene;
    const cost = SHOP_REROLL_COST + scene.shopRerollCount * SHOP_REROLL_ESCALATION;
    const affordable = scene.runManager.gold >= cost;
    const color = affordable ? '#aaddff' : '#666666';
    const rerollBtn = scene.add
      .text(60, 410, `[ Reroll ${cost}G ]`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color,
        backgroundColor: '#333333',
        padding: { x: 8, y: 4 },
      })
      .setDepth(OVERLAY_CONTENT_DEPTH);
    scene.shopContentGroup.push(rerollBtn);
    scene.shopOverlay.push(rerollBtn);

    if (affordable) {
      rerollBtn.setInteractive({ useHandCursor: true });
      rerollBtn.on('pointerover', () => rerollBtn.setColor('#ffdd44'));
      rerollBtn.on('pointerout', () => rerollBtn.setColor(color));
      rerollBtn.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        scene.runManager.spendGold(cost);
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
        scene.showShopBanner('Shop restocked!', '#aaddff');
      });
    }
  }

  showUnitPicker(callback, pickerOptionsOrItem) {
    const scene = this.scene;
    scene.closeUnitPicker();

    const rm = scene.runManager;
    const viewportHeight = 280;
    const contentHeight = rm.roster.length * 30;
    const maxOffset = Math.max(0, contentHeight - viewportHeight);
    const pickerOptions =
      pickerOptionsOrItem &&
      typeof pickerOptionsOrItem === 'object' &&
      ('profCheckItem' in pickerOptionsOrItem || 'itemTypeContext' in pickerOptionsOrItem)
        ? pickerOptionsOrItem
        : { profCheckItem: pickerOptionsOrItem, itemTypeContext: null };
    const profCheckItem = pickerOptions?.profCheckItem || null;
    const itemTypeContext = pickerOptions?.itemTypeContext || null;

    scene.unitPickerState = {
      callback,
      profCheckItem,
      itemTypeContext,
      offset: 0,
      maxOffset,
      viewportTop: 120,
      viewportBottom: 120 + viewportHeight,
    };
    scene.renderUnitPicker();
  }

  renderUnitPicker() {
    const scene = this.scene;
    if (!scene.unitPickerState) return;
    if (scene.unitPicker) scene.unitPicker.forEach((o) => o.destroy());
    scene.unitPicker = [];

    const rm = scene.runManager;
    const state = scene.unitPickerState;
    const cx = 320;
    const panelY = 260;
    const panelW = 360;
    const panelH = 360;
    const listTop = state.viewportTop;
    const listBottom = state.viewportBottom;
    const offset = state.offset || 0;

    const pickerBg = scene.add
      .rectangle(cx, panelY, panelW, panelH, 0x222222, 0.95)
      .setDepth(400)
      .setStrokeStyle(1, 0x888888)
      .setInteractive();
    scene.unitPicker.push(pickerBg);

    const pickerTitle = scene.add
      .text(cx, 102, 'Give to:', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ffdd44',
      })
      .setOrigin(0.5)
      .setDepth(401);
    scene.unitPicker.push(pickerTitle);

    const clipTop = scene.add.rectangle(cx, listTop, panelW - 20, 1, 0x555555, 0.6).setDepth(401);
    const clipBottom = scene.add
      .rectangle(cx, listBottom, panelW - 20, 1, 0x555555, 0.6)
      .setDepth(401);
    scene.unitPicker.push(clipTop, clipBottom);

    rm.roster.forEach((unit, i) => {
      const y = listTop + i * 30 - offset + 15;
      if (y < listTop - 15 || y > listBottom + 15) return;
      const profCheckItem = state.profCheckItem || null;
      const shouldCheckProficiency = isProficiencyCheckRelevant(profCheckItem);
      const noProf = shouldCheckProficiency && !hasProficiency(unit, profCheckItem);
      const inventoryCount = (unit.inventory || []).length;
      const consumableCount = (unit.consumables || []).length;
      const inventoryFull = inventoryCount >= INVENTORY_MAX;
      const consumablesFull = consumableCount >= CONSUMABLE_MAX;
      const fullSuffix =
        state.itemTypeContext === 'consumable'
          ? consumablesFull
            ? ' consumables full'
            : ''
          : state.itemTypeContext === 'inventory'
            ? inventoryFull
              ? ' inventory full'
              : ''
            : '';
      const displayName = truncateUnitNameForCapacityLabel(unit.name, 16);
      const label = `${displayName} (Inventory ${inventoryCount}/${INVENTORY_MAX} | Consumables ${consumableCount}/${CONSUMABLE_MAX})${noProf ? ' no prof' : ''}${fullSuffix}`;
      const color = noProf ? '#cc8844' : '#e0e0e0';
      const btn = scene.add
        .text(cx, y, label, {
          fontFamily: 'monospace',
          fontSize: '13px',
          color,
          backgroundColor: '#444444',
          padding: { x: 12, y: 4 },
        })
        .setOrigin(0.5)
        .setDepth(401)
        .setInteractive({ useHandCursor: true });

      btn.on('pointerover', () => btn.setColor('#ffdd44'));
      btn.on('pointerout', () => btn.setColor(color));
      btn.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        const cb = state.callback;
        scene.closeUnitPicker();
        cb(i);
      });

      scene.unitPicker.push(btn);
    });

    if (state.maxOffset > 0) {
      const pct = Math.round((offset / state.maxOffset) * 100);
      const hint = scene.add
        .text(cx + panelW / 2 - 10, 102, `${pct}%`, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#888888',
        })
        .setOrigin(1, 0.5)
        .setDepth(401);
      scene.unitPicker.push(hint);
    }

    const cancelBtn = scene.add
      .text(cx, 430, '[ Cancel ]', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#bbbbbb',
        backgroundColor: '#333333',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(401)
      .setInteractive({ useHandCursor: true });
    cancelBtn.on('pointerover', () => cancelBtn.setColor('#ffdd44'));
    cancelBtn.on('pointerout', () => cancelBtn.setColor('#bbbbbb'));
    cancelBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      scene.closeUnitPicker();
    });
    scene.unitPicker.push(cancelBtn);
  }

  closeUnitPicker() {
    const scene = this.scene;
    if (scene.unitPicker) {
      scene.unitPicker.forEach((o) => o.destroy());
      scene.unitPicker = null;
    }
    scene.unitPickerState = null;
  }

  showShopBanner(msg, color) {
    const scene = this.scene;
    const banner = scene.add
      .text(320, 400, msg, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color,
        backgroundColor: '#000000cc',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(500)
      .setAlpha(0);

    scene.tweens.add({
      targets: banner,
      alpha: 1,
      duration: 200,
      yoyo: true,
      hold: 800,
      onComplete: () => banner.destroy(),
    });
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
    scene.showShopBanner(`Weapon Art${suffix} unlocked: ${label}`, '#88ddff');
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
    const scene = this.scene;
    scene._shopViewingRoster = false;
    scene._touchPreviewedShopEntry = null;
    scene.closeForgeStatPicker();
    scene._hideForgeTooltip();
    scene._hideShopItemTooltip();
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
    if (scene.unitPicker) {
      scene.closeUnitPicker();
    }
    scene._shopViewingMap = false;
    scene._shopOriginalSlotCount = 0;
    scene._shopNode = null;
    scene._currentShopHasAmbushDiscount = false;
  }
  destroy() {
    this.scene = null;
  }
}
