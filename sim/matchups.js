// Combat Matchup Simulator — Full class matrix, focus mode, scenario tests
// Usage: node sim/matchups.js [--trials N] [--level L] [--csv] [--focus CLASS] [--seed S]

import { installSeed, restoreMathRandom } from './lib/SeededRNG.js';
import { getData, createEnemy, getWeapon } from './lib/SimUnitFactory.js';
import { printTable, toCSV, parseArgs, printRecommendations, printHeader } from './lib/TableFormatter.js';
import { resolveCombat } from '../src/engine/Combat.js';
import { getSkillCombatMods, rollStrikeSkills, checkAstra } from '../src/engine/SkillSystem.js';
import { XP_STAT_NAMES } from '../src/utils/constants.js';

const opts = parseArgs({ trials: 200, level: 1, csv: false, focus: null, seed: 42 });

if (opts.help) {
  console.log('Usage: node sim/matchups.js [--trials N] [--level L] [--csv] [--focus CLASS] [--seed S]');
  process.exit(0);
}

const data = getData();
const issues = [];

const BASE_CLASSES = data.classes.filter(c => c.tier === 'base' && c.name !== 'Dancer'
  && c.name !== 'Lord' && c.name !== 'Tactician' && c.name !== 'Ranger' && c.name !== 'Light Sage');
const BASE_CLASS_NAMES = BASE_CLASSES.map(c => c.name);

/**
 * Run N trials of combat between two unit configurations.
 * Returns { winRate, avgDmgDealt, avgDmgTaken, doubles }
 */
function runMatchup(atkClass, defClass, level, trials, atkSkills = [], defSkills = [], atkWeaponName = null, defWeaponName = null) {
  let atkWins = 0;
  let totalDmgDealt = 0;
  let totalDmgTaken = 0;
  let doublesCount = 0;
  let atkDoubled = 0;

  for (let t = 0; t < trials; t++) {
    const atk = createEnemy(atkClass, level);
    const def = createEnemy(defClass, level);

    // Override weapon if specified
    if (atkWeaponName) atk.weapon = getWeapon(atkWeaponName);
    if (defWeaponName) def.weapon = getWeapon(defWeaponName);

    // Override skills if specified
    if (atkSkills.length) atk.skills = [...atkSkills];
    if (defSkills.length) def.skills = [...defSkills];

    // Set HP below 50% if any skill requires it
    if (atk.skills.includes('wrath') || atk.skills.includes('vantage') || atk.skills.includes('resolve')) {
      atk.currentHP = Math.floor(atk.stats.HP / 2);
    }
    if (def.skills.includes('wrath') || def.skills.includes('vantage') || def.skills.includes('resolve')) {
      def.currentHP = Math.floor(def.stats.HP / 2);
    }

    const distance = 1;
    const atkTerrain = null;
    const defTerrain = null;

    // Build skill context
    const atkMods = getSkillCombatMods(atk, def, [atk], [def], data.skills);
    const defMods = getSkillCombatMods(def, atk, [def], [atk], data.skills);
    const skillCtx = {
      atkMods, defMods,
      rollStrikeSkills, checkAstra,
      skillsData: data.skills,
    };

    const result = resolveCombat(atk, atk.weapon, def, def.weapon, distance, atkTerrain, defTerrain, skillCtx);

    if (result.defenderDied && !result.attackerDied) atkWins++;
    else if (result.defenderDied && result.attackerDied) atkWins += 0.5;

    totalDmgDealt += (def.currentHP || def.stats.HP) - Math.max(0, result.defenderHP);
    totalDmgTaken += (atk.currentHP || atk.stats.HP) - Math.max(0, result.attackerHP);

    if (atk.stats.SPD >= def.stats.SPD + 5) doublesCount++;
    if (def.stats.SPD >= atk.stats.SPD + 5) atkDoubled++;
  }

  return {
    winRate: (atkWins / trials * 100).toFixed(1),
    avgDmgDealt: (totalDmgDealt / trials).toFixed(1),
    avgDmgTaken: (totalDmgTaken / trials).toFixed(1),
    doubles: `${((doublesCount / trials) * 100).toFixed(0)}%`,
    doubled: `${((atkDoubled / trials) * 100).toFixed(0)}%`,
  };
}

// ─── Mode: Focus on one class ───

if (opts.focus) {
  installSeed(opts.seed);
  printHeader(`FOCUS: ${opts.focus} vs All Classes`);

  const levels = [1, 4, 7, 10, 13];
  for (const lvl of levels) {
    const rows = BASE_CLASS_NAMES.map(defCls => {
      const result = runMatchup(opts.focus, defCls, lvl, opts.trials);
      return { Defender: defCls, ...result };
    });

    if (opts.csv) {
      console.log(`\n# ${opts.focus} at Level ${lvl}`);
      toCSV(['Defender', 'winRate', 'avgDmgDealt', 'avgDmgTaken', 'doubles', 'doubled'], rows);
    } else {
      printTable(['Defender', 'winRate', 'avgDmgDealt', 'avgDmgTaken', 'doubles', 'doubled'], rows,
        { title: `${opts.focus} (L${lvl}) vs All` });
    }
  }
  restoreMathRandom();

} else {
  // ─── Full Matrix Mode ───

  const matrixLevels = [1, 5, 10];

  for (const lvl of matrixLevels) {
    installSeed(opts.seed);
    printHeader(`FULL MATRIX: Level ${lvl} (${opts.trials} trials each)`);

    const rows = [];
    for (const atkCls of BASE_CLASS_NAMES) {
      const row = { Attacker: atkCls };
      for (const defCls of BASE_CLASS_NAMES) {
        if (atkCls === defCls) {
          row[defCls] = '50.0';
          continue;
        }
        const result = runMatchup(atkCls, defCls, lvl, opts.trials);
        row[defCls] = result.winRate;

        // Flag imbalanced matchups
        const wr = parseFloat(result.winRate);
        if (wr >= 80) {
          issues.push({
            severity: 'WARNING',
            label: `IMBALANCED: ${atkCls} vs ${defCls} at L${lvl}`,
            detail: `${atkCls} wins ${result.winRate}% of fights`,
            suggestion: `Consider buffing ${defCls} or nerfing ${atkCls}`,
          });
        }
      }
      rows.push(row);
    }

    if (opts.csv) {
      toCSV(['Attacker', ...BASE_CLASS_NAMES], rows);
    } else {
      printTable(['Attacker', ...BASE_CLASS_NAMES], rows);
    }
    restoreMathRandom();
  }
}

