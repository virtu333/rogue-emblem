import { equipmentComparison } from './equipmentComparison.js';
import { appendItemArtDetails } from './ItemArtDetails.js';
import { saveServiceRun } from './serviceSave.js';
import { MenuSurface, element as el, button } from './MenuSurface.js';
import { ChoicePicker } from './ChoicePicker.js';
import { MobileRosterSheet } from './MobileRosterSheet.js';
import {
  shopOwnedItems,
  shopBuyBlock,
  purchaseShopItem,
  shopSellBlock,
  sellShopItem,
  shopForgeBlock,
  forgeShopWeapon,
} from '../engine/ShopCommands.js';
import {
  canForge,
  getForgeCost,
  getForgeDisplayInfo,
  getStatForgeCount,
} from '../engine/ForgeSystem.js';
import { getSellPrice } from '../engine/LootSystem.js';
import { canEquip } from '../engine/UnitManager.js';
import { getImbueDisplayInfo } from '../engine/ImbueSystem.js';
import {
  SHOP_FORGE_LIMITS,
  SHOP_REROLL_COST,
  SHOP_REROLL_ESCALATION,
  AMBUSH_SHOP_DISCOUNT,
  FORGE_STAT_CAP,
  INVENTORY_MAX,
  CONSUMABLE_MAX,
  RUINS_SHOP_MARKUP,
} from '../utils/constants.js';
import { InputAction } from '../utils/InputActions.js';

