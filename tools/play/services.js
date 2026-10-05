// Route-map services for headless play (tools/play): the shop (with the ruins' wares and
// the caravan's), the church and the ruins. Each runs the production commands
// (ShopCommands, ChurchCommands, ChurchVow, RuinsCommands); the stock, pricing and
// restock mirror ShopController, which needs a scene.

import { generateShopInventory } from '../../src/engine/LootSystem.js';
import {
  forgeShopWeapon,
  purchaseShopItem,
  sellShopItem,
  shopBuyBlock,
  shopForgeBlock,
  shopOwnedItems,
  shopSellWarnings,
} from '../../src/engine/ShopCommands.js';
import {
  churchKindleBlock,
  churchPromoteCost,
  churchPromotionBlock,
  churchReviveBlock,
  kindleAtChurch,
  promoteAtChurch,
  reviveAtChurch,
} from '../../src/engine/ChurchCommands.js';
import {
  chooseRuinsPath,
  chosenLine,
  healAtRuins,
  reviveAtRuins,
  ruinsChoice,
  ruinsReviveBlock,
  ruinsServiceBlock,
} from '../../src/engine/RuinsCommands.js';
import {
  churchBlessingBlock,
  churchBlessingOffers,
  churchVow,
  churchVowLine,
  takeChurchBlessing,
} from '../../src/engine/ChurchVow.js';
import { forgePrice } from '../../src/engine/ForgeSystem.js';
import { getSellPrice } from '../../src/engine/LootSystem.js';
import { getReviveCost } from '../../src/engine/RunManager.js';
import { canEquip, canPromote, resolvePromotionTargets } from '../../src/engine/UnitManager.js';
import { healUnitFully } from '../../src/engine/UnitHealth.js';
import { kindlePrice } from '../../src/engine/EclipseSystem.js';
import {
  AMBUSH_SHOP_DISCOUNT,
  CARAVAN_SHOP_ITEM_COUNT_RANGE,
  RUINS_SHOP_ITEM_COUNT,
  RUINS_SHOP_ITEM_COUNT_FINAL,
  RUINS_SHOP_MARKUP,
  SHOP_FORGE_LIMITS,
  SHOP_REROLL_COST,
  SHOP_REROLL_ESCALATION,
} from '../../src/utils/constants.js';
import { PlayError, findItem, parseIndex, splitClauses } from './parse.js';
import { itemDetail } from './runView.js';

/** A command result: `lines` to show; `leave` set when the visit closed. */
const done = (lines, extra = {}) => ({ lines: [].concat(lines).filter(Boolean), ...extra });

function resultLines(result) {
  if (!result.ok) throw new PlayError(result.reason || 'Not possible.');
  return done(result.message || 'Done.');
}

function priced(items, multiplier) {
  return items.map((entry) => ({
    ...entry,
    price: Math.max(1, Math.floor((entry?.price || 0) * multiplier)),
  }));
}

export class ShopVisit {
  /**
   * @param {object} game
   * @param {object|null} node the shop or ruins node; null for the caravan
   * @param {{ruins?: boolean, caravan?: boolean, caravanActId?: string,
   *          ambushDiscount?: boolean, pendingAmbush?: boolean}} options
   */
  constructor(game, node, options = {}) {
    this.game = game;
    this.node = node;
    this.ruins = options.ruins === true;
    this.caravan = options.caravan === true && !node;
    this.options = options;
    this.kind = this.caravan ? 'caravan' : this.ruins ? 'ruins wares' : 'shop';
  }

  get rm() {
    return this.game.rm;
  }

