// TemplateLayout.js — the per-battle shape of a procedural map template, and its enemy groups
// (docs/specs/map-variety.md). Pure, no Phaser.
//
// Three optional template fields, each read only by a template that names it, so every other
// template draws exactly what it drew before:
//   - `enabled: false` keeps a template out of every random pick (the route map's and the
//     generator's); a battle that names it (`templateId`, the dev route) still plays it.
//   - `choices: [{ id, options: [{ weight?, zones, features? }] }]`: one option per choice is
//     taken for the battle, its zones (and features) added to the template's. One draw each.
//   - `mirror: 'y'`: the battle flips the template top to bottom half the time. One draw.
//   - `extraEnemies: N` (1-4): N more foes than the battle rolled, still under the map's density
//     cap. No draw: the count roll is the same one.
//   - two `playerSpawn` zones (a split start): the army deploys in two groups, slots taken from
//     each in turn (the first, third, ... in the first zone). One shuffle per zone, as for one.
//   - `sizeByAct: { act2: [cols, rows], ... }`: the map's size in each act the template lists,
//     in place of the act's size (a long, narrow road). No draw: the act's size roll is still
//     taken and set aside.
// An enemy-spawn zone may carry `group: { id, share, ai: chase | hold | guard, wakeTurn?, role?,
// captain?, formation? }`; a `formation` (strongpoint | screen | pincer, EnemyFormations.js)
// stands the group together facing the army, and the template's opening is then checked so no
// foe the army can strike on its first phase stands where nobody can answer for it; a `role` (front | ranged | flank, GROUP_ROLES) weighs the classes its foes are drawn
// from. A `captain: { name }` (rout templates, base zones only) names the group's strongest foe its
// captain and the map a defeat of the captains (BattleObjectives.js): the rest need not fall.
// A template with groups splits its filler enemies among them by share (largest remainder);
// a `hold` group is one hold pack (engine/HoldActivation.js) that wakes when its Danger zone
// is entered, one of it is hurt or falls, or on its `wakeTurn`; a `guard` group keeps its post.
// The spawns record their group (`templateGroup`) and use only fields today's clients play.

import { HOLD_AI_MODE } from './HoldDisturbance.js';
import { captainLevelFor } from './CaptainLevel.js';
import { OBJECTIVES_VERSION } from './BattleObjectives.js';
import { ZOMBIE_CLASSES } from '../utils/constants.js';
import { FORMATIONS } from './EnemyFormations.js';

/** Hold packs of template groups are numbered from here, clear of HoldActivation's packs (0..). */
export const TEMPLATE_GROUP_PACK_BASE = 100;
export const TEMPLATE_GROUP_AI = Object.freeze(['chase', 'hold', 'guard']);
/** A hold pack needs two members (HoldActivation's packs are never one unit). */
export const MIN_HOLD_GROUP = 2;
export const MIRROR_AXES = Object.freeze(['y']);
/**
 * A group's `role` weighs the classes its slots draw (MapGenerator.resolveClassWeight's tags),
 * in place of the template's `enemyWeights`. Weights only: the act's pool decides what exists,
 * so an Act I ranged group is archers, a later one archers and mages.
 */
export const GROUP_ROLES = Object.freeze({
  // A wall: armour and melee foot soldiers to break through.
  front: Object.freeze({
    armored: 4,
    infantry: 2,
    cavalry: 0.5,
    flying: 0.4,
    archer: 0.4,
    mage: 0.4,
    healer: 0.3,
  }),
  // Fire from behind cover, with the odd healer.
  ranged: Object.freeze({
    archer: 4,
    mage: 4,
    healer: 1.5,
    infantry: 0.4,
    cavalry: 0.4,
    armored: 0.3,
    flying: 0.4,
  }),
  // Fast riders and fliers that come around the side.
  flank: Object.freeze({ cavalry: 4, flying: 4, infantry: 0.5, armored: 0.2, healer: 0.2 }),
});

