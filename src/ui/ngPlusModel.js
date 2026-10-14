// ngPlusModel.js - the Home Base NG+ tab's words and choices (docs/specs/ng-plus.md), pure:
// the unlock, "Who rides again?" with its draft picks, and the Barracks. ui/NgPlusPanel.js
// draws it; the rules are engine/NgPlusState.js and the commits MetaProgressionManager's.
import {
  BRING_LIMIT,
  KEPT_ITEM_CAPS,
  KEPT_SKILL_CAPS,
  NG_PLUS_COST,
  NG_PLUS_MILESTONE,
  RIDE_LORD_PICKS,
  RIDE_RECRUIT_PICKS,
  keptItemKind,
  keptItemsOfKind,
  keptOfKind,
  recordFor,
  ridePickBlock,
  rideSlotsLeft,
} from '../engine/NgPlusState.js';
import { itemDisplayName } from '../utils/itemNames.js';

export const NG_PLUS_TAB_LABEL = 'NG+';

const UNLOCK_BLOCK_TEXT = {
  milestone: 'Win a Black Sun run to open New Game+.',
  valor: `Needs ${NG_PLUS_COST.valor} Valor.`,
  supply: `Needs ${NG_PLUS_COST.supply} Supply.`,
};

const PICK_BLOCK_TEXT = {
  no_ride: 'No win is waiting for a pick.',
  too_many_lords: `Only ${RIDE_LORD_PICKS} lord can ride again from a win.`,
  too_many_recruits: `Only ${RIDE_RECRUIT_PICKS} recruits can ride again from a win.`,
  skill_cap: 'Their kept skills are full: choose one to replace.',
  item_cap: 'Their kept items of that kind are full: choose one to replace.',
  already_kept: 'They already keep that.',
  already_picked: 'They are already in the Barracks from this win.',
  locked: 'Unlock New Game+ first.',
  save_failed: 'Could not save. Please try again.',
};

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The NG+ tab shows once the slot has won Black Sun or bought NG+. */
export function ngPlusTabVisible(meta) {
  return Boolean(meta?.isNgPlusUnlocked?.() || meta?.hasMilestone?.(NG_PLUS_MILESTONE));
}

/** One line for a refusal reason. */
export function ngPlusBlockText(reason) {
  return PICK_BLOCK_TEXT[reason] || UNLOCK_BLOCK_TEXT[reason] || 'That cannot be done now.';
}

/** The unlock card: what NG+ is, its price and why it cannot be bought yet. */
export function unlockView(meta) {
  const block = meta.ngPlusUnlockBlock();
  return {
    unlocked: block === 'unlocked',
    title: 'New Game+',
    lines: [
      'Nightfall and Black Sun runs where your best keep what they earned.',
      'After each win on those rungs, 1 lord and 2 recruits can ride again: each keeps 1 skill and 1 item.',
      'Veterans come back at level 1 in their base class, with their growths, traits and Mark.',
      'Anyone from the Barracks who falls leaves it for good.',
    ],
    cost: `${NG_PLUS_COST.valor} Valor + ${NG_PLUS_COST.supply} Supply · never refunded`,
    buyLabel: 'Unlock New Game+',
    canBuy: block === null,
    blockText: block && block !== 'unlocked' ? UNLOCK_BLOCK_TEXT[block] : '',
  };
}

const skillName = (id, skills) => skills.find((s) => s?.id === id)?.name || id;

const describeRecord = (record) =>
  record.kind === 'lord'
    ? 'Lord'
    : `${record.className} · ${record.traits?.length ? 'traits kept' : 'no traits'}`;

/** A draft pick list for the pending ride: `{ [ref]: { skillId, itemUid, replace... } }`. */
export function draftPicks(draft) {
  return Object.entries(draft || {}).map(([ref, pick]) => ({
    ref,
    ...(pick.skillId != null ? { skillId: pick.skillId } : {}),
    ...(pick.itemUid != null ? { itemUid: pick.itemUid } : {}),
    ...(pick.replaceSkillId != null ? { replaceSkillId: pick.replaceSkillId } : {}),
    ...(pick.replaceItemUid != null ? { replaceItemUid: pick.replaceItemUid } : {}),
  }));
}