  /** As ShopController.handleShop. Returns lines, and `skipped` for a blessing's skip. */
  open() {
    const rm = this.rm;
    const gd = this.game.gameData;
    const node = this.node;
    const pendingAmbush = !this.caravan && rm.getAmbushPendingNode?.()?.id === node?.id && !!node;
    const ambushDiscount =
      !this.caravan &&
      (this.options.ambushDiscount === true ||
        pendingAmbush ||
        (node?.isAmbush === true && node?.ambushCleared === true));
    if (!this.ruins && !this.caravan && rm.consumeSkipFirstShop()) {
      rm.markNodeComplete(node.id);
      if (pendingAmbush) rm.clearAmbushPendingNode(node.id);
      return done('Blessing effect: first shop skipped.', { skipped: true });
    }
    const cached = this.caravan ? rm.activeCaravanShop?.shopState : rm.getShopState?.(node.id);
    const actId = this.caravan ? this.options.caravanActId || rm.currentAct : rm.currentAct;
    this.actId = actId;
    let items;
    if (cached) items = cached.items;
    else {
      items = generateShopInventory(
        actId,
        gd.lootTables,
        gd.weapons,
        gd.consumables,
        gd.accessories,
        rm.roster,
        rm.getWeaponArtSpawnConfig(),
        {
          itemCountBonus: this.caravan ? 0 : rm.getShopItemCountDelta(),
          recentItemNames: this.caravan
            ? []
            : Object.values(rm.shopStateByNodeId || {}).flatMap((state) =>
                (state.items || []).map((entry) => entry.item?.name).filter(Boolean),
              ),
          shopCureGating: rm.difficultyModifiers?.shopCureGating,
          ...(this.ruins
            ? {
                itemCountRange:
                  rm.currentAct === 'finalBoss'
                    ? RUINS_SHOP_ITEM_COUNT_FINAL
                    : RUINS_SHOP_ITEM_COUNT,
              }
            : {}),
          ...(this.caravan
            ? { itemCountRange: CARAVAN_SHOP_ITEM_COUNT_RANGE, rareBias: true }
            : {}),
        },
      );
      items = this._price(items, { ruins: this.ruins, ambush: ambushDiscount });
    }
    this.stock = items.map((entry) => ({ ...entry }));
    this.forgesUsed = cached?.forgesUsed || 0;
    this.rerollCount = cached?.rerollCount || 0;
    this.originalSlotCount = cached?.originalSlotCount || this.stock.length;
    this.ambushActive =
      (cached?.ambushDiscountActive ?? ambushDiscount) === true || (!cached && pendingAmbush);
    if (this.caravan) {
      rm.activeCaravanShop = { actId, shopState: null };
      rm.pendingCaravanShop = null;
    }
    this._save();
    return done(`You enter the ${this.kind}.`);
  }

  _price(items, { ruins, ambush }) {
    const rm = this.rm;
    const diff = rm.getDifficultyModifier?.('shopPriceMultiplier', 1) || 1;
    const blessing = rm.getShopPriceDiscount?.() || 0;
    let out = priced(items, Math.max(0.1, diff * (1 - blessing)));
    if (ruins) out = priced(out, RUINS_SHOP_MARKUP);
    if (ambush) out = priced(out, AMBUSH_SHOP_DISCOUNT);
    return out;
  }

  _save() {
    const state = {
      items: this.stock,
      forgesUsed: this.forgesUsed,
      rerollCount: this.rerollCount,
      originalSlotCount: this.originalSlotCount,
      ambushDiscountActive: this.ambushActive,
    };
    if (this.caravan && this.rm.activeCaravanShop)
      this.rm.activeCaravanShop.shopState = structuredClone(state);
    else if (this.node) this.rm.saveShopState(this.node.id, state);
  }

  _forgeOptions() {
    const rm = this.rm;
    const blessing = Math.max(0, Math.min(0.95, rm.getForgeCostDiscount?.() || 0));
    return {
      forgesUsed: this.forgesUsed,
      forgeLimit:
        (SHOP_FORGE_LIMITS[rm.currentAct] || 2) +
        (rm.blessingRuntimeModifiers?.forgeLimitDelta || 0),
      discount: Math.min(
        0.95,
        this.ambushActive ? 1 - (1 - blessing) * AMBUSH_SHOP_DISCOUNT : blessing,
      ),
    };
  }