/** The class weights a group's slots draw with: its role's, else the template's. */
export function groupEnemyWeights(group, templateWeights) {
  return (group?.role && GROUP_ROLES[group.role]) || templateWeights || null;
}

/** Most foes a template may add over the battle's rolled count (still under the density cap). */
export const MAX_EXTRA_ENEMIES = 4;

/** The foes this template adds over the rolled count: 0 for every template that names none. */
export function templateExtraEnemies(template) {
  return Number.isInteger(template?.extraEnemies) ? template.extraEnemies : 0;
}

/** Most player-spawn zones a template may have: two make a split start. */
export const MAX_PLAYER_ZONES = 2;

/** The template's player-spawn zones, in the order they are written (at most two). */
export function playerSpawnZones(template) {
  return (template?.zones || []).filter((z) => z?.role === 'playerSpawn');
}

/**
 * How many of `total` deploy slots each player zone gets: the first zone the larger half.
 * `capacities` (tiles each zone can hold) moves any slots one zone cannot hold to the other.
 */
export function planPlayerSplit(total, capacities) {
  const n = Math.max(0, Math.trunc(Number(total) || 0));
  if (capacities.length < 2) return [n];
  let first = Math.ceil(n / 2);
  let second = n - first;
  const [capA, capB] = capacities;
  if (first > capA) {
    second += first - capA;
    first = capA;
  }
  if (second > capB) {
    first = Math.min(capA, first + (second - capB));
    second = capB;
  }
  return [first, second];
}

/** Two zones' spawns as one slot order: the first zone's first, the second's first, and so on. */
export function interleaveSpawns(groups) {
  const out = [];
  const longest = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < longest; i++) for (const g of groups) if (i < g.length) out.push(g[i]);
  return out;
}

/** A template's own map size: no wider than the battle canvas (20 x 32 px = 640), no deeper
 * than the final boss's arena, never smaller than the smallest act map. */
export const TEMPLATE_SIZE_BOUNDS = Object.freeze({
  minCols: 10,
  maxCols: 20,
  minRows: 7,
  maxRows: 13,
});

/** This template's map size in `act` ([cols, rows]), or null to keep the act's own size. */
export function templateSizeFor(template, act) {
  const size = template?.sizeByAct?.[act];
  return Array.isArray(size) && size.length === 2 && size.every(Number.isInteger)
    ? [size[0], size[1]]
    : null;
}

const MIRROR_FEATURE_POSITION_Y = Object.freeze({
  topRight: 'bottomRight',
  bottomRight: 'topRight',
});
const MIRROR_EDGE_Y = Object.freeze({ top: 'bottom', bottom: 'top' });
// Fields placed by absolute tile, which a fractional mirror cannot follow.
const ABSOLUTE_FIELDS = Object.freeze(['hybridArena', 'phaseTerrainOverrides', 'entitySpawn']);

const clean = (v) => Math.round(v * 1e9) / 1e9;

/** Whether random picks (route map, generator) may draw this template. */
export function isTemplateDrawable(template) {
  return template?.enabled !== false;
}

/** Whether the template varies per battle (choices or a mirror): only these take draws here. */
export function hasLayoutVariation(template) {
  return (
    Boolean(template?.mirror) || (Array.isArray(template?.choices) && template.choices.length > 0)
  );
}

function weightedIndex(weights, roll) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = roll * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

export function mirrorRectY(rect) {
  const [x1, y1, x2, y2] = rect;
  return [x1, clean(1 - y2), x2, clean(1 - y1)];
}

function mirrorEdges(edges) {
  return Array.isArray(edges) ? edges.map((e) => MIRROR_EDGE_Y[e] || e) : edges;
}

function mirrorWaves(waves) {
  return Array.isArray(waves) ? waves.map((w) => ({ ...w, edges: mirrorEdges(w.edges) })) : waves;
}