/** "Who rides again?": each survivor with whether it is picked and whether it can be. */
export function rideView(state, draft) {
  const ride = state?.pendingRide;
  if (!ride) return null;
  const sent = new Set(ride.picked || []);
  const count = (kind, set) => ride.candidates.filter((c) => c.kind === kind && set(c)).length;
  const lords = count('lord', (c) => draft?.[c.ref] || sent.has(c.ref));
  const recruits = count('recruit', (c) => draft?.[c.ref] || sent.has(c.ref));
  const drafted = ride.candidates.filter((c) => draft?.[c.ref]);
  const left = rideSlotsLeft(ride);
  const block = ridePickBlock(state, draftPicks(draft));
  const keepsNothing = drafted
    .filter((c) => draft[c.ref].skillId == null && draft[c.ref].itemUid == null)
    .map((c) => c.name);
  return {
    title: 'Who rides again?',
    lead: sent.size
      ? `Still open: ${plural(left.lord, 'lord')} and ${plural(left.recruit, 'recruit')}. Each keeps 1 skill and 1 item.`
      : `Pick up to ${RIDE_LORD_PICKS} lord and ${RIDE_RECRUIT_PICKS} recruits. Each keeps 1 skill and 1 item.`,
    counts: `Lords ${lords}/${RIDE_LORD_PICKS} · Recruits ${recruits}/${RIDE_RECRUIT_PICKS}`,
    candidates: ride.candidates.map((c) => {
      const isSent = sent.has(c.ref);
      const isPicked = Boolean(draft?.[c.ref]);
      const full = c.kind === 'lord' ? lords >= RIDE_LORD_PICKS : recruits >= RIDE_RECRUIT_PICKS;
      const record = recordFor(state, c);
      return {
        ref: c.ref,
        name: c.name,
        line: `${c.className} · Lv ${c.level}${record && !isSent ? ' · In the Barracks' : ''}`,
        picked: isPicked,
        sent: isSent,
        // A full kind's survivor can still be opened to read their loadout; only one sent from
        // this win is closed.
        full: !isSent && !isPicked && full,
        fullText: full ? `The ${c.kind} slot is full: remove someone from this pick first.` : '',
        disabled: isSent,
      };
    }),
    canCommit: block === null,
    commitLabel: drafted.length
      ? 'Send them to the Barracks'
      : sent.size
        ? 'Done: no one else rides again'
        : 'Nobody rides again',
    confirmLabel: sent.size ? 'Confirm: close this pick' : 'Confirm: nobody rides again',
    warnText: keepsNothing.length
      ? `${keepsNothing.join(' and ')} ${keepsNothing.length === 1 ? 'keeps' : 'keep'} no skill or item yet: tap them to choose.`
      : '',
    blockText: block ? ngPlusBlockText(block) : '',
  };
}

/**
 * One picked survivor's choices: a skill to keep, an item to keep, and, when the kind is
 * full on their record, which kept one to replace.
 */
export function candidateDetail(state, ref, pick, gameData = {}) {
  const candidate = state?.pendingRide?.candidates.find((c) => c.ref === ref);
  if (!candidate) return null;
  const skills = gameData.skills || [];
  const record = recordFor(state, candidate);
  const kept = new Set(record?.keptSkills || []);
  const keptItems = new Set((record?.keptItems || []).map((i) => i.uid));
  const skillKind = pick?.skillId ? candidate.skillKinds[pick.skillId] || 'skill' : null;
  const skillFull = skillKind && keptOfKind(record, skillKind).length >= KEPT_SKILL_CAPS[skillKind];
  const item = pick?.itemUid ? candidate.items.find((i) => i.uid === pick.itemUid) : null;
  const itemKind = item ? keptItemKind(item) : null;
  const itemFull = itemKind && keptItemsOfKind(record, itemKind).length >= KEPT_ITEM_CAPS[itemKind];
  return {
    name: candidate.name,
    line: `${candidate.className} · Lv ${candidate.level}`,
    record: record
      ? `Keeps ${plural(record.keptSkills.length, 'skill')} and ${plural(record.keptItems.length, 'item')}.`
      : 'New to the Barracks.',
    skills: candidate.skills
      .filter((id) => !kept.has(id))
      .map((id) => ({
        id,
        label: skillName(id, skills),
        kind: candidate.skillKinds[id] === 'ability' ? 'Ability' : 'Skill',
        chosen: pick?.skillId === id,
      })),
    items: candidate.items
      .filter((i) => !keptItems.has(i.uid))
      .map((i) => ({
        uid: i.uid,
        label: itemDisplayName(i, skills),
        chosen: pick?.itemUid === i.uid,
      })),
    skillReplace: skillFull
      ? keptOfKind(record, skillKind).map((id) => ({
          id,
          label: skillName(id, skills),
          chosen: pick?.replaceSkillId === id,
        }))
      : null,
    itemReplace: itemFull
      ? keptItemsOfKind(record, itemKind).map((i) => ({
          uid: i.uid,
          label: itemDisplayName(i, skills),
          chosen: pick?.replaceItemUid === i.uid,
        }))
      : null,
    caps: `Kept skills cap at ${KEPT_SKILL_CAPS.skill} skills and ${KEPT_SKILL_CAPS.ability} abilities.`,
  };
}

