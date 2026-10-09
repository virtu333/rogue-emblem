import {
  getWeaponArtArea,
  getWeaponArtTargeting,
  getEffectiveWeaponArtHpCost,
  getEffectiveWeaponArtMapLimit,
  getWeaponArtTier2Effects,
  getWeaponArtTier5Effects,
  getWeaponArtMissEffects,
  getWeaponArtKillEffects,
} from '../engine/WeaponArtSystem.js';

const MOD_LABELS = {
  atkBonus: 'Attack',
  hitBonus: 'Hit',
  critBonus: 'Crit',
  avoidBonus: 'Avoid',
  defBonus: 'Defense',
  resBonus: 'Resistance',
  spdBonus: 'Speed',
  rangeBonus: 'range',
};

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const tiles = (n) => plural(n, 'tile');
const phases = (n) => plural(n, 'phase');
const signed = (n) => `${n >= 0 ? '+' : ''}${n}`;
const statList = (values) =>
  Object.entries(values)
    .map(([stat, value]) => `${signed(value)} ${stat}`)
    .join(', ');
const STATUS_MEANING = {
  root: 'it cannot move',
  silence: 'no magic or staves',
  sleep: 'it cannot move or act',
  acid: 'damage each turn',
};

/**
 * An area art's row (docs/specs/aoe-weapon-arts.md §3.4). An area blow is the art's own
 * strike against each victim (its DEF or RES): it always lands and never crits.
 */
export function weaponArtAreaRow(area, targeting = 'normal_attack') {
  const blow =
    area.damage.kind === 'fixed'
      ? `${area.damage.amount} damage`
      : `a ${Math.round(area.damage.multiplier * 100)}% blow`;
  const cannotKill =
    (area.nonLethal ? ' (cannot kill)' : '') +
    (area.drainPercent > 0
      ? `; heals you ${Math.round(area.drainPercent * 100)}% of the area damage`
      : '');
  if (targeting === 'chosen_center') {
    const range = area.centerRange;
    const reach =
      range === 'weapon' ? 'within your weapon range' : `${range.min}-${range.max} tiles away`;
    return {
      label: 'Aim',
      text: `pick any tile ${reach}: ${blow} to each enemy within ${tiles(area.radius)} of it${cannotKill}; no counter`,
    };
  }
  if (area.shape === 'line')
    return {
      label: 'Area',
      text: `${blow} to each enemy up to ${tiles(area.length)} behind the target${area.strikes === 'each_landed' ? ', per hit' : ''}${cannotKill}`,
    };
  if (area.shape === 'around_attacker')
    return {
      label: 'Area',
      text: `${blow} to each other enemy within ${tiles(area.radius)} of you${cannotKill}`,
    };
  const who =
    area.pick === 'lowest_hp_pct' && area.maxTargets === 1
      ? 'the most wounded other enemy'
      : area.maxTargets
        ? `up to ${plural(area.maxTargets, 'other enemy', 'other enemies')}`
        : 'each other enemy';
  return {
    label: 'Area',
    text: `${blow} to ${who} within ${tiles(area.radius)} of the target${cannotKill}`,
  };
}

/**
 * What an art does beyond its numbers, one labelled row per effect: On hit, After
 * combat, On miss, On kill. Rules every art shares (moves need room, the foe still
 * counters first) live in WEAPON_ARTS_HELP, not here.
 * @returns {Array<{label:string, text:string}>}
 */
