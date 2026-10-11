// EncounterGroups.js — enemies that share one awareness
// (docs/specs/large-maps/02-encounters-and-pacing.md §3). Pure, no Phaser, no RNG.
//
// An encounter group sleeps, patrols or fights together. Every enemy belongs to at most one
// group (`groupIdOf`); an ungrouped enemy is awake from turn 1. The groups a battle has are its
// config's `encounterGroups` plus, for today's hold packs that no config lists (a set piece's
// authored `hold`, the prologue's `holdPack`, a map locked before groups existed), a group
// `hold:<pack>` derived from the units (§3.6). What each group is doing now is the battle's
// `encounterState` (§6), saved with the checkpoint and the Vision snapshot; the members'
// `aiMode` is its effect, and validateEncounterState holds the two to each other.
//
// checkEncounters is the one wake check (§3.4): AIController.processEnemyPhase runs it at the
// top of every enemy phase, for BattleScene and the headless harness alike. It wakes a group
// the way HoldActivation.wakeHolders (deleted with PR 2.1) woke a pack, to the reason
// (tests/harness/EncounterParity.test.js holds it to that build's record):
//   boss enrage first (a battle-wide rule, never a trigger); then each member in turn, in the
//   order the battle lists its enemies, its triggers in slot order: `hurt` (struck, hexed or
//   moved), the authored absolute `turn`, `hurt` (a member fell), `danger`. The first that
//   holds names the reason. Anti-turtle aggression never wakes a group.
// It runs once per turn: the check records its turn (`checkedTurn`), so an enemy phase resumed
// from a mid-phase checkpoint never checks again (by then enemies that moved may have opened
// new tiles, and a second check would break the exact restore).

import { HOLD_AI_MODE } from './HoldDisturbance.js';
import {
  absoluteTurnDue,
  dangerTargets,
  groupLostMember,
  memberDisturbance,
  memberInDanger,
  wakeTriggerErrors,
} from './EncounterTriggers.js';

export const ENCOUNTER_VERSION = 1;
export const GROUP_STATES = Object.freeze(['picket', 'dormant', 'patrol', 'awake']);
/** The onWake modes this build plays (guard, retake and seek's `then` arrive with 2.4). */
export const ONWAKE_MODES = Object.freeze(['hunt', 'seek']);
export const HOLD_GROUP_PREFIX = 'hold:';
export const MAX_ENCOUNTER_GROUPS = 64;
export const MAX_FIRED_ENTRIES = 64;

/** The wake word each trigger records on a woken member (`holdWoke`), as today's packs did. */
const TRIGGER_OF_REASON = Object.freeze({
  enrage: 'enrage',
  hurt: 'hurt',
  status: 'hurt',
  moved: 'hurt',
  fallen: 'hurt',
  turn: 'turn',
  threat: 'danger',
});

const isRecord = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isTurn = (v) => Number.isSafeInteger(v) && v >= 1;
const isTurnOrNull = (v) => v === null || v === undefined || isTurn(v);

export const holdGroupId = (pack) => `${HOLD_GROUP_PREFIX}${pack}`;
export const isHoldGroupId = (id) => typeof id === 'string' && id.startsWith(HOLD_GROUP_PREFIX);

/** The group a unit or spawn belongs to: its `encounterGroupId`, else its hold pack's. */
export function groupIdOf(unit) {
  if (typeof unit?.encounterGroupId === 'string' && unit.encounterGroupId)
    return unit.encounterGroupId;
  return Number.isInteger(unit?.holdPack) ? holdGroupId(unit.holdPack) : null;
}

/** Copy a spawn's group onto the enemy built from it (BattleScene and the harness alike). */
export function applyEncounterSpawn(enemy, spawn) {
  if (enemy && typeof spawn?.encounterGroupId === 'string' && spawn.encounterGroupId)
    enemy.encounterGroupId = spawn.encounterGroupId;
  return enemy;
}

