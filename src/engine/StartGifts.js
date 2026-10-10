// StartGifts.js — gifts with a catch at the run's start (docs/specs/blessings-v3.md §7).
//
// From the second run on (`runsStarted >= gifts.offer.fromRunsStarted`), about half the runs
// (`gifts.offer.chance`) offer a fourth card at the shrine: a gift drawn from
// `data/blessings.json` `gifts.list`. A gift is never a held blessing (it has no tier and no icon
// cell of its own); taking it takes it in place of a blessing. Each is random in what it gives
// and clear about what it takes (its `catch`).
//
// Streams (none of them moves the shrine's offer, the node map, the battle stream or Math.random
// outside a commit):
//   - `gift-offer:<seed>`: one draw, whether this run offers a gift at all (always spent);
//   - `gift-pick:<seed>`: which gift, by weight, among those this run can take;
//   - `gift:<seed>:<giftId>`: what it holds, rolled at the take inside a seeded Math.random swap
//     (EclipseSystem.withEclipseSeed), so every draw the grant makes (the items' uids included)
//     is on that stream. The shrine handlers a gift reuses (`starting_whetstones`,
//     `starting_scroll`, the wound's stat) draw on their own keys, hashed from the run seed and
//     the gift's record id `gift:<giftId>`.
//
// The take is guarded (`chooseStartGift` refuses once anything was chosen) and saved whole as
// `run.startGift` (`{ id, granted, catchLabel }`): a load reads it and never applies anything
// again (sanitizeStartGift).

import { createSeededRng, isEarnedBlessing } from './BlessingEngine.js';
import { eclipseHash, eclipseNode, nodeFallExemption, withEclipseSeed } from './EclipseSystem.js';
import { accessoryPoolFor, accessoryTableActFor } from './EventEffects.js';
import { bindAccessorySkill } from './AccessorySkills.js';
import { accessorySkillOf } from './AccessorySkillNames.js';
import { applyImbue, canImbue, pickRandomImbue } from './ImbueSystem.js';
import { canForge } from './ForgeSystem.js';
import { addToInventory, canEquip } from './UnitManager.js';
import { findCommander } from './Commander.js';
import { isPrologueRun } from './ScriptedBattle.js';
import { shrineBoonsOf } from './ShrineBoons.js';
import { hasDarkOmen } from './EventSystem.js';
import { ensureItemUid } from '../utils/itemUid.js';

export { GIFT_CATCH_EFFECT_TYPES, GIFT_GRANT_KINDS } from './BlessingEngine.js';

// The one catch only a gift has: applied here, never by the shrine's handlers.
const FALL_NOW = 'eclipse_fall_now';
const NON_COMBAT_WEAPON_TYPES = new Set(['Staff', 'Consumable', 'Scroll', 'Whetstone', 'Breath']);
const RANK_ORDER = { Prof: 0, Mast: 1 };

const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const seedOf = (run) => (Number.isFinite(Number(run?.runSeed)) ? Number(run.runSeed) : 0);

/** The gifts block of a blessings catalog (or of a gameData holding one), or null. */
export function giftsConfigOf(data) {
  const catalog = Array.isArray(data?.blessings) ? data : data?.blessings;
  const gifts = catalog?.gifts;
  if (!isPlain(gifts) || !Array.isArray(gifts.list)) return null;
  const offer = isPlain(gifts.offer) ? gifts.offer : {};
  const chance = num(offer.chance, 0);
  return {
    offer: {
      fromRunsStarted: Math.max(0, Math.trunc(num(offer.fromRunsStarted, 1))),
      chance: Math.max(0, Math.min(1, chance)),
    },
    list: gifts.list.filter((gift) => isPlain(gift) && typeof gift.id === 'string' && gift.id),
  };
}

/** One gift of the catalog by id, or null. */
export function findGift(data, giftId) {
  return giftsConfigOf(data)?.list.find((gift) => gift.id === giftId) || null;
}