export function weaponArtEffectRows(art) {
  const rows = [];
  const onHit = (text) => rows.push({ label: 'On hit', text });
  const effects = getWeaponArtTier2Effects(art);
  const self = (target) => target === 'attacker';
  for (const e of effects.afterCombatDamage || [])
    onHit(
      `${self(e.target) ? 'you take' : 'the target takes'} ${e.amount} more damage after combat${e.nonLethal ? ' (cannot kill)' : ''}`,
    );
  for (const e of effects.afterCombatDebuff || [])
    onHit(`${self(e.target) ? 'your' : 'target'} ${e.stat} ${signed(e.amount)} for the battle`);
  for (const e of effects.inflictStatus || []) {
    const meaning = STATUS_MEANING[e.status];
    onHit(
      `${e.status} ${self(e.target) ? 'you' : 'the target'} for ${phases(e.durationPhases)}${meaning ? ` (${meaning})` : ''}`,
    );
  }
  for (const e of effects.postCombatMove || [])
    onHit(
      {
        advance: `step ${tiles(e.distance)} toward the target`,
        retreat: `step back ${tiles(e.distance)}`,
        swap: 'swap places with the target',
        push: `push the target back ${tiles(e.distance)} (only when next to it)`,
        through: `pass ${tiles(e.distance)} through the target`,
        pushAreaVictims: `push the target and each foe the line hit back ${tiles(e.distance)} (only when next to the target)`,
        ram: `ram the target back up to ${tiles(e.distance)} (only when next to it); if blocked, it and any foe it hits take ${e.collisionDamage}`,
      }[e.mode] || `move (${e.mode})`,
    );
  const area = getWeaponArtArea(art);
  if (area) rows.push(weaponArtAreaRow(area, getWeaponArtTargeting(art)));
  if (art?.noFollowUp === true)
    rows.push({ label: 'Speed', text: 'strikes once however fast you are' });
  const { allyBuff, allyHeal } = getWeaponArtTier5Effects(art);
  if (allyHeal)
    onHit(
      `allies within ${tiles(allyHeal.radius)} of you heal ${allyHeal.percentOfDamage}% of the damage you dealt`,
    );
  if (allyBuff)
    onHit(
      `allies within ${tiles(allyBuff.range)} get ${statList(allyBuff.stats)} for ${phases(allyBuff.durationPhases)}${allyBuff.includeSelf ? ', you included' : ''}`,
    );
  for (const e of effects.setHp || [])
    rows.push({
      label: 'After combat',
      text: `${self(e.target) ? 'your' : "the target's"} HP becomes ${e.value}, hit or miss`,
    });
  const { selfDamageOnMiss } = getWeaponArtMissEffects(art);
  if (selfDamageOnMiss)
    rows.push({
      label: 'On miss',
      text: `you lose ${selfDamageOnMiss} HP per missed strike (cannot kill)`,
    });
  const { killBuff, killMove } = getWeaponArtKillEffects(art);
  if (killBuff)
    rows.push({
      label: 'On kill',
      text: `you get ${statList(killBuff.stats)} for ${phases(killBuff.durationPhases)}`,
    });
  if (killMove?.refresh) rows.push({ label: 'On kill', text: 'you can move and act again' });
  return rows;
}

/** The effect rows as single lines ("On hit: step back 1 tile"), for tooltips. */
export function weaponArtSecondaryDetails(art) {
  return weaponArtEffectRows(art).map((row) => `${row.label}: ${row.text}`);
}

/** The art's numbers: "+8 Attack · +10 Hit · 3 strikes at 60%". */
export function weaponArtModsText(art) {
  const mods = art?.combatMods || {};
  const parts = Object.entries(MOD_LABELS)
    .filter(([key]) => Number.isFinite(mods[key]) && mods[key] !== 0)
    .map(([key, label]) => `${signed(mods[key])} ${label}`);
  if (mods.damageMultiplier) parts.push(`×${mods.damageMultiplier} damage`);
  if (mods.multiHit)
    parts.push(
      `${mods.multiHit.count} strikes at ${Math.round(mods.multiHit.damageMultiplier * 100)}%`,
    );
  if (mods.effectiveness) {
    const targets = [
      ...(mods.effectiveness.moveTypes || []),
      ...(mods.effectiveness.classNames || []),
    ];
    if (targets.length)
      parts.push(`×${mods.effectiveness.multiplier} weapon might against ${targets.join(', ')}`);
  }
  if (mods.rangeOverride) parts.push(`Range ${mods.rangeOverride.min}–${mods.rangeOverride.max}`);
  if (mods.statScaling)
    parts.push(`Adds ${mods.statScaling.stat} ÷ ${mods.statScaling.divisor} to Attack`);
  if (mods.foeDefShare > 0)
    parts.push(`Adds ${Math.round(mods.foeDefShare * 100)}% of the foe's Defense to damage`);
  if (mods.drainPercent)
    parts.push(
      `Heals ${Math.round(mods.drainPercent * 100)}% of damage dealt${mods.drainMaxPerHit ? ` (at most ${mods.drainMaxPerHit} HP a hit)` : ''}`,
    );
  if (mods.drainPerHit) parts.push(`Heals ${mods.drainPerHit} HP on each hit that deals damage`);
  for (const [key, label] of Object.entries({
    preventCounter: 'No counterattack',
    ignoreRES: 'Ignores Resistance',
    targetsRES: 'Targets Resistance',
    ignoreTerrainAvoid: 'Ignores terrain Avoid',
    ignoreWeaponTriangle: 'Ignores weapon triangle',
    halfPhysicalDamage: 'Halves physical damage taken',
  }))
    if (mods[key]) parts.push(label);
  if (mods.vengeance) parts.push('Adds your missing HP to damage');
  return parts.join(' · ');
}

/**
 * The art in one line for battle menus, the forecast and roster cards: its numbers,
 * then its effects. No flavour and no rules; those sit behind ⓘ.
 */