/**
 * The hold packs among `list` (spawns or units) as groups `hold:<pack>`, in order of first
 * appearance (§3.6). Each wakes on `danger` and `hurt` and hunts once awake; a pack with an
 * authored wake turn (a member's `holdWakeTurn`, the first one listed: the pack shares one)
 * also wakes at the enemy phase of that turn. `members` are indices into `list`.
 */
export function groupsFromHoldPacks(list) {
  const byId = new Map();
  (list || []).forEach((unit, index) => {
    if (!Number.isInteger(unit?.holdPack)) return;
    const id = holdGroupId(unit.holdPack);
    if (!byId.has(id)) byId.set(id, { id, members: [], wakeTurn: null });
    const entry = byId.get(id);
    entry.members.push(index);
    if (entry.wakeTurn === null && Number.isInteger(unit.holdWakeTurn) && unit.holdWakeTurn > 0)
      entry.wakeTurn = unit.holdWakeTurn;
  });
  return [...byId.values()].map(({ id, members, wakeTurn }) => ({
    id,
    members,
    state: 'dormant',
    wake: [
      { kind: 'danger' },
      { kind: 'hurt' },
      ...(wakeTurn !== null ? [{ kind: 'turn', turn: wakeTurn, delay: 0 }] : []),
    ],
    onWake: { mode: 'hunt' },
  }));
}

/**
 * Write a generated map's hold packs as groups (§3.6 "New configs"): each holding spawn takes
 * its group's id, and the groups are returned for the config. The unit-level hold fields stay,
 * so a build without groups still plays the map. Draws nothing.
 */
export function writeHoldEncounterGroups(spawns) {
  const groups = groupsFromHoldPacks(spawns);
  for (const group of groups) {
    for (const index of group.members) spawns[index].encounterGroupId = group.id;
  }
  return groups;
}

/**
 * The groups a battle plays: its config's `encounterGroups`, then a `hold:<pack>` group for
 * each hold pack among `units` that the config does not list.
 */
export function battleEncounterGroups(battleConfig, units) {
  const listed = Array.isArray(battleConfig?.encounterGroups) ? battleConfig.encounterGroups : [];
  const ids = new Set(listed.map((g) => g?.id));
  return [...listed, ...groupsFromHoldPacks(units).filter((g) => !ids.has(g.id))];
}

function livingMembers(units, id) {
  return (units || []).filter((u) => u && u.currentHP > 0 && groupIdOf(u) === id);
}

/** The size a group counts its losses from: its pack size, else its generation record. */
function groupSize(group, members) {
  let size = null;
  for (const unit of members) {
    if (Number.isInteger(unit.holdPackSize)) size = Math.max(size ?? 0, unit.holdPackSize);
  }
  if (size !== null) return size;
  if (isHoldGroupId(group?.id)) return null;
  return Array.isArray(group?.members) && group.members.length ? group.members.length : null;
}

/** One group's record, read from its members as they stand. */
function groupEntryFromUnits(group, units) {
  const members = livingMembers(units, group.id);
  const holding = members.filter((u) => u.aiMode === HOLD_AI_MODE);
  const initial = GROUP_STATES.includes(group.state) ? group.state : 'awake';
  const asleep = initial === 'dormant' || initial === 'patrol';
  const state = asleep && !holding.length && members.length ? 'awake' : initial;
  const woke = state === 'awake' && asleep ? members.find((u) => u.holdWoke)?.holdWoke : null;
  return {
    state,
    wokeTurn: null,
    reason: woke ? TRIGGER_OF_REASON[woke] || null : null,
    size: groupSize(group, members),
  };
}

/**
 * The encounter state of a battle that saved none (a checkpoint or snapshot from before
 * groups, or a battle that has not reached its first check): each group dormant while a living
 * member holds, and the turn last checked from the holders' `holdCheckedTurn` (§3.6): a turn
 * every living holder carries (a check marks all it leaves holding), else none, and the check
 * reads each holder's own mark.
 */
