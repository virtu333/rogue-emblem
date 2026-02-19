// EnemySampling.js — Shared enemy class/level/tier sampling for sim parity.

function normalizeLevelRange(range) {
  if (!Array.isArray(range) || range.length < 2) return [1, 1];
  const minRaw = Math.trunc(Number(range[0]) || 1);
  const maxRaw = Math.trunc(Number(range[1]) || minRaw);
  const min = Math.max(1, Math.min(minRaw, maxRaw));
  const max = Math.max(min, Math.max(minRaw, maxRaw));
  return [min, max];
}

function sampleFrom(array) {
  if (!Array.isArray(array) || array.length === 0) return null;
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Sample an enemy spec from an act pool.
 * Returns { className, level, tier }.
 */
export function sampleEnemyFromAct(enemiesData, classesData, act, levelRangeOverride = null) {
  const pool = enemiesData?.pools?.[act] || null;
  const basePool = Array.isArray(pool?.base) ? pool.base : [];
  const promotedPool = Array.isArray(pool?.promoted) ? pool.promoted : [];
  const combined = [...basePool, ...promotedPool];
  const className = sampleFrom(combined) || 'Fighter';

  const [minLevel, maxLevel] = normalizeLevelRange(levelRangeOverride || pool?.levelRange);
  const level = minLevel + Math.floor(Math.random() * (maxLevel - minLevel + 1));

  const classData = Array.isArray(classesData)
    ? classesData.find((candidate) => candidate?.name === className)
    : null;
  const tier = classData?.tier || (promotedPool.includes(className) ? 'promoted' : 'base');

  return { className, level, tier };
}
