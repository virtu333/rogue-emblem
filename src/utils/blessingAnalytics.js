const STORAGE_KEY = 'emblem_rogue_blessing_analytics_v1';
const VERSION = 1;

function createEmptySnapshot() {
  return {
    version: VERSION,
    updatedAt: Date.now(),
    global: {
      selections: 0,
      runsCompleted: 0,
      runsWithBlessing: 0,
      runsSkippedBlessing: 0,
      victories: 0,
      defeats: 0,
    },
    blessings: {},
  };
}

function getStorage() {
  try {
    if (!globalThis?.localStorage) return null;
    return globalThis.localStorage;
  } catch (_) {
    return null;
  }
}

function ensureBlessingStats(snapshot, blessingId) {
  if (!snapshot.blessings[blessingId]) {
    snapshot.blessings[blessingId] = {
      offers: 0,
      picks: 0,
      runs: 0,
      wins: 0,
      losses: 0,
      totalActReached: 0,
      totalBattles: 0,
      lastSelectedAt: null,
      lastOutcomeAt: null,
    };
  }
  return snapshot.blessings[blessingId];
}

export function loadBlessingAnalytics() {
  const storage = getStorage();
  if (!storage) return createEmptySnapshot();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return createEmptySnapshot();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== VERSION || typeof parsed !== 'object') {
      return createEmptySnapshot();
    }
    if (!parsed.global || typeof parsed.global !== 'object') parsed.global = createEmptySnapshot().global;
    if (!parsed.blessings || typeof parsed.blessings !== 'object') parsed.blessings = {};
    return parsed;
  } catch (_) {
    return createEmptySnapshot();
  }
}

export function saveBlessingAnalytics(snapshot) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (_) {
    // ignore write failures (private mode / quota)
  }
}

export function recordBlessingSelection({ offeredIds = [], chosenId = null } = {}) {
  const snapshot = loadBlessingAnalytics();
  const offered = [...new Set((Array.isArray(offeredIds) ? offeredIds : []).filter(id => typeof id === 'string' && id.length > 0))];
  const selected = typeof chosenId === 'string' && chosenId.length > 0 ? chosenId : null;
  const selectedAt = Date.now();

  for (const blessingId of offered) {
    const stats = ensureBlessingStats(snapshot, blessingId);
    stats.offers += 1;
  }

  snapshot.global.selections += 1;
  if (!selected) {
    snapshot.global.runsSkippedBlessing += 1;
  } else {
    snapshot.global.runsWithBlessing += 1;
    const stats = ensureBlessingStats(snapshot, selected);
    stats.picks += 1;
    stats.lastSelectedAt = selectedAt;
  }

  snapshot.updatedAt = selectedAt;
  saveBlessingAnalytics(snapshot);
  return snapshot;
}

export function recordBlessingRunOutcome({ activeBlessings = [], result = 'defeat', actIndex = 0, completedBattles = 0 } = {}) {
  const snapshot = loadBlessingAnalytics();
  const now = Date.now();
  const blessingIds = [...new Set((Array.isArray(activeBlessings) ? activeBlessings : []).filter(id => typeof id === 'string' && id.length > 0))];
  const isVictory = result === 'victory';
  const safeActReached = Math.max(1, Math.trunc(Number(actIndex) + 1) || 1);
  const safeBattles = Math.max(0, Math.trunc(Number(completedBattles) || 0));

  snapshot.global.runsCompleted += 1;
  if (isVictory) snapshot.global.victories += 1;
  else snapshot.global.defeats += 1;

  for (const blessingId of blessingIds) {
    const stats = ensureBlessingStats(snapshot, blessingId);
    stats.runs += 1;
    if (isVictory) stats.wins += 1;
    else stats.losses += 1;
    stats.totalActReached += safeActReached;
    stats.totalBattles += safeBattles;
    stats.lastOutcomeAt = now;
  }

  snapshot.updatedAt = now;
  saveBlessingAnalytics(snapshot);
  return snapshot;
}

export function getBlessingAnalyticsSummary() {
  const snapshot = loadBlessingAnalytics();
  const perBlessing = Object.entries(snapshot.blessings)
    .map(([id, stats]) => ({
      id,
      ...stats,
      pickRate: stats.offers > 0 ? stats.picks / stats.offers : 0,
      winRate: stats.runs > 0 ? stats.wins / stats.runs : 0,
      avgActReached: stats.runs > 0 ? stats.totalActReached / stats.runs : 0,
      avgBattles: stats.runs > 0 ? stats.totalBattles / stats.runs : 0,
    }))
    .sort((a, b) => b.picks - a.picks || a.id.localeCompare(b.id));

  return {
    snapshot,
    perBlessing,
  };
}