export function encounterStateFromUnits(groups, units) {
  const state = { version: ENCOUNTER_VERSION, checkedTurn: null, groups: {}, fired: {} };
  for (const group of groups || []) {
    if (!group?.id || state.groups[group.id]) continue;
    state.groups[group.id] = groupEntryFromUnits(group, units);
  }
  const marks = new Set(
    (units || [])
      .filter((u) => u?.currentHP > 0 && u.aiMode === HOLD_AI_MODE)
      .map((u) => (isTurn(u.holdCheckedTurn) ? u.holdCheckedTurn : null)),
  );
  if (marks.size === 1) state.checkedTurn = [...marks][0];
  return state;
}

/**
 * The encounter check's source for a battle (`setEncounterSource`): its groups from its config
 * and units, and its state, which the battle owns (`host.encounterState`), read from the units
 * the first time it is asked for. BattleScene and the harness share it.
 */
export function encounterSourceFor(host) {
  return () => {
    const groups = battleEncounterGroups(host.battleConfig, host.enemyUnits);
    host.encounterState ||= encounterStateFromUnits(groups, host.enemyUnits);
    return { groups, state: host.encounterState };
  };
}

/** The battle's encounter state for a checkpoint or snapshot: a copy, never the live object. */
export function captureEncounterState(host) {
  const state =
    host?.encounterState ||
    encounterStateFromUnits(battleEncounterGroups(host?.battleConfig, host?.enemyUnits), host?.enemyUnits); // prettier-ignore
  return structuredClone(state);
}

/** Copy a saved encounter state for the battle to own (null when it holds none). */
export function cloneEncounterState(state) {
  return isRecord(state) ? structuredClone(state) : null;
}

/**
 * The wake check (§3.4). Wakes the dormant groups that meet a trigger (mutates the members:
 * `aiMode` cleared, `holdDisturbed` cleared, `holdWoke` set to the wake's word) and records
 * them in `state` (mutated; derived from the units when null). With a `turn`, the check runs
 * once for that turn: it records the turn, and the holders still holding keep it too
 * (`holdCheckedTurn`, the unit-level mark an older build reads).
 * @param {{ groups: object[], state?: object|null, enemyUnits: object[],
 *   playerUnits: object[], npcUnits?: object[], threatContext?: object|null,
 *   bossEnraged?: boolean, turn?: number|null }} battle
 * @returns {{ state: object, woken: { unit: object, reason: string, groupId: string }[] }}
 *   the members woken, in the order the battle lists its enemies
 */
export function checkEncounters({
  groups = [],
  state = null,
  enemyUnits = [],
  playerUnits = [],
  npcUnits = [],
  threatContext = null,
  bossEnraged = false,
  turn = null,
}) {
  const record = state || encounterStateFromUnits(groups, enemyUnits);
  const checked = Number.isInteger(turn);
  if (checked && record.checkedTurn === turn) return { state: record, woken: [] };
  let targets = null;
  let positions = null;
  const reasonOf = new Map();
  for (const group of groups || []) {
    if (!group?.id) continue;
    record.groups[group.id] ||= groupEntryFromUnits(group, enemyUnits);
    const entry = record.groups[group.id];
    if (entry.state !== 'dormant') continue;
    // A holder already checked this turn (its own mark, which an older build's checkpoint
    // carries) sits the check out, as it did under the hold rule.
    const members = livingMembers(enemyUnits, group.id).filter(
      (u) => !(checked && u.aiMode === HOLD_AI_MODE && u.holdCheckedTurn === turn),
    );
    if (!members.length) continue;
    const wakes = Array.isArray(group.wake) ? group.wake : [];
    const has = (kind) => wakes.some((w) => w?.kind === kind);
    const turnDue = checked && wakes.some((w) => absoluteTurnDue(w, turn));
    const lost = has('hurt') && groupLostMember(members.length, entry.size);
    let reason = bossEnraged && group.ignoreEnrage !== true ? 'enrage' : null;
    for (const unit of members) {
      if (reason) break;
      if (has('hurt')) reason = memberDisturbance(unit);
      if (!reason && turnDue) reason = 'turn';
      if (!reason && lost) reason = 'fallen';
      if (!reason && has('danger')) {
        targets ||= dangerTargets({ playerUnits, npcUnits, threatContext });
        positions ||= threatContext?.positions?.() || null;
        if (memberInDanger(unit, threatContext, positions, targets)) reason = 'threat';
      }
    }
    if (!reason) continue;
    reasonOf.set(group.id, reason);
    record.groups[group.id] = {
      ...entry,
      state: 'awake',
      wokeTurn: checked ? turn : null,
      reason: TRIGGER_OF_REASON[reason],
    };
  }
  const woken = [];
  for (const unit of enemyUnits || []) {
    if (!(unit?.currentHP > 0) || unit.aiMode !== HOLD_AI_MODE) continue;
    if (checked && unit.holdCheckedTurn === turn) continue; // sat this check out (above)
    const groupId = groupIdOf(unit);
    const reason = reasonOf.get(groupId);
    if (!reason) {
      if (checked && record.groups[groupId]?.state === 'dormant') unit.holdCheckedTurn = turn;
      continue;
    }
    // onWake `hunt`, the only mode a sleeping group takes in this build: today's chase.
    delete unit.aiMode;
    delete unit.holdDisturbed;
    unit.holdWoke = reason;
    woken.push({ unit, reason, groupId });
  }
  if (checked) record.checkedTurn = turn;
  return { state: record, woken };
}

