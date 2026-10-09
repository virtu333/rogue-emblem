// EarnedBlessings.js - the ledger of earned blessings (docs/specs/blessings-v3.md §6).
//
// An earned blessing (`earned: true` in data/blessings.json) is won in a run, never offered at
// the start, a church or an event. The first source is the act boss: after its victory the run
// is owed a pick of two (or, now and then, nothing). The pick is ROLLED once, at the victory
// commit, and stored on a per-act ledger (`run.earnedBlessingPicks`), so a reload between the
// boss and the pick shows the same pair, a taken or skipped pick is never offered again and the
// pair never depends on what the player did in between.
//
//   run.earnedBlessingPicks = {
//     act1: { version: 1, source: 'act_boss', actId: 'act1', nodeId, offered: [id, id],
//             status: 'owed' | 'taken' | 'skipped' | 'none', chosen: null | id },
//   }
//
// 'none' is an act boss that offered nothing (the odds roll, or no earned blessing left to
// offer): recorded so the same boss is not rolled twice.
//
// The offer is drawn from its own seeded stream (a hash of the run seed and the act): never
// `Math.random`, so the pick moves neither the battle stream nor the node-map stream.
//
// Pure: no Phaser, no DOM. Task 1 of the earned-blessings work defines the ledger; the victory
// commit calls `prepareEarnedBlessingPick` (Task 3) and the pick menu calls the take/skip pair.

import { createSeededRng, isEarnedBlessing } from './BlessingEngine.js';
import { isPrologueRun } from './ScriptedBattle.js';

export const EARNED_PICK_VERSION = 1;
export const EARNED_PICK_SOURCE_ACT_BOSS = 'act_boss';
export const EARNED_PICK_STATUSES = Object.freeze(['owed', 'taken', 'skipped', 'none']);

/** What the data names when it names nothing: two cards, and a gentle fall in the odds. */
export const DEFAULT_EARNED_OFFER = Object.freeze({
  actBoss: 2,
  weightByHeld: Object.freeze([1, 0.85, 0.7]),
});

// Same FNV-1a ChurchVow uses: a stable string -> uint32 that never touches a shared stream.
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The offer rules, from `blessings.json` `earnedOffer`, with a malformed or missing block
 * falling back to the defaults. `weightByHeld[n]` is the odds an act boss offers a pick at all
 * for a run already holding n earned blessings (the last entry holds for more).
 */
export function earnedOfferConfig(catalog) {
  const raw = catalog?.earnedOffer;
  const count = Math.trunc(Number(raw?.actBoss));
  const weights = Array.isArray(raw?.weightByHeld)
    ? raw.weightByHeld.map(Number).filter((w) => Number.isFinite(w) && w >= 0 && w <= 1)
    : [];
  return {
    actBoss: count >= 1 ? count : DEFAULT_EARNED_OFFER.actBoss,
    weightByHeld: weights.length > 0 ? weights : [...DEFAULT_EARNED_OFFER.weightByHeld],
  };
}

/** Every earned blessing in the catalog. */
export function earnedBlessingsOf(gameData) {
  return (gameData?.blessings?.blessings || []).filter(isEarnedBlessing);
}

/** The ids of the earned blessings this run holds. */
export function heldEarnedIds(run) {
  const earned = new Set(earnedBlessingsOf(run?.gameData).map((b) => b.id));
  return (run?.getActiveBlessingIds?.() || []).filter((id) => earned.has(id));
}

/**
 * The odds an act boss offers an earned pick at all, given how many earned blessings the run
 * already holds (the snowball guard: 1, 0.85, 0.7 with the shipped data). One function, so the
 * meaning of "held" changes in one place.
 */
export function earnedOfferChance(heldCount, config = DEFAULT_EARNED_OFFER) {
  const list = Array.isArray(config?.weightByHeld) ? config.weightByHeld : [];
  if (list.length === 0) return 1;
  const n = Math.max(0, Math.trunc(Number(heldCount)) || 0);
  return list[Math.min(n, list.length - 1)];
}

/**
 * True when `node` is this act's boss: the one predicate `RunManager.completeBattle` reads to
 * pay the boss's Vision and relieve the Eclipse.
 */
export function isActBossVictory(run, node) {
  return Boolean(node) && node.id === run?.nodeMap?.bossNodeId && node.type === 'boss';
}

/**
 * True when this boss victory owes a pick that has not been prepared: a real run's act boss,
 * not the final act's (the last boss ends the run), and no ledger entry for the act yet.
 */
export function actBossPickDue(run, node) {
  if (!run || isPrologueRun(run)) return false;
  if (!isActBossVictory(run, node)) return false;
  if (!Array.isArray(run.actSequence) || run.actIndex >= run.actSequence.length - 1) return false;
  return !ledgerOf(run)[run.currentAct];
}

function ledgerOf(run) {
  return isPlainObject(run?.earnedBlessingPicks) ? run.earnedBlessingPicks : {};
}

/**
 * Roll this act's boss offer: `{ status: 'owed', offered: [id, ...] }` or
 * `{ status: 'none', offered: [] }`. Deterministic in (run seed, act, what the run holds):
 * the first draw is the odds roll (always spent, so the pair does not depend on the odds), then
 * the cards are drawn without replacement by `weight` among the earned blessings the run does
 * not hold (weight 0 never). Never `Math.random`.
 */
