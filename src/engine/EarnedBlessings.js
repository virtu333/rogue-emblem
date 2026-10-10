// EarnedBlessings.js - the ledger of earned blessings (docs/specs/blessings-v3.md §6).
//
// An earned blessing (`earned: true` in data/blessings.json) is won in a run, never offered at
// the start, by an ordinary church vow or by an event's `blessing` effect. Each card names where
// it is won (`sources: [{ kind, acts? }]`): an act boss's pick, an eclipsed elite's spoils, the
// Old Sanctum's vow, the Colosseum or an event's outcome. Every offer is ROLLED once, when it is
// earned, and stored on one ledger (`run.earnedBlessingPicks`), so a reload shows the same
// cards, a taken or skipped offer is never offered again and the cards never depend on what the
// player did in between.
//
//   run.earnedBlessingPicks = {
//     act1:              { version, source: 'act_boss', actId: 'act1', nodeId, offered: [id, id],
//                          status, chosen },
//     'elite:act2_3_1':  { version: 2, key: 'elite:act2_3_1', source: 'eclipsed_elite', actId,
//                          nodeId, offered: [id], status, chosen },
//     'sanctum:act2_4_0':{ ..., source: 'sanctum', status: 'open' | 'taken' | 'none' },
//     'event:act3_2_2':  { ..., source: 'event', status: 'taken', chosen },
//     colosseum:         { ..., source: 'colosseum' },
//   }
//
// Ledger keys (`ledgerKeyOf`): an act boss keeps the bare act id (the PR C ledger, unchanged); the
// others are `elite:<node>`, `sanctum:<node>`, `event:<node>` and `colosseum` (once a run). Node
// ids are act-qualified, so keys never collide across acts. An entry's `actId` is the act it was
// earned in (the sanitizer reads it against the run's acts).
//
// Statuses: 'owed' (a pick to take or skip: the act boss, an elite's drop, the Colosseum's),
// 'open' (the Old Sanctum's pair, taken by its vow; never "owed": leaving the church leaves it
// open), 'taken', 'skipped' and 'none' (the source offered nothing, recorded so it is never
// rolled twice).
//
// Every offer is drawn from its own seeded stream (a hash of the run seed and the source's key),
// never `Math.random`, so an earned blessing moves neither the battle, the node-map, the loot,
// the recruit nor the eclipse stream.
//
// Pure: no Phaser, no DOM.

import { createSeededRng, isEarnedBlessing } from './BlessingEngine.js';
import { isPrologueRun } from './ScriptedBattle.js';
import { isSanctum } from './SanctumPass.js';

export const EARNED_PICK_VERSION = 2;
export const EARNED_PICK_SOURCE_ACT_BOSS = 'act_boss';
export const EARNED_PICK_SOURCES = Object.freeze([
  'act_boss',
  'eclipsed_elite',
  'sanctum',
  'colosseum',
  'event',
]);
export const EARNED_PICK_STATUSES = Object.freeze(['owed', 'taken', 'skipped', 'none', 'open']);

/** What the data names when it names nothing: two cards, and a gentle fall in the odds. */
export const DEFAULT_EARNED_OFFER = Object.freeze({
  actBoss: 2,
  weightByHeld: Object.freeze([1, 0.85, 0.7]),
});

