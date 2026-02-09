// Economy Flow Simulator — Gold flow, spending strategies, meta-progression impact
// Usage: node sim/economy.js [--trials N] [--seed S] [--csv] [--meta LEVEL]

import { installSeed, restoreMathRandom } from './lib/SeededRNG.js';
import { getData } from './lib/SimUnitFactory.js';
import { printTable, toCSV, parseArgs, printRecommendations, printHeader, percentiles, meanStd } from './lib/TableFormatter.js';
import { calculateKillGold, calculateBattleGold, generateLootChoices, generateShopInventory } from '../src/engine/LootSystem.js';
import { generateNodeMap } from '../src/engine/NodeMapGenerator.js';
import {
  STARTING_GOLD, ACT_CONFIG, NODE_TYPES, GOLD_PER_KILL_BASE, GOLD_PER_LEVEL_BONUS,
  GOLD_BATTLE_BONUS, GOLD_BOSS_BONUS, GOLD_SKIP_LOOT_MULTIPLIER,
  DEPLOY_LIMITS, ENEMY_COUNT_OFFSET,
} from '../src/utils/constants.js';

const opts = parseArgs({ trials: 500, seed: 42, csv: false, meta: 0 });

if (opts.help) {
  console.log('Usage: node sim/economy.js [--trials N] [--seed S] [--csv] [--meta LEVEL]');
  console.log('  --meta 0: No meta upgrades (default)');
  console.log('  --meta 1: Partial meta (starting_gold L1, battle_gold L1)');
  console.log('  --meta 2: Mid meta (starting_gold L2, battle_gold L2, loot_quality L1)');
  console.log('  --meta 3: Full meta (all maxed)');
  process.exit(0);
}

const data = getData();
const issues = [];

// Meta-progression effects by level
function getMetaEffects(level) {
  if (level === 0) return { goldBonus: 0, battleGoldMultiplier: 0, lootWeaponWeightBonus: 0 };
  if (level === 1) return { goldBonus: 100, battleGoldMultiplier: 0.2, lootWeaponWeightBonus: 0 };
  if (level === 2) return { goldBonus: 200, battleGoldMultiplier: 0.4, lootWeaponWeightBonus: 10 };
  return { goldBonus: 300, battleGoldMultiplier: 0.4, lootWeaponWeightBonus: 20 }; // max
}

// Deploy+offset enemy count formula
function getEnemyCount(act, row, isBoss) {
  const deployCount = DEPLOY_LIMITS[act]?.max || 4;
  const actOffsets = ENEMY_COUNT_OFFSET[act];
  let offset;
  if (actOffsets) {
    if (isBoss && actOffsets.boss) offset = actOffsets.boss;
    else if (row !== undefined && actOffsets[row]) offset = actOffsets[row];
    else offset = actOffsets.default || [1, 2];
  } else {
    offset = [2, 3];
  }
  const [minOff, maxOff] = offset;
  return deployCount + minOff + Math.floor(Math.random() * (maxOff - minOff + 1));
}