/**
 * An initially awake group applies its onWake at battle start (§3.3): written onto its members'
 * spawns as `aiMode` / `aiTargetTile`, as the village's bandits are. `hunt` leaves today's
 * chase; `seek` walks to its anchor (the first tile of `anchors[name].tiles`). Mutates spawns.
 */
export function applyInitialOnWake({ groups = [], spawns = [], anchors = null }) {
  for (const group of groups || []) {
    if (group?.state !== 'awake') continue;
    const mode = group.onWake?.mode ?? 'hunt';
    const members = (spawns || []).filter((s) => groupIdOf(s) === group.id);
    if (mode === 'seek') {
      const tile = anchors?.[group.onWake.anchor]?.tiles?.[0];
      if (!Array.isArray(tile)) continue;
      for (const spawn of members) {
        spawn.aiMode = 'seek_tile';
        spawn.aiTargetTile = { col: tile[0], row: tile[1] };
      }
    } else {
      for (const spawn of members) {
        if (spawn.aiMode === HOLD_AI_MODE || spawn.aiMode === 'guard') delete spawn.aiMode;
      }
    }
  }
  return spawns;
}

/**
 * The problems with a config's encounter groups ([] when sound): ids, members, states, wakes
 * and onWake as this build plays them, and each member spawn agreeing with its group (§3.2,
 * §3.3).
 */
