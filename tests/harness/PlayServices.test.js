// Headless play's route-map services (tools/play): each runs the production command
// modules, so these pin what the adapter adds around them: which commands reach them,
// what a visit remembers, and that a refusal costs nothing.

import { describe, it, expect } from 'vitest';
import { loadGameData } from '../testData.js';
import { Game } from '../../tools/play/game.js';
import { PlaySession } from '../../tools/play/session.js';
import { PlayError } from '../../tools/play/parse.js';
import { ShopVisit, ChurchVisit } from '../../tools/play/services.js';
import { ColosseumVisit } from '../../tools/play/colosseum.js';
import { getSellPrice } from '../../src/engine/LootSystem.js';
import { shopOwnedItems } from '../../src/engine/ShopCommands.js';
import { SHOP_REROLL_COST, SHOP_REROLL_ESCALATION } from '../../src/utils/constants.js';

const gameData = loadGameData();

async function startedGame(seed) {
  const game = new Game(gameData, { seed });
  await game.run(() => game.start());
  await game.run(() => game.exec('bless skip'));
  return game;
}

const nodeOfType = (game, type, extra = () => true) =>
  game.rm.nodeMap.nodes.find((n) => n.type === type && extra(n));

describe('ShopVisit', () => {
  it('buys for a unit, sells, restocks and keeps its stock when re-entered', async () => {
    const game = await startedGame(3);
    const rm = game.rm;
    rm.gold = 5000;
    const node = nodeOfType(game, 'shop', (n) => !n.isAmbush);
    rm.currentNodeId = node.id;
    await game.run(() => {
      const visit = new ShopVisit(game, node);
      visit.open();
      const edric = rm.roster.find((u) => u.name === 'Edric');
      // A weapon or a supply (scrolls and accessories go to the team pools).
      const n = visit.stock.findIndex((e) => e.type !== 'scroll' && e.type !== 'accessory');
      expect(n).toBeGreaterThanOrEqual(0);
      const entry = visit.stock[n];
      const bags = () => [...edric.inventory, ...edric.consumables].map((i) => i.name);
      const had = bags().filter((name) => name === entry.item.name).length;
      visit.exec('buy', [String(n + 1), 'for', 'Edric']);
      expect(bags().filter((name) => name === entry.item.name).length).toBe(had + 1);
      expect(rm.gold).toBe(5000 - entry.price);
      expect(visit.stock).not.toContain(entry);

      // Sell the first row of the sell list: its sell price is half its price.
      const goldBefore = rm.gold;
      const row = shopOwnedItems(rm)[0];
      visit.exec('sell', ['s1']);
      expect(rm.gold).toBe(goldBefore + getSellPrice(row.item));
      expect(getSellPrice(row.item)).toBe(Math.floor((row.item.price || 0) / 2));

      // Restock: 150, then 200, keeping the shop's slot count.
      const slots = visit.originalSlotCount;
      const g0 = rm.gold;
      visit.exec('restock', []);
      visit.exec('restock', []);
      expect(rm.gold).toBe(g0 - (2 * SHOP_REROLL_COST + SHOP_REROLL_ESCALATION));
      expect(visit.stock).toHaveLength(slots);

      const out = visit.exec('leave', []);
      expect(out.completed).toBe(true);
      expect(node.completed).toBe(true);
      const again = new ShopVisit(game, node);
      again.open();
      expect(again.stock.map((e) => [e.item.name, e.price])).toEqual(
        visit.stock.map((e) => [e.item.name, e.price]),
      );
      expect(again.rerollCount).toBe(2);
    });
  });

  it('refuses a purchase it cannot pay for and changes nothing', async () => {
    const game = await startedGame(3);
    const rm = game.rm;
    const node = nodeOfType(game, 'shop', (n) => !n.isAmbush);
    await game.run(() => {
      const visit = new ShopVisit(game, node);
      visit.open();
      rm.gold = 0;
      const stock = visit.stock.map((e) => e.item.name);
      expect(() => visit.exec('buy', ['1', 'for', 'Edric'])).toThrow(PlayError);
      expect(rm.gold).toBe(0);
      expect(visit.stock.map((e) => e.item.name)).toEqual(stock);
      expect(() => visit.exec('restock', [])).toThrow(PlayError);
    });
  });
});