  get canForge() {
    return !this.ruins && !this.caravan;
  }

  get canRestock() {
    return !this.caravan;
  }

  view() {
    const rm = this.rm;
    const out = [`== ${this.kind.toUpperCase()} · ${rm.gold} gold ==`];
    if (this.ambushActive) out.push('Ambush discount active.');
    out.push('For sale:');
    if (!this.stock.length) out.push('  (sold out)');
    this.stock.forEach((entry, i) => {
      out.push(
        `  ${i + 1}. ${itemDetail(entry.item, this.game.gameData)} — ${entry.price} G${shopBuyBlock(rm, this.stock, entry) === 'Not enough gold.' ? ' (too dear)' : ''}`,
      );
    });
    out.push('Yours to sell:');
    shopOwnedItems(rm).forEach((row, i) => {
      out.push(`  s${i + 1}. ${row.item.name} (${row.owner}) — ${getSellPrice(row.item)} G`);
    });
    if (this.canForge) {
      const o = this._forgeOptions();
      out.push(`Forge: ${o.forgeLimit - o.forgesUsed} of ${o.forgeLimit} forge(s) left here.`);
    }
    if (this.canRestock)
      out.push(`Restock costs ${SHOP_REROLL_COST + this.rerollCount * SHOP_REROLL_ESCALATION} G.`);
    return out.join('\n');
  }

  help() {
    return [
      'buy <n|name> for <unit>|convoy   (by number or name; scrolls and accessories go to the team pools, an accessory "for <unit>" is equipped)',
      'sell s<n>                      (see the sell list)',
      this.canForge ? 'forge <unit> <weapon> might|hit|crit|weight' : null,
      this.canRestock ? 'restock' : null,
      'leave',
    ]
      .filter(Boolean)
      .join('\n');
  }

  exec(verb, words) {
    const rm = this.rm;
    switch (verb) {
      case 'buy': {
        const { head, clauses } = splitClauses(words, ['for', 'to']);
        // By number (the list renumbers after each purchase) or by name.
        const entry = /^#?\d+$/.test(head.join(' '))
          ? this.stock[parseIndex(head[0], this.stock.length, 'stock item')]
          : this.stock.find(
              (e) =>
                e.item ===
                findItem(
                  this.stock.map((x) => x.item),
                  head.join(' '),
                  'item for sale',
                ),
            );
        const who = clauses.for || clauses.to;
        const pool = entry.type === 'scroll' || entry.type === 'accessory';
        let recipient;
        if (!who) {
          if (pool) recipient = entry.type === 'accessory' ? 'pool' : null;
          else throw new PlayError('Buy for whom? "buy <n> for <unit>" or "for convoy".');
        } else if (who.toLowerCase() === 'convoy') recipient = 'convoy';
        else if (who.toLowerCase() === 'pool') recipient = 'pool';
        else recipient = this.game.resolveRosterUnit(who);
        const result = purchaseShopItem(rm, this.stock, entry, recipient);
        if (result.ok) this._save();
        const out = resultLines(result);
        // The menu says "Cannot equip; can carry": buying it is allowed, so say so.
        if (
          recipient &&
          typeof recipient === 'object' &&
          entry.item.type !== 'Consumable' &&
          !pool &&
          !canEquip(recipient, entry.item)
        )
          out.lines.push(
            `Note: ${recipient.name} cannot equip ${entry.item.name}; it is only carried.`,
          );
        return out;
      }
      case 'sell': {
        const rows = shopOwnedItems(rm);
        const token = String(words[0] || '').replace(/^s/i, '');
        const row = rows[parseIndex(token, rows.length, 'item to sell (s<n>)')];
        const warnings = shopSellWarnings(rm, row);
        const result = sellShopItem(rm, row);
        if (result.ok) this._save();
        const out = resultLines(result);
        if (warnings.length) out.lines.push(`Warning: ${warnings.map((w) => w.code).join(', ')}`);
        return out;
      }
      case 'forge': {
        if (!this.canForge) throw new PlayError(`No forge at the ${this.kind}.`);
        if (words.length < 3) throw new PlayError('forge <unit> <weapon> might|hit|crit|weight');
        const unit = this.game.resolveRosterUnit(words[0]);
        const stat = words[words.length - 1].toLowerCase();
        const weapon = findItem(unit.inventory, words.slice(1, -1).join(' '), 'weapon');
        const options = { ...this._forgeOptions(), expectedLevel: weapon._forgeLevel || 0 };
        const reason = shopForgeBlock(rm, weapon, stat, options);
        if (reason) throw new PlayError(reason);
        const cost = forgePrice(weapon, stat, options.discount);
        const result = forgeShopWeapon(rm, weapon, stat, options);
        if (result.ok) {
          this.forgesUsed++;
          this._save();
        }
        const out = resultLines(result);
        out.lines.push(`(${cost} G)`);
        return out;
      }
      case 'restock':
        return this._restock();
      case 'leave':
        return this.leave();
      default:
        throw new PlayError(`Unknown shop command "${verb}".\n${this.help()}`);
    }
  }

