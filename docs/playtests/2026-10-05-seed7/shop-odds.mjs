// How often did the seed-7 pilot's shops offer an answer to armour? Run from the repo:
//
//   node docs/playtests/2026-10-05-seed7/shop-odds.mjs [samples]
//
// It replays the pilot (replay/session.json, digests checked) and, at each shop the
// run opened, takes what that shop's stock was drawn from: the act, the army as it
// stood (proficiencies decide which weapons can appear), the shop's count bonus, the
// names stocked by earlier shops (a shop avoids repeating them), the difficulty's cure
// gating and whether it is ruins or a caravan. Then it draws that stock again
// `samples` times on fresh random streams, exactly as ShopVisit.open does.
//
// Two answers:
//   per visit  the chance that a shop with this one's history stocks an anti-armour
//              weapon (a special that is "Effective vs ... Armored")
//   the route  the chance that none of the run's shops before the elite did, drawn in
//              order, each shop's history taken from the shops drawn before it in the
//              same sample: no assumption that shops are independent
//
// Held fixed (so the route figure is for this army and this path, not for the game):
// the route, the army at each visit, and restocks (the pilot's are listed, not drawn).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameData } from '../../../tests/testData.js';
import { PlaySession } from '../../../tools/play/session.js';
import { generateShopInventory } from '../../../src/engine/LootSystem.js';
import { createSeededRng } from '../../../src/engine/BlessingEngine.js';
import {
  CARAVAN_SHOP_ITEM_COUNT_RANGE,
  RUINS_SHOP_ITEM_COUNT,
  RUINS_SHOP_ITEM_COUNT_FINAL,
} from '../../../src/utils/constants.js';

const here = dirname(fileURLToPath(import.meta.url));
const samples = Number(process.argv[2]) || 4000;
const gameData = loadGameData();
const record = JSON.parse(readFileSync(join(here, 'replay', 'session.json'), 'utf8'));

const antiArmour = (item) => /Effective vs [^(]*Armored/i.test(item?.special || '');

// 1. The shops the pilot opened, with what each one's stock was drawn from.
const visits = [];
let seen = null;
await PlaySession.fromRecord(gameData, record, {
  onEntry: (i, entry, _digest, s) => {
    const g = s.game;
    if (g.phase !== 'shop' || g.visit === seen || !g.visit?.stock) return;
    seen = g.visit;
    const rm = g.rm;
    const v = g.visit;
    visits.push({
      at: i + 1,
      node: v.node?.id ?? 'caravan',
      act: v.actId,
      ruins: v.ruins,
      caravan: v.caravan,
      roster: structuredClone(rm.roster),
      artConfig: rm.getWeaponArtSpawnConfig(),
      countBonus: v.caravan ? 0 : rm.getShopItemCountDelta(),
      cureGating: rm.difficultyModifiers?.shopCureGating,
      stocked: v.stock.map((e) => e.item?.name),
      stockedAnswer: v.stock.filter((e) => antiArmour(e.item)).map((e) => e.item.name),
    });
  },
});
const restocks = record.log.filter((e) => /^restock\b/.test(e.cmd)).length;

function draw(visit, recent, rng) {
  const prev = Math.random;
  Math.random = rng;
  try {
    return generateShopInventory(
      visit.act,
      gameData.lootTables,
      gameData.weapons,
      gameData.consumables,
      gameData.accessories,
      visit.roster,
      visit.artConfig,
      {
        itemCountBonus: visit.countBonus,
        recentItemNames: visit.caravan ? [] : recent,
        shopCureGating: visit.cureGating,
        ...(visit.ruins
          ? {
              itemCountRange:
                visit.act === 'finalBoss' ? RUINS_SHOP_ITEM_COUNT_FINAL : RUINS_SHOP_ITEM_COUNT,
            }
          : {}),
        ...(visit.caravan ? { itemCountRange: CARAVAN_SHOP_ITEM_COUNT_RANGE, rareBias: true } : {}),
      },
    );
  } finally {
    Math.random = prev;
  }
}

// 2. Per visit: this shop's chance, given the stock the run's earlier shops really had.
console.log(`Seed-7 pilot: ${visits.length} shop(s) opened, ${restocks} restock(s) bought.`);
for (const [k, v] of visits.entries()) {
  const recent = visits.slice(0, k).flatMap((x) => (x.caravan ? [] : x.stocked));
  let hits = 0;
  for (let n = 0; n < samples; n++)
    if (draw(v, recent, createSeededRng(1_000_003 * (k + 1) + n)).some((e) => antiArmour(e.item)))
      hits++;
  console.log(
    `  ${v.node} (${v.act}${v.ruins ? ', ruins' : ''}${v.caravan ? ', caravan' : ''}, command ${v.at}): ${((100 * hits) / samples).toFixed(1)}% stock an anti-armour weapon; this run's stocked ${v.stockedAnswer.join(', ') || 'none'}`,
  );
}

// 3. The route: every shop drawn in order within one sample, history included.
let none = 0;
for (let n = 0; n < samples; n++) {
  const rng = createSeededRng(7_000_001 + n);
  const recent = [];
  let any = false;
  for (const v of visits) {
    const stock = draw(v, recent, rng);
    if (stock.some((e) => antiArmour(e.item))) any = true;
    if (!v.caravan) recent.push(...stock.map((e) => e.item?.name).filter(Boolean));
  }
  if (!any) none++;
}
console.log(
  `Route: ${((100 * none) / samples).toFixed(1)}% of ${samples} draws of these ${visits.length} shops, in order, stock no anti-armour weapon at all (this army, this path, no restocks drawn).`,
);