describe('ChurchVisit', () => {
  it('heals everyone and completes the node on leaving; promotes no one too low', async () => {
    const game = await startedGame(3);
    const rm = game.rm;
    const node = nodeOfType(game, 'church');
    for (const u of rm.roster) u.currentHP = 1;
    await game.run(() => {
      const visit = new ChurchVisit(game, node);
      visit.exec('heal', []);
      for (const u of rm.roster) expect(u.currentHP).toBe(u.stats.HP);
      expect(() => visit.exec('promote', ['Edric'])).toThrow(PlayError);
      expect(visit.exec('leave', []).completed).toBe(true);
      expect(node.completed).toBe(true);
    });
  });

  it('the ruins allow one path: rest heals, then the wares stay shut', async () => {
    const game = await startedGame(3);
    const rm = game.rm;
    const node = nodeOfType(game, 'ruins');
    for (const u of rm.roster) u.currentHP = 1;
    await game.run(() => {
      const visit = new ChurchVisit(game, node, { ruins: true });
      expect(() => visit.exec('heal', [])).toThrow(PlayError);
      visit.exec('path', ['rest']);
      for (const u of rm.roster) expect(u.currentHP).toBe(u.stats.HP);
      expect(() => visit.exec('path', ['scavenge'])).toThrow(PlayError);
      expect(() => visit.exec('wares', [])).toThrow(PlayError);
    });
  });
});

describe('ColosseumVisit', () => {
  it('fights a bout to its end, counting the fight, and hires one mercenary per visit', async () => {
    const game = await startedGame(3);
    const rm = game.rm;
    rm.gold = 5000;
    const node = nodeOfType(game, 'colosseum');
    await game.run(() => {
      const visit = new ColosseumVisit(game, node);
      const tier = visit.tiers()[0];
      visit.exec('arena', ['Edric', tier.name]);
      expect(visit.challenger).not.toBeNull();
      // Stepping back costs nothing.
      visit.exec('back', []);
      expect(rm.gold).toBe(5000);
      visit.exec('arena', ['Edric', tier.name]);
      visit.exec('fight', []);
      for (let i = 0; i < 20 && visit.bout; i++) visit.exec('next', []);
      expect(visit.bout).toBeNull();
      expect(visit.fightsPerUnit.Edric).toBe(1);
      expect(node.colosseumState.fightsPerUnit.Edric).toBe(1);
      const edric = rm.roster.find((u) => u.name === 'Edric');
      expect(edric.currentHP).toBeGreaterThanOrEqual(1);

      visit.exec('mercs', []);
      const [first] = visit.mercCandidates;
      const size = rm.roster.length;
      const gold = rm.gold;
      visit.exec('hire', ['1']);
      expect(rm.roster).toHaveLength(size + 1);
      expect(rm.gold).toBe(gold - first.hireCost);
      expect(() => visit.exec('hire', ['2'])).toThrow(PlayError);
      expect(visit.exec('leave', []).leave).toBe(true);
      expect(node.completed).toBe(true);
    });
  });
});

describe('route map roster commands', () => {
  it('store, withdraw, give and equip move items as the roster does', async () => {
    const session = await PlaySession.create(gameData, { seed: 3 });
    await session.exec('bless skip');
    const rm = session.game.rm;
    const names = (u) => u.inventory.map((w) => w.name);
    const edric = rm.roster.find((u) => u.name === 'Edric');
    const gaspar = rm.roster.find((u) => u.name === 'Gaspar');
    await session.exec('store Edric Steel Sword');
    expect(names(edric)).not.toContain('Steel Sword');
    expect(rm.getConvoyItems().weapons.map((w) => w.name)).toContain('Steel Sword');
    await session.exec('withdraw Gaspar Steel Sword');
    expect(names(gaspar)).toContain('Steel Sword');
    await session.exec('equip Gaspar Steel Sword');
    expect(gaspar.weapon.name).toBe('Steel Sword');
    await session.exec('give Gaspar Steel Sword to Edric');
    expect(names(edric)).toContain('Steel Sword');
    await expect(session.exec('use Edric Vulnerary')).rejects.toBeInstanceOf(PlayError);
  });
});

describe('battle spoils', () => {
  it('skip pays the skip gold; a gold choice pays its gold', async () => {
    for (const choose of ['skip', 'gold']) {
      const session = await PlaySession.create(gameData, { seed: 7, invincible: true });
      for (const cmd of ['bless skip', `go act1_0_2`, 'auto battle']) await session.exec(cmd);
      expect(session.phase).toBe('reward');
      const rm = session.game.rm;
      const record = rm.pendingBattleReward;
      const gold = rm.gold;
      if (choose === 'skip') {
        await session.exec('skip');
        expect(rm.gold).toBe(gold + record.skipGold);
      } else {
        const index = record.choices.findIndex((c) => c.type === 'gold');
        expect(index).toBeGreaterThanOrEqual(0);
        await session.exec(`take ${index + 1}`);
        expect(rm.gold).toBe(gold + record.choices[index].goldAmount);
      }
      expect(rm.pendingBattleReward).toBeNull();
      expect(session.phase).toBe('map');
    }
  });
});
