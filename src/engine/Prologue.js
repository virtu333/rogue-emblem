// Prologue.js — the prologue's authored data turned into the engine's own shapes
// (docs/specs/prologue-chapter.md §9). Pure: no Phaser, and no Math.random.
//
// data/prologue.json
//   seed            integer; seeds the authored units' streams (and, through RunManager,
//                   the prologue run).
//   grant           { valor, supply }: the Home Base grant paid once at the end.
//   units           { <key>: unit spec } (buildPrologueUnit). The key is how chapters,
//                   beats and joins name the unit; it is also the unit's name.
//                     lord        a lords.json name (built by createLordUnit), or
//                     className   a classes.json class (a generic unit, e.g. Tamsin)
//                     level       integer >= 1
//                     stats       optional, every stat incl. MOV (authored, final)
//                     growths     optional, every XP stat (authored, final)
//                     traits      optional trait ids, default []
//                     proficiencies optional weapon types ("Light", "Staff"): replace
//                                 the class's ranks, at Prof
//                     skills      optional skill ids: replace the lord/class skills
//                     inventory   weapon and consumable names; the first weapon the
//                                 unit can wield is equipped (staves only when nothing
//                                 else is). [] means unarmed.
//                   Gaspar is not here: he is the standard veteran (createVeteranKnight).
//   chapters        [chapter], one per prologue battle:
//                     id, node      chapter id and the route node that fights it
//                     title         display name
//                     objective     'rout' | 'seize' | 'escape'
//                     roster        unit keys that fight it (a standalone chapter builds
//                                   them with buildPrologueUnits; at most one per spawn)
//                     map           { legend: { char: terrain name }, rows: ["F . T", ...] }
//                                   rows are whitespace-separated legend characters;
//                                   the map holds terrain only, spawns are coordinates.
//                     playerSpawns  [{ col, row }]
//                     enemies       [{ id, className, level, col, row, weapon, skills,
//                                      aiMode?, holdPack?, holdPackSize?, isBoss?, name? }]
//                                   `id` names the enemy in beats; weapon/skills are the
//                                   enemy's whole kit (EnemySpawnGear.applySpawnLoadout).
//                     npc           null | { unit, className, col, row } (P3's Sera)
//                     villageTile   null | { col, row } on a Village tile
//                     thronePos     null | { col, row } (seize; default: the map's Throne)
//                     escapeTiles   null | [{ col, row }]
//                     loot          null | authored loot offer (P2+, not yet built)
//                     beats         [beat] (prologueBeatsFor)
//                   No reinforcements, bandits or fog: a chapter has no keys for them.
//   route           null | { nodes: [...], edges: [...] }  (P2+: buildPrologueNodeMap)
//   joins           null | { afterChapter: { <chapterId>: [unit key | special id] },
//                            atNode: { <nodeId>: [unit key | special id] } }
//   boss            null | { name, className, level, weapon, epithet } (P4's Varro; never
//                   in a real act's boss pool)
//
// Beats. A beat is { id, on, once?, <conditions>..., do: [action] }. `on` names a
// trigger; every other key except id/once/do is a condition the event must meet.
// prologueBeatsFor returns the actions of every matching beat, in authored order.
//
// Triggers (PROLOGUE_TRIGGERS) and the conditions each accepts:
//   battleStart                         the battle's first player phase, before input
//   turnStart       turn, phase         a phase begins; `phase` defaults to 'player'
//   unitSelected    unit, turn          a player unit is selected
//   afterMove       unit, tile, terrain, dangerFrom, turn
//                                       a unit finished moving (before its action);
//                                       event.dangerFrom lists the enemy ids whose
//                                       Danger tiles (what the player knows) hold the tile
//   forecastOpened  unit, target, nth, concept, turn
//                                       an attack forecast opened; event.nth counts the
//                                       battle's forecasts from 1, event.concepts is
//                                       forecastConcepts() of that forecast
//   combatResolved  unit, target, turn  a combat the player started has resolved
//   unitActed       unit, turn          a player unit's action is over (attack, wait...)
//   unitDefeated    unit                a unit fell
//   levelUp         unit                a unit gained a level
//   hpBelow         unit, pct           a unit's HP changed; matches at or below pct %
//   holdWoken       unit                a holding enemy woke
//   talk            unit, target        a Talk resolved
//   seize           unit                a lord seized
//   victory                             the battle is won
// Condition values: unit/target are unit keys or enemy ids; tile is { col, row };
// dangerFrom is an enemy id or '*' (any); concept is one of FORECAST_CONCEPTS; turn, nth
// and pct are integers.
//
// Actions (PROLOGUE_ACTIONS), each an object with exactly one key:
//   coach: <goal id>                    show a coach goal
//   note: <hint id>                     show a field note (marks the HintManager id)
//   dialogue: <dialogue key>            play a dialogue.json prologue line set
//   gateSelect: { unit }                only this unit may be selected
//   gateMove: { col, row }              the selected unit may only move here
//   gateConfirm: true                   only Confirm / Cancel on the open forecast
//   highlight: { tile } | { unit } | { reachOf: <enemy id> }
//   markLesson: { id, kind: 'shown' | 'practised' }
// The ids are resolved by the scene (PrologueController); this module only matches.

import { TERRAIN, XP_STAT_NAMES } from '../utils/constants.js';
import { TRAIT_RULES_VERSION } from './TraitSystem.js';
import { usesMagic, isStaff } from './Combat.js';
import {
  applyPromotedMastery,
  canEquip,
  createLordUnit,
  createUnit,
  levelUp,
  applyLevelUpGains,
  parseWeaponProficiencies,
} from './UnitManager.js';
import { keyedBattleRandom } from './BattleRng.js';
import { ensureItemUidWith } from '../utils/itemUid.js';
import { validateBattleConfig } from './MapGenerator.js';