/** The Barracks: every record, the recruits marked when brought into the next NG+ run. */
export function barracksView(state, gameData = {}) {
  const skills = gameData.skills || [];
  const bring = new Set(state?.bring || []);
  const records = state?.barracks || [];
  return {
    title: 'Barracks',
    lead: records.length
      ? `Bring up to ${BRING_LIMIT} recruits into each NG+ run. Lords bring their kit whenever they ride.`
      : 'Empty. Win on Nightfall or Black Sun to send someone here.',
    bringCount: `Bringing ${bring.size}/${BRING_LIMIT}`,
    records: records.map((record) => ({
      id: record.id,
      name: record.name,
      kind: record.kind,
      line: `${describeRecord(record)} · Rode ${plural(record.rides, 'time')}`,
      skills: record.keptSkills.map((id) => skillName(id, skills)),
      items: record.keptItems.map((i) => itemDisplayName(i, skills)),
      brought: bring.has(record.id),
      canBring: record.kind === 'recruit' && (bring.has(record.id) || bring.size < BRING_LIMIT),
    })),
  };
}

/**
 * Begin Run's warning while "Who rides again?" is still open on a bought NG+: the next
 * Nightfall or Black Sun win replaces an open pick, so it asks once first. Null otherwise.
 */
export function openRideWarning(meta) {
  const ride = meta?.getNgPlus?.()?.pendingRide;
  if (!ride || !meta.isNgPlusUnlocked?.()) return null;
  const left = rideSlotsLeft(ride);
  const open = [
    left.lord ? plural(left.lord, 'lord') : null,
    left.recruit ? plural(left.recruit, 'recruit') : null,
  ].filter(Boolean);
  return {
    text: `Who rides again? still has ${open.join(' and ') || 'room'} to send (NG+ tab). Your next Nightfall or Black Sun win replaces this pick.`,
    confirmLabel: 'Begin anyway',
  };
}

/** The difficulty screen's NG+ line: who comes back in the run about to start. */
export function ngPlusRunNote(meta) {
  const state = meta?.getNgPlus?.();
  const lords = (state?.barracks || []).filter((r) => r.kind === 'lord').length;
  const brought = (state?.bring || []).length;
  const rides = brought === 1 ? '1 veteran rides' : `${brought} veterans ride`;
  const kits =
    lords === 1 ? '1 Barracks lord brings their kit' : `${lords} Barracks lords bring their kit`;
  return `New Game+: ${rides} with you; ${kits} when in the run.`;
}

/** The run result's NG+ line: a win left survivors to pick at Home Base, or null. */
export function ngPlusResultNote(meta, run) {
  const ride = meta?.getNgPlus?.()?.pendingRide;
  const runId = run?.runRecordId || `run-${run?.runSeed}`;
  if (!ride || ride.runId !== runId) return null;
  if (meta.isNgPlusUnlocked?.()) return 'Who rides again? Choose at Home Base, in the NG+ tab.';
  return ngPlusTabVisible(meta)
    ? 'Your survivors wait at Home Base: unlock New Game+ to choose who rides again.'
    : 'Your survivors are kept for New Game+, which a Black Sun win opens.';
}
