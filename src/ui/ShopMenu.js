import { shopRequirementLabel, forgeImpactSuffix, repairImpactSuffix } from './itemDecisionText.js';
import { equipmentComparison } from './equipmentComparison.js';
import { appendItemArtDetails } from './ItemArtDetails.js';
import { ContextHelp } from './ContextHelp.js';
import { equippedBadgeElement } from './equippedBadge.js';
import { itemKeywordRow, itemKeywordText } from './itemKeywordChips.js';
import { itemBaseLine } from '../engine/ItemKeywords.js';
import { saveServiceRun } from './serviceSave.js';
import { MenuSurface, element as el, button } from './MenuSurface.js';
import { ChoicePicker } from './ChoicePicker.js';
import { unitPortrait } from './unitPortrait.js';
import { MobileRosterSheet } from './MobileRosterSheet.js';
import { tradeWarningText } from './tradeMenuModel.js';
import { TRADE_WARNINGS } from '../engine/ItemTrade.js';
import {
  shopOwnedItems,
  shopBuyBlock,
  purchaseShopItem,
  shopSellBlock,
  shopSellRisk,
  sellRiskLabel,
  SELL_RISKS,
  shopSellWarnings,
  sellShopItem,
  shopForgeBlock,
  forgeShopWeapon,
  shopRepairBlock,
  repairShopWeapon,
} from '../engine/ShopCommands.js';
import { isWorn, wearCount, wearDisplay, repairPrice } from '../engine/WeaponWear.js';
import {
  canForge,
  forgePrice,
  getForgeDisplayInfo,
  getStatForgeCount,
} from '../engine/ForgeSystem.js';
import { getSellPrice } from '../engine/LootSystem.js';
import { canEquip } from '../engine/UnitManager.js';
import { getImbueDisplayInfo } from '../engine/ImbueSystem.js';
import { itemUsageShort, itemUsageText } from '../engine/ItemUsage.js';
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
import { itemIcon, itemHero } from './itemIcons.js';
import {
  applyServiceVignette,
  serviceVignetteFor,
  prefersStill,
  vignetteMotes,
} from './itemMoments.js';