export const PROLOGUE_TEMPLATE_PREFIX = 'prologue:';
export const PROLOGUE_OBJECTIVES = ['rout', 'seize', 'escape'];
export const PROLOGUE_ENEMY_AI_MODES = ['chase', 'guard', 'hold'];
export const PROLOGUE_LESSON_KINDS = ['shown', 'practised'];
export const FORECAST_CONCEPTS = ['triangle', 'doubling', 'noCounter', 'magic', 'uncertainHit'];

export const PROLOGUE_TRIGGERS = Object.freeze({
  battleStart: [],
  turnStart: ['turn', 'phase'],
  unitSelected: ['unit', 'turn'],
  afterMove: ['unit', 'tile', 'terrain', 'dangerFrom', 'turn'],
  forecastOpened: ['unit', 'target', 'nth', 'concept', 'turn'],
  combatResolved: ['unit', 'target', 'turn'],
  unitActed: ['unit', 'turn'],
  unitDefeated: ['unit'],
  levelUp: ['unit'],
  hpBelow: ['unit', 'pct'],
  holdWoken: ['unit'],
  talk: ['unit', 'target'],
  seize: ['unit'],
  victory: [],
});

export const PROLOGUE_ACTIONS = Object.freeze([
  'coach',
  'note',
  'dialogue',
  'gateSelect',
  'gateMove',
  'gateConfirm',
  'highlight',
  'markLesson',
]);

const BEAT_KEYS = new Set(['id', 'on', 'once', 'do']);
const CHAPTER_KEYS = new Set([
  'id',
  'node',
  'title',
  'objective',
  'roster',
  'map',
  'playerSpawns',
  'enemies',
  'npc',
  'villageTile',
  'thronePos',
  'escapeTiles',
  'loot',
  'beats',
]);
const UNIT_KEYS = new Set([
  'lord',
  'className',
  'level',
  'stats',
  'growths',
  'traits',
  'proficiencies',
  'skills',
  'inventory',
]);
const ENEMY_KEYS = new Set([
  'id',
  'className',
  'level',
  'col',
  'row',
  'weapon',
  'skills',
  'aiMode',
  'holdPack',
  'holdPackSize',
  'isBoss',
  'name',
]);
const ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const UNIT_STATS = [...XP_STAT_NAMES, 'MOV'];
// Every ground move type a prologue unit can have (Gaspar is Cavalry).
const PLAYER_SPAWN_MOVE_TYPES = ['Infantry', 'Armored', 'Cavalry'];

const isInt = (v) => Number.isInteger(v);
const isTile = (t) => t && typeof t === 'object' && isInt(t.col) && isInt(t.row);
const tileKey = (t) => `${t.col},${t.row}`;

// --- Map ---------------------------------------------------------------------------

/**
 * Parse a chapter's ASCII map against terrain.json. Never throws.
 * @returns {{ mapLayout: number[][]|null, cols: number, rows: number, errors: string[] }}
 */
export function parsePrologueMap(map, terrainData) {
  const errors = [];
  const rowsIn = map?.rows;
  const legend = map?.legend;
  if (!Array.isArray(rowsIn) || rowsIn.length === 0) {
    return { mapLayout: null, cols: 0, rows: 0, errors: ['map.rows must be a non-empty array'] };
  }
  if (!legend || typeof legend !== 'object' || Array.isArray(legend)) {
    return { mapLayout: null, cols: 0, rows: 0, errors: ['map.legend must be an object'] };
  }
  const indexOf = {};
  for (const [char, name] of Object.entries(legend)) {
    if (!/^\S$/.test(char)) errors.push(`map.legend key "${char}" must be one character`);
    const index = (terrainData || []).findIndex((t) => t?.name === name);
    if (index < 0) errors.push(`map.legend "${char}" names unknown terrain "${name}"`);
    else indexOf[char] = index;
  }
  const tokens = rowsIn.map((row) => (typeof row === 'string' ? row.trim().split(/\s+/) : null));
  const cols = tokens[0]?.length || 0;
  const mapLayout = [];
  tokens.forEach((line, r) => {
    if (!line) {
      errors.push(`map row ${r} must be a string`);
      return;
    }
    if (line.length !== cols) {
      errors.push(
        `map row ${r} has ${line.length} tiles, expected ${cols} (rows must be rectangular)`,
      );
    }
    mapLayout.push(
      line.map((char, c) => {
        if (!(char in indexOf)) {
          if (!(char in legend)) errors.push(`map tile (${c},${r}) "${char}" is not in the legend`);
          return -1;
        }
        return indexOf[char];
      }),
    );
  });
  return { mapLayout: errors.length ? null : mapLayout, cols, rows: rowsIn.length, errors };
}

function throneTiles(mapLayout) {
  const out = [];
  mapLayout.forEach((line, row) =>
    line.forEach((index, col) => {
      if (index === TERRAIN.Throne) out.push({ col, row });
    }),
  );
  return out;
}

/**
 * The battle config a chapter fights on: the shape `generateBattle` returns, so it can
 * be locked on its node (RunManager.battleConfigsByNodeId) and read by BattleScene and
 * the headless harness unchanged. Plain JSON. Throws on a map that doesn't parse
 * (validatePrologueConfig reports the details).
 * @param {object} chapter - a data/prologue.json chapter
 * @param {object[]} terrainData - data/terrain.json
 */