export function formatWeaponArtEffects(art) {
  if (!art) return '';
  return [weaponArtModsText(art), ...weaponArtSecondaryDetails(art)].filter(Boolean).join(' · ');
}

export function weaponArtCostText(unit, art, options = {}) {
  const cost = getEffectiveWeaponArtHpCost(unit, art, options);
  const base = Math.max(0, Number(art?.hpCost) || 0);
  return `HP cost ${cost}${cost !== base ? ` (base ${base})` : ''}`;
}

/**
 * "2/3 map uses left · 1/1 turn uses left" for this unit. `options` is the run's
 * `weaponArtRunOptions(run)`: Bloodless Art's extra use is part of the limit shown, so the
 * menu says what `canUseWeaponArt` will allow.
 */
export function weaponArtUsesText(unit, art, turnNumber, options = {}) {
  const usage = unit?._battleWeaponArtUsage || {};
  const parts = [];
  const mapLimit = getEffectiveWeaponArtMapLimit(unit, art, options);
  if (mapLimit > 0)
    parts.push(`${Math.max(0, mapLimit - (usage.map?.[art.id] || 0))}/${mapLimit} map uses left`);
  if (Number(art?.perTurnLimit) > 0 && turnNumber != null) {
    const used = usage.turnKey === String(turnNumber) ? usage.turn?.[art.id] || 0 : 0;
    parts.push(`${Math.max(0, art.perTurnLimit - used)}/${art.perTurnLimit} turn uses left`);
  }
  return parts.join(' · ') || 'No usage limit';
}

const RANK_NAMES = { Prof: 'Proficient', Mast: 'Master rank' };

/**
 * The art's sheet for item details and scrolls, one labelled row each: Cost, Effect,
 * On hit / After combat / On miss / On kill, Needs, then its flavour line (label '').
 * Static copy: never carries last battle's usage counters.
 * @returns {Array<{label:string, text:string}>}
 */
export function weaponArtSheet(art) {
  if (!art) return [{ label: '', text: 'Weapon art details unavailable.' }];
  const types = art.allowedTypes?.length ? art.allowedTypes : [art.weaponType].filter(Boolean);
  const cost = [`${Math.max(0, Number(art.hpCost) || 0)} HP`];
  if (art.perMapLimit) cost.push(`${art.perMapLimit} per battle`);
  if (art.perTurnLimit) cost.push(`${art.perTurnLimit} per turn`);
  const rows = [{ label: 'Cost', text: cost.join(' · ') }];
  const mods = weaponArtModsText(art);
  if (mods) rows.push({ label: 'Effect', text: mods });
  rows.push(...weaponArtEffectRows(art));
  rows.push({
    label: 'Needs',
    text: `${types.join(' / ')} · ${RANK_NAMES[art.requiredRank] || art.requiredRank || 'Proficient'}`,
  });
  if (art.description) rows.push({ label: '', text: art.description });
  return rows;
}

/** The sheet as plain lines ("Cost: 8 HP · 2 per battle"). */
export function weaponArtDetailLines(art) {
  return weaponArtSheet(art).map((row) => (row.label ? `${row.label}: ${row.text}` : row.text));
}

/** Where a scroll is used, for its first lines. */
const SCROLL_USE = {
  art: 'Use: Roster → Skills → Bind to weapon. Kept until bound.',
  skill: 'Use: Roster → Skills → Teach. Kept until taught.',
};

export function weaponArtScrollText(scroll, catalog = []) {
  const art = catalog.find((a) => a.id === scroll?.teachesWeaponArtId);
  const types = scroll?.allowedWeaponTypes?.length
    ? scroll.allowedWeaponTypes
    : art?.allowedTypes?.length
      ? art.allowedTypes
      : [art?.weaponType].filter(Boolean);
  return [
    `Weapon art scroll: binds ${art?.name || 'a weapon art'} to one ${types.length ? `${types.join(' / ')} ` : ''}weapon for this run.`,
    SCROLL_USE.art,
    '',
    ...weaponArtDetailLines(art),
  ].join('\n');
}

/**
 * A skill scroll's text: what it teaches (an action skill says it adds a command, the
 * answer to "is Blink a weapon art?"), then the skill's own description.
 */
export function skillScrollText(scroll, skills = []) {
  const skill = skills.find((s) => s.id === scroll?.skillId);
  const name = skill?.name || scroll?.name?.replace(/ Scroll$/, '') || 'a skill';
  const kind = skill?.trigger === 'action' ? ', a battle command,' : '';
  const lines = [`Skill scroll: teaches ${name}${kind} to one unit.`, SCROLL_USE.skill];
  const about = skill?.description || scroll?.special;
  if (about) lines.push('', about);
  return lines.join('\n');
}
