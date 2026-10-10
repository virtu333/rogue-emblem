// ChurchVow — each church asks for one vow (playtest 2026-09-28, Wave 4).
//
// Healing and reviving stay open at every church. Beyond them the player makes one
// vow per church: Promotion (as before: the church's promotions, within the
// difficulty's limit), a Blessing (one minor, tier-1 blessing added to the run,
// chosen from a few the altar offers) or, when the run holds a burden, a Cleansing (lift one
// burden of the player's choice, never Debt, and never a Lingering Injury, which Heal all mends without a
// vow: docs/specs/event-nodes-phase2.md §2B). The first
// promotion, the chosen blessing or the cleansed burden commits the vow; the other sides then
// stay closed for this church. A church only: never the Ruins' sanctuary, never the
// prologue. The vow is kept
// on the run (RunManager.churchVowByNodeId, saved), like the Ruins' one path, so
// leaving, re-entering or reloading never opens the other side. Pure: no Phaser, no
// DOM. The offer is hashed from the run seed and the node, never the battle RNG.
//
// Twin Chapel (blessings v3 §5.3, `church_extra_vows`): a church accepts one more vow, each a
// different one (Promotion and a Blessing, say; never the same vow twice). The saved vow is a
// string for one vow (as every save before it) and an array of distinct vows once a second is
// made (`churchVows` reads both).

import { CHURCH_VOWS, NODE_TYPES } from '../utils/constants.js';
import { shrineBoonsOf } from './ShrineBoons.js';
import { isPrologueRun } from './ScriptedBattle.js';
import {
  burdenDefFor,
  burdenOf,
  cleansableBurdens,
  HEALED_BURDENS,
  isCleansable,
  removeBurden,
} from './Burdens.js';
import { PROLOGUE_BLESSING_BLOCK } from '../data/prologueContent.js';

export { CHURCH_VOWS };