export function rollActBossEarnedOffer(run) {
  const config = earnedOfferConfig(run?.gameData?.blessings);
  const held = new Set(run?.getActiveBlessingIds?.() || []);
  const rand = createSeededRng(
    hash(`earned-pick:${Number(run?.runSeed) >>> 0}:${run?.currentAct}`),
  );
  const chance = earnedOfferChance(heldEarnedIds(run).length, config);
  const roll = rand();
  if (!(roll < chance)) return { status: 'none', offered: [] };

  const pool = earnedBlessingsOf(run?.gameData).filter(
    (b) => !held.has(b.id) && (Number.isFinite(b.weight) ? b.weight : 1) > 0,
  );
  const offered = [];
  while (offered.length < config.actBoss && pool.length > 0) {
    const total = pool.reduce((sum, b) => sum + (Number.isFinite(b.weight) ? b.weight : 1), 0);
    let target = rand() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      target -= Number.isFinite(pool[i].weight) ? pool[i].weight : 1;
      if (target <= 0) {
        index = i;
        break;
      }
    }
    offered.push(pool.splice(index, 1)[0].id);
  }
  return offered.length > 0 ? { status: 'owed', offered } : { status: 'none', offered: [] };
}

/**
 * Roll and store this act's pick (idempotent: an act with an entry keeps it, so a repeat call,
 * a reload or a lazy re-prepare returns the same pair). Returns the entry, or null when the
 * run owes none (`actBossPickDue` is false and there is no entry).
 */
export function prepareEarnedBlessingPick(run, node) {
  const existing = ledgerOf(run)[run?.currentAct];
  if (existing) return existing;
  if (!actBossPickDue(run, node)) return null;
  if (!isPlainObject(run.earnedBlessingPicks)) run.earnedBlessingPicks = {};
  const rolled = rollActBossEarnedOffer(run);
  const entry = {
    version: EARNED_PICK_VERSION,
    source: EARNED_PICK_SOURCE_ACT_BOSS,
    actId: run.currentAct,
    nodeId: node.id,
    offered: rolled.offered,
    status: rolled.status,
    chosen: null,
  };
  run.earnedBlessingPicks[run.currentAct] = entry;
  return entry;
}

/** The pick the run still owes: the current act's owed entry first, else any owed one. */
export function earnedPickOwed(run) {
  const ledger = ledgerOf(run);
  const current = ledger[run?.currentAct];
  if (current?.status === 'owed') return current;
  return Object.values(ledger).find((entry) => entry?.status === 'owed') || null;
}

/**
 * Take one of an owed pick's cards: the blessing joins the run and its boons apply now. Refused
 * (nothing changes) unless the act's pick is owed and `blessingId` is one of the cards offered
 * (or the blessing cannot join: already held); a second call finds the pick taken and refuses.
 * @returns {{ ok: true, blessing: object } | { ok: false, reason: string }}
 */
export function takeEarnedBlessing(run, actId, blessingId) {
  const entry = ledgerOf(run)[actId];
  if (!entry || entry.status !== 'owed') return { ok: false, reason: 'No pick is owed.' };
  if (!entry.offered.includes(blessingId))
    return { ok: false, reason: 'That blessing was not offered.' };
  const blessing = (run.gameData?.blessings?.blessings || []).find((b) => b.id === blessingId);
  if (!blessing || !isEarnedBlessing(blessing))
    return { ok: false, reason: 'That blessing is not an earned blessing.' };
  if (!run.addBlessingMidRun(blessingId, { earned: true }))
    return { ok: false, reason: 'That blessing could not be taken.' };
  entry.status = 'taken';
  entry.chosen = blessingId;
  run._recordBlessingEvent?.('earned_pick', blessingId, null, {
    actId,
    source: entry.source,
    offered: [...entry.offered],
  });
  return { ok: true, blessing };
}

/** Leave an owed pick untaken for good. @returns {{ ok: boolean, reason?: string }} */
export function skipEarnedBlessing(run, actId) {
  const entry = ledgerOf(run)[actId];
  if (!entry || entry.status !== 'owed') return { ok: false, reason: 'No pick is owed.' };
  entry.status = 'skipped';
  return { ok: true };
}

/**
 * A saved ledger read back: well-formed entries kept as plain objects, anything else dropped (a
 * dropped act is simply prepared again, to the same pair, if its boss is still unclaimed).
 */
export function sanitizeEarnedBlessingPicks(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const [actId, entry] of Object.entries(raw)) {
    if (!actId || !isPlainObject(entry)) continue;
    if (!EARNED_PICK_STATUSES.includes(entry.status)) continue;
    const offered = Array.isArray(entry.offered)
      ? [...new Set(entry.offered.filter((id) => typeof id === 'string' && id))]
      : [];
    const chosen = typeof entry.chosen === 'string' && entry.chosen ? entry.chosen : null;
    if (entry.status === 'owed' && offered.length === 0) continue;
    if (entry.status === 'taken' && !chosen) continue;
    out[actId] = {
      version: Number.isFinite(entry.version) ? Math.trunc(entry.version) : EARNED_PICK_VERSION,
      source:
        typeof entry.source === 'string' && entry.source
          ? entry.source
          : EARNED_PICK_SOURCE_ACT_BOSS,
      actId,
      nodeId: typeof entry.nodeId === 'string' && entry.nodeId ? entry.nodeId : null,
      offered,
      status: entry.status,
      chosen: entry.status === 'taken' ? chosen : null,
    };
  }
  return out;
}