  /** As ShopController.rerollShop. */
  _restock() {
    if (!this.canRestock) throw new PlayError('The caravan does not restock.');
    const rm = this.rm;
    const gd = this.game.gameData;
    const cost = SHOP_REROLL_COST + this.rerollCount * SHOP_REROLL_ESCALATION;
    if (!rm.spendGold(cost)) throw new PlayError(`Restock costs ${cost} G.`);
    this.rerollCount++;
    const targetCount = Math.max(0, Number(this.originalSlotCount) || this.stock.length || 0);
    const currentItems = this.stock.slice();
    const hasPurchasedAny = currentItems.length < targetCount;
    const baseItems = hasPurchasedAny ? currentItems : [];
    const itemKey = (entry) =>
      `${entry?.type || entry?.item?.type || ''}|${entry?.item?.name || ''}`;
    const generate = () => {
      const generated = generateShopInventory(
        rm.currentAct,
        gd.lootTables,
        gd.weapons,
        gd.consumables,
        gd.accessories,
        rm.roster,
        rm.getWeaponArtSpawnConfig(),
        { shopCureGating: rm.difficultyModifiers?.shopCureGating },
      );
      return this._price(generated, { ruins: this.ruins, ambush: this.ambushActive });
    };
    const result = baseItems.slice(0, targetCount);
    const deferred = [];
    const seen = new Set(result.map(itemKey).filter(Boolean));
    const passes = Math.max(4, targetCount * 4);
    for (let pass = 0; result.length < targetCount && pass < passes; pass++) {
      for (const entry of generate()) {
        if (result.length >= targetCount) break;
        const key = itemKey(entry);
        if (hasPurchasedAny && key && seen.has(key)) {
          deferred.push(entry);
          continue;
        }
        result.push(entry);
        if (key) seen.add(key);
      }
    }
    while (result.length < targetCount && deferred.length > 0) result.push(deferred.shift());
    for (let pass = 0; result.length < targetCount && pass < passes; pass++) {
      for (const entry of generate()) {
        if (result.length >= targetCount) break;
        result.push(entry);
      }
    }
    if (result.length < targetCount) {
      const source = result.length > 0 ? result : currentItems;
      if (source.length > 0) {
        const seed = source[0];
        while (result.length < targetCount)
          result.push({ ...seed, item: seed?.item ? { ...seed.item } : seed.item });
      }
    }
    this.stock = result.slice(0, targetCount);
    this._save();
    return done(`Shop restocked for ${cost} G.`);
  }

