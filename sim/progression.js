// Progression Curve Calculator — Expected values, XP accumulation, Monte Carlo growths
// Usage: node sim/progression.js [--trials N] [--lord NAME] [--csv]

import { installSeed, restoreMathRandom } from './lib/SeededRNG.js';
import { getData, createLord, createEnemy } from './lib/SimUnitFactory.js';
import {
  getLordCombinedGrowths, getClassGrowths, expectedStatsAtLevel, applyPromotionBonuses
} from './lib/ExpectedValue.js';
import {
  printTable, toCSV, parseArgs, printRecommendations, printHeader, meanStd
} from './lib/TableFormatter.js';
import { XP_STAT_NAMES, XP_BASE_COMBAT, XP_KILL_BONUS, XP_LEVEL_DIFF_SCALE, XP_MIN, ACT_CONFIG } from '../src/utils/constants.js';
import { levelUp } from '../src/engine/UnitManager.js';

const opts = parseArgs({ trials: 1000, lord: null, csv: false, seed: 42 });

if (opts.help) {
  console.log('Usage: node sim/progression.js [--trials N] [--lord NAME] [--csv] [--seed S]');
  process.exit(0);
}

const data = getData();
const issues = [];

// ─── Part A: Expected Value (deterministic) ───

printHeader('PART A: Expected Stats at Level Checkpoints');

const checkpointLevels = [1, 5, 10, 15, 20];
const lordsToRun = opts.lord
  ? data.lords.filter(l => l.name.toLowerCase() === opts.lord.toLowerCase())
  : data.lords;

if (lordsToRun.length === 0) {
  console.error(`Lord "${opts.lord}" not found. Available: ${data.lords.map(l => l.name).join(', ')}`);
  process.exit(1);
}

for (const lord of lordsToRun) {
  const classData = data.classes.find(c => c.name === lord.class);
  const growths = getLordCombinedGrowths(lord, classData);

  const rows = checkpointLevels.map(lvl => {
    const stats = expectedStatsAtLevel(lord.baseStats, growths, lvl);
    return { Level: lvl, ...Object.fromEntries(XP_STAT_NAMES.map(s => [s, stats[s]])) };
  });

  const columns = ['Level', ...XP_STAT_NAMES];
  if (opts.csv) {
    console.log(`\n# ${lord.name} (${lord.class}) — Expected Stats`);
    toCSV(columns, rows);
  } else {
    printTable(columns, rows, { title: `${lord.name} (${lord.class}) — Expected Stats` });
    console.log(`  Growths: ${XP_STAT_NAMES.map(s => `${s}=${growths[s].toFixed(0)}%`).join(', ')}`);
  }
}

// ─── Enemy archetype comparison ───

printHeader('Enemy Archetype Expected Stats');

const enemyCheckpoints = [
  { name: 'Act1 Myrm L2', cls: 'Myrmidon', lvl: 2 },
  { name: 'Act1 Knight L2', cls: 'Knight', lvl: 2 },
  { name: 'Act1 Fighter L2', cls: 'Fighter', lvl: 2 },
  { name: 'Act2 Myrm L6', cls: 'Myrmidon', lvl: 6 },
  { name: 'Act2 Knight L6', cls: 'Knight', lvl: 6 },
  { name: 'Act2 Mage L6', cls: 'Mage', lvl: 6 },
  { name: 'Act3 Myrm L12', cls: 'Myrmidon', lvl: 12 },
  { name: 'Act3 Swordmaster L5', cls: 'Swordmaster', lvl: 5 },
  { name: 'Act3 General L5', cls: 'General', lvl: 5 },
];

{
  const rows = enemyCheckpoints.map(({ name, cls, lvl }) => {
    const classData = data.classes.find(c => c.name === cls);
    if (!classData) return { Enemy: name };

    if (classData.tier === 'promoted') {
      // Promoted: base L10 stats + promotion + promoted levels
      const baseCls = data.classes.find(c => c.name === classData.promotesFrom);
      const baseGrowths = getClassGrowths(baseCls);
      const baseStats = expectedStatsAtLevel(baseCls.baseStats, baseGrowths, 10);
      const promoted = applyPromotionBonuses(baseStats, classData.promotionBonuses);
      // Then level further in promoted class (using base class growths since promoted don't have growthRanges)
      const finalStats = {};
      for (const s of XP_STAT_NAMES) {
        finalStats[s] = promoted[s] + (baseGrowths[s] / 100) * (lvl - 1);
      }
      return { Enemy: name, ...Object.fromEntries(XP_STAT_NAMES.map(s => [s, finalStats[s]])) };
    }

    const growths = getClassGrowths(classData);
    const stats = expectedStatsAtLevel(classData.baseStats, growths, lvl);
    return { Enemy: name, ...Object.fromEntries(XP_STAT_NAMES.map(s => [s, stats[s]])) };
  });

  const columns = ['Enemy', ...XP_STAT_NAMES];
  if (opts.csv) {
    toCSV(columns, rows);
  } else {
    printTable(columns, rows);
  }
}

