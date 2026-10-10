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
      // Runs that took the shrine's gift with a catch (engine/StartGifts.js): neither a
      // blessing picked nor one skipped.
      runsWithGift: 0,
      victories: 0,
      defeats: 0,
    },
    blessings: {},
    // Per gift id: offers, picks (taken) and the outcomes of the runs that took it.
    gifts: {},
  };
}

function ensureGiftStats(snapshot, giftId) {
  if (!snapshot.gifts || typeof snapshot.gifts !== 'object') snapshot.gifts = {};
  if (!snapshot.gifts[giftId]) {
    snapshot.gifts[giftId] = { offers: 0, picks: 0, runs: 0, wins: 0, losses: 0 };
  }
  return snapshot.gifts[giftId];
}

const nonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

/** The blessing ids a taken start gift handed out (Sealed Reliquary, Pilgrim's Wager). */
function giftGrantedBlessingIds(startGift) {
  return (Array.isArray(startGift?.granted) ? startGift.granted : [])
    .filter((entry) => entry?.kind === 'blessing')
    .map((entry) => nonEmptyString(entry.id))
    .filter(Boolean);
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
  // A card a start gift handed out is counted apart from picks (older snapshots lack it).
  if (!Number.isFinite(snapshot.blessings[blessingId].giftGrants))
    snapshot.blessings[blessingId].giftGrants = 0;
  return snapshot.blessings[blessingId];
}

function extractBlessingId(entry) {
  if (typeof entry === 'string') {
    const id = entry.trim();
    return id.length > 0 ? id : null;
  }
  if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') return null;
  const id = entry.id.trim();
  return id.length > 0 ? id : null;
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
    if (!parsed.global || typeof parsed.global !== 'object')
      parsed.global = createEmptySnapshot().global;
    if (!parsed.blessings || typeof parsed.blessings !== 'object') parsed.blessings = {};
    if (!parsed.gifts || typeof parsed.gifts !== 'object') parsed.gifts = {};
    if (!Number.isFinite(parsed.global.runsWithGift)) parsed.global.runsWithGift = 0;
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

/**
 * One shrine selection. `giftOfferedId` is the gift the shrine offered (if any) and `giftId` the
 * gift taken in place of a blessing: a gift run counts as `runsWithGift`, never as a skipped
 * blessing, and a card the gift handed out (`grantedBlessingId`) as that card's `giftGrants`,
 * never as a pick.
 */
export function recordBlessingSelection({
  offeredIds = [],
  chosenId = null,
  giftOfferedId = null,
  giftId = null,
  grantedBlessingId = null,
} = {}) {
  const snapshot = loadBlessingAnalytics();
  const offered = [
    ...new Set(
      (Array.isArray(offeredIds) ? offeredIds : []).filter(
        (id) => typeof id === 'string' && id.length > 0,
      ),
    ),
  ];
  const selected = typeof chosenId === 'string' && chosenId.length > 0 ? chosenId : null;
  const selectedAt = Date.now();

  for (const blessingId of offered) {
    const stats = ensureBlessingStats(snapshot, blessingId);
    stats.offers += 1;
  }

  const offeredGift = nonEmptyString(giftOfferedId);
  const takenGift = nonEmptyString(giftId);
  if (offeredGift) ensureGiftStats(snapshot, offeredGift).offers += 1;

  snapshot.global.selections += 1;
  if (takenGift) {
    snapshot.global.runsWithGift += 1;
    const gift = ensureGiftStats(snapshot, takenGift);
    // A gift taken that was not recorded as offered still counts its offer once.
    if (takenGift !== offeredGift) gift.offers += 1;
    gift.picks += 1;
    const granted = nonEmptyString(grantedBlessingId);
    if (granted) ensureBlessingStats(snapshot, granted).giftGrants += 1;
  } else if (!selected) {
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

/**
 * A run's outcome, credited to each blessing it held. A taken start gift (`startGift`, the run's
 * record) is credited to the gift; a card the gift handed out is part of the gift, so its own
 * stats are left alone.
 */
export function recordBlessingRunOutcome({
  activeBlessings = [],
  result = 'defeat',
  actIndex = 0,
  completedBattles = 0,
  startGift = null,
} = {}) {
  const snapshot = loadBlessingAnalytics();
  const now = Date.now();
  const fromGift = new Set(giftGrantedBlessingIds(startGift));
  const blessingIds = [
    ...new Set(
      (Array.isArray(activeBlessings) ? activeBlessings : [])
        .map(extractBlessingId)
        .filter((id) => id && !fromGift.has(id)),
    ),
  ];
  const isVictory = result === 'victory';
  const safeActReached = Math.max(1, Math.trunc(Number(actIndex) + 1) || 1);
  const safeBattles = Math.max(0, Math.trunc(Number(completedBattles) || 0));

  snapshot.global.runsCompleted += 1;
  if (isVictory) snapshot.global.victories += 1;
  else snapshot.global.defeats += 1;

  const giftId = nonEmptyString(startGift?.id);
  if (giftId) {
    const gift = ensureGiftStats(snapshot, giftId);
    gift.runs += 1;
    if (isVictory) gift.wins += 1;
    else gift.losses += 1;
  }

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