// Estimate enemy level by act
function getEnemyLevel(act) {
  const pool = data.enemies.pools[act];
  if (!pool) return 5;
  const [min, max] = pool.levelRange;
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Simulate a full run's economy. Returns { goldByCheckpoint, canPromoteByMidAct2, totalGold, ... } */
function simulateRunEconomy(strategy, metaLevel) {
  const meta = getMetaEffects(metaLevel);
  let gold = STARTING_GOLD + meta.goldBonus;
  const checkpoints = {}; // act → gold
  let totalBattleGold = 0;
  let shopSpent = 0;
  let masterSealBought = false;
  let battleCount = 0;

  const acts = ['act1', 'act2', 'act3', 'finalBoss'];

  for (const act of acts) {
    const actConfig = ACT_CONFIG[act];
    const nodeMap = generateNodeMap(act, actConfig);

    // Walk a random path through the node map
    let currentId = nodeMap.startNodeId;
    const visited = new Set();

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const node = nodeMap.nodes.find(n => n.id === currentId);
      if (!node) break;

      if (node.type === NODE_TYPES.BATTLE || node.type === NODE_TYPES.BOSS || node.type === NODE_TYPES.RECRUIT) {
        battleCount++;
        const isBoss = node.type === NODE_TYPES.BOSS;
        const enemyCount = getEnemyCount(act, node.row, isBoss);

        // Calculate kill gold
        let killGold = 0;
        for (let i = 0; i < enemyCount; i++) {
          const enemyLvl = getEnemyLevel(act);
          killGold += calculateKillGold({ level: enemyLvl, isBoss: false });
        }
        if (isBoss) {
          killGold += GOLD_BOSS_BONUS;
        }

        let battleGold = calculateBattleGold(killGold);
        // Apply meta battle gold multiplier
        if (meta.battleGoldMultiplier > 0) {
          battleGold = Math.floor(battleGold * (1 + meta.battleGoldMultiplier));
        }
        totalBattleGold += battleGold;

        // Loot decision
        if (!isBoss) {
          const lootChoices = generateLootChoices(act, data.lootTables, data.weapons, data.consumables, 3, meta.lootWeaponWeightBonus);

          if (strategy === 'save-for-seal') {
            // Always take gold from loot if available, otherwise skip
            const goldLoot = lootChoices.find(c => c.type === 'gold');
            if (goldLoot) {
              battleGold += goldLoot.goldAmount;
            } else {
              // Skip loot for bonus gold
              battleGold += Math.floor(battleGold * (GOLD_SKIP_LOOT_MULTIPLIER - 1));
            }
          } else if (strategy === 'buy-weapons') {
            // Take weapon loot if available
            const weaponLoot = lootChoices.find(c => c.type === 'weapon' || c.type === 'rare');
            if (!weaponLoot) {
              const goldLoot = lootChoices.find(c => c.type === 'gold');
              if (goldLoot) battleGold += goldLoot.goldAmount;
            }
          } else {
            // balanced: take consumable > weapon > gold
            const consumableLoot = lootChoices.find(c => c.type === 'consumable');
            if (!consumableLoot) {
              const goldLoot = lootChoices.find(c => c.type === 'gold');
              if (goldLoot) battleGold += goldLoot.goldAmount;
            }
          }
        }

        gold += battleGold;
      }

      if (node.type === NODE_TYPES.SHOP) {
        const shopInv = generateShopInventory(act, data.lootTables, data.weapons, data.consumables);

        if (strategy === 'save-for-seal') {
          // Only buy Master Seal when affordable
          const seal = shopInv.find(i => i.item.name === 'Master Seal');
          if (seal && gold >= seal.price && !masterSealBought) {
            gold -= seal.price;
            shopSpent += seal.price;
            masterSealBought = true;
          }
        } else if (strategy === 'buy-weapons') {
          // Buy best affordable weapon
          const affordableWeapons = shopInv.filter(i => i.type === 'weapon' && gold >= i.price);
          if (affordableWeapons.length > 0) {
            const best = affordableWeapons.sort((a, b) => b.price - a.price)[0];
            gold -= best.price;
            shopSpent += best.price;
          }
        } else {
          // balanced: buy vulnerary + maybe a weapon if affordable
          const vuln = shopInv.find(i => i.item.name === 'Vulnerary');
          if (vuln && gold >= vuln.price) {
            gold -= vuln.price;
            shopSpent += vuln.price;
          }
          const affordableWeapons = shopInv.filter(i => i.type === 'weapon' && gold >= i.price);
          if (affordableWeapons.length > 0 && gold > 500) {
            const pick = affordableWeapons[0];
            gold -= pick.price;
            shopSpent += pick.price;
          }
        }
      }

      // Advance to next node
      if (node.edges.length > 0) {
        currentId = node.edges[Math.floor(Math.random() * node.edges.length)];
      } else {
        break;
      }
    }

    checkpoints[act] = gold;
  }

  return {
    goldByCheckpoint: checkpoints,
    totalBattleGold,
    shopSpent,
    masterSealBought,
    finalGold: gold,
    battleCount,
    canPromoteMidAct2: checkpoints.act1 >= 2500 || (checkpoints.act2 >= 2500),
  };
}

// ─── Run simulations for each strategy ───

const strategies = ['save-for-seal', 'buy-weapons', 'balanced'];
const metaLevel = opts.meta;

