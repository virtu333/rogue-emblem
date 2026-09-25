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
    } else if (
      row.rule === 'class_exclude' &&
      typeof row.affix === 'string' &&
      Array.isArray(row.classes)
    ) {
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
    excludedActs: toArray(rules.excludedActs),
    excludedAffixes: toArray(rules.excludedAffixes),
    affixChance: Math.max(0, asNumber(rules.affixChance, 0)),
    maxAffixesPerUnit: Math.max(0, Math.trunc(asNumber(rules.maxAffixesPerUnit, 0))),
    tierPool: toArray(rules.tierPool)
      .map((x) => Math.trunc(asNumber(x, 0)))
      .filter((x) => x > 0),
  };
}

/**
 * Assign affixes to generated enemy spawns (runs inside battle generation, under the
 * battle's seeded Math.random).
 * @param {Array} enemySpawns
 * @param {{ affixConfig?, difficultyId?, act?, eclipse? }} options
 *   eclipse (optional, from RunManager.getBattleParams → battleParams.eclipseAffix):
 *     gatingDifficultyId  use another difficulty's gating (Normal → Hard from Umbral)
 *     extraMaxAffixes     +N max affixes per unit (Totality and Hollow)
 *     guaranteedCount     eclipsed nodes: at least this many enemies carry an affix
 *     guaranteedTier      highest affix tier the guarantee draws from
 */
export function assignAffixesToEnemySpawns(enemySpawns, options = {}) {
  const spawns = assignRolledAffixes(enemySpawns, options);
  const eclipse = options.eclipse;
  if (!eclipse || !(Number(eclipse.guaranteedCount) > 0)) return spawns;
  return ensureGuaranteedAffixes(spawns, options);
}

function effectiveRules(config, difficultyId, eclipse) {
  const gatingId =
    typeof eclipse?.gatingDifficultyId === 'string' && eclipse.gatingDifficultyId
      ? eclipse.gatingDifficultyId
      : difficultyId;
  const rules = resolveDifficultyRules(config, gatingId);
  const extra = Math.max(0, Math.trunc(asNumber(eclipse?.extraMaxAffixes, 0)));
  if (rules && extra > 0) rules.maxAffixesPerUnit += extra;
  return rules;
}

// Eclipsed battles: at least `guaranteedCount` non-boss enemies carry one affix of tier
// <= guaranteedTier, whatever the difficulty's chance or act gating. The difficulty's
// affix exclusions and the class/mutual exclusion rules still hold.
function ensureGuaranteedAffixes(enemySpawns, options) {
  const { affixConfig: config = null, difficultyId = 'normal', eclipse } = options;
  if (!Array.isArray(enemySpawns) || !config || !Array.isArray(config.affixes)) return enemySpawns;
  const count = Math.max(0, Math.trunc(asNumber(eclipse.guaranteedCount, 0)));
  const maxTier = Math.max(1, Math.trunc(asNumber(eclipse.guaranteedTier, 1)));
  const rules = effectiveRules(config, difficultyId, eclipse);
  const excluded = new Set(rules?.excludedAffixes || []);
  const pool = config.affixes.filter((affix) => {
    const tier = Math.trunc(asNumber(affix?.tier, 0));
    return tier >= 1 && tier <= maxTier && !excluded.has(affix.id);
  });
  if (!pool.length) return enemySpawns;
  const eligible = [];
  let affixed = 0;
  enemySpawns.forEach((spawn, index) => {
    if (!spawn || spawn.isBoss) return;
    if (Array.isArray(spawn.affixes) && spawn.affixes.length) affixed++;
    else eligible.push(index);
  });
  let need = Math.min(count, affixed + eligible.length) - affixed;
  if (need <= 0) return enemySpawns;
  const exclusionMaps = buildExclusionMaps(config);
  const out = [...enemySpawns];
  while (need > 0 && eligible.length) {
    const index = eligible.splice(Math.floor(Math.random() * eligible.length), 1)[0];
    const spawn = out[index];
    const available = pool
      .filter((affix) => isAffixAllowed(affix, new Set(), spawn.className, exclusionMaps))
      .map((affix) => ({ item: affix, weight: Math.max(0.01, asNumber(affix.weight, 1)) }));
    const picked = available.length ? weightedPick(available) : null;
    if (!picked) continue;
    out[index] = { ...spawn, affixes: [picked.id] };
    need--;
  }
  return out;
}

function assignRolledAffixes(enemySpawns, options = {}) {
  const { affixConfig = null, difficultyId = 'normal', act = 'act1', eclipse = null } = options;
  if (!Array.isArray(enemySpawns) || enemySpawns.length === 0) return enemySpawns || [];
  const config = affixConfig;
  if (!config || !Array.isArray(config.affixes)) return enemySpawns;

  const rules = effectiveRules(config, difficultyId, eclipse);
  if (
    !rules ||
    rules.excludedActs.includes(act) ||
    rules.maxAffixesPerUnit <= 0 ||
    rules.affixChance <= 0 ||
    rules.tierPool.length === 0
  ) {
    return enemySpawns;
  }

  const chance = Math.max(0, Math.min(1, rules.affixChance * resolveActMultiplier(config, act)));
  if (chance <= 0) return enemySpawns;

  const tierPool = new Set(rules.tierPool);
  const allowedAffixes = config.affixes.filter(
    (affix) =>
      tierPool.has(Math.trunc(asNumber(affix?.tier, 0))) &&
      !rules.excludedAffixes.includes(affix.id),
  );
  if (allowedAffixes.length === 0) return enemySpawns;

  const exclusionMaps = buildExclusionMaps(config);

  const bossRules = config?.config?.bossAffixRules;

  return enemySpawns.map((spawn) => {
    // Entity bosses use curated affixes when bossAffixRules.enabled is true.
    // If disabled, they fall through to the regular boss skip (line below) and get no affixes.
    // This is intentional — entity bosses should only receive curated affixes, never random ones.
    if (spawn?.isBoss && spawn.isEntity && bossRules?.enabled) {
      const entityPool = (config.affixes || []).filter(
        (a) =>
          bossRules.entityAffixPool?.includes(a.id) && !bossRules.excludeFromEntity?.includes(a.id),
      );
      if (entityPool.length === 0) return spawn;
      const count = Math.min(bossRules.entityAffixCount || 2, entityPool.length);
      const selected = [];
      const selectedIds = new Set();
      const entityExclusions = buildExclusionMaps(config);
      for (let i = 0; i < count; i++) {
        const available = entityPool
          .filter((a) => isAffixAllowed(a, selectedIds, spawn.className, entityExclusions))
          .map((a) => ({ item: a, weight: Math.max(0.01, asNumber(a.weight, 1)) }));
        if (available.length === 0) break;
        const picked = weightedPick(available);
        if (!picked) break;
        selected.push(picked.id);
        selectedIds.add(picked.id);
      }
      return selected.length > 0 ? { ...spawn, affixes: selected } : spawn;
    }
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
