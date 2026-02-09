// Full Run Monte Carlo — Abstract battle resolution, full act progression
// Usage: node sim/fullrun.js [--trials N] [--seed S] [--csv] [--verbose] [--meta LEVEL]

import { installSeed, restoreMathRandom } from './lib/SeededRNG.js';
import { getData, createLord, createEnemy, createBoss, createRecruit } from './lib/SimUnitFactory.js';
import { printTable, toCSV, parseArgs, printRecommendations, printHeader, meanStd, percentiles } from './lib/TableFormatter.js';
import { resolveCombat, resolveHeal, calculateHealAmount, canCounter, parseRange } from '../src/engine/Combat.js';
import { getSkillCombatMods, rollStrikeSkills, checkAstra } from '../src/engine/SkillSystem.js';
import { gainExperience, calculateCombatXP, canPromote, promoteUnit } from '../src/engine/UnitManager.js';
import { calculateKillGold, calculateBattleGold } from '../src/engine/LootSystem.js';
import { generateNodeMap } from '../src/engine/NodeMapGenerator.js';
import {
  ACT_CONFIG, ACT_SEQUENCE, NODE_TYPES, ROSTER_CAP, DEPLOY_LIMITS,
  STARTING_GOLD, GOLD_BOSS_BONUS, BOSS_STAT_BONUS, XP_STAT_NAMES,
} from '../src/utils/constants.js';

const opts = parseArgs({ trials: 200, seed: 42, csv: false, verbose: false, meta: 0 });

if (opts.help) {
  console.log('Usage: node sim/fullrun.js [--trials N] [--seed S] [--csv] [--verbose] [--meta LEVEL]');
  process.exit(0);
}

const data = getData();
const issues = [];

function getMetaEffects(level) {
  if (level === 0) return { statBonuses: {}, goldBonus: 0, battleGoldMultiplier: 0, extraVulnerary: 0, deployBonus: 0, rosterCapBonus: 0 };
  if (level === 1) return { statBonuses: { HP: 2, STR: 1 }, goldBonus: 100, battleGoldMultiplier: 0.2, extraVulnerary: 0, deployBonus: 0, rosterCapBonus: 0 };
  if (level === 2) return { statBonuses: { HP: 4, STR: 1, DEF: 1 }, goldBonus: 200, battleGoldMultiplier: 0.4, extraVulnerary: 1, deployBonus: 0, rosterCapBonus: 0 };
  return { statBonuses: { HP: 6, STR: 2, DEF: 2, SPD: 2, SKL: 2, RES: 1 }, goldBonus: 300, battleGoldMultiplier: 0.4, extraVulnerary: 1, deployBonus: 1, rosterCapBonus: 2 };
}

function getEnemyCount(act) {
  if (act === 'act1') return 2;
  if (act === 'act2') return 5 + Math.floor(Math.random() * 3); // 5-7
  if (act === 'act3') return 7 + Math.floor(Math.random() * 3); // 7-9
  return 10 + Math.floor(Math.random() * 3); // 10-12
}