export class ShopMenu {
  constructor(controller) {
    this.controller = controller;
    this.scene = controller.scene;
    this.status = '';
    this.open();
  }
  get run() {
    return this.scene.runManager;
  }
  open() {
    if (this.surface || this.destroyed) return;
    const s = this.scene;
    const title = s._currentShopIsCaravan
      ? 'Merchant Caravan'
      : s._currentShopIsRuins
        ? 'Ruins market'
        : 'Village';
    this.surface = new MenuSurface(s, title, () => this.leave());
    this.surface.root.classList.add('shop-menu');
    this.surface.header.querySelector('button').textContent = s._currentShopIsRuins
      ? 'Return to ruins'
      : 'Leave';
    this.gold = el('span', '', 'shop-gold');
    this.surface.header.insertBefore(this.gold, this.surface.header.lastChild);
    this.surface.onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return false;
      if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        this.changeTab(event.key === 'ArrowLeft' ? -1 : 1);
        return true;
      }
      return false;
    };
    this.surface.onAction = (action, payload) => {
      if (action === InputAction.NAVIGATE && payload?.dx) {
        this.changeTab(payload.dx);
        return true;
      }
      if ([InputAction.PREV_UNIT, InputAction.NEXT_UNIT].includes(action)) {
        this.changeTab(action === InputAction.PREV_UNIT ? -1 : 1);
        return true;
      }
      if (action === InputAction.ROSTER) {
        this.roster();
        return true;
      }
      return false;
    };
    this.render();
    this.surface.focusContent();
  }
  changeTab(delta) {
    if (this.child) return;
    const tabs = this.controller._getShopTabs();
    const index = tabs.findIndex((t) => t.key === this.scene.activeShopTab);
    this.scene.activeShopTab = tabs[(index + Math.sign(delta) + tabs.length) % tabs.length].key;
    this.selected = null;
    this.render();
    this.surface.body.querySelector('.shop-tabs [aria-pressed="true"]')?.focus();
  }
  rows() {
    const tab = this.scene.activeShopTab;
    if (tab === 'buy')
      return this.scene.shopBuyItems.map((entry) => ({ item: entry.item, entry, owner: 'Stock' }));
    const rows = shopOwnedItems(this.run);
    return tab === 'sell'
      ? rows.filter((row) => getSellPrice(row.item) > 0)
      : rows.filter((row) => canForge(row.item));
  }
  render(message) {
    if (!this.surface || this.surface.destroyed) return;
    if (message != null) this.status = message;
    const body = this.surface.body;
    const scroll =
      this.renderedTab === this.scene.activeShopTab
        ? body.querySelector('.shop-stock')?.scrollTop || 0
        : 0;
    this.renderedTab = this.scene.activeShopTab;
    const focus = document.activeElement?.dataset.shopFocus;
    body.replaceChildren();
    this.gold.textContent = `${this.run.gold} G`;
    const tabs = el('nav', null, 'shop-tabs');
    tabs.setAttribute('aria-label', 'Shop sections');
    for (const tab of this.controller._getShopTabs()) {
      const b = button(tab.label, () => {
        this.scene.activeShopTab = tab.key;
        this.selected = null;
        this.render();
        this.surface.body.querySelector('.shop-tabs [aria-pressed="true"]')?.focus();
      });
      b.dataset.shopFocus = tab.key;
      b.setAttribute('aria-pressed', String(this.scene.activeShopTab === tab.key));
      tabs.append(b);
    }
    const rows = this.rows();
    const chosen = rows.find((row) => row.item === this.selected) || rows[0];
    this.selected = chosen?.item;
    const split = el('div', null, 'shop-split');
    const stock = el('div', null, 'shop-stock re-scroll');
    stock.setAttribute('aria-label', 'Shop items');
    if (!rows.length)
      stock.append(
        el(
          'p',
          this.scene.activeShopTab === 'buy'
            ? 'Sold out. You can restock or leave.'
            : 'No eligible items.',
        ),
      );
    rows.forEach((row, i) => {
      const b = button(
        null,
        () => {
          this.selected = row.item;
          this.render();
          this.surface.body.querySelector('.shop-stock [aria-pressed="true"]')?.focus();
        },
        're-btn shop-row',
      );
      b.dataset.shopFocus = `item-${i}`;
      b.setAttribute('aria-pressed', String(row.item === this.selected));
      const sub =
        this.scene.activeShopTab === 'buy'
          ? `${row.entry.price} G · ${row.item.type}`
          : this.scene.activeShopTab === 'sell'
            ? `${row.owner} · +${getSellPrice(row.item)} G`
            : `${row.owner} · Forge ${row.item._forgeLevel || 0}`;
      b.append(el('strong', row.item.name), el('span', sub));
      stock.append(b);
    });
    const detail = el('article', null, 'shop-detail');
    if (this.scene.activeShopTab === 'buy') {
      if (this.scene._currentShopIsRuins)
        detail.append(
          el('p', `Ruins prices include a ${Math.round((RUINS_SHOP_MARKUP - 1) * 100)}% markup.`),
        );
      if (this.scene._currentShopHasAmbushDiscount)
        detail.append(
          el(
            'p',
            `Liberated village: ${Math.round((1 - AMBUSH_SHOP_DISCOUNT) * 100)}% discount included.`,
          ),
        );
    }
    if (chosen) this.details(detail, chosen);
    split.append(stock, detail);
    const footer = el('footer', null, 'shop-footer');
    const status = el('p', this.status, 'shop-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const actions = el('div', null, 'shop-tools');
    if (this.scene.activeShopTab === 'buy' && !this.scene._currentShopIsCaravan) {
      const cost = SHOP_REROLL_COST + this.scene.shopRerollCount * SHOP_REROLL_ESCALATION;
      const reroll = button(`Restock · ${cost} G`, () =>
        this.confirm(
          'Restock shop?',
          `Spend ${cost} gold. Existing unpurchased stock is kept after a purchase; remaining slots refill.`,
          () => {
            if (
              this.run.gold < cost ||
              cost !== SHOP_REROLL_COST + this.scene.shopRerollCount * SHOP_REROLL_ESCALATION
            )
              return { ok: false, reason: 'Shop changed. Review the cost again.' };
            if (!this.controller.rerollShop()) return { ok: false, reason: 'Not enough gold.' };
            return this.complete({ ok: true, message: 'Shop restocked.' });
          },
        ),
      );
      reroll.disabled = this.run.gold < cost;
      actions.append(reroll);
    }
    actions.append(
      button('View map', () => this.scene._enterShopMapView()),
      button('Roster', () => this.roster()),
    );
    footer.append(status, actions);
    body.append(tabs, split, footer);
    stock.scrollTop = scroll;
    if (focus)
      [...body.querySelectorAll('[data-shop-focus]')]
        .find((b) => b.dataset.shopFocus === focus)
        ?.focus();
  }
  details(container, row) {
    const { item } = row;
    const copy = el('div', null, 'shop-copy re-scroll');
    copy.append(el('h3', item.name));
    const meta = [item.tier, item.type, item.rankRequired ? `Requires ${item.rankRequired}` : null]
      .filter(Boolean)
      .join(' · ');
    copy.append(el('p', meta, 'shop-meta'));
    const detailText = this.controller._getShopItemDetailText(row.entry || { item });
    copy.append(
      el(
        'p',
        detailText
          .replace(/\bMt:/g, 'Might:')
          .replace(/\bCrt:/g, 'Crit:')
          .replace(/\bWt:/g, 'Weight:')
          .replace(/\bRng:/g, 'Range:'),
        'shop-mechanics',
      ),
    );
    appendItemArtDetails(copy, item, this.scene.gameData.weaponArts?.arts || []);
    if (item.might != null || item.type === 'Staff') {
      const comparisons = el('details');
      comparisons.append(el('summary', 'Compare with your roster'));
      for (const unit of this.run.roster.filter((u) => canEquip(u, item)))
        comparisons.append(el('p', `${unit.name}: ${equipmentComparison(unit, item)}`));
      copy.append(comparisons);
    }
    const forge = getForgeDisplayInfo(item);
    if (forge.level)
      copy.append(
        el(
          'p',
          `Forge ${forge.level} · ${Object.entries(forge.bonuses)
            .filter(([, v]) => v)
            .map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`)
            .join(' · ')}`,
        ),
      );
    const imbue = getImbueDisplayInfo(item, this.scene.gameData.imbues);
    if (imbue) copy.append(el('p', `${imbue.name}: ${imbue.description}`));
    if (item.lore) {
      const lore = el('details', null, 'shop-lore');
      lore.append(el('summary', 'Item story'), el('p', item.lore));
      copy.append(lore);
    }
    const action = el('div', null, 'shop-commit');
    const tab = this.scene.activeShopTab;
    let reason = '';
    if (tab === 'buy') {
      reason = shopBuyBlock(this.run, this.scene.shopBuyItems, row.entry);
      const b = button(
        `Buy · ${row.entry.price} G`,
        () => this.buy(row.entry),
        're-btn re-btn--primary',
      );
      b.disabled = !!reason;
      action.append(b);
    } else if (tab === 'sell') {
      reason = shopSellBlock(this.run, row);
      const b = button(
        `Sell · ${getSellPrice(item)} G`,
        () =>
          this.confirm(
            `Sell ${item.name}?`,
            `${row.owner} loses this item. Receive ${getSellPrice(item)} gold.`,
            () => this.complete(sellShopItem(this.run, row)),
          ),
        're-btn re-btn--primary',
      );
      b.disabled = !!reason;
      action.append(b);
    } else {
      const options = this.forgeOptions();
      copy.append(
        el(
          'p',
          `${Math.max(0, options.forgeLimit - options.forgesUsed)} of ${options.forgeLimit} shop forges remaining.`,
        ),
      );
      const b = button('Choose forge', () => this.forge(item), 're-btn re-btn--primary');
      b.disabled = options.forgesUsed >= options.forgeLimit;
      if (b.disabled) reason = 'No forges remain at this shop.';
      action.append(b);
    }
    if (reason) action.prepend(el('p', reason, 'shop-reason'));
    container.append(copy, action);
  }
  persist() {
    this.controller._saveShopState();
    return saveServiceRun(this.scene);
  }
  complete(result) {
    if (!result.ok) return result;
    this.scene.registry.get('audio')?.playSFX('sfx_gold');
    this.render((result.message || '') + this.persist());
    return result;
  }
  picker(options) {
    if (this.child || !this.surface) return;
    this.surface.root.inert = true;
    this.child = new ChoicePicker({
      scene: this.scene,
      ...options,
      onClose: () => {
        this.child = null;
        if (!this.surface || this.destroyed) return;
        this.surface.root.inert = false;
        this.render();
        (
          this.surface.body.querySelector('.shop-stock [aria-pressed="true"]') ||
          this.surface.body.querySelector('button')
        )?.focus();
      },
    });
  }
  confirm(title, text, apply) {
    this.picker({
      title,
      choices: [true],
      confirmation: true,
      label: () => title,
      describe: () => text,
      apply,
    });
  }
  buy(entry) {
    if (entry.type === 'accessory') {
      this.picker({
        title: `Buy and equip ${entry.item.name}`,
        choices: [...this.run.roster, 'pool'],
        label: (unit) => (unit === 'pool' ? 'Keep in shared pool' : unit.name),
        describe: (unit) =>
          `${entry.price} gold · ` +
          (unit === 'pool'
            ? 'Equip later.'
            : `Equip now${unit.accessory ? `; ${unit.accessory.name} returns to the shared pool` : ''}.`),
        blocked: () => shopBuyBlock(this.run, this.scene.shopBuyItems, entry),
        apply: (unit) =>
          this.complete(purchaseShopItem(this.run, this.scene.shopBuyItems, entry, unit)),
      });
      return;
    }
    if (entry.type === 'scroll') {
      this.confirm(
        `Buy ${entry.item.name}?`,
        `${entry.price} gold · Added to the team ${entry.type} pool.`,
        () => this.complete(purchaseShopItem(this.run, this.scene.shopBuyItems, entry)),
      );
      return;
    }
    const supply = entry.item.type === 'Consumable';
    this.picker({
      title: `Give ${entry.item.name} to`,
      choices: [...this.run.roster]
        .sort(
          (a, b) =>
            Number(!supply && !canEquip(a, entry.item)) -
            Number(!supply && !canEquip(b, entry.item)),
        )
        .concat('convoy'),
      label: (unit) => (unit === 'convoy' ? 'Convoy' : unit.name),
      describe: (unit) => {
        if (unit === 'convoy') return `${entry.price} gold · Store for later.`;
        const count = supply ? (unit.consumables || []).length : (unit.inventory || []).length;
        const max = supply ? CONSUMABLE_MAX : INVENTORY_MAX;
        return `${supply ? 'Supplies' : 'Items'} ${count}/${max} · ${count >= max ? 'Full: sent to convoy' : supply ? 'Can carry' : canEquip(unit, entry.item) ? 'Can equip' : 'Cannot equip; can carry'} · ${entry.price} gold${!supply && canEquip(unit, entry.item) ? ` · ${equipmentComparison(unit, entry.item)}` : ''}`;
      },
      blocked: (unit) => {
        const reason = shopBuyBlock(this.run, this.scene.shopBuyItems, entry);
        if (reason) return reason;
        const full =
          unit === 'convoy' ||
          (supply
            ? (unit.consumables || []).length >= CONSUMABLE_MAX
            : (unit.inventory || []).length >= INVENTORY_MAX);
        return full && !this.run.canAddToConvoy(entry.item) ? 'No space in convoy.' : '';
      },
      apply: (unit) =>
        this.complete(purchaseShopItem(this.run, this.scene.shopBuyItems, entry, unit)),
    });
  }
  forgeOptions() {
    const blessing = Math.max(0, Math.min(0.95, this.run.getForgeCostDiscount?.() || 0));
    return {
      forgesUsed: this.scene.shopForgesUsed,
      forgeLimit:
        (SHOP_FORGE_LIMITS[this.run.currentAct] || 2) +
        (this.run.blessingRuntimeModifiers?.forgeLimitDelta || 0),
      discount: Math.min(
        0.95,
        this.scene._currentShopHasAmbushDiscount
          ? 1 - (1 - blessing) * AMBUSH_SHOP_DISCOUNT
          : blessing,
      ),
    };
  }
  forge(weapon) {
    const expectedLevel = weapon._forgeLevel || 0;
    const owner = this.run.roster.find((u) => u.inventory?.includes(weapon));
    const stats = [
      { key: 'might', label: '+1 Might' },
      { key: 'hit', label: '+5 Hit' },
      { key: 'crit', label: '+5 Crit' },
      { key: 'weight', label: '−1 Weight' },
    ];
    this.picker({
      title: `Forge ${weapon.name}`,
      choices: stats,
      label: (stat) => stat.label,
      describe: (stat) =>
        `${Math.max(1, Math.floor(getForgeCost(weapon, stat.key) * (1 - this.forgeOptions().discount)))} gold · ${getStatForgeCount(weapon, stat.key)}/${FORGE_STAT_CAP} upgrades${owner && stat.key === 'weight' ? ` · ${equipmentComparison(owner, { ...weapon, weight: Math.max(0, weapon.weight - 1) }, weapon)}` : ''}`,
      blocked: (stat) =>
        shopForgeBlock(this.run, weapon, stat.key, { ...this.forgeOptions(), expectedLevel }),
      apply: (stat) => {
        const result = forgeShopWeapon(this.run, weapon, stat.key, {
          ...this.forgeOptions(),
          expectedLevel,
        });
        if (result.ok) this.scene.shopForgesUsed++;
        return this.complete(result);
      },
    });
  }
  roster() {
    if (this.child) return;
    this.surface.root.inert = true;
    this.child = new MobileRosterSheet({
      scene: this.scene,
      units: this.run.roster,
      gameData: this.scene.gameData,
      run: this.run,
      onClose: () => {
        this.child.destroy();
        this.child = null;
        if (this.surface && !this.destroyed) {
          this.surface.root.inert = false;
          this.render(this.status + this.persist());
          this.surface.focusContent();
        }
      },
    });
  }
  leave() {
    if (!this.child) this.controller.leaveShopNode();
  }
  setVisible(visible) {
    if (visible) this.open();
    else {
      this.child?.destroy();
      this.child = null;
      this.surface?.destroy();
      this.surface = null;
    }
  }
  destroy() {
    this.destroyed = true;
    this.setVisible(false);
  }
}