  /** As ShopController.leaveShopNode. */
  leave() {
    const rm = this.rm;
    if (this.node) this._save();
    if (this.caravan) {
      rm.clearPendingCaravanShop();
      return done('You leave the caravan.', { leave: true });
    }
    if (this.ruins)
      return done('You return to the ruins sanctuary.', { leave: true, backToRuins: true });
    rm.clearAmbushPendingNode(this.node.id);
    rm.markNodeComplete(this.node.id);
    return done('You leave the shop.', { leave: true, completed: true });
  }
}

/** The church and the ruins sanctuary (ChurchMenu, both modes). */
export class ChurchVisit {
  constructor(game, node, { ruins = false } = {}) {
    this.game = game;
    this.node = node;
    this.ruins = ruins;
  }

  get rm() {
    return this.game.rm;
  }

  view() {
    const rm = this.rm;
    const gd = this.game.gameData;
    const id = this.node.id;
    const out = [`== ${this.ruins ? 'RUINS SANCTUARY' : 'CHURCH'} · ${rm.gold} gold ==`];
    if (this.ruins) {
      const path = ruinsChoice(rm, id);
      if (!path) {
        out.push('Rest or scavenge: the ruins allow only one, and the choice is final.');
        out.push(
          `  path rest     — heal every unit now (free); then revive the fallen for gold (${rm.fallenUnits.length} waiting). No wares.`,
        );
        out.push(
          `  path scavenge — buy and sell from the ruins' stock at +${Math.round((RUINS_SHOP_MARKUP - 1) * 100)}% prices. No healing or revival.`,
        );
        return out.join('\n');
      }
      out.push(chosenLine(path));
      if (path === 'scavenge') {
        out.push("  wares — browse the ruins' stock");
        return out.join('\n');
      }
    }
    out.push('  heal — heal every unit (free)');
    out.push(
      'Roster HP: ' + rm.roster.map((u) => `${u.name} ${u.currentHP}/${u.stats.HP}`).join(', '),
    );
    if (!this.ruins) {
      const config = rm.getEclipseConfig?.();
      const price = rm.isEclipseActive?.() && config ? kindlePrice(rm.currentAct, config) : null;
      if (price != null) {
        const reason = churchKindleBlock(rm, id);
        out.push(
          `  kindle — lift ${config.kindleAmount} Eclipse shadow for ${price} G (shadow now ${rm.eclipse.shadow})${reason ? ` [${reason}]` : ''}`,
        );
      }
    }
    out.push('Revive the fallen:');
    if (!rm.fallenUnits.length) out.push('  (no fallen allies)');
    for (const u of rm.fallenUnits) {
      const reason = this.ruins ? ruinsReviveBlock(rm, id, u) : churchReviveBlock(rm, u);
      out.push(
        `  revive ${u.name} — ${u.className} Lv${u.level}, ${getReviveCost(u)} G${reason ? ` [${reason}]` : ''}`,
      );
    }
    if (!this.ruins) {
      const vow = churchVow(rm, id);
      out.push(
        vow
          ? `Vow: ${churchVowLine(vow)}`
          : 'Vow: promote units here, or take a blessing — one per church.',
      );
      const eligible = rm.roster.filter(canPromote);
      out.push(
        `Promote (${churchPromoteCost({})} G, lords ${churchPromoteCost({ isLord: true })} G):`,
      );
      if (!eligible.length) out.push('  (no unit eligible; base classes promote from level 10)');
      for (const u of eligible) {
        const reason = churchPromotionBlock(rm, u, id, gd);
        const targets = resolvePromotionTargets(u, gd.classes, gd.lords) || [];
        out.push(
          `  promote ${u.name} <class> — ${u.className} Lv${u.level} -> ${targets.map((t) => t.name).join(' | ')}${reason ? ` [${reason}]` : ''}`,
        );
      }
      if (vow !== 'blessing') {
        const offers = churchBlessingOffers(rm, id, gd);
        if (offers.length) out.push("Blessings (free; taking one is this church's vow):");
        offers.forEach((b, i) => {
          const reason = churchBlessingBlock(rm, id, b.id, gd);
          out.push(`  bless ${i + 1} — ${b.name}: ${b.description}${reason ? ` [${reason}]` : ''}`);
        });
      }
    }
    return out.join('\n');
  }