export function buildPrologueBattleConfig(chapter, terrainData) {
  const parsed = parsePrologueMap(chapter?.map, terrainData);
  if (!parsed.mapLayout) {
    throw new Error(`Prologue chapter "${chapter?.id}": ${parsed.errors.join('; ')}`);
  }
  const { mapLayout, cols, rows } = parsed;
  const objective = chapter.objective || 'rout';
  const enemySpawns = (chapter.enemies || []).map((e) => {
    const spawn = {
      className: e.className,
      level: e.level,
      col: e.col,
      row: e.row,
      authoredId: e.id,
    };
    if (e.weapon) spawn.weapon = e.weapon;
    if (Array.isArray(e.skills)) spawn.skills = [...e.skills];
    if (e.aiMode) spawn.aiMode = e.aiMode;
    if (isInt(e.holdPack)) spawn.holdPack = e.holdPack;
    if (isInt(e.holdPackSize)) spawn.holdPackSize = e.holdPackSize;
    if (e.isBoss) spawn.isBoss = true;
    if (e.name) spawn.name = e.name;
    return spawn;
  });
  const npc = chapter.npc
    ? {
        col: chapter.npc.col,
        row: chapter.npc.row,
        className: chapter.npc.className,
        name: chapter.npc.unit,
        prologueUnit: chapter.npc.unit,
      }
    : null;
  let thronePos = isTile(chapter.thronePos) ? { ...chapter.thronePos } : null;
  if (!thronePos && objective === 'seize') {
    const thrones = throneTiles(mapLayout);
    if (thrones.length === 1) thronePos = thrones[0];
  }
  return {
    mapLayout,
    cols,
    rows,
    objective,
    biome: null,
    playerSpawns: (chapter.playerSpawns || []).map((t) => ({ col: t.col, row: t.row })),
    enemySpawns,
    npcSpawn: npc,
    villageTile: isTile(chapter.villageTile) ? { ...chapter.villageTile } : undefined,
    thronePos,
    escapeTiles: Array.isArray(chapter.escapeTiles)
      ? chapter.escapeTiles.map((t) => ({ col: t.col, row: t.row }))
      : undefined,
    templateId: `${PROLOGUE_TEMPLATE_PREFIX}${chapter.id}`,
    prologueChapter: chapter.id,
    parBonus: 0,
    toxicTiles: [],
  };
}

// --- Beats -------------------------------------------------------------------------

/**
 * The beat concepts a forecast shows (FORECAST_CONCEPTS), for forecastOpened events.
 * @param {object} forecast - getCombatForecast's result
 * @param {{ weapon?: object }} [context] - the weapon the forecast plans to attack with
 */
export function forecastConcepts(forecast, { weapon = null } = {}) {
  const out = [];
  const triangle = forecast?.display?.triangle;
  if (triangle?.damage || triangle?.hit) out.push('triangle');
  if (forecast?.attacker?.doubles || forecast?.defender?.doubles) out.push('doubling');
  if (forecast?.defender && !forecast.defender.canCounter) out.push('noCounter');
  if (weapon && usesMagic(weapon)) out.push('magic');
  if (Number.isFinite(forecast?.attacker?.hit) && forecast.attacker.hit < 100) {
    out.push('uncertainHit');
  }
  return out;
}

const CONDITION_MATCHERS = {
  unit: (want, e) => e.unit === want,
  target: (want, e) => e.target === want,
  turn: (want, e) => e.turn === want,
  phase: (want, e) => e.phase === want,
  tile: (want, e) => isTile(e.tile) && e.tile.col === want.col && e.tile.row === want.row,
  terrain: (want, e) => e.terrain === want,
  dangerFrom: (want, e) =>
    Array.isArray(e.dangerFrom) &&
    (want === '*' ? e.dangerFrom.length > 0 : e.dangerFrom.includes(want)),
  nth: (want, e) => e.nth === want,
  concept: (want, e) => Array.isArray(e.concepts) && e.concepts.includes(want),
  pct: (want, e) => Number.isFinite(e.hpPct) && e.hpPct <= want,
};

function beatConditions(beat) {
  return Object.keys(beat).filter((key) => !BEAT_KEYS.has(key));
}

function beatMatches(beat, event) {
  if (beat.on !== event.type) return false;
  const conditions = beatConditions(beat);
  // A turnStart beat names the player phase unless it says otherwise.
  if (beat.on === 'turnStart' && !conditions.includes('phase') && event.phase !== 'player') {
    return false;
  }
  return conditions.every((key) => CONDITION_MATCHERS[key]?.(beat[key], event) === true);
}

/**
 * The actions a chapter's beats take for one event. Pure: `state` is not mutated.
 * Beats match in authored order and their actions come out in that order, each tagged
 * with its beat id. A `once` beat fires at most once: the returned state records it.
 * @param {object} chapter
 * @param {{ type: string }} event - see the module header for each trigger's fields
 * @param {{ fired?: string[] }} [state]
 * @returns {{ actions: object[], fired: string[], state: { fired: string[] } }}
 */
export function prologueBeatsFor(chapter, event, state = {}) {
  const done = new Set(Array.isArray(state?.fired) ? state.fired : []);
  const actions = [];
  const fired = [];
  if (event && typeof event.type === 'string') {
    for (const beat of Array.isArray(chapter?.beats) ? chapter.beats : []) {
      if (!beat || (beat.once && done.has(beat.id))) continue;
      if (!beatMatches(beat, event)) continue;
      fired.push(beat.id);
      if (beat.once) done.add(beat.id);
      for (const action of Array.isArray(beat.do) ? beat.do : []) {
        actions.push({ ...structuredClone(action), beat: beat.id });
      }
    }
  }
  return { actions, fired, state: { ...state, fired: [...done] } };
}

// --- Units -------------------------------------------------------------------------

/** A seeded stream for one authored unit, independent of the order units are built in. */
export function prologueUnitRng(seed, unitKey) {
  return keyedBattleRandom(Math.trunc(Number(seed) || 0) >>> 0, `prologue-unit:${unitKey}`);
}

