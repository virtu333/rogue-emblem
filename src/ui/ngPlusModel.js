// ngPlusModel.js - the Home Base NG+ tab's words and choices (docs/specs/ng-plus.md), pure:
// the unlock, "Who rides again?" with its draft picks, and the Barracks. ui/NgPlusPanel.js
// draws it; the rules are engine/NgPlusState.js and the commits MetaProgressionManager's.
import {
  BRING_LIMIT,
  KEPT_ITEM_CAPS,
  KEPT_SKILL_CAPS,
  NG_PLUS_COST,
  NG_PLUS_MILESTONE,
  NG_PLUS_UPGRADES,
  NG_PLUS_UPGRADE_IDS,
  RIDE_LORD_PICKS,
  RIDE_RECRUIT_PICKS,
  keptItemKind,
  keptItemsOfKind,
  keptOfKind,
  ngPlusUpgradeNextCost,
  recordFor,
  ridePickBlock,
  rideSlotsLeft,
} from '../engine/NgPlusState.js';
import { itemDisplayName } from '../utils/itemNames.js';
import { echoEffectLines, recordEcho } from '../engine/NgPlusEcho.js';

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
  kept_by_other: 'Another Barracks veteran already keeps that item.',
  locked: 'Unlock New Game+ first.',
  maxed: 'Fully upgraded.',
  too_many: 'Bringing as many as the Barracks allows.',
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
      'Anyone from the Barracks who falls leaves it for good, except a lost run’s commander, who loses only their latest ride.',
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
  // An heirloom another record keeps (traded to this survivor during the run) is theirs.
  const keptByOthers = new Map();
  for (const other of state.barracks || [])
    if (other !== record) for (const i of other.keptItems) keptByOthers.set(i.uid, other.name);
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
      .filter((i) => !keptItems.has(i.uid) && !keptByOthers.has(i.uid))
      .map((i) => ({
        uid: i.uid,
        label: itemDisplayName(i, skills),
        chosen: pick?.itemUid === i.uid,
      })),
    heirlooms: candidate.items
      .filter((i) => keptByOthers.has(i.uid))
      .map((i) => `${itemDisplayName(i, skills)} (kept by ${keptByOthers.get(i.uid)})`),
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
export function barracksView(state, gameData = {}, bringLimit = BRING_LIMIT) {
  const skills = gameData.skills || [];
  const bring = new Set(state?.bring || []);
  const records = state?.barracks || [];
  return {
    title: 'Barracks',
    lead: records.length
      ? `Bring up to ${bringLimit} recruits into each NG+ run. Lords bring their kit whenever they ride. Every ride a member has had adds 1 Echo, and Echo makes the enemies stronger.`
      : 'Empty. Win on Nightfall or Black Sun to send someone here.',
    bringCount: `Bringing ${bring.size}/${bringLimit}`,
    records: records.map((record) => ({
      id: record.id,
      name: record.name,
      kind: record.kind,
      line: `${describeRecord(record)} · Rode ${plural(record.rides, 'time')}`,
      skills: record.keptSkills.map((id) => skillName(id, skills)),
      items: record.keptItems.map((i) => itemDisplayName(i, skills)),
      brought: bring.has(record.id),
      canBring: record.kind === 'recruit' && (bring.has(record.id) || bring.size < bringLimit),
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

/**
 * The Echo the run about to start would have: its brought veterans' rides and the rides of the
 * starting lords that have a kit (a third lord's are added when they join).
 */
export function echoPreview(meta) {
  const state = meta?.getNgPlus?.();
  const records = state?.barracks || [];
  const bring = new Set(state?.bring || []);
  const pair = meta?.getLordSelection?.() || { commander: 'Edric', partner: 'Sera' };
  const starting = new Set([pair.commander, pair.partner]);
  return records
    .filter((r) => (r.kind === 'recruit' ? bring.has(r.id) : starting.has(r.name)))
    .reduce((sum, r) => sum + recordEcho(r), 0);
}

/** One line for an Echo: "Echo 12: enemies +2 levels, enemy stats +1." */
export function echoLine(echo, gameData) {
  const effects = echoEffectLines(echo, gameData);
  return `Echo ${echo}: ${effects.length ? effects.join(', ') : 'no change to enemies yet'}.`;
}

/** The difficulty screen's NG+ line: who comes back in the run about to start. */
export function ngPlusRunNote(meta, gameData = null) {
  const state = meta?.getNgPlus?.();
  const lords = (state?.barracks || []).filter((r) => r.kind === 'lord').length;
  const brought = (state?.bring || []).length;
  const rides = brought === 1 ? '1 veteran rides' : `${brought} veterans ride`;
  const kits =
    lords === 1 ? '1 Barracks lord brings their kit' : `${lords} Barracks lords bring their kit`;
  const note = `New Game+: ${rides} with you; ${kits} when in the run.`;
  return gameData ? `${note} ${echoLine(echoPreview(meta), gameData)}` : note;
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

const UPGRADE_WORDS = {
  barracks_wing: {
    lead: 'Bring one more recruit veteran into each NG+ run.',
    now: (tier) => `Brings ${BRING_LIMIT + tier} recruit veterans.`,
  },
  seers_lantern: {
    lead: 'One more Vision charge in every run, NG+ or not.',
    now: (tier) => (tier ? `+${plural(tier, 'Vision charge')}.` : 'No extra Vision yet.'),
  },
};

/**
 * The NG+ tab's repeatable upgrades (NgPlusState.NG_PLUS_UPGRADES): each with its tier, what
 * it gives now, the next tier's price and whether it can be bought.
 */
export function upgradesView(meta) {
  return NG_PLUS_UPGRADE_IDS.map((id) => {
    const upgrade = NG_PLUS_UPGRADES[id];
    const words = UPGRADE_WORDS[id];
    const tier = meta.ngPlusUpgradeTier(id);
    const cost = ngPlusUpgradeNextCost(id, tier);
    const block = meta.ngPlusUpgradeBlock(id);
    return {
      id,
      name: upgrade.name,
      tierLine: `Tier ${tier}/${upgrade.maxTier}`,
      lead: words.lead,
      now: words.now(tier),
      cost: cost ? `Next: ${cost.valor} Valor + ${cost.supply} Supply · never refunded` : '',
      buyLabel: cost ? `Buy tier ${tier + 1}` : 'Fully upgraded',
      canBuy: block === null,
      blockText:
        block === 'valor' || block === 'supply'
          ? `Needs ${cost[block]} ${block === 'valor' ? 'Valor' : 'Supply'}.`
          : block && block !== 'maxed'
            ? ngPlusBlockText(block)
            : '',
    };
  });
}