/** The template flipped top to bottom (a new object; the catalog is never written). */
export function mirrorTemplateY(template) {
  const t = structuredClone(template);
  t.zones = (t.zones || []).map((z) => ({ ...z, rect: mirrorRectY(z.rect) }));
  if (Array.isArray(t.structures))
    t.structures = t.structures.map((s) => (s.rect ? { ...s, rect: mirrorRectY(s.rect) } : s));
  if (t.escapeZone?.rect) t.escapeZone = { ...t.escapeZone, rect: mirrorRectY(t.escapeZone.rect) };
  if (Array.isArray(t.features))
    t.features = t.features.map((f) => ({
      ...f,
      position: MIRROR_FEATURE_POSITION_Y[f.position] || f.position,
    }));
  const r = t.reinforcements;
  if (r) {
    r.spawnEdges = mirrorEdges(r.spawnEdges);
    r.waves = mirrorWaves(r.waves);
    r.repeatingWaves = mirrorWaves(r.repeatingWaves);
    if (r.extraWavesByDifficulty)
      for (const id of Object.keys(r.extraWavesByDifficulty))
        r.extraWavesByDifficulty[id] = mirrorWaves(r.extraWavesByDifficulty[id]);
  }
  return t;
}

/**
 * The template this battle plays: its choices taken and maybe mirrored. Draws only for a
 * template that varies (one per choice, then one for the mirror); any other template comes
 * back as it is, with no draw.
 * @returns {{ template: object, layout: { mirrored: boolean, choices: object } | null }}
 */
export function resolveTemplateLayout(template, random = Math.random) {
  if (!hasLayoutVariation(template)) return { template, layout: null };
  const resolved = structuredClone(template);
  const choices = {};
  for (const choice of template.choices || []) {
    const options = choice.options || [];
    const index = weightedIndex(
      options.map((o) => (Number.isFinite(o.weight) && o.weight > 0 ? o.weight : 1)),
      random(),
    );
    choices[choice.id] = index;
    const option = options[index] || {};
    resolved.zones = [...resolved.zones, ...structuredClone(option.zones || [])];
    if (option.features)
      resolved.features = [...(resolved.features || []), ...structuredClone(option.features)];
  }
  delete resolved.choices;
  let mirrored = false;
  if (template.mirror === 'y') mirrored = random() < 0.5;
  delete resolved.mirror;
  return {
    template: mirrored ? mirrorTemplateY(resolved) : resolved,
    layout: { mirrored, choices },
  };
}

/** The template's grouped enemy-spawn zones, in order (empty for a one-zone template). */
export function enemyGroupZones(template) {
  return (template?.zones || []).filter((z) => z.role === 'enemySpawn' && z.group);
}

/**
 * How many of `total` filler enemies each group takes: largest remainder by share, then a
 * hold group too small to be a pack (under MIN_HOLD_GROUP) gives its members to the largest
 * group that charges or guards. Pure, no draw.
 * @returns {number[]} counts per group, summing to `total`
 */
export function planGroupCounts(groups, total) {
  const n = Math.max(0, Math.trunc(total) || 0);
  if (!groups.length) return [];
  const shares = groups.map((g) => (Number(g.share) > 0 ? Number(g.share) : 0));
  const sum = shares.reduce((s, v) => s + v, 0);
  if (!(sum > 0)) return groups.map((_, i) => (i === 0 ? n : 0));
  const exact = shares.map((s) => (s / sum) * n);
  const counts = exact.map(Math.floor);
  let left = n - counts.reduce((s, v) => s + v, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) counts[order[k].i]++;
  // A captain's group always fields its captain (a hold group a pack of two), taken from the
  // largest group that can spare one, while the total allows.
  groups.forEach((g, i) => {
    const floor = captainSlotFloor(g);
    while (counts[i] < floor) {
      const donor = counts
        .map((c, j) => ({ c, j, spare: c - captainSlotFloor(groups[j]) }))
        .filter(({ j, spare }) => j !== i && spare > 0)
        .sort((a, b) => b.c - a.c || a.j - b.j)[0]?.j;
      if (donor === undefined) break;
      counts[donor]--;
      counts[i]++;
    }
  });
  const sink = counts
    .map((c, i) => ({ c, i }))
    .filter(({ i }) => groups[i].ai !== 'hold')
    .sort((a, b) => b.c - a.c || a.i - b.i)[0]?.i;
  if (sink !== undefined) {
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].ai === 'hold' && counts[i] > 0 && counts[i] < MIN_HOLD_GROUP) {
        counts[sink] += counts[i];
        counts[i] = 0;
      }
    }
  }
  return counts;
}