/** "Worn 2/3 · Dulled −1 Might · Bent −5 Hit": the wear, by name, on a shop card. */
function wearDisplayText(weapon) {
  const { count, max, steps } = wearDisplay(weapon);
  const named = steps.map((step) => `${step.label} ${step.effect}`);
  return [`Worn ${count}/${max}`, ...named].join(' \u00b7 ');
}

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
  /** Catalogs the equip comparison names arts and imbues from. */
  compareOptions() {
    const data = this.scene.gameData || {};
    return { arts: data.weaponArts?.arts || [], imbues: data.imbues };
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
      : // A worn weapon is repaired here instead of forged (the forge tab lists both).
        rows.filter((row) => canForge(row.item) || isWorn(row.item));
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
    // The place: a painted vignette (header band on desktop, behind the detail on phones);
    // the forge tab swaps to the forge and its sparks.
    const tabList = this.controller._getShopTabs();
    const band = applyServiceVignette(
      this.surface.root,
      serviceVignetteFor({
        caravan: this.scene._currentShopIsCaravan,
        ruins: this.scene._currentShopIsRuins,
        tab: this.scene.activeShopTab,
      }),
      {
        title: this.surface.header.querySelector('h2')?.textContent || '',
        kicker: tabList.map((t) => t.label).join(' · '),
        still: prefersStill(this.scene),
      },
    );
    body.append(band);
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
    // The prologue's Market and a caravan have no Restock: their lines never offer it.
    const canRestock = this.controller.canReroll?.() !== false && !this.scene._currentShopIsCaravan;
    stock.setAttribute('aria-label', 'Shop items');
    if (!rows.length)
      stock.append(
        el(
          'p',
          this.scene.activeShopTab === 'buy'
            ? canRestock
              ? 'Sold out. You can restock or leave.'
              : 'Sold out.'
            : 'No eligible items.',
        ),
      );
    // Out of reach reads as out of reach: the row's price turns warn, and a stock
    // the purse can't touch says so (a forge's cost can empty the purse; playtest
    // Sep 2026 read that as "forging turned off buying").
    const short = (row) =>
      this.scene.activeShopTab === 'buy' && Number(row.entry?.price) > this.run.gold;
    if (rows.length && rows.every(short))
      stock.append(
        el(
          'p',
          `Nothing here is within ${this.run.gold} G. ${canRestock ? 'Sell, restock or leave.' : 'Sell or leave.'}`,
          'shop-reason shop-reason--gold',
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
      if (short(row)) b.classList.add('is-short');
      b.setAttribute('aria-pressed', String(row.item === this.selected));
      const selling = this.scene.activeShopTab === 'sell';
      const sub =
        this.scene.activeShopTab === 'buy'
          ? [`${row.entry.price} G`, row.item.type, itemKeywordText(row.item)]
              .filter(Boolean)
              .join(' · ')
          : selling
            ? // How much it has been used: "Edric · +875 G · 14 strikes".
              [row.owner, `+${getSellPrice(row.item)} G`, itemUsageShort(row.item)]
                .filter(Boolean)
                .join(' · ')
            : isWorn(row.item)
              ? `${row.owner} · Worn ${wearCount(row.item)}/${wearDisplay(row.item).max}`
              : `${row.owner} · Forge ${row.item._forgeLevel || 0}`;
      const name = el('strong', row.item.name);
      if (row.kind === 'inventory' && row.unit?.weapon === row.item)
        name.append(equippedBadgeElement((tag) => el(tag)));
      const text = el('span', null, 'shop-row-text');
      text.append(name, el('span', sub));
      // Selling someone's only weapon (or staff, or bow) reads on the row itself,
      // before it is chosen; spares, supplies and the convoy carry no tag.
      const risks = selling ? this.riskTags(row) : null;
      if (risks) text.append(risks);
      b.append(itemIcon(row.item, { size: 32 }), text);
      stock.append(b);
    });
    const detail = el('article', null, 'shop-detail ia-pane');
    const paneMotes = vignetteMotes(this.surface.root.dataset.vignette);
    if (paneMotes) detail.append(paneMotes);
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
    if (this.scene.activeShopTab === 'buy' && canRestock) {
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
    // The item, large: its painting (or pixel icon at 2x) beside the name and its kind.
    const head = el('div', null, 'shop-hero');
    const title = el('div', null, 'shop-hero-title');
    // What it is ("Silver Lance", "Legend Sword"), then its rules as tags.
    const kicker = itemBaseLine(item) || [item.tier, item.type].filter(Boolean).join(' · ');
    if (kicker) title.append(el('p', kicker, 'shop-kicker'));
    title.append(el('h3', item.name));
    const keys = itemKeywordRow(item, { baseLine: false, make: (tag) => el(tag) });
    if (keys) title.append(keys);
    const requirement = shopRequirementLabel(item);
    if (requirement) title.append(el('p', requirement, 'shop-meta'));
    head.append(itemHero(item, { size: 96 }), title);
    copy.append(head);
    const detailText = this.controller._getShopItemDetailText(row.entry || { item });
    // What it does reads beside the picture, so a phone shows it without scrolling.
    title.append(
      el(
        'p',
        // The kicker already names the type; drop it from the numbers' first line.
        detailText
          .replace(new RegExp(`^${item.type}\\n`), '')
          .replace(/\bMt:/g, 'Might:')
          .replace(/\bCrt:/g, 'Crit:')
          .replace(/\bWt:/g, 'Weight:')
          .replace(/\bRng:/g, 'Range:'),
        'shop-mechanics',
      ),
    );
    // How much this very item has been used, beside its numbers (a sale decides on it).
    const usage = this.scene.activeShopTab === 'buy' ? '' : itemUsageText(item);
    if (usage) title.append(el('p', usage, 'shop-usage'));
    if (item.lore) copy.append(el('p', item.lore, 'shop-lore'));
    appendItemArtDetails(copy, item, this.scene.gameData.weaponArts?.arts || [], {
      openHelp: (title, blocks) => this.openHelp(title, blocks),
    });
    if (item.might != null || item.type === 'Staff') {
      const comparisons = el('details');
      comparisons.append(el('summary', 'Compare with your roster'));
      for (const unit of this.run.roster.filter((u) => canEquip(u, item)))
        comparisons.append(
          el(
            'p',
            `${unit.name}: ${equipmentComparison(unit, item, unit.weapon, this.compareOptions())}`,
          ),
        );
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
    if (isWorn(item)) copy.append(el('p', wearDisplayText(item), 'shop-wear'));
    const imbue = getImbueDisplayInfo(item, this.scene.gameData.imbues);
    if (imbue) copy.append(el('p', `${imbue.name}: ${imbue.description}`));
    const action = el('div', null, 'shop-commit');
    const tab = this.scene.activeShopTab;
    let reason = '';
    let goldShort = false;
    if (tab === 'buy') {
      reason = shopBuyBlock(this.run, this.scene.shopBuyItems, row.entry);
      const b = button(
        `Buy · ${row.entry.price} G`,
        () => this.buy(row.entry),
        're-btn re-btn--primary',
      );
      b.disabled = !!reason;
      goldShort = reason === 'Not enough gold.';
      if (goldShort) {
        reason = `Not enough gold: ${row.entry.price - this.run.gold} G short.`;
        b.classList.add('shop-buy--short');
      }
      action.append(b);
    } else if (tab === 'sell') {
      reason = shopSellBlock(this.run, row);
      // Selling the last weapon is allowed; say what it costs before and at the confirm.
      // The last weapon of a type is a note (muted), not a warning; the confirm's
      // plain text says both.
      const warnings = shopSellWarnings(this.run, row).filter((w) => tradeWarningText(w));
      const sentence = (w) => `${tradeWarningText(w)}.`;
      const soft = (w) => w.code === TRADE_WARNINGS.leavesNoType;
      const warning = warnings.map(sentence).join(' ');
      const b = button(
        `Sell · ${getSellPrice(item)} G`,
        () =>
          this.confirm(
            `Sell ${item.name}?`,
            `${row.owner} loses this item.${warning ? ` ${warning}` : ''} Receive ${getSellPrice(item)} gold.`,
            () => this.complete(sellShopItem(this.run, row)),
          ),
        're-btn re-btn--primary',
      );
      b.disabled = !!reason;
      if (warning && !reason) {
        b.setAttribute('aria-description', warning);
        const hard = warnings
          .filter((w) => !soft(w))
          .map(sentence)
          .join(' ');
        const note = warnings.filter(soft).map(sentence).join(' ');
        if (hard) action.append(el('p', hard, 'shop-warning'));
        if (note) action.append(el('p', note, 'shop-warning is-soft'));
      }
      action.append(b);
    } else {
      const options = this.forgeOptions();
      copy.append(
        el(
          'p',
          `${Math.max(0, options.forgeLimit - options.forgesUsed)} of ${options.forgeLimit} shop forges remaining.`,
        ),
      );
      if (isWorn(item)) {
        // A worn weapon shows Repair in place of the forge stats; it spends a forge use.
        const price = repairPrice(item, options.discount);
        const b = button(`Repair · ${price} G`, () => this.repair(item), 're-btn re-btn--primary');
        reason = shopRepairBlock(this.run, item, options);
        b.disabled = !!reason;
        goldShort = reason === 'Not enough gold.';
        if (goldShort) {
          reason = `Not enough gold: ${price - this.run.gold} G short.`;
          b.classList.add('shop-buy--short');
        }
        action.append(b);
      } else {
        const b = button('Choose forge', () => this.forge(item), 're-btn re-btn--primary');
        b.disabled = options.forgesUsed >= options.forgeLimit;
        if (b.disabled) reason = 'No forges remain at this shop.';
        action.append(b);
      }
    }
    if (reason)
      action.prepend(el('p', reason, goldShort ? 'shop-reason shop-reason--gold' : 'shop-reason'));
    container.append(copy, action);
  }
  /** The sell row's risk tags ("Only weapon", "Only staff", "Only bow"), or null. */
  riskTags(row) {
    const risks = shopSellRisk(this.run, row).filter((risk) => sellRiskLabel(risk));
    if (!risks.length) return null;
    const tags = el('span', null, 'shop-risks');
    for (const risk of risks) {
      const tag = el('span', sellRiskLabel(risk), 'shop-risk');
      // The last weapon or staff is a hard warning; the last of a type is a note.
      tag.classList.add(risk.code === SELL_RISKS.onlyType ? 'is-soft' : 'is-hard');
      tag.dataset.risk = risk.code;
      tags.append(tag);
    }
    return tags;
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
  /** The unit's face for a chooser row (null for the pool / convoy rows). */
  face(unit) {
    if (!unit || typeof unit !== 'object') return null;
    try {
      return unitPortrait(this.scene, this.scene.gameData, unit, 'mr-unit-face');
    } catch {
      return null; // decoration only
    }
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
        face: (unit) => this.face(unit),
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
      face: (unit) => this.face(unit),
      describe: (unit) => {
        if (unit === 'convoy') return `${entry.price} gold · Store for later.`;
        const count = supply ? (unit.consumables || []).length : (unit.inventory || []).length;
        const max = supply ? CONSUMABLE_MAX : INVENTORY_MAX;
        return `${supply ? 'Supplies' : 'Items'} ${count}/${max} · ${count >= max ? 'Full: sent to convoy · trade it in from Roster' : supply ? 'Can carry' : canEquip(unit, entry.item) ? 'Can equip' : 'Cannot equip; can carry'} · ${entry.price} gold${!supply && canEquip(unit, entry.item) ? ` · ${equipmentComparison(unit, entry.item, unit.weapon, this.compareOptions())}` : ''}`;
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
  /** Mend the most recent wear step: one confirm naming the stat, the cost and the forge use. */
  repair(weapon) {
    const expectedWear = wearCount(weapon);
    const owner = this.run.roster.find((u) => u.inventory?.includes(weapon));
    const step = wearDisplay(weapon).steps.at(-1);
    const price = repairPrice(weapon, this.forgeOptions().discount);
    this.confirm(
      `Repair ${weapon.name}?`,
      `${step.label}: restores ${step.restore}${repairImpactSuffix(owner, weapon)}. ${price} gold and one shop forge.`,
      () => {
        const options = { ...this.forgeOptions(), expectedWear };
        const result = repairShopWeapon(this.run, weapon, options);
        if (result.ok) this.scene.shopForgesUsed++;
        return this.complete(result);
      },
    );
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
        `${forgePrice(weapon, stat.key, this.forgeOptions().discount)} gold · ${getStatForgeCount(weapon, stat.key)}/${FORGE_STAT_CAP} upgrades${forgeImpactSuffix(owner, weapon, stat.key)}`,
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
  /** Shared rules (weapon arts, scrolls) over the shop, which keeps its place. */
  openHelp(title, blocks) {
    if (this.child || !this.surface) return;
    const focus = document.activeElement;
    this.child = new ContextHelp(this.scene, this.surface.root, title, blocks, () => {
      this.child = null;
      focus?.focus?.();
    });
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