function parseProficiencyList(list) {
  return list.map((type) => ({ type, rank: 'Prof' }));
}

function findItem(gameData, name) {
  const weapon = (gameData.weapons || []).find((w) => w?.name === name);
  if (weapon) return { kind: 'weapon', data: weapon };
  const consumable = (gameData.consumables || []).find((c) => c?.name === name);
  if (consumable) return { kind: 'consumable', data: consumable };
  return null;
}

function equipAuthored(unit) {
  const usable = (unit.inventory || []).filter((w) => canEquip(unit, w));
  const weapon = usable.find((w) => !isStaff(w)) || usable[0] || null;
  unit.weapon = weapon;
  if (weapon) {
    unit.inventory.splice(unit.inventory.indexOf(weapon), 1);
    unit.inventory.unshift(weapon);
  }
}

/**
 * Build an authored prologue unit (docs/specs/prologue-chapter.md §8): fixed stats,
 * growths and traits, the authored kit, no meta. Lords start from createLordUnit (their
 * personal skill, growth fields, lord flags), generic units from createUnit; either way
 * the authored fields then replace what was rolled. Every draw (growth rolls when growths
 * aren't authored, level-ups when stats aren't, item uids) comes from `rng`; Math.random
 * is never touched. Gaspar is not built here (createVeteranKnight).
 * @param {object} spec - a data/prologue.json `units` entry
 * @param {object} gameData - { lords, classes, weapons, consumables }
 * @param {() => number} rng - e.g. prologueUnitRng(prologue.seed, key)
 * @param {{ name?: string }} [options] - the unit's name when the spec has no lord
 */
export function buildPrologueUnit(spec, gameData, rng, { name = null } = {}) {
  if (typeof rng !== 'function') throw new Error('buildPrologueUnit needs a seeded rng');
  if (!spec || typeof spec !== 'object') throw new Error('buildPrologueUnit needs a spec');
  let unit;
  if (spec.lord) {
    const lordData = (gameData.lords || []).find((l) => l.name === spec.lord);
    if (!lordData) throw new Error(`Unknown prologue lord "${spec.lord}"`);
    const classData = (gameData.classes || []).find((c) => c.name === lordData.class);
    unit = createLordUnit(lordData, classData, gameData.weapons || [], { rng });
  } else {
    const classData = (gameData.classes || []).find((c) => c.name === spec.className);
    if (!classData) throw new Error(`Unknown prologue class "${spec.className}"`);
    unit = createUnit(classData, 1, gameData.weapons || [], {
      name: name || spec.className,
      rng,
    });
  }

  if (Array.isArray(spec.proficiencies))
    unit.proficiencies = parseProficiencyList(spec.proficiencies);
  unit.weaponRank = unit.proficiencies[0]?.rank || 'Prof';
  if (spec.growths) unit.growths = { ...spec.growths };
  const level = Math.max(1, Math.trunc(Number(spec.level) || 1));
  if (spec.stats) {
    unit.stats = { ...spec.stats };
    unit.level = level;
  } else {
    for (let i = 1; i < level; i++) {
      const gains = levelUp(unit, rng);
      if (gains) applyLevelUpGains(unit, gains);
    }
  }
  unit.xp = 0;
  unit.mov = unit.stats.MOV;
  unit.currentHP = unit.stats.HP;
  unit.traits = Array.isArray(spec.traits) ? [...spec.traits] : [];
  unit.traitRulesVersion = TRAIT_RULES_VERSION;
  if (Array.isArray(spec.skills)) unit.skills = [...spec.skills];

  unit.inventory = [];
  unit.consumables = [];
  for (const itemName of Array.isArray(spec.inventory) ? spec.inventory : []) {
    const item = findItem(gameData, itemName);
    if (!item) throw new Error(`Unknown prologue item "${itemName}"`);
    const clone = ensureItemUidWith(structuredClone(item.data), rng);
    if (item.kind === 'consumable') unit.consumables.push(clone);
    else unit.inventory.push(clone);
  }
  equipAuthored(unit);
  return unit;
}

/**
 * Build the named authored units (default: every `units` entry), each named by its key
 * and drawing from its own stream (prologueUnitRng), so building one never changes
 * another. Returns them in the order asked.
 * @param {object} prologue - data/prologue.json
 * @param {object} gameData
 * @param {string[]} [keys]
 */
export function buildPrologueUnits(prologue, gameData, keys = Object.keys(prologue?.units || {})) {
  return keys.map((key) => {
    const spec = prologue?.units?.[key];
    if (!spec) throw new Error(`Unknown prologue unit "${key}"`);
    return buildPrologueUnit(spec, gameData, prologueUnitRng(prologue.seed, key), { name: key });
  });
}

// --- Validation --------------------------------------------------------------------

function weaponTypes(weapons) {
  return new Set((weapons || []).map((w) => w?.type).filter((t) => t && t !== 'Scroll'));
}

function passable(terrainData, index, moveType) {
  const cost = terrainData?.[index]?.moveCost?.[moveType];
  return cost !== undefined && cost !== '--' && Number.isFinite(parseInt(cost, 10));
}

/** Proficiency stand-in for a class (what an enemy of it can wield). */
function classWielder(classData) {
  return {
    proficiencies: applyPromotedMastery(
      parseWeaponProficiencies(classData?.weaponProficiencies),
      classData?.tier || 'base',
    ),
  };
}