// ─── Part B: XP Accumulation Model ───

printHeader('PART B: XP / Level Accumulation Model');

// Model: estimate levels at checkpoints based on enemy counts + XP formula
// Act 1: ~4 battles × 2 enemies each = 8 kills, Act 2: ~5 battles × 6 enemies = 30 kills
// XP per kill = max(1, 30 + levelDiff*5 + 20)

const xpCheckpoints = [
  { label: 'End Act 1', battles: 4, enemiesPerBattle: 2, enemyLevel: 2, bossKills: 1 },
  { label: 'Mid Act 2', battles: 7, enemiesPerBattle: 5, enemyLevel: 5, bossKills: 1 },
  { label: 'End Act 2', battles: 10, enemiesPerBattle: 6, enemyLevel: 7, bossKills: 2 },
  { label: 'Mid Act 3', battles: 13, enemiesPerBattle: 7, enemyLevel: 10, bossKills: 2 },
  { label: 'End Act 3', battles: 16, enemiesPerBattle: 8, enemyLevel: 13, bossKills: 3 },
];

for (const lord of lordsToRun) {
  const rows = [];
  let totalXP = 0;
  let currentLevel = 1;
  const deployedUnits = 2; // split XP across deployed units

  for (const cp of xpCheckpoints) {
    // Estimate total kills up to this point
    const totalEnemies = cp.battles * cp.enemiesPerBattle + cp.bossKills;
    const xpPerKill = Math.max(XP_MIN, XP_BASE_COMBAT + (cp.enemyLevel - currentLevel) * XP_LEVEL_DIFF_SCALE + XP_KILL_BONUS);
    totalXP = totalEnemies * xpPerKill / deployedUnits;
    currentLevel = Math.min(20, 1 + Math.floor(totalXP / 100));

    rows.push({
      Checkpoint: cp.label,
      TotalKills: totalEnemies,
      XPPerKill: xpPerKill,
      TotalXP: Math.floor(totalXP),
      EstLevel: currentLevel,
    });
  }

  if (opts.csv) {
    console.log(`\n# ${lord.name} — XP Model (${deployedUnits} units sharing XP)`);
    toCSV(['Checkpoint', 'TotalKills', 'XPPerKill', 'TotalXP', 'EstLevel'], rows);
  } else {
    printTable(['Checkpoint', 'TotalKills', 'XPPerKill', 'TotalXP', 'EstLevel'], rows,
      { title: `${lord.name} — XP Model (${deployedUnits} units sharing XP)` });
  }
}

// ─── Part C: Monte Carlo Growth Simulation ───

printHeader(`PART C: Monte Carlo Growth Simulation (${opts.trials} trials)`);

installSeed(opts.seed);

for (const lord of lordsToRun) {
  const mcLevels = [5, 10, 15, 20];
  const statsByLevel = {};
  for (const lvl of mcLevels) {
    statsByLevel[lvl] = {};
    for (const stat of XP_STAT_NAMES) {
      statsByLevel[lvl][stat] = [];
    }
  }

  for (let t = 0; t < opts.trials; t++) {
    const unit = createLord(lord.name);
    for (let lvl = 2; lvl <= 20; lvl++) {
      const gains = levelUp(unit);
      if (gains) {
        unit.level = gains.newLevel;
        for (const stat of XP_STAT_NAMES) {
          unit.stats[stat] += gains.gains[stat];
        }
      }
      if (mcLevels.includes(lvl)) {
        for (const stat of XP_STAT_NAMES) {
          statsByLevel[lvl][stat].push(unit.stats[stat]);
        }
      }
    }
  }

  const rows = mcLevels.map(lvl => {
    const row = { Level: lvl };
    for (const stat of XP_STAT_NAMES) {
      const { mean, std } = meanStd(statsByLevel[lvl][stat]);
      row[stat] = `${mean.toFixed(1)}±${std.toFixed(1)}`;
    }
    return row;
  });

  if (opts.csv) {
    // For CSV, output mean and std as separate columns
    const csvRows = mcLevels.map(lvl => {
      const row = { Level: lvl };
      for (const stat of XP_STAT_NAMES) {
        const { mean, std } = meanStd(statsByLevel[lvl][stat]);
        row[`${stat}_mean`] = mean;
        row[`${stat}_std`] = std;
      }
      return row;
    });
    const csvCols = ['Level', ...XP_STAT_NAMES.flatMap(s => [`${s}_mean`, `${s}_std`])];
    console.log(`\n# ${lord.name} — Monte Carlo (N=${opts.trials})`);
    toCSV(csvCols, csvRows);
  } else {
    printTable(['Level', ...XP_STAT_NAMES], rows,
      { title: `${lord.name} — Monte Carlo Stats (N=${opts.trials}, mean±std)` });
  }

  // Flag high-variance stats
  for (const stat of XP_STAT_NAMES) {
    const { mean, std } = meanStd(statsByLevel[20][stat]);
    if (std > mean * 0.15 && mean > 5) {
      issues.push({
        severity: 'INFO',
        label: `${lord.name}: High variance in ${stat} at L20`,
        detail: `mean=${mean.toFixed(1)}, std=${std.toFixed(1)} (${(std/mean*100).toFixed(0)}% CV)`,
      });
    }
  }
}