  help() {
    if (this.ruins && !ruinsChoice(this.rm, this.node.id))
      return 'path rest | path scavenge | leave';
    if (this.ruins && ruinsChoice(this.rm, this.node.id) === 'scavenge') return 'wares | leave';
    return this.ruins
      ? 'heal | revive <name> | leave'
      : 'heal | revive <name> | promote <unit> [<class>] | bless <n> | kindle | leave';
  }

  exec(verb, words) {
    const rm = this.rm;
    const gd = this.game.gameData;
    const id = this.node.id;
    switch (verb) {
      case 'path': {
        if (!this.ruins) throw new PlayError('Only the ruins have paths.');
        const path = String(words[0] || '').toLowerCase();
        const result = chooseRuinsPath(rm, id, path);
        const out = resultLines(result);
        if (result.ok && path === 'scavenge') out.openWares = true;
        return out;
      }
      case 'wares': {
        if (!this.ruins) throw new PlayError('Only the ruins have wares.');
        const reason = ruinsServiceBlock(rm, id, 'wares');
        if (reason) throw new PlayError(reason);
        return done('', { openWares: true });
      }
      case 'heal': {
        if (this.ruins) return resultLines(healAtRuins(rm, id));
        for (const u of rm.roster) healUnitFully(u);
        return done('All units healed.');
      }
      case 'revive': {
        const unit = this.game.resolveUnitIn(words.join(' '), rm.fallenUnits, 'fallen ally');
        return resultLines(this.ruins ? reviveAtRuins(rm, id, unit) : reviveAtChurch(rm, unit));
      }
      case 'promote': {
        if (this.ruins) throw new PlayError('The ruins cannot promote.');
        const eligible = rm.roster.filter(canPromote);
        if (!words.length) throw new PlayError('promote <unit> [<class>]');
        // The unit is the longest leading run of words that names one.
        let unit = null;
        let rest = [];
        for (let n = words.length; n >= 1 && !unit; n--) {
          try {
            unit = this.game.resolveUnitIn(
              words.slice(0, n).join(' '),
              eligible,
              'unit eligible to promote',
            );
            rest = words.slice(n);
          } catch (err) {
            if (n === 1) throw err;
          }
        }
        const targets = resolvePromotionTargets(unit, gd.classes, gd.lords) || [];
        if (!targets.length) throw new PlayError('No available promotion class.');
        const want = rest.join(' ').toLowerCase();
        const target = want
          ? targets.find((t) => t.name.toLowerCase() === want) ||
            targets.find((t) => t.name.toLowerCase().startsWith(want))
          : targets.length === 1
            ? targets[0]
            : null;
        if (!target)
          throw new PlayError(
            `Promote ${unit.name} to which class? ${targets.map((t) => t.name).join(' | ')}`,
          );
        return resultLines(promoteAtChurch(rm, unit, id, target, gd));
      }
      case 'bless': {
        if (this.ruins) throw new PlayError('No altar in the ruins.');
        const offers = churchBlessingOffers(rm, id, gd);
        const blessing = offers[parseIndex(words[0], offers.length, 'blessing')];
        return resultLines(takeChurchBlessing(rm, id, blessing.id, gd));
      }
      case 'kindle':
        if (this.ruins) throw new PlayError('Only a church can kindle the sun.');
        return resultLines(kindleAtChurch(rm, id));
      case 'leave':
        rm.markNodeComplete(id);
        return done(`You leave the ${this.ruins ? 'ruins' : 'church'}.`, {
          leave: true,
          completed: true,
        });
      default:
        throw new PlayError(`Unknown command "${verb}" here.\n${this.help()}`);
    }
  }
}