function validateUnits(units, gameData, errors) {
  if (!units || typeof units !== 'object' || Array.isArray(units)) {
    errors.push('units must be an object keyed by unit name');
    return;
  }
  const types = weaponTypes(gameData.weapons);
  const traitIds = new Set((gameData.traits || []).map((t) => t?.id));
  const skillIds = new Set((gameData.skills || []).map((s) => s?.id));
  for (const [key, spec] of Object.entries(units)) {
    const where = `units.${key}`;
    if (!spec || typeof spec !== 'object') {
      errors.push(`${where} must be an object`);
      continue;
    }
    for (const field of Object.keys(spec)) {
      if (!UNIT_KEYS.has(field)) errors.push(`${where} has unknown field "${field}"`);
    }
    let classData = null;
    if (spec.lord && spec.className) errors.push(`${where} names both a lord and a className`);
    if (spec.lord) {
      const lord = (gameData.lords || []).find((l) => l.name === spec.lord);
      if (!lord) errors.push(`${where}.lord "${spec.lord}" is not in lords.json`);
      else {
        if (key !== spec.lord) errors.push(`${where} must be keyed by its lord's name`);
        classData = (gameData.classes || []).find((c) => c.name === lord.class);
      }
    } else if (spec.className) {
      classData = (gameData.classes || []).find((c) => c.name === spec.className);
      if (!classData) errors.push(`${where}.className "${spec.className}" is not in classes.json`);
    } else {
      errors.push(`${where} needs a lord or a className`);
    }
    if (!isInt(spec.level) || spec.level < 1) errors.push(`${where}.level must be an integer >= 1`);
    if (spec.stats !== undefined) {
      for (const stat of UNIT_STATS) {
        if (!isInt(spec.stats?.[stat]) || spec.stats[stat] < 0) {
          errors.push(`${where}.stats.${stat} must be an integer >= 0`);
        }
      }
      if (isInt(spec.stats?.HP) && spec.stats.HP < 1) errors.push(`${where}.stats.HP must be >= 1`);
    }
    if (spec.growths !== undefined) {
      for (const stat of XP_STAT_NAMES) {
        const g = spec.growths?.[stat];
        if (!isInt(g) || g < 0 || g > 200) {
          errors.push(`${where}.growths.${stat} must be an integer from 0 to 200`);
        }
      }
    }
    if (spec.traits !== undefined) {
      if (!Array.isArray(spec.traits)) errors.push(`${where}.traits must be an array`);
      else
        for (const id of spec.traits)
          if (!traitIds.has(id)) errors.push(`${where}.traits: unknown trait "${id}"`);
    }
    if (spec.skills !== undefined) {
      if (!Array.isArray(spec.skills)) errors.push(`${where}.skills must be an array`);
      else
        for (const id of spec.skills)
          if (!skillIds.has(id)) errors.push(`${where}.skills: unknown skill "${id}"`);
    }
    let proficiencies = classData ? classWielder(classData).proficiencies : [];
    if (spec.proficiencies !== undefined) {
      if (!Array.isArray(spec.proficiencies)) {
        errors.push(`${where}.proficiencies must be an array of weapon types`);
      } else {
        for (const type of spec.proficiencies)
          if (!types.has(type))
            errors.push(`${where}.proficiencies: unknown weapon type "${type}"`);
        proficiencies = parseProficiencyList(spec.proficiencies);
      }
    }
    if (!Array.isArray(spec.inventory)) {
      errors.push(`${where}.inventory must be an array (empty: unarmed)`);
      continue;
    }
    let weaponCount = 0;
    let consumableCount = 0;
    for (const name of spec.inventory) {
      const item = findItem(gameData, name);
      if (!item) {
        errors.push(`${where}.inventory: unknown item "${name}"`);
        continue;
      }
      if (item.kind === 'consumable') {
        consumableCount++;
        continue;
      }
      weaponCount++;
      if (item.data.type === 'Scroll') {
        errors.push(`${where}.inventory: "${name}" is a scroll, not a carried weapon`);
      } else if ((classData || spec.proficiencies) && !canEquip({ proficiencies }, item.data)) {
        errors.push(`${where}.inventory: ${key} can't wield "${name}" (${item.data.type})`);
      }
    }
    if (weaponCount > 5) errors.push(`${where}.inventory carries more than 5 weapons`);
    if (consumableCount > 3) errors.push(`${where}.inventory carries more than 3 consumables`);
  }
}

function validateCondition(where, key, value, ctx, errors) {
  const unitRef = (v) =>
    typeof v === 'string' && (ctx.unitNames.has(v) || ctx.enemyIds.has(v) || ctx.npcNames.has(v));
  switch (key) {
    case 'unit':
    case 'target':
      if (!unitRef(value)) errors.push(`${where}.${key} "${value}" names no unit of this chapter`);
      break;
    case 'turn':
    case 'nth':
      if (!isInt(value) || value < 1) errors.push(`${where}.${key} must be an integer >= 1`);
      break;
    case 'pct':
      if (!isInt(value) || value < 1 || value > 100) {
        errors.push(`${where}.pct must be an integer from 1 to 100`);
      }
      break;
    case 'phase':
      if (value !== 'player' && value !== 'enemy') {
        errors.push(`${where}.phase must be "player" or "enemy"`);
      }
      break;
    case 'tile':
      if (!ctx.inBounds(value)) errors.push(`${where}.tile is not a tile on the map`);
      break;
    case 'terrain':
      if (!ctx.terrainNames.has(value)) errors.push(`${where}.terrain "${value}" is not a terrain`);
      break;
    case 'dangerFrom':
      if (value !== '*' && !ctx.enemyIds.has(value)) {
        errors.push(`${where}.dangerFrom "${value}" is not an enemy id or "*"`);
      }
      break;
    case 'concept':
      if (!FORECAST_CONCEPTS.includes(value)) {
        errors.push(`${where}.concept "${value}" is not one of ${FORECAST_CONCEPTS.join(', ')}`);
      }
      break;
    default:
      errors.push(`${where}: unknown condition "${key}"`);
  }
}