export function encounterGroupErrors(battleConfig) {
  const groups = battleConfig?.encounterGroups;
  if (groups === undefined) return [];
  if (!Array.isArray(groups)) return ['encounterGroups is not a list'];
  const errors = [];
  if (groups.length > MAX_ENCOUNTER_GROUPS) errors.push('too many encounter groups');
  if (battleConfig.encounterVersion !== ENCOUNTER_VERSION)
    errors.push(`encounterVersion must be ${ENCOUNTER_VERSION}`);
  const spawns = Array.isArray(battleConfig.enemySpawns) ? battleConfig.enemySpawns : [];
  const anchors = isRecord(battleConfig.anchors) ? battleConfig.anchors : {};
  const ids = new Set();
  const claimed = new Map();
  for (const [i, group] of groups.entries()) {
    const at = `encounterGroups[${i}]`;
    if (!isRecord(group) || typeof group.id !== 'string' || !group.id) {
      errors.push(`${at}: id is required`);
      continue;
    }
    if (ids.has(group.id)) errors.push(`${at}: duplicate id "${group.id}"`);
    ids.add(group.id);
    if (!GROUP_STATES.includes(group.state)) errors.push(`${at}: unknown state "${group.state}"`);
    if (group.state === 'patrol' || group.state === 'picket')
      errors.push(`${at}: state "${group.state}" is not supported yet`);
    if (!Array.isArray(group.members) || !group.members.length) {
      errors.push(`${at}: members is empty`);
    } else {
      for (const index of group.members) {
        if (!Number.isInteger(index) || !spawns[index]) {
          errors.push(`${at}: member ${index} is not a spawn`);
          continue;
        }
        if (claimed.has(index)) errors.push(`${at}: spawn ${index} is in two groups`);
        claimed.set(index, group.id);
        if (groupIdOf(spawns[index]) !== group.id)
          errors.push(`${at}: spawn ${index} does not carry the group's id`);
        const holds = spawns[index].aiMode === HOLD_AI_MODE;
        if (group.state === 'dormant' && !holds)
          errors.push(`${at}: dormant member ${index} does not hold`);
        if (group.state === 'awake' && holds) errors.push(`${at}: awake member ${index} holds`);
      }
    }
    const wakes = group.wake === undefined ? [] : group.wake;
    if (!Array.isArray(wakes)) errors.push(`${at}: wake is not a list`);
    else wakes.forEach((w, j) => errors.push(...wakeTriggerErrors(w, `${at}.wake[${j}]`)));
    if (group.state === 'dormant' && Array.isArray(wakes) && !wakes.length)
      errors.push(`${at}: a dormant group needs a wake trigger`);
    const mode = group.onWake?.mode ?? 'hunt';
    if (group.onWake !== undefined && !isRecord(group.onWake))
      errors.push(`${at}: onWake is not a record`);
    else if (!ONWAKE_MODES.includes(mode))
      errors.push(`${at}: onWake "${mode}" is not supported yet`);
    else if (mode === 'seek') {
      if (group.state !== 'awake')
        errors.push(`${at}: a seek onWake is written at start: the group must start awake`);
      if (!Array.isArray(anchors[group.onWake.anchor]?.tiles?.[0]))
        errors.push(`${at}: seek anchor "${group.onWake.anchor}" is not on the map`);
    }
  }
  // A spawn that names a group no config lists would sleep with no wake.
  spawns.forEach((spawn, index) => {
    const id = spawn?.encounterGroupId;
    if (id !== undefined && !ids.has(id))
      errors.push(`enemySpawns[${index}]: group "${id}" is not listed`);
  });
  return errors;
}

/**
 * Is `state` a sound encounter state for these enemies (the checkpoint validator's check,
 * §6)? Known states, whole turns, a fired ledger in order and within its cap, and members
 * agreeing with their group: a dormant group's living members hold, an awake group's do not.
 */
export function isValidEncounterState(state, enemyUnits = []) {
  if (!isRecord(state) || state.version !== ENCOUNTER_VERSION) return false;
  if (!isTurnOrNull(state.checkedTurn)) return false;
  if (!isRecord(state.groups) || Object.keys(state.groups).length > MAX_ENCOUNTER_GROUPS)
    return false;
  for (const entry of Object.values(state.groups)) {
    if (!isRecord(entry) || !GROUP_STATES.includes(entry.state)) return false;
    if (!isTurnOrNull(entry.wokeTurn)) return false;
    if (entry.reason != null && !(typeof entry.reason === 'string' && entry.reason.length <= 32))
      return false;
    if (entry.size != null && !isTurn(entry.size)) return false;
  }
  if (!isRecord(state.fired) || Object.keys(state.fired).length > MAX_FIRED_ENTRIES) return false;
  for (const fired of Object.values(state.fired)) {
    if (!isRecord(fired) || !isTurn(fired.firedTurn) || !isTurn(fired.dueTurn)) return false;
    if (fired.dueTurn < fired.firedTurn) return false;
  }
  for (const unit of Array.isArray(enemyUnits) ? enemyUnits : []) {
    if (!(unit?.currentHP > 0)) continue;
    const entry = state.groups[groupIdOf(unit)];
    if (!entry) continue;
    const holds = unit.aiMode === HOLD_AI_MODE;
    if (entry.state === 'dormant' && !holds) return false;
    if (entry.state === 'awake' && holds) return false;
  }
  return true;
}
