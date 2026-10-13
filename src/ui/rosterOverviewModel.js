// rosterOverviewModel — the Roster's first page: every unit as a small card at once
// (pure; MobileRosterSheet draws it). A card carries what a glance should answer
// between battles: who, what class and level, how hurt, how near a level, and what it
// fights with (its equipped weapon, or "No weapon"). Tapping a card opens that unit's
// detail.
//
// Marks are news the player may act on; the card's face shows none (the owner's
// playtest, 2026-10-13: the weapon line took their place), but they ride the card's
// label for a screen reader. In order: Commander, Deployed / Benched (only where the caller knows the
// formation), Injured (the Lingering Injury burden's unit), Can promote, New skill
// (benched, unseen), Unarmed (no weapon it can fight with, though it could wield one).

import { getDisplayLevel, canPromote } from '../engine/UnitManager.js';
import { battleDebuffsFor } from '../engine/Burdens.js';
import { unitUidOf } from '../engine/UnitIdentity.js';
import { unseenBenchedSkills } from '../engine/SkillLoadout.js';
import { xpBarFacts, showsXp } from './xpBar.js';
import { itemDisplayName } from '../utils/itemNames.js';

const NON_COMBAT_TYPES = new Set(['Staff', 'Scroll']);

/** True when the unit could fight with some weapon but carries none it can. */
export function isUnarmed(unit) {
  const canWield = (unit?.proficiencies || []).some((p) => p && !NON_COMBAT_TYPES.has(p.type));
  if (!canWield) return false;
  return !(unit.inventory || []).some((w) => w && !NON_COMBAT_TYPES.has(w.type));
}

function injuredUids(run) {
  if (!run) return new Set();
  try {
    return new Set(
      battleDebuffsFor(run)
        .map((d) => d.unitUid)
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

/** The marks one living unit carries, most important first: [{ id, label, tone }]. */
export function unitMarks(unit, { run = null, injured = new Set(), isDeployed = null } = {}) {
  const marks = [];
  if (unit?.isCommander) marks.push({ id: 'commander', label: 'Commander', tone: 'gold' });
  if (typeof isDeployed === 'function') {
    marks.push(
      isDeployed(unit)
        ? { id: 'deployed', label: 'Deployed', tone: 'good' }
        : { id: 'benched', label: 'Benched', tone: 'muted' },
    );
  }
  const uid = unitUidOf(unit);
  if (uid && injured.has(uid)) marks.push({ id: 'injured', label: 'Injured', tone: 'bad' });
  if (run && canPromote(unit)) marks.push({ id: 'promote', label: 'Can promote', tone: 'gold' });
  if (run && unseenBenchedSkills(unit).length)
    marks.push({ id: 'new_skill', label: 'New skill', tone: 'gold' });
  if (isUnarmed(unit)) marks.push({ id: 'unarmed', label: 'Unarmed', tone: 'bad' });
  return marks;
}

function hpOf(unit, fallen) {
  const max = Math.max(1, Number(unit?.stats?.HP) || 1);
  const current = fallen ? 0 : Math.max(0, Math.min(max, Number(unit?.currentHP) || 0));
  return { current, max, ratio: current / max };
}

/** The card's bottom line: { name, item } for the equipped weapon, else { name: 'No weapon', item: null }. */
export function equippedWeaponLine(unit) {
  const item = unit?.weapon || null;
  return item?.name ? { name: itemDisplayName(item), item } : { name: 'No weapon', item: null };
}

function cardOf(unit, index, { fallen = false, xpOptions = {}, ...markCtx } = {}) {
  const level = getDisplayLevel(unit);
  const hp = hpOf(unit, fallen);
  const xp = !fallen && showsXp(unit) ? xpBarFacts(unit, xpOptions) : null;
  const marks = fallen
    ? [{ id: 'fallen', label: 'Fallen', tone: 'bad' }]
    : unitMarks(unit, markCtx);
  const weapon = equippedWeaponLine(unit);
  const label = [
    unit.name,
    `Level ${level} ${unit.className}`,
    fallen ? 'fallen' : `HP ${hp.current} of ${hp.max}`,
    xp ? xp.text : null,
    weapon.item ? `equipped ${weapon.name}` : 'no weapon equipped',
    ...marks.filter((m) => m.id !== 'fallen').map((m) => m.label),
  ]
    .filter(Boolean)
    .join(', ');
  return {
    index,
    unit,
    name: unit.name,
    level,
    className: unit.className,
    hp,
    xp,
    weapon,
    marks,
    fallen,
    label,
  };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The overview: { title, countText, deployText, deployTitle, cards, fallen }.
 * `deploy` is BattleDeployCount.rosterDeploySlots(run) (or null).
 */
export function rosterOverviewModel({
  units = [],
  fallen = [],
  run = null,
  deploy = null,
  isDeployed = null,
  xpOptions = {},
} = {}) {
  const injured = injuredUids(run);
  const ctx = { run, injured, isDeployed, xpOptions };
  const cards = units.filter(Boolean).map((unit, index) => cardOf(unit, index, ctx));
  const fallenCards = (fallen || [])
    .filter((u) => u?.stats)
    .map((unit, index) => cardOf(unit, index, { fallen: true, xpOptions }));
  const deployed =
    typeof isDeployed === 'function' ? units.filter((u) => u && isDeployed(u)).length : null;
  let deployText = '';
  let deployTitle = '';
  if (deploy) {
    deployText =
      deployed == null ? `Deploy up to ${deploy.slots}` : `${deployed} of ${deploy.slots} deployed`;
    const bonus = deploy.bonus > 0 ? `, ${deploy.bonus} of them from upgrades and blessings` : '';
    deployTitle = deploy.capped
      ? `This fight fields up to ${deploy.slots} units${bonus}.`
      : `Battles this act field up to ${deploy.slots} units${bonus}.`;
  }
  return {
    countText: plural(cards.length, 'unit'),
    deployText,
    deployTitle,
    cards,
    fallen: fallenCards,
  };
}