function validateAction(where, action, ctx, errors) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    errors.push(`${where} must be an object`);
    return;
  }
  const keys = Object.keys(action);
  if (keys.length !== 1 || !PROLOGUE_ACTIONS.includes(keys[0])) {
    errors.push(`${where} must have exactly one of: ${PROLOGUE_ACTIONS.join(', ')}`);
    return;
  }
  const [kind] = keys;
  const value = action[kind];
  const isId = (v) => typeof v === 'string' && ID_PATTERN.test(v);
  switch (kind) {
    case 'coach':
    case 'note':
    case 'dialogue':
      if (!isId(value)) errors.push(`${where}.${kind} must be a snake_case id`);
      break;
    case 'gateSelect':
      if (!ctx.unitNames.has(value?.unit) && !ctx.npcNames.has(value?.unit)) {
        errors.push(`${where}.gateSelect.unit "${value?.unit}" is not a player unit`);
      }
      break;
    case 'gateMove':
      if (!ctx.inBounds(value)) errors.push(`${where}.gateMove is not a tile on the map`);
      else if (!ctx.passable(value, 'Infantry')) {
        errors.push(`${where}.gateMove (${value.col},${value.row}) is impassable`);
      }
      break;
    case 'gateConfirm':
      if (value !== true) errors.push(`${where}.gateConfirm must be true`);
      break;
    case 'highlight': {
      const hk = value && typeof value === 'object' ? Object.keys(value) : [];
      if (hk.length !== 1 || !['tile', 'unit', 'reachOf'].includes(hk[0])) {
        errors.push(`${where}.highlight needs exactly one of tile, unit, reachOf`);
      } else if (hk[0] === 'tile' && !ctx.inBounds(value.tile)) {
        errors.push(`${where}.highlight.tile is not a tile on the map`);
      } else if (hk[0] === 'unit') {
        validateCondition(`${where}.highlight`, 'unit', value.unit, ctx, errors);
      } else if (hk[0] === 'reachOf' && !ctx.enemyIds.has(value.reachOf)) {
        errors.push(`${where}.highlight.reachOf "${value.reachOf}" is not an enemy id`);
      }
      break;
    }
    case 'markLesson':
      if (!isId(value?.id)) errors.push(`${where}.markLesson.id must be a snake_case id`);
      if (!PROLOGUE_LESSON_KINDS.includes(value?.kind)) {
        errors.push(`${where}.markLesson.kind must be "shown" or "practised"`);
      }
      break;
    default:
      break;
  }
}

function validateBeats(where, beats, ctx, errors) {
  if (!Array.isArray(beats)) {
    errors.push(`${where}.beats must be an array`);
    return;
  }
  const ids = new Set();
  beats.forEach((beat, i) => {
    const at = `${where}.beats[${i}]`;
    if (!beat || typeof beat !== 'object') {
      errors.push(`${at} must be an object`);
      return;
    }
    if (typeof beat.id !== 'string' || !ID_PATTERN.test(beat.id)) {
      errors.push(`${at}.id must be a snake_case id`);
    } else if (ids.has(beat.id)) errors.push(`${at}: duplicate beat id "${beat.id}"`);
    else ids.add(beat.id);
    if (beat.once !== undefined && typeof beat.once !== 'boolean') {
      errors.push(`${at}.once must be true or false`);
    }
    const allowed = PROLOGUE_TRIGGERS[beat.on];
    if (!allowed) {
      errors.push(`${at}.on "${beat.on}" is not a known trigger`);
    } else {
      for (const key of beatConditions(beat)) {
        if (!allowed.includes(key)) {
          errors.push(`${at}: trigger "${beat.on}" takes no condition "${key}"`);
        } else validateCondition(at, key, beat[key], ctx, errors);
      }
    }
    if (!Array.isArray(beat.do) || beat.do.length === 0) {
      errors.push(`${at}.do must be a non-empty array of actions`);
    } else beat.do.forEach((action, j) => validateAction(`${at}.do[${j}]`, action, ctx, errors));
  });
}