/** The group index of each filler slot in order: group 0's slots, then group 1's, ... */
export function planGroupSlots(groups, total) {
  return planGroupCounts(groups, total).flatMap((count, i) => new Array(count).fill(i));
}

// A Cleric heals and a Necromancer raises from its post: neither is told to hold or guard.
const KEEPS_OWN_ROLE = new Set(['Cleric', 'Necromancer']);

/** The fewest slots a group takes so its captain stands (a hold pack needs two): 0 without one. */
function captainSlotFloor(group) {
  if (!hasTemplateCaptain(group)) return 0;
  return group.ai === 'hold' ? MIN_HOLD_GROUP : 1;
}

/** A captain's authored id (BattleObjectives' ref): `captain_<group id>`. */
export const TEMPLATE_CAPTAIN_PREFIX = 'captain_';
/** The strip's name for two or more captains ("Defeat · the captains (1/2)"). */
export const TEMPLATE_CAPTAINS_LABEL = 'the captains';
/** A captain's name, as long as a class name the HUD already fits. */
export const TEMPLATE_CAPTAIN_NAME_MAX = 18;

/** Whether a group names a captain. */
export function hasTemplateCaptain(group) {
  return typeof group?.captain?.name === 'string' && group.captain.name.trim().length > 0;
}

/**
 * Which of a captain group's members becomes its captain (-1 for none): the strongest, the earlier
 * on a tie, passing over a healer, a Necromancer and a Zombie while the group has anyone else.
 * The formation that seats the captain at its heart (EnemyFormations.js) asks the same question.
 */
export function captainIndexOf(members) {
  const list = members || [];
  const plain = (s) => !KEEPS_OWN_ROLE.has(s.className) && !ZOMBIE_CLASSES.has(s.className);
  const anyPlain = list.some(plain);
  let best = -1;
  list.forEach((s, i) => {
    if (anyPlain && !plain(s)) return;
    if (best < 0 || s.level > list[best].level) best = i;
  });
  return best;
}

/**
 * Name each captain group's captain (mutates the spawns; no draw): its strongest member, the
 * earlier on a tie, passing over a healer, a Necromancer and a Zombie (which would rise nameless)
 * while the group has anyone else. The captain takes the group's captain name, an authored id
 * (`captain_<group id>`) and the elite captain's level rule (CaptainLevel.js) when that is higher
 * than its own; it keeps its group's orders. Returns the captains' ids in group order.
 * @param {object[]} spawns
 * @param {object[]} groups the template's groups (TemplateLayout.enemyGroupZones)
 * @param {{ act: string, levelTop: number }} ctx the act and the battle's level range top
 */
export function appointTemplateCaptains(spawns, groups, { act, levelTop }) {
  const ids = [];
  for (const group of groups || []) {
    if (!hasTemplateCaptain(group)) continue;
    const members = (spawns || []).filter(
      (s) => s?.templateGroup === group.id && !s.isBoss && !s.authoredId,
    );
    const captain = members[captainIndexOf(members)];
    if (!captain) continue;
    const id = `${TEMPLATE_CAPTAIN_PREFIX}${group.id}`;
    captain.authoredId = id;
    captain.name = group.captain.name.trim();
    captain.level = Math.max(captain.level, captainLevelFor(act, levelTop));
    ids.push(id);
  }
  return ids;
}

/**
 * The objectives model of a captains map (BattleObjectives.js): defeat every captain named,
 * "the captains" when there are two or more. Null when no captain stands (a plain rout).
 */
