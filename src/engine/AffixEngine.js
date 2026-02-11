// AffixEngine.js - data-driven enemy affix assignment helpers.
// Pure functions, no Phaser dependencies.

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildExclusionMaps(config) {
  const exclusionRows = toArray(config?.config?.exclusions);
  const mutual = new Map();
  const classExclude = new Map();

  for (const row of exclusionRows) {
    if (!row || typeof row !== 'object') continue;
    if (row.rule === 'mutually_exclusive' && Array.isArray(row.affixes)) {
      const ids = row.affixes.filter((id) => typeof id === 'string');
      for (const left of ids) {
        const set = mutual.get(left) || new Set();
        ids.forEach((right) => {
          if (right !== left) set.add(right);
        });
        mutual.set(left, set);
      }
    } else if (row.rule === 'class_exclude' && typeof row.affix === 'string' && Array.isArray(row.classes)) {
      classExclude.set(row.affix, new Set(row.classes.filter((name) => typeof name === 'string')));
    }
  }

  return { mutual, classExclude };
}

function isAffixAllowed(affix, selectedIds, className, exclusionMaps) {
  if (!affix || typeof affix.id !== 'string') return false;
  if (selectedIds.has(affix.id)) return false;

  const classRules = exclusionMaps.classExclude.get(affix.id);
  if (classRules && classRules.has(className)) return false;

  for (const picked of selectedIds) {
    const blocked = exclusionMaps.mutual.get(picked);
    if (blocked && blocked.has(affix.id)) return false;
  }

  return true;
}

function weightedPick(entries) {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  if (total <= 0) return null;
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.item;
  }
  return entries[entries.length - 1]?.item || null;
}

function resolveActMultiplier(config, act) {
  const actScaling = config?.config?.actScaling;
  if (!actScaling || typeof actScaling !== 'object') return 1;
  const entry = actScaling[act];
  return Math.max(0, asNumber(entry?.chanceMultiplier, 1));
}

function resolveDifficultyRules(config, difficultyId) {
  const difficulty = config?.config?.difficultyGating;
  if (!difficulty || typeof difficulty !== 'object') return null;
  const rules = difficulty[difficultyId] || difficulty.normal || null;
  if (!rules) return null;
  return {
    affixChance: Math.max(0, asNumber(rules.affixChance, 0)),
    maxAffixesPerUnit: Math.max(0, Math.trunc(asNumber(rules.maxAffixesPerUnit, 0))),
    tierPool: toArray(rules.tierPool).map((x) => Math.trunc(asNumber(x, 0))).filter((x) => x > 0),
  };
}

export function assignAffixesToEnemySpawns(enemySpawns, options = {}) {
  const {
    affixConfig = null,
    difficultyId = 'normal',
    act = 'act1',
  } = options;
  if (!Array.isArray(enemySpawns) || enemySpawns.length === 0) return enemySpawns || [];
  const config = affixConfig;
  if (!config || !Array.isArray(config.affixes)) return enemySpawns;

  const rules = resolveDifficultyRules(config, difficultyId);
  if (!rules || rules.maxAffixesPerUnit <= 0 || rules.affixChance <= 0 || rules.tierPool.length === 0) {
    return enemySpawns;
  }

  const chance = Math.max(0, Math.min(1, rules.affixChance * resolveActMultiplier(config, act)));
  if (chance <= 0) return enemySpawns;

  const tierPool = new Set(rules.tierPool);
  const allowedAffixes = config.affixes.filter((affix) => tierPool.has(Math.trunc(asNumber(affix?.tier, 0))));
  if (allowedAffixes.length === 0) return enemySpawns;

  const exclusionMaps = buildExclusionMaps(config);

  return enemySpawns.map((spawn) => {
    if (!spawn || spawn.isBoss) return spawn;
    if (Math.random() >= chance) return spawn;

    const selected = [];
    const selectedIds = new Set();
    const attempts = Math.max(1, rules.maxAffixesPerUnit);
    for (let i = 0; i < attempts; i++) {
      if (i > 0 && Math.random() >= chance) break;
      const pool = allowedAffixes
        .filter((affix) => isAffixAllowed(affix, selectedIds, spawn.className, exclusionMaps))
        .map((affix) => ({ item: affix, weight: Math.max(0.01, asNumber(affix.weight, 1)) }));
      if (pool.length === 0) break;
      const picked = weightedPick(pool);
      if (!picked) break;
      selected.push(picked.id);
      selectedIds.add(picked.id);
    }

    if (selected.length === 0) return spawn;
    return {
      ...spawn,
      affixes: selected,
    };
  });
}