function validateChapter(chapter, index, prologue, gameData, errors, seen) {
  const where = `chapters[${index}]${chapter?.id ? ` (${chapter.id})` : ''}`;
  if (!chapter || typeof chapter !== 'object') {
    errors.push(`${where} must be an object`);
    return;
  }
  for (const key of Object.keys(chapter)) {
    if (!CHAPTER_KEYS.has(key)) errors.push(`${where} has unknown field "${key}"`);
  }
  if (typeof chapter.id !== 'string' || !ID_PATTERN.test(chapter.id)) {
    errors.push(`${where}.id must be a snake_case id`);
  } else if (seen.chapters.has(chapter.id)) errors.push(`${where}: duplicate chapter id`);
  else seen.chapters.add(chapter.id);
  if (typeof chapter.node !== 'string' || !chapter.node)
    errors.push(`${where}.node must be a node id`);
  else if (seen.nodes.has(chapter.node))
    errors.push(`${where}: node "${chapter.node}" fights two chapters`);
  else seen.nodes.add(chapter.node);
  if (!PROLOGUE_OBJECTIVES.includes(chapter.objective)) {
    errors.push(`${where}.objective must be one of ${PROLOGUE_OBJECTIVES.join(', ')}`);
  }

  const terrainData = gameData.terrain || [];
  const parsed = parsePrologueMap(chapter.map, terrainData);
  for (const e of parsed.errors) errors.push(`${where}.${e}`);
  const { cols, rows } = parsed;
  const inBounds = (t) => isTile(t) && t.col >= 0 && t.col < cols && t.row >= 0 && t.row < rows;
  const passableAt = (t, moveType) =>
    parsed.mapLayout ? passable(terrainData, parsed.mapLayout[t.row][t.col], moveType) : true;

  if (!Array.isArray(chapter.roster) || chapter.roster.length === 0) {
    errors.push(`${where}.roster must be a non-empty array of unit keys`);
  } else {
    const unitKeys = new Set(Object.keys(prologue?.units || {}));
    const seenUnits = new Set();
    for (const key of chapter.roster) {
      if (!unitKeys.has(key)) errors.push(`${where}.roster: unknown unit "${key}"`);
      else if (seenUnits.has(key)) errors.push(`${where}.roster: "${key}" twice`);
      seenUnits.add(key);
    }
    if (
      Array.isArray(chapter.playerSpawns) &&
      chapter.roster.length > chapter.playerSpawns.length
    ) {
      errors.push(`${where}.roster has more units than playerSpawns`);
    }
  }

  if (!Array.isArray(chapter.playerSpawns) || chapter.playerSpawns.length === 0) {
    errors.push(`${where}.playerSpawns must be a non-empty array`);
  } else {
    chapter.playerSpawns.forEach((t, i) => {
      if (!inBounds(t)) errors.push(`${where}.playerSpawns[${i}] is off the map`);
      else
        for (const moveType of PLAYER_SPAWN_MOVE_TYPES)
          if (!passableAt(t, moveType)) {
            errors.push(
              `${where}.playerSpawns[${i}] (${tileKey(t)}) is impassable for ${moveType}`,
            );
          }
    });
  }

  const enemyIds = new Set();
  const skillIds = new Set((gameData.skills || []).map((s) => s?.id));
  if (!Array.isArray(chapter.enemies) || chapter.enemies.length === 0) {
    errors.push(`${where}.enemies must be a non-empty array`);
  } else {
    chapter.enemies.forEach((enemy, i) => {
      const at = `${where}.enemies[${i}]${enemy?.id ? ` (${enemy.id})` : ''}`;
      if (!enemy || typeof enemy !== 'object') {
        errors.push(`${at} must be an object`);
        return;
      }
      for (const key of Object.keys(enemy)) {
        if (!ENEMY_KEYS.has(key)) errors.push(`${at} has unknown field "${key}"`);
      }
      if (typeof enemy.id !== 'string' || !ID_PATTERN.test(enemy.id)) {
        errors.push(`${at}.id must be a snake_case id`);
      } else if (enemyIds.has(enemy.id)) errors.push(`${at}: duplicate enemy id`);
      else enemyIds.add(enemy.id);
      const classData = (gameData.classes || []).find((c) => c.name === enemy.className);
      if (!classData) errors.push(`${at}.className "${enemy.className}" is not in classes.json`);
      if (!isInt(enemy.level) || enemy.level < 1)
        errors.push(`${at}.level must be an integer >= 1`);
      if (!inBounds(enemy)) errors.push(`${at} is off the map`);
      else if (classData && !passableAt(enemy, classData.moveType || 'Infantry')) {
        errors.push(`${at} (${tileKey(enemy)}) is impassable for ${classData.moveType}`);
      }
      // Authored kit: the weapon is required, so no enemy rolls a tier by level.
      const weapon = (gameData.weapons || []).find((w) => w.name === enemy.weapon);
      if (!weapon) errors.push(`${at}.weapon "${enemy.weapon}" is not in weapons.json`);
      else if (
        classData &&
        (weapon.type === 'Scroll' || !canEquip(classWielder(classData), weapon))
      ) {
        errors.push(`${at}: a ${enemy.className} can't wield "${enemy.weapon}"`);
      }
      if (!Array.isArray(enemy.skills)) errors.push(`${at}.skills must be an array ([] for none)`);
      else
        for (const id of enemy.skills)
          if (!skillIds.has(id)) errors.push(`${at}.skills: unknown skill "${id}"`);
      if (enemy.aiMode !== undefined && !PROLOGUE_ENEMY_AI_MODES.includes(enemy.aiMode)) {
        errors.push(`${at}.aiMode must be one of ${PROLOGUE_ENEMY_AI_MODES.join(', ')}`);
      }
      if (enemy.aiMode === 'hold') {
        if (!isInt(enemy.holdPack) || enemy.holdPack < 0) {
          errors.push(`${at}.holdPack must be an integer >= 0 for a holder`);
        }
        if (!isInt(enemy.holdPackSize) || enemy.holdPackSize < 1) {
          errors.push(`${at}.holdPackSize must be an integer >= 1 for a holder`);
        }
      } else if (enemy.holdPack !== undefined || enemy.holdPackSize !== undefined) {
        errors.push(`${at} has hold fields but aiMode is not "hold"`);
      }
    });
    // A pack's declared size must be its holder count, or it wakes as "fallen" at once.
    const packs = new Map();
    for (const e of chapter.enemies) {
      if (e?.aiMode !== 'hold' || !isInt(e.holdPack)) continue;
      const pack = packs.get(e.holdPack) || { count: 0, sizes: new Set() };
      pack.count++;
      pack.sizes.add(e.holdPackSize);
      packs.set(e.holdPack, pack);
    }
    for (const [pack, { count, sizes }] of packs) {
      if (sizes.size !== 1 || !sizes.has(count)) {
        errors.push(
          `${where}: hold pack ${pack} has ${count} holders but holdPackSize ${[...sizes].join('/')}`,
        );
      }
    }
  }

  const npcNames = new Set();
  if (chapter.npc) {
    const spec = prologue?.units?.[chapter.npc.unit];
    if (!spec) errors.push(`${where}.npc.unit "${chapter.npc.unit}" is not in units`);
    else {
      npcNames.add(chapter.npc.unit);
      const lord = spec.lord ? (gameData.lords || []).find((l) => l.name === spec.lord) : null;
      const className = lord ? lord.class : spec.className;
      if (chapter.npc.className !== className) {
        errors.push(`${where}.npc.className must be "${className}" (the unit's class)`);
      }
    }
    if (!inBounds(chapter.npc)) errors.push(`${where}.npc is off the map`);
  }
  for (const field of ['villageTile', 'thronePos']) {
    if (chapter[field] != null && !inBounds(chapter[field])) {
      errors.push(`${where}.${field} is not a tile on the map`);
    }
  }
  if (chapter.escapeTiles != null && !Array.isArray(chapter.escapeTiles)) {
    errors.push(`${where}.escapeTiles must be an array of tiles`);
  }
  if (chapter.objective === 'seize' && parsed.mapLayout && !isTile(chapter.thronePos)) {
    const thrones = throneTiles(parsed.mapLayout);
    if (thrones.length !== 1) {
      errors.push(`${where}: a seize map needs thronePos or exactly one Throne tile`);
    }
  }

  const ctx = {
    unitNames: new Set(Object.keys(prologue?.units || {})),
    enemyIds,
    npcNames,
    terrainNames: new Set(terrainData.map((t) => t?.name)),
    inBounds,
    passable: passableAt,
  };
  validateBeats(where, chapter.beats, ctx, errors);

  // The built config must pass the generator's own output check.
  if (parsed.mapLayout) {
    try {
      const config = buildPrologueBattleConfig(chapter, terrainData);
      for (const v of validateBattleConfig(config, {
        terrain: terrainData,
        classes: gameData.classes,
      })) {
        errors.push(`${where}: battle config: ${v}`);
      }
    } catch (err) {
      errors.push(`${where}: battle config: ${err?.message || err}`);
    }
  }
}