export function templateCaptainObjectives(captainIds) {
  if (!Array.isArray(captainIds) || captainIds.length === 0) return null;
  return {
    version: OBJECTIVES_VERSION,
    primary: [
      {
        id: 'captains',
        kind: 'defeat',
        targets: [...captainIds],
        ...(captainIds.length > 1 ? { label: TEMPLATE_CAPTAINS_LABEL } : {}),
      },
    ],
  };
}

/** The captain groups a template names (base zones: an option never adds one). */
export function templateCaptainGroups(template) {
  return enemyGroupZones(template)
    .map((z) => z.group)
    .filter(hasTemplateCaptain);
}

/**
 * Give each grouped spawn its group's orders (mutates them): a `hold` group's members one hold
 * pack (`aiMode: 'hold'`, `holdPack` TEMPLATE_GROUP_PACK_BASE + the group's index, its size and
 * wake turn), a `guard` group's `aiMode: 'guard'`. A hold group left with fewer than two members
 * charges instead (a pack of one never forms).
 */
export function applyTemplateGroupOrders(spawns, groups) {
  groups.forEach((group, index) => {
    if (group.ai !== 'hold' && group.ai !== 'guard') return;
    const members = (spawns || []).filter(
      (s) => s?.templateGroup === group.id && !s.isBoss && !KEEPS_OWN_ROLE.has(s.className),
    );
    if (group.ai === 'guard') {
      for (const s of members) s.aiMode = 'guard';
      return;
    }
    if (members.length < MIN_HOLD_GROUP) return;
    for (const s of members) {
      s.aiMode = HOLD_AI_MODE;
      s.holdPack = TEMPLATE_GROUP_PACK_BASE + index;
      s.holdPackSize = members.length;
      if (Number.isInteger(group.wakeTurn)) s.holdWakeTurn = group.wakeTurn;
    }
  });
  return spawns;
}

/** Whether a spawn belongs to a template group (left out of the rung's own hold assignment). */
export function isTemplateGroupSpawn(spawn) {
  return typeof spawn?.templateGroup === 'string';
}

// --- Validation (MapTemplateEngine.validateMapTemplatesConfig calls this) ---

const KNOWN_GROUP_KEYS = new Set(['id', 'share', 'ai', 'wakeTurn', 'role', 'captain', 'formation']);
const KNOWN_CHOICE_KEYS = new Set(['id', 'options']);
const KNOWN_OPTION_KEYS = new Set(['weight', 'zones', 'features']);

/**
 * Check a template's layout fields: `enabled`, `mirror`, `choices` and enemy groups.
 * `validateZone` / `validateFeatures` are the template validator's own checks, passed in.
 */