function getEnemyLevel(act, levelRange) {
  const pool = data.enemies.pools[act];
  if (!pool) return 10;
  const [min, max] = levelRange || pool.levelRange;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pickEnemyClass(act) {
  const pool = data.enemies.pools[act];
  if (!pool) return 'Fighter';
  const combined = [...pool.base, ...pool.promoted];
  return combined[Math.floor(Math.random() * combined.length)];
}

function pickBoss(act) {
  const bosses = data.enemies.bosses[act];
  if (!bosses || bosses.length === 0) return { className: 'Fighter', level: 10, name: 'Boss' };
  return bosses[Math.floor(Math.random() * bosses.length)];
}

function getWeaponRange(unit) {
  if (!unit.weapon) return { min: 1, max: 1 };
  return parseRange(unit.weapon.range);
}

/**
 * Abstract battle resolution — no grid, just stat-based combat rounds.
 * Returns { victory, edricDied, unitDeaths, rounds, xpGained, goldEarned }
 */
function resolveBattle(playerUnits, enemies, actId, isBoss, meta, verbose) {
  // Reset HP to max for all units
  for (const u of playerUnits) u.currentHP = u.stats.HP;
  for (const e of enemies) e.currentHP = e.stats.HP;

  const alive = { player: [...playerUnits], enemy: [...enemies] };
  let rounds = 0;
  const MAX_ROUNDS = 30;
  let totalKillGold = 0;
  const unitDeaths = [];

  // Apply terrain bonuses: 30% player get Forest, 20% enemy
  const forestTerrain = data.terrain.find(t => t.name === 'Forest') || { avoidBonus: 15, defBonus: 1 };
  const playerTerrains = playerUnits.map(() => Math.random() < 0.3 ? forestTerrain : null);
  const enemyTerrains = enemies.map(() => Math.random() < 0.2 ? forestTerrain : null);

  while (rounds < MAX_ROUNDS && alive.player.length > 0 && alive.enemy.length > 0) {
    rounds++;

    // --- Player Phase ---
    for (const unit of [...alive.player]) {
      if (alive.enemy.length === 0) break;
      if (unit.currentHP <= 0) continue;

      // Healers: heal lowest-HP ally
      if (unit.weapon?.type === 'Staff') {
        const injured = alive.player.filter(u => u.currentHP < u.stats.HP && u !== unit);
        if (injured.length > 0) {
          const target = injured.sort((a, b) => (a.currentHP / a.stats.HP) - (b.currentHP / b.stats.HP))[0];
          const healResult = resolveHeal(unit.weapon, target);
          target.currentHP = healResult.targetHPAfter;
          if (verbose) console.log(`  ${unit.name} heals ${target.name} for ${healResult.healAmount}`);
        }
        continue;
      }

      if (!unit.weapon) continue;

      // Attack weakest enemy (lowest HP)
      const target = alive.enemy.sort((a, b) => a.currentHP - b.currentHP)[0];
      const unitIdx = playerUnits.indexOf(unit);
      const targetIdx = enemies.indexOf(target);
      const atkTerrain = playerTerrains[unitIdx] || null;
      const defTerrain = enemyTerrains[targetIdx] || null;

      // Determine combat distance
      const atkRange = getWeaponRange(unit);
      const defRange = getWeaponRange(target);
      const distance = atkRange.max >= 2 ? 2 : 1; // Ranged units attack from range 2

      const atkMods = getSkillCombatMods(unit, target, alive.player, alive.enemy, data.skills);
      const defMods = getSkillCombatMods(target, unit, alive.enemy, alive.player, data.skills);

      const result = resolveCombat(
        unit, unit.weapon, target, target.weapon,
        distance, atkTerrain, defTerrain,
        { atkMods, defMods, rollStrikeSkills, checkAstra, skillsData: data.skills }
      );

      unit.currentHP = Math.max(0, result.attackerHP);
      target.currentHP = Math.max(0, result.defenderHP);

      if (verbose && result.events.length > 0) {
        const dmgDealt = result.events.filter(e => e.attacker === unit.name && !e.miss).reduce((s, e) => s + e.damage, 0);
        console.log(`  ${unit.name} attacks ${target.name}: ${dmgDealt} dmg, ${target.currentHP > 0 ? target.currentHP + ' HP left' : 'KILLED'}`);
      }

      if (target.currentHP <= 0) {
        alive.enemy.splice(alive.enemy.indexOf(target), 1);
        totalKillGold += calculateKillGold({ level: target.level, isBoss: target.isBoss });

        // XP gain
        const xp = calculateCombatXP(unit, target, true);
        gainExperience(unit, xp);
      }

      if (unit.currentHP <= 0) {
        alive.player.splice(alive.player.indexOf(unit), 1);
        unitDeaths.push(unit.name);
        if (verbose) console.log(`  !! ${unit.name} has fallen!`);
      }
    }

    if (alive.enemy.length === 0) break;

    // --- Enemy Phase ---
    for (const enemy of [...alive.enemy]) {
      if (alive.player.length === 0) break;
      if (enemy.currentHP <= 0) continue;
      if (!enemy.weapon) continue;

      // Attack lowest-DEF player unit
      const target = alive.player.sort((a, b) => a.stats.DEF - b.stats.DEF)[0];
      const unitIdx = playerUnits.indexOf(target);
      const enemyIdx = enemies.indexOf(enemy);
      const atkTerrain = enemyTerrains[enemyIdx] || null;
      const defTerrain = playerTerrains[unitIdx] || null;

      const atkRange = getWeaponRange(enemy);
      const distance = atkRange.max >= 2 ? 2 : 1;

      const atkMods = getSkillCombatMods(enemy, target, alive.enemy, alive.player, data.skills);
      const defMods = getSkillCombatMods(target, enemy, alive.player, alive.enemy, data.skills);

      const result = resolveCombat(
        enemy, enemy.weapon, target, target.weapon,
        distance, atkTerrain, defTerrain,
        { atkMods, defMods, rollStrikeSkills, checkAstra, skillsData: data.skills }
      );

      enemy.currentHP = Math.max(0, result.attackerHP);
      target.currentHP = Math.max(0, result.defenderHP);

      if (target.currentHP <= 0) {
        alive.player.splice(alive.player.indexOf(target), 1);
        unitDeaths.push(target.name);
        if (verbose) console.log(`  !! ${target.name} falls to ${enemy.name}!`);
      }

      if (enemy.currentHP <= 0) {
        alive.enemy.splice(alive.enemy.indexOf(enemy), 1);
        totalKillGold += calculateKillGold({ level: enemy.level, isBoss: enemy.isBoss });
      }
    }
  }

  const edricDied = unitDeaths.includes('Edric');
  const victory = alive.enemy.length === 0 && !edricDied;

  let goldEarned = calculateBattleGold(totalKillGold);
  if (meta.battleGoldMultiplier > 0) {
    goldEarned = Math.floor(goldEarned * (1 + meta.battleGoldMultiplier));
  }

  return { victory, edricDied, unitDeaths, rounds, goldEarned };
}

/**
 * Simulate a full run from Act 1 through Final Boss.
 */
function simulateRun(metaLevel, verbose) {
  const meta = getMetaEffects(metaLevel);
  const roster = [createLord('Edric'), createLord('Sera')];
  let gold = STARTING_GOLD + meta.goldBonus;
  let totalBattles = 0;
  let actsCompleted = 0;
  let edricDied = false;
  let defeatCause = '';
  const unitDeathLog = [];
  let promoted = false;

  for (const actId of ACT_SEQUENCE) {
    if (edricDied) break;

    const actConfig = ACT_CONFIG[actId];
    const nodeMap = generateNodeMap(actId, actConfig);

    if (verbose) console.log(`\n=== ${actConfig.name} (${actId}) ===`);

    let currentId = nodeMap.startNodeId;
    const visited = new Set();

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const node = nodeMap.nodes.find(n => n.id === currentId);
      if (!node) break;

      if (node.type === NODE_TYPES.BATTLE || node.type === NODE_TYPES.BOSS || node.type === NODE_TYPES.RECRUIT) {
        totalBattles++;
        const isBoss = node.type === NODE_TYPES.BOSS;

        // Create enemies
        const enemyCount = isBoss ? getEnemyCount(actId) + 1 : getEnemyCount(actId);
        const enemies = [];
        for (let i = 0; i < enemyCount; i++) {
          const cls = pickEnemyClass(actId);
          const lvl = getEnemyLevel(actId, node.battleParams?.levelRange);
          try {
            enemies.push(createEnemy(cls, lvl));
          } catch (_) {
            enemies.push(createEnemy('Fighter', lvl));
          }
        }

        if (isBoss) {
          const bossDef = pickBoss(actId);
          try {
            enemies.push(createBoss(bossDef.className, bossDef.level));
          } catch (_) {
            enemies.push(createBoss('Fighter', bossDef.level));
          }
        }

        // NPC recruit
        let recruitUnit = null;
        if (node.type === NODE_TYPES.RECRUIT) {
          const pool = data.recruits[actId];
          if (pool) {
            const pick = pool.pool[Math.floor(Math.random() * pool.pool.length)];
            const level = pool.levelRange[0] + Math.floor(Math.random() * (pool.levelRange[1] - pool.levelRange[0] + 1));
            try {
              recruitUnit = createRecruit(pick.className, pick.name, level);
            } catch (_) { /* skip recruit */ }
          }
        }

        // Deploy: select alive units, respecting deploy limits
        const aliveRoster = roster.filter(u => u.currentHP > 0);
        const deployLimits = DEPLOY_LIMITS[actId] || { min: 4, max: 6 };
        const deployMax = Math.min(deployLimits.max + (meta.deployBonus || 0), aliveRoster.length);
        const deployCount = Math.max(deployLimits.min, Math.min(deployMax, aliveRoster.length));
        const deployed = aliveRoster.slice(0, deployCount);

        if (verbose) {
          console.log(`\n  Battle ${totalBattles} (${node.type}): ${deployed.length} vs ${enemies.length} enemies`);
          console.log(`  Deploy: ${deployed.map(u => `${u.name} L${u.level}`).join(', ')}`);
        }

        const result = resolveBattle(deployed, enemies, actId, isBoss, meta, verbose);

        gold += result.goldEarned;

        if (result.edricDied) {
          edricDied = true;
          defeatCause = `Edric died in ${actId} battle ${totalBattles}`;
          break;
        }

        // Remove dead units from roster (except Edric — checked above)
        for (const deadName of result.unitDeaths) {
          const idx = roster.findIndex(u => u.name === deadName);
          if (idx >= 0) {
            unitDeathLog.push({ name: deadName, act: actId, battle: totalBattles });
            roster.splice(idx, 1);
          }
        }

        // Add recruit to roster if battle won and space available
        if (recruitUnit && result.victory && roster.length < ROSTER_CAP + (meta.rosterCapBonus || 0)) {
          recruitUnit.faction = 'player';
          roster.push(recruitUnit);
          if (verbose) console.log(`  Recruited ${recruitUnit.name} (${recruitUnit.className} L${recruitUnit.level})`);
        }

        // Try promotion for Edric if affordable and eligible
        const edric = roster.find(u => u.name === 'Edric');
        if (edric && canPromote(edric) && gold >= 2500 && !promoted) {
          const lordData = data.lords.find(l => l.name === 'Edric');
          const promotedClassData = data.classes.find(c => c.name === lordData.promotedClass);
          if (promotedClassData) {
            promoteUnit(edric, promotedClassData, lordData.promotionBonuses, data.skills);
            gold -= 2500;
            promoted = true;
            if (verbose) console.log(`  ** Edric promoted to ${lordData.promotedClass}! **`);
          }
        }
      }

      if (node.type === NODE_TYPES.REST) {
        // Heal all units to full
        for (const u of roster) u.currentHP = u.stats.HP;
        if (verbose) console.log(`  Rest: all units healed`);
      }

      // Advance
      if (node.edges.length > 0) {
        currentId = node.edges[Math.floor(Math.random() * node.edges.length)];
      } else {
        break;
      }
    }

    if (!edricDied) actsCompleted++;
  }

  const victory = !edricDied && actsCompleted === ACT_SEQUENCE.length;

  return {
    victory,
    edricDied,
    defeatCause,
    actsCompleted,
    totalBattles,
    finalGold: gold,
    rosterSize: roster.length,
    edricLevel: roster.find(u => u.name === 'Edric')?.level || 0,
    edricTier: roster.find(u => u.name === 'Edric')?.tier || 'base',
    promoted,
    unitDeaths: unitDeathLog,
  };
}