// ─── Scenario Tests ───

printHeader('SCENARIO TESTS');

installSeed(opts.seed);

// Scenario 1: Swordmaster with Killing Edge + Wrath + crit_plus_15
{
  console.log('\n--- Swordmaster (Killing Edge + Wrath + Crit+15) vs Promoted Classes ---');
  const promotedEnemies = ['General', 'Paladin', 'Sage', 'Hero', 'Sniper'];
  const rows = promotedEnemies.map(defCls => {
    const result = runMatchup('Swordmaster', defCls, 5, opts.trials,
      ['wrath', 'crit_plus_15'], [], 'Killing Edge');
    return { Defender: defCls, ...result };
  });
  if (opts.csv) {
    toCSV(['Defender', 'winRate', 'avgDmgDealt', 'avgDmgTaken', 'doubles', 'doubled'], rows);
  } else {
    printTable(['Defender', 'winRate', 'avgDmgDealt', 'avgDmgTaken', 'doubles', 'doubled'], rows);
  }

  // Check if crit stacking is too strong
  const avgWR = rows.reduce((s, r) => s + parseFloat(r.winRate), 0) / rows.length;
  if (avgWR > 80) {
    issues.push({
      severity: 'CRITICAL',
      label: 'Wrath + Killing Edge + Crit+15 is overpowered',
      detail: `Swordmaster avg win rate ${avgWR.toFixed(1)}% vs promoted classes`,
      suggestion: 'Consider reducing Wrath crit bonus from +30 to +20, or cap total crit at 80%',
    });
  }
}

// Scenario 2: Hero with Brave Sword + Astra
{
  console.log('\n--- Hero (Brave Sword + Astra) vs Promoted Classes ---');
  const promotedEnemies = ['General', 'Paladin', 'Sage', 'Swordmaster', 'Sniper'];
  const rows = promotedEnemies.map(defCls => {
    const result = runMatchup('Hero', defCls, 5, opts.trials,
      ['astra'], [], 'Brave Sword');
    return { Defender: defCls, ...result };
  });
  if (opts.csv) {
    toCSV(['Defender', 'winRate', 'avgDmgDealt', 'avgDmgTaken', 'doubles', 'doubled'], rows);
  } else {
    printTable(['Defender', 'winRate', 'avgDmgDealt', 'avgDmgTaken', 'doubles', 'doubled'], rows);
  }

  const avgWR = rows.reduce((s, r) => s + parseFloat(r.winRate), 0) / rows.length;
  if (avgWR > 85) {
    issues.push({
      severity: 'CRITICAL',
      label: 'Brave + Astra stacking is game-breaking',
      detail: `Hero avg win rate ${avgWR.toFixed(1)}% vs promoted classes`,
      suggestion: 'Consider preventing Brave and Astra from stacking (Astra replaces Brave count)',
    });
  }
}

// Scenario 3: Knight viability across levels
{
  console.log('\n--- Knight Viability Curve (vs all base classes) ---');
  const levels = [1, 3, 5, 8, 10];
  const rows = levels.map(lvl => {
    let totalWR = 0;
    let count = 0;
    for (const defCls of BASE_CLASS_NAMES) {
      if (defCls === 'Knight') continue;
      const result = runMatchup('Knight', defCls, lvl, opts.trials);
      totalWR += parseFloat(result.winRate);
      count++;
    }
    return { Level: lvl, AvgWinRate: (totalWR / count).toFixed(1) };
  });
  if (opts.csv) {
    toCSV(['Level', 'AvgWinRate'], rows);
  } else {
    printTable(['Level', 'AvgWinRate'], rows);
  }

  const l1wr = parseFloat(rows[0].AvgWinRate);
  const l10wr = parseFloat(rows[rows.length - 1].AvgWinRate);
  if (l10wr < 35) {
    issues.push({
      severity: 'WARNING',
      label: 'Knight falls off hard at higher levels',
      detail: `L1 avg WR: ${l1wr}%, L10 avg WR: ${l10wr}%`,
      suggestion: 'Consider increasing Knight SPD growth from 10-20 to 20-30',
    });
  }
}

// Scenario 4: Myrmidon speed advantage
{
  console.log('\n--- Myrmidon Doubling Rate vs All (L1) ---');
  const rows = BASE_CLASS_NAMES.filter(c => c !== 'Myrmidon').map(defCls => {
    const result = runMatchup('Myrmidon', defCls, 1, opts.trials);
    return { Defender: defCls, WinRate: result.winRate, Doubles: result.doubles, Doubled: result.doubled };
  });
  if (opts.csv) {
    toCSV(['Defender', 'WinRate', 'Doubles', 'Doubled'], rows);
  } else {
    printTable(['Defender', 'WinRate', 'Doubles', 'Doubled'], rows);
  }
}

restoreMathRandom();

// ─── Recommendations ───

printRecommendations(issues);
