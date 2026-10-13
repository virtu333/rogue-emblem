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
// An enemy-spawn zone may carry `group: { id, share, ai: chase | hold | guard, wakeTurn? }`.
// A template with groups splits its filler enemies among them by share (largest remainder);
// a `hold` group is one hold pack (engine/HoldActivation.js) that wakes when its Danger zone
// is entered, one of it is hurt or falls, or on its `wakeTurn`; a `guard` group keeps its post.
// The spawns record their group (`templateGroup`) and use only fields today's clients play.

import { HOLD_AI_MODE } from './HoldDisturbance.js';

/** Hold packs of template groups are numbered from here, clear of HoldActivation's packs (0..). */
export const TEMPLATE_GROUP_PACK_BASE = 100;
export const TEMPLATE_GROUP_AI = Object.freeze(['chase', 'hold', 'guard']);
/** A hold pack needs two members (HoldActivation's packs are never one unit). */
export const MIN_HOLD_GROUP = 2;
export const MIRROR_AXES = Object.freeze(['y']);

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

const KNOWN_GROUP_KEYS = new Set(['id', 'share', 'ai', 'wakeTurn']);
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
  const checkGroups = (zones, where, groupIds) => {
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
      if (!TEMPLATE_GROUP_AI.includes(g.ai))
        errors.push(`${gp}.ai must be one of ${TEMPLATE_GROUP_AI.join(', ')}`);
      if (
        g.wakeTurn !== undefined &&
        (!Number.isInteger(g.wakeTurn) || g.wakeTurn < 2 || g.wakeTurn > 12)
      )
        errors.push(`${gp}.wakeTurn must be an integer in [2,12]`);
      if (g.wakeTurn !== undefined && g.ai !== 'hold')
        errors.push(`${gp}.wakeTurn is only for a hold group`);
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
            checkGroups(option.zones, `${op}.zones`, new Set(baseGroupIds));
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
  if ((template.zones || []).filter((z) => z?.role === 'playerSpawn').length > 1) {
    errors.push(`${path} may have only one playerSpawn zone`);
  }
}