for (const strategy of strategies) {
  installSeed(opts.seed);
  printHeader(`Economy: "${strategy}" strategy (meta=${metaLevel}, N=${opts.trials})`);

  const results = [];
  for (let t = 0; t < opts.trials; t++) {
    results.push(simulateRunEconomy(strategy, metaLevel));
  }

  // Gold at each checkpoint
  const acts = ['act1', 'act2', 'act3', 'finalBoss'];
  const cpRows = acts.map(act => {
    const golds = results.map(r => r.goldByCheckpoint[act] || 0);
    const pcts = percentiles(golds);
    const { mean } = meanStd(golds);
    return { Act: act, Mean: Math.floor(mean), ...Object.fromEntries(Object.entries(pcts).map(([k, v]) => [k, Math.floor(v)])) };
  });

  if (opts.csv) {
    toCSV(['Act', 'Mean', 'P10', 'P25', 'P50', 'P75', 'P90'], cpRows);
  } else {
    printTable(['Act', 'Mean', 'P10', 'P25', 'P50', 'P75', 'P90'], cpRows);
  }

  // Promotion affordability
  const sealRate = results.filter(r => r.masterSealBought || r.canPromoteMidAct2).length / results.length * 100;
  const avgBattleGold = meanStd(results.map(r => r.totalBattleGold));
  const avgShopSpent = meanStd(results.map(r => r.shopSpent));
  const avgBattles = meanStd(results.map(r => r.battleCount));

  console.log(`  Promotion affordable (by Act 2 end): ${sealRate.toFixed(1)}%`);
  console.log(`  Avg battle gold earned: ${avgBattleGold.mean.toFixed(0)} ± ${avgBattleGold.std.toFixed(0)}`);
  console.log(`  Avg shop spending: ${avgShopSpent.mean.toFixed(0)} ± ${avgShopSpent.std.toFixed(0)}`);
  console.log(`  Avg battles fought: ${avgBattles.mean.toFixed(1)}`);

  // Flagging
  if (strategy === 'save-for-seal') {
    if (sealRate < 50) {
      issues.push({
        severity: 'WARNING',
        label: `SEAL TOO EXPENSIVE (meta=${metaLevel})`,
        detail: `Only ${sealRate.toFixed(1)}% of runs can afford Master Seal by end Act 2`,
        suggestion: 'Reduce Master Seal price from 2500 to 2000, or increase battle gold',
      });
    }
    if (sealRate > 90 && metaLevel === 0) {
      issues.push({
        severity: 'INFO',
        label: `ECONOMY GENEROUS (meta=${metaLevel})`,
        detail: `${sealRate.toFixed(1)}% of runs afford Master Seal by Act 2 while saving`,
      });
    }
  }

  restoreMathRandom();
}

// ─── Meta comparison ───

if (opts.meta === 0) {
  printHeader('META COMPARISON: Economy impact across meta levels');

  const metaLevels = [0, 1, 2, 3];
  const compRows = [];

  for (const ml of metaLevels) {
    installSeed(opts.seed);
    const results = [];
    for (let t = 0; t < opts.trials; t++) {
      results.push(simulateRunEconomy('balanced', ml));
    }

    const finalGolds = results.map(r => r.finalGold);
    const { mean } = meanStd(finalGolds);
    const pcts = percentiles(finalGolds);
    const sealRate = results.filter(r => r.canPromoteMidAct2).length / results.length * 100;

    compRows.push({
      Meta: `L${ml}`,
      MeanGold: Math.floor(mean),
      P10: Math.floor(pcts.P10),
      P50: Math.floor(pcts.P50),
      P90: Math.floor(pcts.P90),
      'Seal%': sealRate.toFixed(1),
    });
    restoreMathRandom();
  }

  if (opts.csv) {
    toCSV(['Meta', 'MeanGold', 'P10', 'P50', 'P90', 'Seal%'], compRows);
  } else {
    printTable(['Meta', 'MeanGold', 'P10', 'P50', 'P90', 'Seal%'], compRows);
  }

  // Check if meta shifts promotion rate too much
  const base = parseFloat(compRows[0]['Seal%']);
  const maxed = parseFloat(compRows[3]['Seal%']);
  if (maxed - base > 30) {
    issues.push({
      severity: 'WARNING',
      label: 'META ECONOMY IMPACT HIGH',
      detail: `Promotion rate shifts from ${base}% (no meta) to ${maxed}% (full meta)`,
      suggestion: 'Consider reducing goldBonus or battleGoldMultiplier max values',
    });
  }
}

// ─── Recommendations ───

printRecommendations(issues);