restoreMathRandom();

// ─── Part D: Player vs Enemy Power Comparison ───

printHeader('PART D: Player vs Enemy Power Comparison');

const powerCheckpoints = [
  { label: 'End Act 1 (L3-4)', playerLvl: 4, enemyClass: 'Fighter', enemyLvl: 3, act: 'act1' },
  { label: 'Mid Act 2 (L7-8)', playerLvl: 8, enemyClass: 'Myrmidon', enemyLvl: 6, act: 'act2' },
  { label: 'End Act 2 (L10-11)', playerLvl: 11, enemyClass: 'Knight', enemyLvl: 8, act: 'act2' },
  { label: 'Mid Act 3 (L13-14)', playerLvl: 14, enemyClass: 'Swordmaster', enemyLvl: 5, act: 'act3' },
  { label: 'End Act 3 (L17-18)', playerLvl: 18, enemyClass: 'General', enemyLvl: 8, act: 'act3' },
];

for (const lord of lordsToRun) {
  const classData = data.classes.find(c => c.name === lord.class);
  const growths = getLordCombinedGrowths(lord, classData);

  const rows = powerCheckpoints.map(cp => {
    const playerStats = expectedStatsAtLevel(lord.baseStats, growths, cp.playerLvl);

    const enemyCls = data.classes.find(c => c.name === cp.enemyClass);
    let enemyStats;
    if (enemyCls.tier === 'promoted') {
      const baseCls = data.classes.find(c => c.name === enemyCls.promotesFrom);
      const baseGrowths = getClassGrowths(baseCls);
      const base10 = expectedStatsAtLevel(baseCls.baseStats, baseGrowths, 10);
      const promoted = applyPromotionBonuses(base10, enemyCls.promotionBonuses);
      enemyStats = {};
      for (const s of XP_STAT_NAMES) {
        enemyStats[s] = promoted[s] + (baseGrowths[s] / 100) * (cp.enemyLvl - 1);
      }
    } else {
      const eGrowths = getClassGrowths(enemyCls);
      enemyStats = expectedStatsAtLevel(enemyCls.baseStats, eGrowths, cp.enemyLvl);
    }

    // Key combat stats comparison
    const strDiff = playerStats.STR - enemyStats.DEF;
    const spdDiff = playerStats.SPD - enemyStats.SPD;
    const hpRatio = playerStats.HP / enemyStats.HP;

    return {
      Checkpoint: cp.label,
      'P.STR': playerStats.STR.toFixed(1),
      'P.SPD': playerStats.SPD.toFixed(1),
      'P.DEF': playerStats.DEF.toFixed(1),
      'E.STR': enemyStats.STR.toFixed(1),
      'E.SPD': enemyStats.SPD.toFixed(1),
      'E.DEF': enemyStats.DEF.toFixed(1),
      'STR-DEF': strDiff.toFixed(1),
      'SPD gap': spdDiff.toFixed(1),
      'HP ratio': hpRatio.toFixed(2),
    };
  });

  if (opts.csv) {
    console.log(`\n# ${lord.name} — Power Comparison`);
    toCSV(Object.keys(rows[0]), rows);
  } else {
    printTable(Object.keys(rows[0]), rows, { title: `${lord.name} vs Enemy Power Curve` });
  }

  // Flag power imbalances
  for (const row of rows) {
    const strDef = parseFloat(row['STR-DEF']);
    if (strDef > 10) {
      issues.push({
        severity: 'WARNING',
        label: `${lord.name} outscales enemies at ${row.Checkpoint}`,
        detail: `STR-DEF gap = ${strDef.toFixed(1)} (player damage exceeds enemy defense by large margin)`,
        suggestion: 'Consider increasing enemy DEF growths or scaling enemy levels higher',
      });
    }
    if (strDef < -3) {
      issues.push({
        severity: 'WARNING',
        label: `${lord.name} underpowered at ${row.Checkpoint}`,
        detail: `STR-DEF gap = ${strDef.toFixed(1)} (player may deal 0 damage)`,
        suggestion: 'Consider reducing enemy DEF or increasing player STR growths',
      });
    }
  }
}

// ─── Recommendations ───

printRecommendations(issues);