/** The other sources' numbers when the data names none (decisions D-4, D-5, D-6). */
export const DEFAULT_EARNED_SOURCES = Object.freeze({
  eclipsedEliteChance: 1 / 3,
  sanctumChance: 0.5,
  sanctumCards: 2,
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

const seedOf = (run) => Number(run?.runSeed) >>> 0;
const weightOf = (b) => (Number.isFinite(b?.weight) ? b.weight : 1);
const isShare = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * The act boss's offer rules, from `blessings.json` `earnedOffer`, with a malformed or missing
 * block falling back to the defaults (a bad `weightByHeld` entry sends the whole array to its
 * defaults). `weightByHeld[n]` is the odds an act boss offers a pick at all for a run already
 * holding n earned blessings (the last entry holds for more).
 */
export function earnedOfferConfig(catalog) {
  const raw = catalog?.earnedOffer;
  const count = Math.trunc(Number(raw?.actBoss));
  // One bad entry rejects the whole array: dropping it would shift every later entry down a
  // place (the odds for 2 held would read as the odds for 1), which is worse than the defaults.
  const list = raw?.weightByHeld;
  const valid =
    Array.isArray(list) &&
    list.length > 0 &&
    list.every((w) => typeof w === 'number' && Number.isFinite(w) && w >= 0 && w <= 1);
  return {
    actBoss: count >= 1 ? count : DEFAULT_EARNED_OFFER.actBoss,
    weightByHeld: valid ? [...list] : [...DEFAULT_EARNED_OFFER.weightByHeld],
  };
}

/**
 * The other sources' numbers from `earnedOffer`: the eclipsed elite's flat drop chance (D-4) and
 * the Old Sanctum's stamp chance (D-5). A malformed number falls back to its default.
 */
export function earnedSourceConfig(catalog) {
  const raw = catalog?.earnedOffer;
  return {
    eclipsedEliteChance: isShare(raw?.eclipsedEliteChance)
      ? raw.eclipsedEliteChance
      : DEFAULT_EARNED_SOURCES.eclipsedEliteChance,
    sanctumChance: isShare(raw?.sanctum?.chance)
      ? raw.sanctum.chance
      : DEFAULT_EARNED_SOURCES.sanctumChance,
    sanctumCards: DEFAULT_EARNED_SOURCES.sanctumCards,
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

/** Where an earned blessing is won: its `sources` (`[{ kind, acts? }]`), or none. */
export function earnedSourcesOf(blessing) {
  if (!isEarnedBlessing(blessing) || !Array.isArray(blessing.sources)) return [];
  return blessing.sources.filter((s) => isPlainObject(s) && EARNED_PICK_SOURCES.includes(s.kind));
}

/** True when the earned blessing can be won from `kind` in `actId` (a source's `acts` limit it). */
export function isEarnedFrom(blessing, kind, actId = null) {
  return earnedSourcesOf(blessing).some(
    (s) => s.kind === kind && (!Array.isArray(s.acts) || s.acts.includes(actId)),
  );
}

/** True for a twisted earned blessing (one taken with a `twist`). */
export function isTwistedBlessing(blessing) {
  return isEarnedBlessing(blessing) && isPlainObject(blessing.twist);
}

/** A twisted blessing's twist as a held price (`{ label, effects, kind: 'twist' }`), or null. */
export function twistPriceOf(blessing) {
  if (!isTwistedBlessing(blessing)) return null;
  return {
    label: blessing.twist.label,
    effects: structuredClone(blessing.twist.effects || []),
    kind: 'twist',
  };
}

/** True when the run meets the blessing's `requires` (`eclipse`: the run's Eclipse is on, or off). */
function meetsRequires(run, blessing) {
  const req = blessing?.requires;
  if (!isPlainObject(req)) return true;
  if (req.eclipse !== undefined && Boolean(run?.isEclipseActive?.()) !== req.eclipse) return false;
  return true;
}

/** True when the card and a held blessing exclude each other (`excludes`, either way). */
function excludedByHeld(blessing, heldIds, index) {
  const own = Array.isArray(blessing.excludes) ? blessing.excludes : [];
  for (const id of heldIds) {
    if (own.includes(id)) return true;
    const other = index.get(id);
    if (Array.isArray(other?.excludes) && other.excludes.includes(blessing.id)) return true;
  }
  return false;
}

/**
 * The earned blessings `kind` may offer this run now, in catalog order: earned, weight above 0,
 * not held, not excluded by (and not excluding) a held blessing, its `requires` met, won from
 * `kind` (and, when its source names acts, in `actId`). A twisted card only ever comes from an
 * act boss.
 * @param {object} run
 * @param {string} kind - a source kind
 * @param {{ actId?: string }} [options]
 */
export function earnedPoolFor(run, kind, { actId = run?.currentAct } = {}) {
  const catalog = run?.gameData?.blessings?.blessings || [];
  const index = new Map(catalog.map((b) => [b?.id, b]));
  const held = run?.getActiveBlessingIds?.() || [];
  const heldSet = new Set(held);
  return earnedBlessingsOf(run?.gameData).filter(
    (b) =>
      weightOf(b) > 0 &&
      !heldSet.has(b.id) &&
      !excludedByHeld(b, held, index) &&
      meetsRequires(run, b) &&
      isEarnedFrom(b, kind, actId) &&
      (kind === EARNED_PICK_SOURCE_ACT_BOSS || !isTwistedBlessing(b)),
  );
}

/**
 * Draw up to `count` cards from `pool` by weight, without replacement (`pool` is not changed).
 * `allow(card, offered)` may refuse a card given the cards already drawn (the twist rule).
 */
function drawCards(pool, count, rand, allow = () => true) {
  const left = [...pool];
  const offered = [];
  while (offered.length < count) {
    const open = left.filter((b) => allow(b, offered));
    if (open.length === 0) break;
    const total = open.reduce((sum, b) => sum + weightOf(b), 0);
    let target = rand() * total;
    let pick = open[open.length - 1];
    for (const b of open) {
      target -= weightOf(b);
      if (target <= 0) {
        pick = b;
        break;
      }
    }
    offered.push(pick);
    left.splice(left.indexOf(pick), 1);
  }
  return offered;
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

/** The ledger key an entry is filed under: its `key`, else (an act boss's) its act. */
export function ledgerKeyOf(entry) {
  if (typeof entry?.key === 'string' && entry.key) return entry.key;
  return typeof entry?.actId === 'string' ? entry.actId : null;
}

/** The ledger keys of the other sources. */
export const eliteLedgerKey = (nodeId) => `elite:${nodeId}`;
export const sanctumLedgerKey = (nodeId) => `sanctum:${nodeId}`;
export const eventLedgerKey = (nodeId) => `event:${nodeId}`;
export const COLOSSEUM_LEDGER_KEY = 'colosseum';

function ledgerOf(run) {
  return isPlainObject(run?.earnedBlessingPicks) ? run.earnedBlessingPicks : {};
}

/** The ledger entry filed under `key`, or null. */
export function earnedLedgerEntry(run, key) {
  const entry = ledgerOf(run)[key];
  return isPlainObject(entry) ? entry : null;
}

/** File a new entry (an act boss's under its act, every other source under its own key). */
function fileEntry(run, key, { source, nodeId, offered, status, chosen = null }) {
  if (!isPlainObject(run.earnedBlessingPicks)) run.earnedBlessingPicks = {};
  const entry = {
    version: EARNED_PICK_VERSION,
    ...(source === EARNED_PICK_SOURCE_ACT_BOSS ? {} : { key }),
    source,
    actId: run.currentAct,
    nodeId: nodeId ?? null,
    offered,
    status,
    chosen,
  };
  run.earnedBlessingPicks[key] = entry;
  return entry;
}

// ── The act boss ────────────────────────────────────────────────────────

/**
 * True when `node` is this act's boss: the one predicate `RunManager.completeBattle` reads to
 * pay the boss's Vision and that `actBossPickDue` reads for the pick.
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

/**
 * Roll this act's boss offer: `{ status: 'owed', offered: [id, ...] }` or
 * `{ status: 'none', offered: [] }`. Deterministic in (run seed, act, what the run holds):
 * the first draw is the odds roll (always spent, so the pair does not depend on the odds), then
 * the cards are drawn without replacement by `weight` among the earned blessings an act boss may
 * offer in this act (`earnedPoolFor(run, 'act_boss')`). A pair holds at most one twisted card
 * (D-3): once one is drawn, the next draw leaves the twisted out. Never `Math.random`.
 */
export function rollActBossEarnedOffer(run) {
  const config = earnedOfferConfig(run?.gameData?.blessings);
  const rand = createSeededRng(hash(`earned-pick:${seedOf(run)}:${run?.currentAct}`));
  const chance = earnedOfferChance(heldEarnedIds(run).length, config);
  const roll = rand();
  if (!(roll < chance)) return { status: 'none', offered: [] };
  const pool = earnedPoolFor(run, EARNED_PICK_SOURCE_ACT_BOSS);
  const offered = drawCards(
    pool,
    config.actBoss,
    rand,
    (card, drawn) => !isTwistedBlessing(card) || !drawn.some(isTwistedBlessing),
  ).map((b) => b.id);
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
  const rolled = rollActBossEarnedOffer(run);
  return fileEntry(run, run.currentAct, {
    source: EARNED_PICK_SOURCE_ACT_BOSS,
    nodeId: node.id,
    offered: rolled.offered,
    status: rolled.status,
  });
}

// ── An eclipsed elite's drop (D-7) ──────────────────────────────────────

/**
 * True when this victory is an eclipsed elite's (a battle node the Eclipse took: never a Dark
 * Omen's event fight, the prologue or an ordinary elite) and its drop has not been rolled.
 */
export function eliteDropDue(run, node) {
  if (!run || !node || isPrologueRun(run)) return false;
  if (node.type !== 'battle' || node.battleParams?.isEclipsed !== true) return false;
  if (node.darkOmen === true || node.eventBattle === true) return false;
  return !ledgerOf(run)[eliteLedgerKey(node.id)];
}

/**
 * Roll and store an eclipsed elite's drop, at the victory commit: a flat chance
 * (`earnedOffer.eclipsedEliteChance`, a third) of one pure earned card (`eclipsed_elite`), on its
 * own stream (`earned-elite:<seed>:<node>`; the chance draw is always spent). Owed (one card, take
 * or skip) or 'none'. Idempotent; null when no drop is due and none is filed.
 */
export function prepareEliteEarnedDrop(run, node) {
  const key = eliteLedgerKey(node?.id);
  const existing = ledgerOf(run)[key];
  if (existing) return existing;
  if (!eliteDropDue(run, node)) return null;
  const { eclipsedEliteChance } = earnedSourceConfig(run.gameData?.blessings);
  const rand = createSeededRng(hash(`earned-elite:${seedOf(run)}:${node.id}`));
  const hit = rand() < eclipsedEliteChance;
  const card = drawCards(earnedPoolFor(run, 'eclipsed_elite'), 1, rand)[0] || null;
  const offered = hit && card ? [card.id] : [];
  return fileEntry(run, key, {
    source: 'eclipsed_elite',
    nodeId: node.id,
    offered,
    status: offered.length ? 'owed' : 'none',
  });
}

// ── The Old Sanctum (D-6) ───────────────────────────────────────────────

/**
 * The Old Sanctum's pair, rolled the first time its door opens and kept (status 'open' until
 * its vow takes one; 'none' when nothing is left, and the church's tier I offers return): up to
 * two `sanctum` cards, the rest filled from the pure act-boss and eclipsed-elite cards, on its own
 * stream (`earned-sanctum:<seed>:<node>`). Null for a node that is no sanctum, or in the prologue.
 */
export function openSanctum(run, nodeId) {
  const key = sanctumLedgerKey(nodeId);
  const existing = ledgerOf(run)[key];
  if (existing) return existing;
  if (!run || isPrologueRun(run)) return null;
  const node = run.nodeMap?.nodes?.find((n) => n?.id === nodeId);
  if (!isSanctum(node)) return null;
  const { sanctumCards } = earnedSourceConfig(run.gameData?.blessings);
  const rand = createSeededRng(hash(`earned-sanctum:${seedOf(run)}:${nodeId}`));
  const offered = drawCards(earnedPoolFor(run, 'sanctum'), sanctumCards, rand);
  if (offered.length < sanctumCards) {
    const fill = [];
    for (const kind of [EARNED_PICK_SOURCE_ACT_BOSS, 'eclipsed_elite'])
      for (const b of earnedPoolFor(run, kind))
        if (!isTwistedBlessing(b) && !fill.includes(b) && !offered.includes(b)) fill.push(b);
    const order = new Map(earnedBlessingsOf(run.gameData).map((b, i) => [b.id, i]));
    fill.sort((a, b) => order.get(a.id) - order.get(b.id));
    offered.push(...drawCards(fill, sanctumCards - offered.length, rand));
  }
  const ids = offered.map((b) => b.id);
  return fileEntry(run, key, {
    source: 'sanctum',
    nodeId,
    offered: ids,
    status: ids.length ? 'open' : 'none',
  });
}

// ── The Colosseum (D-8; the card ships in a later PR) ───────────────────

/**
 * The Colosseum's offer, once a run (key `colosseum`): one `colosseum` card, owed. Idempotent;
 * null when the run already has an entry for it or nothing is left to offer.
 */
export function prepareColosseumOffer(run, nodeId) {
  if (!run || isPrologueRun(run)) return null;
  const existing = ledgerOf(run)[COLOSSEUM_LEDGER_KEY];
  if (existing) return existing;
  const rand = createSeededRng(hash(`earned-colosseum:${seedOf(run)}`));
  const card = drawCards(earnedPoolFor(run, 'colosseum'), 1, rand)[0] || null;
  if (!card) return null;
  return fileEntry(run, COLOSSEUM_LEDGER_KEY, {
    source: 'colosseum',
    nodeId,
    offered: [card.id],
    status: 'owed',
  });
}

// ── An event's grant (D-9) ──────────────────────────────────────────────

/** Why the event cannot grant this earned blessing now ('' when it can). */
export function earnedGrantBlock(run, blessingId, { source = 'event', key = null } = {}) {
  const blessing = (run?.gameData?.blessings?.blessings || []).find((b) => b?.id === blessingId);
  if (!blessing || !isEarnedBlessing(blessing)) return 'That is no earned blessing.';
  if (!isEarnedFrom(blessing, source, run?.currentAct)) return 'It is not won here.';
  if ((run?.getActiveBlessingIds?.() || []).includes(blessingId)) return 'You already carry it.';
  if (key && ledgerOf(run)[key]) return 'It was already given here.';
  return '';
}

/**
 * An earned blessing handed out directly (an event's `earnedBlessing` effect): it joins the run,
 * its boons apply, and the ledger records it taken under `key`. Refused (nothing changes) when
 * `earnedGrantBlock` names a reason or the blessing cannot join.
 * @returns {{ ok: true, blessing: object, entry: object } | { ok: false, reason: string }}
 */
export function grantEarnedBlessing(
  run,
  blessingId,
  { source = 'event', key, nodeId = null } = {},
) {
  const reason = earnedGrantBlock(run, blessingId, { source, key });
  if (reason) return { ok: false, reason };
  const blessing = run.gameData.blessings.blessings.find((b) => b.id === blessingId);
  if (!run.addBlessingMidRun(blessingId, { earned: true, source }))
    return { ok: false, reason: 'That blessing could not be taken.' };
  const entry = fileEntry(run, key, {
    source,
    nodeId,
    offered: [blessingId],
    status: 'taken',
    chosen: blessingId,
  });
  run._recordEarnedPick?.(blessingId, { actId: entry.actId, source, key, offered: [blessingId] });
  return { ok: true, blessing, entry };
}

// ── Owed picks, taking and skipping ─────────────────────────────────────

/**
 * The pick the run still owes (take or skip; never an 'open' sanctum): the current act's boss
 * first, else the first owed entry. `keys` / `sources` narrow which entries count.
 * @param {object} run
 * @param {{ keys?: string[], sources?: string[] }} [filter]
 */
export function earnedPickOwed(run, { keys = null, sources = null } = {}) {
  const ledger = ledgerOf(run);
  const counts = (key, entry) =>
    entry?.status === 'owed' &&
    (!keys || keys.includes(key)) &&
    (!sources || sources.includes(entry.source || EARNED_PICK_SOURCE_ACT_BOSS));
  const current = ledger[run?.currentAct];
  if (counts(run?.currentAct, current)) return current;
  for (const [key, entry] of Object.entries(ledger)) if (counts(key, entry)) return entry;
  return null;
}

/**
 * Take one of an offer's cards (an owed pick, or an open sanctum): the blessing joins the run
 * and its boons apply now (a twisted card's twist with them, as its held price). Refused (nothing
 * changes) unless the entry under `key` is owed or open and `blessingId` is one of its cards (or
 * the blessing cannot join: already held); a second call finds it taken and refuses.
 * @param {object} run
 * @param {string} key - the ledger key (an act boss's is its act id)
 * @param {string} blessingId
 * @returns {{ ok: true, blessing: object } | { ok: false, reason: string }}
 */
export function takeEarnedBlessing(run, key, blessingId) {
  const entry = ledgerOf(run)[key];
  if (!entry || (entry.status !== 'owed' && entry.status !== 'open'))
    return { ok: false, reason: 'No pick is owed.' };
  if (!entry.offered.includes(blessingId))
    return { ok: false, reason: 'That blessing was not offered.' };
  const blessing = (run.gameData?.blessings?.blessings || []).find((b) => b.id === blessingId);
  if (!blessing || !isEarnedBlessing(blessing))
    return { ok: false, reason: 'That blessing is not an earned blessing.' };
  const source = entry.source || EARNED_PICK_SOURCE_ACT_BOSS;
  if (!run.addBlessingMidRun(blessingId, { earned: true, price: twistPriceOf(blessing), source }))
    return { ok: false, reason: 'That blessing could not be taken.' };
  entry.status = 'taken';
  entry.chosen = blessingId;
  run._recordEarnedPick?.(blessingId, {
    actId: entry.actId,
    source,
    ...(source === EARNED_PICK_SOURCE_ACT_BOSS ? {} : { key }),
    offered: [...entry.offered],
  });
  return { ok: true, blessing };
}

/** Leave an owed pick untaken for good. @returns {{ ok: boolean, reason?: string }} */
export function skipEarnedBlessing(run, key) {
  const entry = ledgerOf(run)[key];
  if (!entry || entry.status !== 'owed') return { ok: false, reason: 'No pick is owed.' };
  entry.status = 'skipped';
  return { ok: true };
}

/**
 * A saved ledger read back: well-formed entries kept as plain objects, anything else dropped (a
 * dropped act boss is simply prepared again, to the same pair, if its boss is still unclaimed).
 *
 * `earnedIds` (the earned ids the catalog knows) and `actSequence` (the run's acts) are what the
 * save is read against; either left out skips that check.
 *  - An offered id the catalog no longer has as an earned blessing is dropped from the cards; an
 *    owed or open offer with none left becomes 'none' (nothing to show, and not rolled again).
 *  - A taken entry with no recorded choice stays 'taken' (the choice null): the pick was made,
 *    so it is never prepared a second time.
 *  - An entry earned in an act the run does not have (its `actId`, or an act boss's key) is gone.
 *  - An unknown source is gone. An entry that is not an act boss's keeps its ledger key as `key`.
 * @param {*} raw
 * @param {{ earnedIds?: Iterable<string>|null, actSequence?: string[]|null }} [known]
 */
export function sanitizeEarnedBlessingPicks(raw, { earnedIds = null, actSequence = null } = {}) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  const earned = earnedIds ? new Set(earnedIds) : null;
  const acts = Array.isArray(actSequence) ? actSequence : null;
  for (const [key, entry] of Object.entries(raw)) {
    if (!key || !isPlainObject(entry)) continue;
    const source =
      entry.source === undefined || entry.source === null || entry.source === ''
        ? EARNED_PICK_SOURCE_ACT_BOSS
        : entry.source;
    if (!EARNED_PICK_SOURCES.includes(source)) continue;
    const boss = source === EARNED_PICK_SOURCE_ACT_BOSS;
    const actId = boss || typeof entry.actId !== 'string' || !entry.actId ? key : entry.actId;
    if (acts && !acts.includes(actId)) continue;
    if (!EARNED_PICK_STATUSES.includes(entry.status)) continue;
    let offered = Array.isArray(entry.offered)
      ? [...new Set(entry.offered.filter((id) => typeof id === 'string' && id))]
      : [];
    const showing = entry.status === 'owed' || entry.status === 'open';
    if (showing && offered.length === 0) continue;
    if (earned) offered = offered.filter((id) => earned.has(id));
    let status = entry.status;
    if (showing && offered.length === 0) status = 'none';
    const chosen = typeof entry.chosen === 'string' && entry.chosen ? entry.chosen : null;
    out[key] = {
      version: Number.isFinite(entry.version) ? Math.trunc(entry.version) : EARNED_PICK_VERSION,
      ...(boss ? {} : { key }),
      source,
      actId,
      nodeId: typeof entry.nodeId === 'string' && entry.nodeId ? entry.nodeId : null,
      offered,
      status,
      chosen: status === 'taken' ? chosen : null,
    };
  }
  return out;
}