// ─── Run Simulations ───

installSeed(opts.seed);

if (opts.verbose) {
  // Single verbose run
  printHeader('VERBOSE SINGLE RUN');
  const result = simulateRun(opts.meta, true);
  console.log(`\n--- Result ---`);
  console.log(`  Victory: ${result.victory}`);
  console.log(`  Edric died: ${result.edricDied}`);
  if (result.defeatCause) console.log(`  Cause: ${result.defeatCause}`);
  console.log(`  Acts completed: ${result.actsCompleted}`);
  console.log(`  Total battles: ${result.totalBattles}`);
  console.log(`  Gold: ${result.finalGold}`);
  console.log(`  Promoted: ${result.promoted}`);
  console.log(`  Edric Level: ${result.edricLevel} (${result.edricTier})`);
  console.log(`  Roster: ${result.rosterSize}`);
  if (result.unitDeaths.length > 0) {
    console.log(`  Deaths: ${result.unitDeaths.map(d => `${d.name} (${d.act})`).join(', ')}`);
  }
  restoreMathRandom();
} else {
  // Full Monte Carlo
  const metaLevels = opts.meta === 0 ? [0, 1, 2, 3] : [opts.meta];

  for (const ml of metaLevels) {
    installSeed(opts.seed);
    printHeader(`FULL RUN MONTE CARLO (meta=${ml}, N=${opts.trials})`);

    const results = [];
    for (let t = 0; t < opts.trials; t++) {
      results.push(simulateRun(ml, false));
    }

    const winRate = results.filter(r => r.victory).length / results.length * 100;
    const edricDeathRate = results.filter(r => r.edricDied).length / results.length * 100;
    const promoRate = results.filter(r => r.promoted).length / results.length * 100;
    const avgBattles = meanStd(results.map(r => r.totalBattles));
    const avgActs = meanStd(results.map(r => r.actsCompleted));
    const avgRoster = meanStd(results.map(r => r.rosterSize));
    const avgGold = meanStd(results.map(r => r.finalGold));
    const avgEdricLevel = meanStd(results.map(r => r.edricLevel));

    const summaryRows = [
      { Metric: 'Win Rate', Value: `${winRate.toFixed(1)}%` },
      { Metric: 'Edric Death Rate', Value: `${edricDeathRate.toFixed(1)}%` },
      { Metric: 'Promotion Rate', Value: `${promoRate.toFixed(1)}%` },
      { Metric: 'Avg Battles', Value: `${avgBattles.mean.toFixed(1)} ± ${avgBattles.std.toFixed(1)}` },
      { Metric: 'Avg Acts Completed', Value: `${avgActs.mean.toFixed(1)} ± ${avgActs.std.toFixed(1)}` },
      { Metric: 'Avg Roster Size', Value: `${avgRoster.mean.toFixed(1)} ± ${avgRoster.std.toFixed(1)}` },
      { Metric: 'Avg Final Gold', Value: `${avgGold.mean.toFixed(0)} ± ${avgGold.std.toFixed(0)}` },
      { Metric: 'Avg Edric Level', Value: `${avgEdricLevel.mean.toFixed(1)} ± ${avgEdricLevel.std.toFixed(1)}` },
    ];

    if (opts.csv) {
      toCSV(['Metric', 'Value'], summaryRows);
    } else {
      printTable(['Metric', 'Value'], summaryRows);
    }

    // Death cause breakdown
    const deathsByAct = {};
    for (const r of results) {
      if (r.edricDied) {
        const act = r.defeatCause.match(/act\d|finalBoss/)?.[0] || 'unknown';
        deathsByAct[act] = (deathsByAct[act] || 0) + 1;
      }
    }
    if (Object.keys(deathsByAct).length > 0) {
      const deathRows = Object.entries(deathsByAct).sort((a, b) => b[1] - a[1]).map(([act, count]) => ({
        Act: act, Deaths: count, Rate: `${(count / results.length * 100).toFixed(1)}%`,
      }));
      console.log('  Edric death breakdown by act:');
      if (opts.csv) {
        toCSV(['Act', 'Deaths', 'Rate'], deathRows);
      } else {
        printTable(['Act', 'Deaths', 'Rate'], deathRows);
      }
    }

    // Unit death frequency
    const deathFreq = {};
    for (const r of results) {
      for (const d of r.unitDeaths) {
        deathFreq[d.name] = (deathFreq[d.name] || 0) + 1;
      }
    }
    const freqRows = Object.entries(deathFreq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({
      Unit: name, Deaths: count, Rate: `${(count / results.length * 100).toFixed(1)}%`,
    }));
    if (freqRows.length > 0) {
      console.log('  Most frequent unit deaths:');
      if (opts.csv) {
        toCSV(['Unit', 'Deaths', 'Rate'], freqRows);
      } else {
        printTable(['Unit', 'Deaths', 'Rate'], freqRows);
      }
    }

    // Flagging
    if (ml === 0) {
      if (winRate < 50) {
        issues.push({
          severity: 'WARNING',
          label: 'BASE DIFFICULTY TOO HIGH',
          detail: `Win rate ${winRate.toFixed(1)}% at meta 0`,
          suggestion: 'Consider reducing enemy levels or counts in early acts',
        });
      }
      if (edricDeathRate > 40) {
        issues.push({
          severity: 'WARNING',
          label: 'LORD TOO FRAGILE',
          detail: `Edric dies in ${edricDeathRate.toFixed(1)}% of runs`,
          suggestion: 'Consider increasing Edric base DEF or HP growths',
        });
      }
      if (edricDeathRate < 10) {
        issues.push({
          severity: 'INFO',
          label: 'LORD TOO SAFE',
          detail: `Edric only dies in ${edricDeathRate.toFixed(1)}% of runs`,
        });
      }
    }
    if (ml === 3 && winRate > 90) {
      issues.push({
        severity: 'WARNING',
        label: 'META TRIVIALIZES',
        detail: `Win rate ${winRate.toFixed(1)}% at max meta`,
        suggestion: 'Consider reducing meta stat bonuses or costs',
      });
    }

    restoreMathRandom();
  }
}

// ─── Recommendations ───

printRecommendations(issues);