function validateBoss(boss, gameData, errors) {
  if (boss == null) return;
  if (typeof boss !== 'object') {
    errors.push('boss must be an object or null');
    return;
  }
  if (typeof boss.name !== 'string' || !boss.name) errors.push('boss.name must be a string');
  const realBosses = Object.entries(gameData.enemies?.bosses || {});
  for (const [act, pool] of realBosses) {
    if ((Array.isArray(pool) ? pool : []).some((b) => b?.name === boss.name)) {
      errors.push(`boss "${boss.name}" is in the real ${act} boss pool (prologue bosses stay out)`);
    }
  }
  const classData = (gameData.classes || []).find((c) => c.name === boss.className);
  if (!classData) errors.push(`boss.className "${boss.className}" is not in classes.json`);
  if (!isInt(boss.level) || boss.level < 1) errors.push('boss.level must be an integer >= 1');
  const weapon = (gameData.weapons || []).find((w) => w.name === boss.weapon);
  if (!weapon) errors.push(`boss.weapon "${boss.weapon}" is not in weapons.json`);
  else if (classData && !canEquip(classWielder(classData), weapon)) {
    errors.push(`boss: a ${boss.className} can't wield "${boss.weapon}"`);
  }
}

function validateJoins(joins, prologue, gameData, errors) {
  if (joins == null) return;
  if (typeof joins !== 'object' || Array.isArray(joins)) {
    errors.push('joins must be an object or null');
    return;
  }
  const chapterIds = new Set((prologue.chapters || []).map((c) => c?.id));
  const joinable = new Set([
    ...Object.keys(prologue.units || {}),
    ...(gameData.specialChars || []).map((s) => s?.id),
  ]);
  for (const [section, keys] of Object.entries(joins)) {
    if (section !== 'afterChapter' && section !== 'atNode') {
      errors.push(`joins has unknown section "${section}"`);
      continue;
    }
    for (const [at, list] of Object.entries(keys || {})) {
      if (section === 'afterChapter' && !chapterIds.has(at)) {
        errors.push(`joins.afterChapter: unknown chapter "${at}"`);
      }
      if (!Array.isArray(list)) {
        errors.push(`joins.${section}.${at} must be an array`);
        continue;
      }
      for (const who of list)
        if (!joinable.has(who)) errors.push(`joins.${section}.${at}: unknown unit "${who}"`);
    }
  }
}

/**
 * Validate data/prologue.json against the game data (npm run validate:data).
 * @param {object} prologue
 * @param {object} gameData - { terrain, lords, classes, weapons, consumables, skills,
 *   traits, enemies, specialChars }
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePrologueConfig(prologue, gameData = {}) {
  const errors = [];
  if (!prologue || typeof prologue !== 'object') {
    return { valid: false, errors: ['prologue data must be an object'] };
  }
  if (!isInt(prologue.seed)) errors.push('seed must be an integer');
  for (const currency of ['valor', 'supply']) {
    const v = prologue.grant?.[currency];
    if (!isInt(v) || v < 0) errors.push(`grant.${currency} must be an integer >= 0`);
  }
  validateUnits(prologue.units, gameData, errors);
  if (!Array.isArray(prologue.chapters) || prologue.chapters.length === 0) {
    errors.push('chapters must be a non-empty array');
  } else {
    const seen = { chapters: new Set(), nodes: new Set() };
    prologue.chapters.forEach((chapter, i) =>
      validateChapter(chapter, i, prologue, gameData, errors, seen),
    );
  }
  if (
    prologue.route != null &&
    (typeof prologue.route !== 'object' || !Array.isArray(prologue.route.nodes))
  ) {
    errors.push('route must be null or { nodes: [...], edges: [...] }');
  }
  validateJoins(prologue.joins, prologue, gameData, errors);
  validateBoss(prologue.boss, gameData, errors);
  return { valid: errors.length === 0, errors };
}