/** How many blessings an altar offers (fewer once the run holds the rest). */
export const CHURCH_BLESSING_OFFERS = 3;

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A saved vow entry (a string, or an array once Twin Chapel's second vow is made) as a list. */
export function normalizeChurchVows(raw) {
  const list = Array.isArray(raw) ? raw : [raw];
  return [...new Set(list.filter((vow) => CHURCH_VOWS.includes(vow)))];
}

/** The vows made at this church, in the order made (empty when none yet). */
export function churchVows(run, nodeId) {
  return normalizeChurchVows(run?.churchVowByNodeId?.[nodeId]);
}

/** The first vow made at this church: 'promote', 'blessing', 'cleanse', or null (none yet). */
export function churchVow(run, nodeId) {
  return churchVows(run, nodeId)[0] ?? null;
}

/** How many vows a church accepts in this run: one, or more with Twin Chapel. */
export function churchVowCapacity(run) {
  return 1 + shrineBoonsOf(run).extraChurchVows;
}

/** How many more vows this church accepts (0 once they are all made). */
export function churchVowsLeft(run, nodeId) {
  return Math.max(0, churchVowCapacity(run) - churchVows(run, nodeId).length);
}

// A church's vows, in words (capacity is at most the three vows there are).
const VOW_COUNT_WORDS = Object.freeze(['', 'one', 'two', 'three']);

const VOW_NAME = Object.freeze({
  promote: 'Promotion',
  blessing: 'a Blessing',
  cleanse: 'Cleansing',
});
const VOW_CLOSES = Object.freeze({
  promote: 'promotes no one',
  blessing: 'gives no blessing',
  cleanse: 'lifts no burden',
});

/** "Promotion", "Promotion and a Blessing", "Promotion, a Blessing and Cleansing". */
function vowNames(vows) {
  const names = vows.map((vow) => VOW_NAME[vow]);
  return names.length <= 1
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The line a church shows once its vows are made: `vow` is the one vow (a string) or the list
 * made here. Every vow not made is named as closed.
 */
export function churchVowLine(vow) {
  const vows = normalizeChurchVows(vow);
  if (vows.length === 0) return '';
  const closed = CHURCH_VOWS.filter((v) => !vows.includes(v)).map((v) => VOW_CLOSES[v]);
  const lead = vows.length === 1 ? 'Your vow here was' : 'Your vows here were';
  if (closed.length === 0) return `${lead} ${vowNames(vows)}: this altar has nothing more to give.`;
  return `${lead} ${vowNames(vows)}: this altar ${closed.join(' and ')}.`;
}

/**
 * The church's vow line for the menu: before any vow, how many vows it takes; after one with a
 * vow left (Twin Chapel), which was made and that one more is open; once every vow is made, the
 * closed line (`churchVowLine`). `offersCleanse` says whether Cleansing is on the altar's list.
 */
export function churchVowStatusLine(run, nodeId, { offersCleanse = false } = {}) {
  const vows = churchVows(run, nodeId);
  const left = churchVowsLeft(run, nodeId);
  if (vows.length > 0 && left <= 0) return churchVowLine(vows);
  if (vows.length > 0)
    return `${vows.length === 1 ? 'Your vow here was' : 'Your vows here were'} ${vowNames(vows)}. Twin Chapel: ${left === 1 ? 'one more vow is' : `${left} more vows are`} open, each a different one.`;
  const choices = offersCleanse
    ? 'Promote your units, take a blessing or lift a burden'
    : 'Promote your units, or take a blessing';
  const capacity = churchVowCapacity(run);
  if (capacity > 1)
    return `${choices}: ${VOW_COUNT_WORDS[capacity] || capacity} different vows per church (Twin Chapel). The first promotion, the blessing or the cleansing makes each.`;
  return offersCleanse
    ? `${choices}: one vow per church. The first promotion, the blessing or the cleansing makes it.`
    : `${choices}: one vow per church. The first promotion or the blessing makes it.`;
}

const VOW_WILL_CLOSE = Object.freeze({
  promote: 'promote no one',
  blessing: 'give no blessing',
  cleanse: 'lift no burden',
});

/**
 * Twin Chapel's line for a vow's confirmation: what making `vow` here leaves open. Null when the
 * church takes one vow (the menu keeps its own line) or `vow` is already made.
 */
export function churchVowCommitNote(run, nodeId, vow) {
  if (churchVowCapacity(run) <= 1) return null;
  const made = churchVows(run, nodeId);
  if (made.includes(vow)) return null;
  const after = [...made, vow];
  const left = churchVowCapacity(run) - after.length;
  if (left > 0)
    return `Twin Chapel: this is one of your vows here; ${left === 1 ? 'one more stays' : `${left} more stay`} open.`;
  const closed = CHURCH_VOWS.filter((v) => !after.includes(v)).map((v) => VOW_WILL_CLOSE[v]);
  return closed.length
    ? `This is your last vow here: this church will ${closed.join(' and ')}.`
    : 'This is your last vow here.';
}

/**
 * The minor blessings this altar offers: tier 1, none the run already holds, in an
 * order hashed from the run seed and the node (the same offer on every visit).
 */
export function churchBlessingOffers(run, nodeId, gameData) {
  const held = new Set(run?.getActiveBlessingIds?.() || []);
  const pool = (gameData?.blessings?.blessings || []).filter(
    (b) => b?.tier === 1 && !held.has(b.id),
  );
  const seed = `${Number(run?.runSeed) >>> 0}:${nodeId}`;
  return pool
    .map((b) => ({ b, key: hash(`${seed}:${b.id}`) }))
    .sort((x, y) => x.key - y.key || (x.b.id < y.b.id ? -1 : 1))
    .slice(0, CHURCH_BLESSING_OFFERS)
    .map(({ b }) => b);
}

/**
 * Why a vow cannot be made (or used) here now: '' when it can. A vow already made here stays
 * open (a church's promotions are one vow); another needs a vow left (Twin Chapel).
 */
export function churchVowBlock(run, nodeId, vow) {
  if (!CHURCH_VOWS.includes(vow)) return 'Choose Promotion, a Blessing or Cleansing.';
  const made = churchVows(run, nodeId);
  if (made.includes(vow) || made.length === 0) return '';
  if (churchVowsLeft(run, nodeId) <= 0) return churchVowLine(made);
  return '';
}

/** Why this blessing cannot be taken here: '' when it can. */
export function churchBlessingBlock(run, nodeId, blessingId, gameData) {
  // The prologue's chapel shows the altar, greyed: blessings start with the first run.
  if (isPrologueRun(run)) return PROLOGUE_BLESSING_BLOCK;
  if (churchVows(run, nodeId).includes('blessing')) return 'This altar has already blessed you.';
  const reason = churchVowBlock(run, nodeId, 'blessing');
  if (reason) return reason;
  if (!churchBlessingOffers(run, nodeId, gameData).some((b) => b.id === blessingId))
    return 'That blessing is not offered here.';
  return '';
}

/** Vow a Blessing: the chosen minor blessing joins the run and applies now. */
export function takeChurchBlessing(run, nodeId, blessingId, gameData) {
  const reason = churchBlessingBlock(run, nodeId, blessingId, gameData);
  if (reason) return { ok: false, reason };
  if (!run.addBlessingMidRun(blessingId)) return { ok: false, reason: 'Blessing unavailable.' };
  commitChurchVow(run, nodeId, 'blessing');
  const blessing = gameData.blessings.blessings.find((b) => b.id === blessingId);
  return { ok: true, message: `${blessing.name}: ${blessing.description}` };
}

// ── Cleanse ────────────────────────────────────────────────────────────────

/** True when this church could cleanse something now: a church node, a burden a church can lift. */
export function churchOffersCleanse(run, nodeId) {
  if (isPrologueRun(run)) return false;
  const node = run?.nodeMap?.nodes?.find((n) => n?.id === nodeId);
  return node?.type === NODE_TYPES.CHURCH && cleansableBurdens(run).length > 0;
}

/** Why this burden cannot be cleansed here ('' when it can). */
export function churchCleanseBlock(run, nodeId, burdenId) {
  if (isPrologueRun(run)) return 'Nothing weighs on you yet.';
  const node = run?.nodeMap?.nodes?.find((n) => n?.id === nodeId);
  if (node?.type !== NODE_TYPES.CHURCH) return 'Only a church can cleanse.';
  if (churchVows(run, nodeId).includes('cleanse')) return 'This altar has already cleansed you.';
  const vowed = churchVowBlock(run, nodeId, 'cleanse');
  if (vowed) return vowed;
  const burden = burdenOf(run, burdenId);
  if (!burden) return 'That burden is not on you.';
  if (HEALED_BURDENS.includes(burden.id))
    return 'Heal all mends a lingering injury. It needs no vow.';
  if (!isCleansable(burden)) return 'The lender has lawyers. No altar lifts this.';
  return '';
}

/** Vow a Cleansing: one burden is lifted from the run and the church's vow is made. */
export function cleanseAtChurch(run, nodeId, burdenId) {
  const reason = churchCleanseBlock(run, nodeId, burdenId);
  if (reason) return { ok: false, reason };
  const removed = removeBurden(run, burdenId);
  if (!removed) return { ok: false, reason: 'That burden is not on you.' };
  commitChurchVow(run, nodeId, 'cleanse');
  const label = burdenDefFor(run.gameData?.events, burdenId, run.difficultyId)?.label || burdenId;
  return { ok: true, burden: removed, message: `${label} lifted.` };
}

/**
 * Record the vow (a promotion commits 'promote' through this). A vow already made here is not
 * recorded again; a second one (Twin Chapel) turns the entry into the list of vows made.
 */
export function commitChurchVow(run, nodeId, vow) {
  if (!nodeId || !CHURCH_VOWS.includes(vow)) return;
  if (!run.churchVowByNodeId || typeof run.churchVowByNodeId !== 'object')
    run.churchVowByNodeId = {};
  const made = churchVows(run, nodeId);
  if (made.includes(vow)) return;
  const vows = [...made, vow];
  run.churchVowByNodeId[nodeId] = vows.length === 1 ? vow : vows;
}