export function validateTemplateLayout(
  path,
  template,
  objective,
  errors,
  { validateZone, validateFeatures },
) {
  if (template.enabled !== undefined && typeof template.enabled !== 'boolean') {
    errors.push(`${path}.enabled must be a boolean when provided`);
  }
  if (
    template.extraEnemies !== undefined &&
    (!Number.isInteger(template.extraEnemies) ||
      template.extraEnemies < 1 ||
      template.extraEnemies > MAX_EXTRA_ENEMIES)
  ) {
    errors.push(`${path}.extraEnemies must be an integer from 1 to ${MAX_EXTRA_ENEMIES}`);
  }
  if (template.sizeByAct !== undefined) {
    const sp = `${path}.sizeByAct`;
    const b = TEMPLATE_SIZE_BOUNDS;
    if (
      !template.sizeByAct ||
      typeof template.sizeByAct !== 'object' ||
      Array.isArray(template.sizeByAct)
    ) {
      errors.push(`${sp} must be an object of act id to [cols, rows]`);
    } else {
      if (template.fixedSize !== undefined) errors.push(`${sp} cannot be used with fixedSize`);
      if (!Array.isArray(template.acts)) {
        errors.push(`${sp} needs the template's acts, so every act it is drawn in has a size`);
      }
      for (const act of template.acts || []) {
        if (!(act in template.sizeByAct)) errors.push(`${sp} has no size for ${act}`);
      }
      for (const [act, size] of Object.entries(template.sizeByAct)) {
        if (Array.isArray(template.acts) && !template.acts.includes(act)) {
          errors.push(`${sp}.${act} names an act the template is not drawn in`);
        }
        const ok =
          Array.isArray(size) &&
          size.length === 2 &&
          size.every(Number.isInteger) &&
          size[0] >= b.minCols &&
          size[0] <= b.maxCols &&
          size[1] >= b.minRows &&
          size[1] <= b.maxRows;
        if (!ok) {
          errors.push(
            `${sp}.${act} must be [cols, rows] from ${b.minCols}x${b.minRows} to ${b.maxCols}x${b.maxRows}`,
          );
        }
      }
    }
  }
  if (template.mirror !== undefined) {
    if (!MIRROR_AXES.includes(template.mirror)) {
      errors.push(`${path}.mirror must be one of ${MIRROR_AXES.join(', ')}`);
    }
    for (const field of ABSOLUTE_FIELDS) {
      if (template[field] !== undefined) errors.push(`${path}.mirror cannot be used with ${field}`);
    }
    if (template.reinforcements?.scriptedWaves?.length) {
      errors.push(`${path}.mirror cannot be used with scriptedWaves (absolute tiles)`);
    }
  }
  const baseGroupIds = new Set();
  const checkGroups = (zones, where, groupIds, inOption = false) => {
    (zones || []).forEach((zone, i) => {
      if (!zone || zone.group === undefined) return;
      const gp = `${where}[${i}].group`;
      const g = zone.group;
      if (zone.role !== 'enemySpawn') errors.push(`${gp} is only allowed on an enemySpawn zone`);
      if (!g || typeof g !== 'object' || Array.isArray(g)) {
        errors.push(`${gp} must be an object`);
        return;
      }
      if (!Object.keys(g).every((k) => KNOWN_GROUP_KEYS.has(k)))
        errors.push(`${gp} contains unknown keys`);
      if (typeof g.id !== 'string' || !g.id.trim())
        errors.push(`${gp}.id must be a non-empty string`);
      else if (groupIds.has(g.id)) errors.push(`${gp}.id duplicate: ${g.id}`);
      else groupIds.add(g.id);
      if (!(Number.isFinite(g.share) && g.share > 0 && g.share <= 1))
        errors.push(`${gp}.share must be a number in (0,1]`);
      if (g.role !== undefined && !Object.hasOwn(GROUP_ROLES, g.role))
        errors.push(`${gp}.role must be one of ${Object.keys(GROUP_ROLES).join(', ')}`);
      if (!TEMPLATE_GROUP_AI.includes(g.ai))
        errors.push(`${gp}.ai must be one of ${TEMPLATE_GROUP_AI.join(', ')}`);
      if (g.formation !== undefined && !FORMATIONS.includes(g.formation))
        errors.push(`${gp}.formation must be one of ${FORMATIONS.join(', ')}`);
      if (
        g.wakeTurn !== undefined &&
        (!Number.isInteger(g.wakeTurn) || g.wakeTurn < 2 || g.wakeTurn > 12)
      )
        errors.push(`${gp}.wakeTurn must be an integer in [2,12]`);
      if (g.wakeTurn !== undefined && g.ai !== 'hold')
        errors.push(`${gp}.wakeTurn is only for a hold group`);
      if (g.captain !== undefined) {
        const c = g.captain;
        if (
          !c ||
          typeof c !== 'object' ||
          Array.isArray(c) ||
          Object.keys(c).some((k) => k !== 'name')
        )
          errors.push(`${gp}.captain must be { name }`);
        else if (
          typeof c.name !== 'string' ||
          !c.name.trim() ||
          c.name.trim().length > TEMPLATE_CAPTAIN_NAME_MAX
        )
          errors.push(`${gp}.captain.name must be 1-${TEMPLATE_CAPTAIN_NAME_MAX} characters`);
        // A defeat of the captains is a rout's family (BattleObjectives' legacy `rout`).
        if (objective !== 'rout') errors.push(`${gp}.captain is only for a rout template`);
        // The route map names the captains from the template before the battle: never a maybe.
        if (inOption) errors.push(`${gp}.captain may not be on a choice's zone`);
        if (typeof g.id === 'string' && !/^[a-z0-9_]{1,16}$/.test(g.id))
          errors.push(`${gp}.id must match [a-z0-9_]{1,16} for a captain's id`);
      }
      // On a rout map every foe must fall: a pack that never wakes could be waited out forever.
      if (g.ai === 'hold' && objective === 'rout' && g.wakeTurn === undefined)
        errors.push(`${gp}.wakeTurn is required for a hold group on a rout map`);
    });
  };
  checkGroups(template.zones, `${path}.zones`, baseGroupIds);
  let optionAddsEnemyZone = false;
  if (template.choices !== undefined) {
    if (!Array.isArray(template.choices) || template.choices.length === 0) {
      errors.push(`${path}.choices must be a non-empty array when provided`);
    } else {
      const ids = new Set();
      template.choices.forEach((choice, ci) => {
        const cp = `${path}.choices[${ci}]`;
        if (!choice || typeof choice !== 'object') {
          errors.push(`${cp} must be an object`);
          return;
        }
        if (!Object.keys(choice).every((k) => KNOWN_CHOICE_KEYS.has(k)))
          errors.push(`${cp} contains unknown keys`);
        if (typeof choice.id !== 'string' || !choice.id.trim() || ids.has(choice.id))
          errors.push(`${cp}.id must be a unique non-empty string`);
        ids.add(choice.id);
        if (!Array.isArray(choice.options) || choice.options.length < 2) {
          errors.push(`${cp}.options must list at least two options`);
          return;
        }
        choice.options.forEach((option, oi) => {
          const op = `${cp}.options[${oi}]`;
          if (!option || typeof option !== 'object') {
            errors.push(`${op} must be an object`);
            return;
          }
          if (!Object.keys(option).every((k) => KNOWN_OPTION_KEYS.has(k)))
            errors.push(`${op} contains unknown keys`);
          if (option.weight !== undefined && !(Number.isFinite(option.weight) && option.weight > 0))
            errors.push(`${op}.weight must be a positive number when provided`);
          if (!Array.isArray(option.zones)) errors.push(`${op}.zones must be an array`);
          else {
            option.zones.forEach((z, zi) => validateZone(`${op}.zones[${zi}]`, z, errors));
            // An option may add a grouped enemy zone (where a flank stands), never a player zone.
            option.zones.forEach((z, zi) => {
              if (!z?.role) return;
              if (z.role !== 'enemySpawn' || !z.group)
                errors.push(`${op}.zones[${zi}] may only add an enemySpawn zone with a group`);
              else optionAddsEnemyZone = true;
            });
            checkGroups(option.zones, `${op}.zones`, new Set(baseGroupIds), true);
          }
          if (option.features !== undefined) {
            validateFeatures(`${op}.features`, option.features, errors);
            if (Array.isArray(option.features) && option.features.some((f) => f?.type === 'Throne'))
              errors.push(`${op}.features may not add a Throne (a seize map has exactly one)`);
          }
        });
      });
    }
  }
  const enemyZones = (template.zones || []).filter((z) => z?.role === 'enemySpawn');
  const grouped = enemyZones.filter((z) => z.group);
  if ((enemyZones.length > 1 || optionAddsEnemyZone) && grouped.length !== enemyZones.length) {
    errors.push(`${path} has several enemySpawn zones: each needs a group`);
  }
  if (playerSpawnZones(template).length > MAX_PLAYER_ZONES) {
    errors.push(`${path} may have at most ${MAX_PLAYER_ZONES} playerSpawn zones (a split start)`);
  }
}