/**
 * A gift's catch as a price: `{ label, effects }`, its `prices` resolved through the catalog's
 * `priceCatalog` (in order) or its own `effects`. Null when it names nothing usable.
 */
export function giftCatchOf(gift, data) {
  const source = gift?.catch;
  if (!isPlain(source) || typeof source.label !== 'string' || !source.label.trim()) return null;
  const catalog = Array.isArray(data?.blessings) ? data : data?.blessings;
  let effects = [];
  if (Array.isArray(source.prices)) {
    for (const id of source.prices) {
      const entry = catalog?.priceCatalog?.[id];
      if (!Array.isArray(entry?.effects)) return null;
      effects.push(...entry.effects);
    }
  } else if (Array.isArray(source.effects)) effects = source.effects;
  effects = effects
    .filter(
      (effect) => isPlain(effect) && typeof effect.type === 'string' && isPlain(effect.params),
    )
    .map((effect) => ({ type: effect.type, params: structuredClone(effect.params) }));
  if (!effects.length) return null;
  return { label: source.label.trim(), effects };
}

const handlerEffectsOf = (price) => price.effects.filter((effect) => effect.type !== FALL_NOW);
const fallCountOf = (price) =>
  price.effects
    .filter((effect) => effect.type === FALL_NOW)
    .reduce((sum, effect) => sum + Math.max(0, Math.trunc(num(effect.params?.count, 1))), 0);

// ── What a gift can hand out ────────────────────────────────────────────

/**
 * The blessings a `blessing` gift draws from: that tier's shrine cards (never an earned one or
 * one whose own boon carries its price, an intrinsic price: Gambler's Toss, Lone Banner, Slow
 * Fuse), weight above 0 and not already held. Sorted by id, so the draw never reads catalog order.
 */
export function giftBlessingPool(run, grant) {
  const catalog = run?.gameData?.blessings;
  const tier = Math.trunc(num(grant?.tier, 0));
  const held = new Set(run?.getActiveBlessingIds?.() || []);
  return (Array.isArray(catalog?.blessings) ? catalog.blessings : [])
    .filter(
      (blessing) =>
        !isEarnedBlessing(blessing) &&
        blessing.tier === tier &&
        !blessing.intrinsicPrice &&
        num(blessing.weight, 1) > 0 &&
        !held.has(blessing.id) &&
        // A pact card is only handed out with its pact waived.
        (!blessing.pact || grant?.waivePact === true),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The Silver (or `grant.tier`) weapons a `weapon` gift can give the commander, best rank first. */
export function giftWeaponCandidates(run, grant) {
  const commander = findCommander(run?.roster || []);
  if (!commander) return [];
  const tier = typeof grant?.tier === 'string' && grant.tier ? grant.tier : 'Silver';
  const weapons = (Array.isArray(run?.gameData?.weapons) ? run.gameData.weapons : []).filter(
    (weapon) =>
      weapon?.tier === tier &&
      !NON_COMBAT_WEAPON_TYPES.has(weapon.type) &&
      !weapon.signatureOf &&
      num(weapon.price, 0) > 0 &&
      canEquip(commander, weapon),
  );
  // The commander's best proficiency (Mastery over Prime; ties keep the class's order) that has
  // such a weapon at all.
  const profs = (commander.proficiencies || [])
    .map((prof, index) => ({ prof, index }))
    .sort(
      (a, b) =>
        (RANK_ORDER[b.prof.rank] ?? -1) - (RANK_ORDER[a.prof.rank] ?? -1) || a.index - b.index,
    );
  for (const { prof } of profs) {
    const ofType = weapons
      .filter((weapon) => weapon.type === prof.type)
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    if (ofType.length) return ofType;
  }
  return [];
}

/** Lords' combat weapons a whetstone could forge (what `starting_whetstones` reads). */
function lordsHaveForgeableWeapon(run) {
  return (run?.roster || []).some(
    (unit) =>
      unit?.isLord &&
      [...(unit.inventory || []), unit.weapon].some(
        (weapon) => weapon && !NON_COMBAT_WEAPON_TYPES.has(weapon.type) && canForge(weapon),
      ),
  );
}

/** The weapon-art scrolls the `starting_scroll` handler could give these lords. */
function artScrollPool(run) {
  const artById = new Map((run?.gameData?.weaponArts?.arts || []).map((art) => [art?.id, art]));
  return (run?.gameData?.weapons || []).filter(
    (item) =>
      item?.type === 'Scroll' &&
      typeof item.teachesWeaponArtId === 'string' &&
      run._isScrollValidForCurrentLords?.(item, artById),
  );
}

/** The skill scrolls of an act's loot table (`skillScroll`), sorted by name. */
export function giftSkillScrollPool(run, act) {
  const names = run?.gameData?.lootTables?.[act]?.skillScroll || [];
  const byName = new Map((run?.gameData?.weapons || []).map((item) => [item?.name, item]));
  return [...new Set(names)]
    .map((name) => byName.get(name))
    .filter((item) => item?.type === 'Scroll' && typeof item.skillId === 'string')
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** The nodes a gift's catch may let the dark take now: any the Eclipse itself could take. */
export function giftFallableNodes(run) {
  const nodeMap = run?.nodeMap;
  return (Array.isArray(nodeMap?.nodes) ? nodeMap.nodes : [])
    .filter(
      (node) =>
        nodeFallExemption(node, {
          nodeMap,
          currentNodeId: run.currentNodeId,
          activeNodeId: run.battleInProgress?.nodeId || null,
          spareTypes: shrineBoonsOf(run).eclipseSpareTypes,
        }) === null,
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** True when the grant can hand out something real on this run as it stands. */
function grantPossible(run, gift) {
  const grant = gift?.grant || {};
  if (grant.kind === 'blessing') return giftBlessingPool(run, grant).length > 0;
  if (grant.kind === 'accessories') return accessoryPoolFor(run, grant.tierOffset).length > 0;
  if (grant.kind === 'scrolls')
    return (
      (num(grant.artScrolls) <= 0 || artScrollPool(run).length > 0) &&
      (num(grant.skillScrolls) <= 0 ||
        giftSkillScrollPool(run, grant.skillScrollAct || 'act2').length > 0)
    );
  if (grant.kind === 'weapon') return giftWeaponCandidates(run, grant).length > 0;
  if (grant.kind === 'whetstones') return lordsHaveForgeableWeapon(run);
  return false;
}

/**
 * Can this run take this gift now: weight above 0, its `requires` met (the Eclipse on for a
 * catch that darkens it), something real to grant, and a catch that costs something (a shadow
 * price with the Eclipse off, a Vision price with no charge, a fall with nothing left to fall
 * are no catch at all: the gift is not offered then).
 */
export function isGiftEligible(run, gift) {
  if (!gift || !(num(gift.weight, 1) > 0)) return false;
  if (isPlain(gift.requires) && typeof gift.requires.eclipse === 'boolean') {
    if (Boolean(run?.isEclipseActive?.()) !== gift.requires.eclipse) return false;
  }
  const price = giftCatchOf(gift, run?.gameData);
  if (!price) return false;
  if (!run?.isBlessingCostApplicable?.({ effects: handlerEffectsOf(price) })) return false;
  const falls = fallCountOf(price);
  if (falls > 0 && (!run?.isEclipseActive?.() || giftFallableNodes(run).length < falls))
    return false;
  return grantPossible(run, gift);
}

function pickWeighted(items, rand) {
  const total = items.reduce((sum, item) => sum + Math.max(0, num(item.weight, 1)), 0);
  if (!(total > 0)) return null;
  let roll = rand() * total;
  for (const item of items) {
    roll -= Math.max(0, num(item.weight, 1));
    if (roll < 0) return item;
  }
  return items[items.length - 1];
}

/**
 * Roll whether this run offers a gift, and which (pure but for its two keyed streams). Never in
 * the prologue, never before `fromRunsStarted` runs were started. The offer draw is always spent
 * once the run qualifies, so which gift is drawn never depends on the odds.
 * @returns {string|null} the offered gift's id
 */
export function rollStartGiftOffer(run, { runsStarted = 0 } = {}) {
  const config = giftsConfigOf(run?.gameData);
  if (!config || !config.list.length || isPrologueRun(run)) return null;
  if (!(Math.trunc(num(runsStarted, 0)) >= config.offer.fromRunsStarted)) return null;
  const seed = seedOf(run);
  const offerDraw = createSeededRng(eclipseHash(`gift-offer:${seed}`))();
  if (!(offerDraw < config.offer.chance)) return null;
  const eligible = config.list
    .filter((gift) => isGiftEligible(run, gift))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!eligible.length) return null;
  return pickWeighted(eligible, createSeededRng(eclipseHash(`gift-pick:${seed}`)))?.id || null;
}

// ── The take ────────────────────────────────────────────────────────────

/** The record id a gift's own effects are written under in `blessingHistory`. */
export const giftRecordId = (giftId) => `gift:${giftId}`;

function historyDetails(run, recordId, effectType) {
  const record = [...(run.blessingHistory || [])]
    .reverse()
    .find((entry) => entry?.blessingId === recordId && entry?.effectType === effectType);
  return record?.details || {};
}

function grantBlessing(run, gift, price, rand) {
  const pool = giftBlessingPool(run, gift.grant);
  const blessing = pickWeighted(pool, rand);
  if (!blessing) return null;
  // The gift's catch is the held card's price (the held list reads "Catch: ..."); a tier IV
  // card's pact is waived.
  const ok = run.addBlessingMidRun(blessing.id, {
    price: { label: price.label, effects: handlerEffectsOf(price), kind: 'gift' },
    waivePact: gift.grant.waivePact === true,
    source: 'gift',
  });
  return ok ? { granted: [{ kind: 'blessing', id: blessing.id, name: blessing.name }] } : null;
}

function grantAccessories(run, gift, rand) {
  const grant = gift.grant;
  const pool = accessoryPoolFor(run, grant.tierOffset);
  const act = accessoryTableActFor(run, grant.tierOffset);
  const count = Math.max(1, Math.trunc(num(grant.count, 1)));
  const remaining = [...pool];
  const granted = [];
  if (!Array.isArray(run.accessories)) run.accessories = [];
  for (let i = 0; i < count && pool.length; i++) {
    // Distinct while the table has enough; then it may repeat.
    const from = remaining.length ? remaining : pool;
    const index = Math.min(from.length - 1, Math.floor(rand() * from.length));
    const template = from[index];
    if (from === remaining) remaining.splice(index, 1);
    const item = ensureItemUid(structuredClone(template));
    // Only the first may bear a skill, at the gift's own chance (decision D-16).
    if (i === 0)
      bindAccessorySkill(item, act, run.gameData, rand, { chance: num(grant.skillChance, 0) });
    run.accessories.push(item);
    granted.push({
      kind: 'accessory',
      name: item.name,
      ...(accessorySkillOf(item) ? { skill: accessorySkillOf(item) } : {}),
    });
  }
  return granted.length ? { granted } : null;
}

function grantScrolls(run, gift, rand) {
  const grant = gift.grant;
  const recordId = giftRecordId(gift.id);
  const granted = [];
  const arts = Math.max(0, Math.trunc(num(grant.artScrolls, 0)));
  if (arts > 0) {
    run.applyStartGiftEffects(recordId, [{ type: 'starting_scroll', params: { count: arts } }]);
    for (const name of historyDetails(run, recordId, 'starting_scroll').granted || [])
      granted.push({ kind: 'scroll', name });
  }
  const skills = Math.max(0, Math.trunc(num(grant.skillScrolls, 0)));
  const pool = giftSkillScrollPool(run, grant.skillScrollAct || 'act2');
  if (!Array.isArray(run.scrolls)) run.scrolls = [];
  for (let i = 0; i < skills && pool.length; i++) {
    const template = pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
    run.scrolls.push(ensureItemUid(structuredClone(template)));
    granted.push({ kind: 'scroll', name: template.name });
  }
  return granted.length ? { granted } : null;
}

function grantWeapon(run, gift, rand) {
  const commander = findCommander(run.roster || []);
  const candidates = giftWeaponCandidates(run, gift.grant);
  if (!commander || !candidates.length) return null;
  const weapon = structuredClone(
    candidates[Math.min(candidates.length - 1, Math.floor(rand() * candidates.length))],
  );
  let imbue = null;
  if (gift.grant.imbue === true && canImbue(weapon)) {
    imbue = pickRandomImbue(run.gameData?.imbues, rand);
    if (imbue && !applyImbue(weapon, imbue).success) imbue = null;
  }
  // The commander's bag, else the convoy.
  let to = null;
  if (addToInventory(commander, weapon)) to = 'bag';
  else if (run.addToConvoy(weapon)) to = 'convoy';
  if (!to) return null;
  return {
    granted: [
      {
        kind: 'weapon',
        name: weapon.name,
        unit: commander.name,
        to,
        ...(imbue ? { imbue: imbue.id } : {}),
      },
    ],
  };
}

function grantWhetstones(run, gift) {
  const recordId = giftRecordId(gift.id);
  const count = Math.max(1, Math.trunc(num(gift.grant.count, 1)));
  run.applyStartGiftEffects(recordId, [{ type: 'starting_whetstones', params: { count } }]);
  const applied = historyDetails(run, recordId, 'starting_whetstones').applied || [];
  const granted = applied.map((entry) => ({
    kind: 'forge',
    unit: entry.unit,
    weapon: entry.weapon,
    stat: entry.stat,
  }));
  return granted.length ? { granted } : null;
}

/** Let the dark take `count` fallable nodes now, drawn on the gift's stream. Returns their ids. */
function fallNow(run, count, rand) {
  const fell = [];
  const config = run.getEclipseConfig?.();
  for (let i = 0; i < count; i++) {
    const nodes = giftFallableNodes(run);
    if (!nodes.length || !config) break;
    const node = nodes[Math.min(nodes.length - 1, Math.floor(rand() * nodes.length))];
    eclipseNode(node, {
      runSeed: run.runSeed,
      config,
      actId: run.nodeMap?.actId || run.currentAct,
      mapTemplates: run.gameData?.mapTemplates || null,
      fogChanceBonus: run.getDifficultyModifier?.('fogChanceBonus', 0) || 0,
      halfFogChance: run.difficultyId === 'normal',
      shadow: run.eclipse?.shadow || 0,
      darkOmen: (candidate) => hasDarkOmen(run, candidate),
    });
    fell.push(node.id);
  }
  return fell;
}

function applyGift(run, gift, price) {
  const rand = Math.random; // the gift's stream (withEclipseSeed)
  const kind = gift.grant?.kind;
  let result = null;
  if (kind === 'blessing') result = grantBlessing(run, gift, price, rand);
  else if (kind === 'accessories') result = grantAccessories(run, gift, rand);
  else if (kind === 'scrolls') result = grantScrolls(run, gift, rand);
  else if (kind === 'weapon') result = grantWeapon(run, gift, rand);
  else if (kind === 'whetstones') result = grantWhetstones(run, gift);
  if (!result) return null;
  // A blessing gift's catch rode in as the held card's price; any other gift pays it here, under
  // its own record id.
  if (kind !== 'blessing')
    run.applyStartGiftEffects(giftRecordId(gift.id), handlerEffectsOf(price));
  const fell = fallNow(run, fallCountOf(price), rand);
  return { granted: result.granted, fell };
}

/**
 * Take the offered gift: no blessing is chosen (the selection is recorded as skipped), the gift's
 * grant and catch apply once, on the gift's own stream, and `run.startGift` records it. Refused
 * for a gift that was not offered, and once anything was chosen at this shrine; asking again for
 * the gift already taken changes nothing.
 * @returns {{ ok: boolean, already?: boolean, reason?: string, startGift?: object }}
 */
export function chooseStartGift(run, giftId) {
  if (!run) return { ok: false, reason: 'no_run' };
  if (run.startGift) {
    return run.startGift.id === giftId
      ? { ok: true, already: true, startGift: run.startGift }
      : { ok: false, reason: 'already_chosen' };
  }
  // Anything already chosen at this shrine (a blessing, or no blessing), in this session or in
  // a saved run's history, closes the gift.
  const chosen = (run.blessingHistory || []).some(
    (record) => record?.stage === 'run_start' && record?.eventType === 'selection',
  );
  if (run._blessingChosen || chosen) return { ok: false, reason: 'already_chosen' };
  const offeredId = run.blessingSelectionTelemetry?.gift?.offeredId || null;
  if (!giftId || giftId !== offeredId) return { ok: false, reason: 'not_offered' };
  const gift = findGift(run.gameData, giftId);
  const price = giftCatchOf(gift, run.gameData);
  if (!gift || !price || !isGiftEligible(run, gift)) return { ok: false, reason: 'unavailable' };
  if (!run.chooseBlessing(null)) return { ok: false, reason: 'already_chosen' };
  const result = withEclipseSeed(`gift:${seedOf(run)}:${giftId}`, () =>
    applyGift(run, gift, price),
  );
  const startGift = {
    id: gift.id,
    granted: result?.granted || [],
    catchLabel: price.label,
    ...(result?.fell?.length ? { fell: result.fell } : {}),
  };
  run.startGift = startGift;
  if (run.blessingSelectionTelemetry?.gift) run.blessingSelectionTelemetry.gift.chosen = true;
  run.blessingHistory.push({
    timestamp: Date.now(),
    stage: 'run_start',
    eventType: 'gift',
    blessingId: null,
    effectType: null,
    details: { giftId: gift.id, granted: structuredClone(startGift.granted), catch: price.label },
  });
  return { ok: true, startGift };
}

// ── Save ────────────────────────────────────────────────────────────────

const GRANT_FIELDS = ['kind', 'id', 'name', 'skill', 'unit', 'to', 'imbue', 'weapon', 'stat'];

/**
 * A saved `startGift`, field by field: `{ id, granted, catchLabel, fell? }` or null. Granted
 * entries keep their known string fields; anything else is dropped. Never applies anything.
 */
export function sanitizeStartGift(raw) {
  if (!isPlain(raw) || typeof raw.id !== 'string' || !raw.id.trim()) return null;
  const granted = (Array.isArray(raw.granted) ? raw.granted : [])
    .filter((entry) => isPlain(entry) && typeof entry.kind === 'string' && entry.kind)
    .map((entry) =>
      Object.fromEntries(
        GRANT_FIELDS.filter((key) => typeof entry[key] === 'string' && entry[key]).map((key) => [
          key,
          entry[key],
        ]),
      ),
    );
  const fell = (Array.isArray(raw.fell) ? raw.fell : []).filter(
    (id) => typeof id === 'string' && id,
  );
  return {
    id: raw.id.trim(),
    granted,
    catchLabel: typeof raw.catchLabel === 'string' ? raw.catchLabel : '',
    ...(fell.length ? { fell } : {}),
  };
}

/**
 * The gift a run holds as the pause list shows it, or null: a gift that handed out a blessing is
 * that blessing's entry already (its "Catch: ..." price), so it has none of its own.
 * @returns {{ id, label, tier: 'Gift', earned: false, gift: true, line, price, priceKind } | null}
 */
export function startGiftEntry(run) {
  const record = run?.startGift;
  if (!record || record.granted?.some((entry) => entry.kind === 'blessing')) return null;
  const gift = findGift(run?.gameData, record.id);
  if (!gift) return null;
  return {
    id: giftRecordId(gift.id),
    label: gift.name,
    tier: 'Gift',
    earned: false,
    gift: true,
    line: gift.description || '',
    price: record.catchLabel || gift.catch?.label || null,
    priceKind: 'Catch',
  };
}
