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
//                     join        optional, a unit that joins on arrival at a route node
//                                 (joins.atNode): { line, needs?, lineIfGranted? }. `line`
//                                 is the dialogue.json `prologue` key its recruit card
//                                 reads; `needs` names an item the army must hold when it
//                                 joins (Tamsin's bow): when no unit carries it and the
//                                 convoy has none, it is granted to the convoy and the
//                                 card reads `lineIfGranted` instead (prologueArrival)
//                   Gaspar is not here: he is the standard veteran (createVeteranKnight).
//   chapters        [chapter], one per prologue battle:
//                     id, node      chapter id and the route node that fights it
//                     title         display name
//                     objective     'rout' | 'seize' | 'escape'
//                     roster        who fights it, in spawn order: unit keys and special
//                                   character ids (the standard veteran, Gaspar). A standalone
//                                   replay builds them with buildPrologueRoster; in the
//                                   prologue run it is the run's roster. Every unit here
//                                   is protected (its fall restarts the chapter).
//                     rosterLevels  optional { <unit key>: level }: the level a replay
//                                   builds the unit at (seeded level-ups from its spec),
//                                   so a replay enters at the chapter's expected level
//                     rosterItems   optional { <unit key>: [item names] }: what a replay
//                                   adds to an authored unit's kit (the items the run
//                                   would have handed it by then: Tamsin's bow)
//                     rosterEquip   optional { <unit key>: weapon name }: the carried
//                                   weapon a replay's unit holds (what the roster lesson
//                                   and the deploy note have it equip by then: Gaspar's
//                                   sword against P4's axes)
//                     showPar       optional, default true: false hides the HUD par and
//                                   turns the par's rules off (no late pressure, no
//                                   rating); P1-P3 teach without it, P4 teaches it
//                     deploy        optional { min, note? }: the roster outnumbers the
//                                   spawns and the deploy screen chooses who fights (at
//                                   most one per spawn, at least `min`; the commander
//                                   always deploys). `note` is the field note the screen
//                                   opens with (prologueContent PROLOGUE_NOTES). P4's.
//                     formation     optional { tiles: [{ col, row }] }: the chapter opens
//                                   formation placement (FormationController) with these
//                                   spare start tiles beside the spawns. P4's.
//                     map           { legend: { char: terrain name }, rows: ["F . T", ...] }
//                                   rows are whitespace-separated legend characters;
//                                   the map holds terrain only, spawns are coordinates.
//                     playerSpawns  [{ col, row }]
//                     enemies       [{ id, className, level, col, row, weapon, skills,
//                                      aiMode?, holdPack?, holdPackSize?, isBoss?, name? }]
//                                   `id` names the enemy in beats; weapon/skills are the
//                                   enemy's whole kit (EnemySpawnGear.applySpawnLoadout).
//                     npc           null | { unit, className, col, row, line? }: an
//                                   authored green unit (P3's Sera), built from `units`
//                                   (buildPrologueNpcUnit), never a rolled recruit; it is
//                                   protected, green or blue. `line` is the dialogue.json
//                                   `prologue` key its Talk card reads.
//                     villageTile   null | { col, row, reward? } on a Village tile. It is
//                                   never contested (no bandits); `reward` names the item
//                                   the visit sends to the convoy (default: the act's
//                                   random consumable, VillageSystem.villageRewardItem)
//                     thronePos     null | { col, row } (seize; default: the map's Throne)
//                     escapeTiles   null | [{ col, row }]
//                     loot          null | the authored reward offer that replaces the
//                                   random draw: [{ item, quantity? } | { gold }]
//                                   (buildPrologueLootChoices)
//                     beats         [beat] (prologueBeatsFor)
//                   No reinforcements, bandits or fog: a chapter has no keys for them.
//   route           null | { title, nodes: [...], edges: [...] }: the literal route map
//                   of the prologue run (buildPrologueNodeMap). A node is { id, row,
//                   col?, chapter? | type?, title?, preview?, stock?, lines? }: a chapter
//                   node fights that chapter (type 'battle', or 'boss' when given), a
//                   service node has a type ('shop' | 'church' | 'ruins'). `preview` is the
//                   route card's line for it; a shop's or a ruins' `stock` is its fixed
//                   wares (item names, catalogue prices; buildPrologueShopStock; the ruins
//                   mark them up as any ruins does); `lines` is a dialogue.json `prologue`
//                   key spoken once on arrival (the watchtower's vision; PrologueArrival).
//                   Edges go from a row to the next. Row 0
//                   is the first chapter alone; the prologue ends when the chapter node
//                   on the last row is won (prologueFinalNodeId).
//   joins           null | { afterChapter: { <chapterId>: [unit key | special id] },
//                            atNode: { <nodeId>: [unit key | special id] } }
//                   Who joins the run's roster, committed with that chapter's victory
//                   (RunManager.completeBattle) or on arrival at that node.
//   ending          null | { music?, scenes: [{ dialogue, cue?, shake?, veil? }], titleCard }
//                   the ending the last chapter hands to (PrologueEnding): its scenes in
//                   order, each a dialogue.json `prologue` key with an optional stinger
//                   (`cue`, a musicConfig stinger name), a camera shudder (`shake`) and a
//                   screen veil (`veil`: 'hollow_sun' | 'thread'); `music` is the track it
//                   plays under (an existing one); then the title card's text. (A legacy
//                   { dialogue, titleCard } is one scene.)
//   boss            null | { name, className, level, weapon, epithet, lore? } (P4's Varro;
//                   never in a real act's boss pool). The chapter's isBoss enemy must
//                   match it; the boss card reads its epithet (ceremonyContent's
//                   findBossDefinition falls back to it).
//
// Beats. A beat is { id, on, once?, <conditions>..., do: [action] }. `on` names a
// trigger; every other key except id/once/do is a condition the event must meet.
// prologueBeatsFor returns the actions of every matching beat, in authored order.
//
// Triggers (PROLOGUE_TRIGGERS) and the conditions each accepts:
//   battleStart                         the battle's first player phase, before input
//   turnStart       turn, phase, hurt   a phase begins; `phase` defaults to 'player'
//   unitSelected    unit, turn, hurt    a player unit is selected; event.hurt is true
//                                       while any player unit is below full HP
//   afterMove       unit, tile, terrain, dangerFrom, turn, safe, inRange, foeDistance,
//                   besideAlly, afterRewind
//                                       a unit finished moving (before its action);
//                                       event.dangerFrom lists the enemy ids whose
//                                       Danger tiles (what the player knows) hold the tile
//                                       (safe: none does); inRange: a foe is in its attack
//                                       reach from here; foeDistances: its distance to
//                                       every visible foe (foeDistance matches one);
//                                       besideAlly: an ally stands next to it;
//                                       afterRewind: a Vision rewind was spent this battle
//   forecastOpened  unit, target, nth, concept, turn, targetTerrain
//                                       an attack forecast opened; event.nth counts the
//                                       battle's forecasts from 1, event.concepts is
//                                       forecastConcepts() of that forecast;
//                                       event.targetTerrain the target's tile (Throne)
//   combatResolved  unit, target, turn, kill
//                                       a combat the player started has resolved;
//                                       event.kill is true when the target fell to it
//   unitActed       unit, turn          a player unit's action is over (attack, wait...)
//   unitDefeated    unit                a unit fell
//   levelUp         unit                a unit gained a level
//   hpBelow         unit, pct           a unit's HP changed; matches at or below pct %
//   holdWoken       unit                a holding enemy woke
//   talk            unit, target        a Talk resolved (the recruit has joined)
//   healed          unit, target        a staff heal resolved
//   rewound                             a Vision rewind was spent and the board restored
//   seize           unit                a lord seized
//   victory                             the battle is won
// Condition values: unit/target are unit keys or enemy ids; tile is { col, row };
// dangerFrom is an enemy id or '*' (any); concept is one of FORECAST_CONCEPTS; turn, nth,
// pct and foeDistance are integers; hurt, safe, inRange, besideAlly and afterRewind are
// booleans; terrain and targetTerrain are terrain names.
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
//   grantVision: true                   the prologue's one Vision charge (P3's exercise:
//                                       RunManager.grantPrologueVision, once per run)
//   clearCoach: true                    the coach goal (one without a gate) is done
// The ids are resolved by the scene (PrologueController); this module only matches.

import { LOOT_GOLD_TEAM_XP, NODE_TYPES, TERRAIN, XP_STAT_NAMES } from '../utils/constants.js';
import { TRAIT_RULES_VERSION } from './TraitSystem.js';
import { usesMagic, isStaff } from './Combat.js';
import {
  applyPromotedMastery,
  canEquip,
  createLordUnit,
  createUnit,
  equipWeapon,
  levelUp,
  applyLevelUpGains,
  parseWeaponProficiencies,
} from './UnitManager.js';
import { createSpecialCharacter } from './SpecialCharacters.js';
import { keyedBattleRandom } from './BattleRng.js';
import { ensureItemUidWith } from '../utils/itemUid.js';
import { validateBattleConfig } from './MapGenerator.js';
import { shopEntryTypeForItem } from './LootSystem.js';
import { actShopPrice } from './ShopEconomy.js';

export const PROLOGUE_TEMPLATE_PREFIX = 'prologue:';
export const PROLOGUE_ACT_ID = 'act1';
/** Route nodes without a column sit on the route's centre lane (NodeMapGenerator's). */
export const PROLOGUE_ROUTE_CENTER_COL = 2;
export const PROLOGUE_ROUTE_SERVICE_TYPES = [NODE_TYPES.SHOP, NODE_TYPES.CHURCH, NODE_TYPES.RUINS];
export const PROLOGUE_OBJECTIVES = ['rout', 'seize', 'escape'];
export const PROLOGUE_ENEMY_AI_MODES = ['chase', 'guard', 'hold'];
export const PROLOGUE_LESSON_KINDS = ['shown', 'practised'];
export const FORECAST_CONCEPTS = ['triangle', 'doubling', 'noCounter', 'magic', 'uncertainHit'];

export const PROLOGUE_TRIGGERS = Object.freeze({
  battleStart: [],
  turnStart: ['turn', 'phase', 'hurt'],
  unitSelected: ['unit', 'turn', 'hurt'],
  afterMove: [
    'unit',
    'tile',
    'terrain',
    'dangerFrom',
    'turn',
    'safe',
    'inRange',
    'foeDistance',
    'besideAlly',
    'afterRewind',
  ],
  forecastOpened: ['unit', 'target', 'nth', 'concept', 'turn', 'targetTerrain'],
  combatResolved: ['unit', 'target', 'turn', 'kill'],
  unitActed: ['unit', 'turn'],
  unitDefeated: ['unit'],
  levelUp: ['unit'],
  hpBelow: ['unit', 'pct'],
  holdWoken: ['unit'],
  talk: ['unit', 'target'],
  healed: ['unit', 'target'],
  rewound: [],
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
  'grantVision',
  'clearCoach',
]);

const BEAT_KEYS = new Set(['id', 'on', 'once', 'do']);
const CHAPTER_KEYS = new Set([
  'id',
  'node',
  'title',
  'objective',
  'roster',
  'rosterLevels',
  'showPar',
  'map',
  'playerSpawns',
  'enemies',
  'npc',
  'rosterItems',
  'rosterEquip',
  'villageTile',
  'thronePos',
  'escapeTiles',
  'loot',
  'beats',
  'deploy',
  'formation',
]);
const ENDING_VEILS = Object.freeze(['hollow_sun', 'thread']);
const ROUTE_NODE_KEYS = new Set([
  'id',
  'row',
  'col',
  'chapter',
  'type',
  'title',
  'preview',
  'stock',
  'lines',
]);
const NPC_KEYS = new Set(['unit', 'className', 'col', 'row', 'line']);
const JOIN_KEYS = new Set(['line', 'needs', 'lineIfGranted']);
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
  'join',
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
const isId = (v) => typeof v === 'string' && ID_PATTERN.test(v);
const isTile = (t) => t && typeof t === 'object' && isInt(t.col) && isInt(t.row);
const tileKey = (t) => `${t.col},${t.row}`;
const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

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
  const villageTile = isTile(chapter.villageTile)
    ? {
        col: chapter.villageTile.col,
        row: chapter.villageTile.row,
        // Authored villages are never contested, and may name their reward.
        uncontested: true,
        ...(typeof chapter.villageTile.reward === 'string'
          ? { reward: chapter.villageTile.reward }
          : {}),
      }
    : undefined;
  return {
    mapLayout,
    cols,
    rows,
    objective,
    biome: null,
    playerSpawns: (chapter.playerSpawns || []).map((t) => ({ col: t.col, row: t.row })),
    enemySpawns,
    npcSpawn: npc,
    villageTile,
    thronePos,
    escapeTiles: Array.isArray(chapter.escapeTiles)
      ? chapter.escapeTiles.map((t) => ({ col: t.col, row: t.row }))
      : undefined,
    templateId: `${PROLOGUE_TEMPLATE_PREFIX}${chapter.id}`,
    prologueChapter: chapter.id,
    parBonus: 0,
    // The chapter's data decides whether par is shown and applied (showPar).
    hidePar: chapter.showPar === false,
    // The authored reward offer (null: the chapter ends without a loot screen).
    loot: Array.isArray(chapter.loot) ? structuredClone(chapter.loot) : null,
    // A chapter that opens formation placement names its spare start tiles
    // (FormationController uses them instead of drawing its own).
    ...(Array.isArray(chapter.formation?.tiles)
      ? { formationSpares: chapter.formation.tiles.map((t) => ({ col: t.col, row: t.row })) }
      : {}),
    toxicTiles: [],
  };
}

/** The chapter's deploy rule ({ min, note }) or null: the roster outnumbers its spawns. */
export function prologueDeployRule(chapter) {
  const deploy = chapter?.deploy;
  if (!isPlainObject(deploy) || !isInt(deploy.min)) return null;
  return { min: deploy.min, note: typeof deploy.note === 'string' ? deploy.note : null };
}

/** True when the chapter opens formation placement (its `formation`). */
export function prologueOpensFormation(chapter) {
  return isPlainObject(chapter?.formation) && Array.isArray(chapter.formation.tiles);
}

/** The prologue's own boss definitions (boss cards, epithets): never a real act's. */
export function prologueBossDefinitions(prologue) {
  const boss = prologue?.boss;
  return isPlainObject(boss) && typeof boss.name === 'string' ? [boss] : [];
}

/**
 * The route card's line naming a chapter's boss: "Captain Varro · Fighter · Iron Axe
 * (reach 1)". The deploy screen shows no boss and the boss card plays after deploy, so
 * the route preview is where the deploy choice gets its information. Null without one.
 */
export function prologueBossLine(chapter, weapons = []) {
  const boss = (Array.isArray(chapter?.enemies) ? chapter.enemies : []).find((e) => e?.isBoss);
  if (!boss) return null;
  const weapon = (weapons || []).find((w) => w?.name === boss.weapon) || null;
  const range = weapon ? String(weapon.range || '1').replace('-', '–') : null;
  const kit = weapon ? `${weapon.name} (reach ${range})` : boss.weapon || null;
  return [boss.name || boss.className, boss.className, kit].filter(Boolean).join(' · ');
}

// --- The route map ---------------------------------------------------------------

/** The chapter the route node fights, or null for a service node / unknown id. */
export function prologueChapterForNode(prologue, nodeId) {
  const chapters = Array.isArray(prologue?.chapters) ? prologue.chapters : [];
  return chapters.find((c) => c?.node === nodeId) || null;
}

/** The node whose victory ends the prologue: the chapter node on the route's last row. */
export function prologueFinalNodeId(prologue) {
  const nodes = Array.isArray(prologue?.route?.nodes) ? prologue.route.nodes : [];
  let best = null;
  for (const node of nodes) {
    if (!node?.chapter) continue;
    if (!best || Number(node.row) > Number(best.row)) best = node;
  }
  return best?.id || null;
}

/** A node's fixed battle seed: from the prologue seed and its id, never Math.random. */
export function prologueNodeBattleSeed(seed, nodeId) {
  const draw = keyedBattleRandom(Math.trunc(Number(seed) || 0) >>> 0, `prologue-node:${nodeId}`);
  return Math.trunc(draw() * 0x100000000) >>> 0;
}

/**
 * The prologue run's literal node map (the shape generateNodeMap returns, plain
 * JSON): one node per route entry, its edges, titles, and for a chapter node the
 * battleParams that name the chapter (`prologueChapter`) so BattleScene plays the
 * locked authored config. The prologue is one act (PROLOGUE_ACT_ID) whose "boss"
 * node is the last chapter's (prologueFinalNodeId): isActComplete ends it.
 * @param {object} prologue - data/prologue.json
 */
export function buildPrologueNodeMap(prologue, gameData = null) {
  const route = prologue?.route;
  if (!route || !Array.isArray(route.nodes)) throw new Error('prologue.route is not authored');
  const chapters = Array.isArray(prologue.chapters) ? prologue.chapters : [];
  const nodes = route.nodes.map((entry) => {
    const chapter = entry.chapter ? chapters.find((c) => c?.id === entry.chapter) : null;
    const type = chapter ? entry.type || NODE_TYPES.BATTLE : entry.type;
    const node = {
      id: entry.id,
      row: entry.row,
      col: isInt(entry.col) ? entry.col : PROLOGUE_ROUTE_CENTER_COL,
      type,
      edges: [],
      battleParams: chapter
        ? {
            act: PROLOGUE_ACT_ID,
            objective: chapter.objective || 'rout',
            row: entry.row,
            prologueChapter: chapter.id,
            battleSeed: prologueNodeBattleSeed(prologue.seed, entry.id),
          }
        : null,
      completed: false,
      title: entry.title || chapter?.title || null,
    };
    if (typeof entry.preview === 'string' && entry.preview.trim()) node.preview = entry.preview;
    // A prologue shop's or ruins' fixed wares (ShopController: buildPrologueShopStock).
    if (Array.isArray(entry.stock)) node.prologueStock = [...entry.stock];
    // Lines spoken once on arrival (PrologueArrival: the watchtower's vision).
    if (typeof entry.lines === 'string' && entry.lines) node.prologueLines = entry.lines;
    // The boss a chapter node holds, named on its route card (describeLoomNode).
    const bossLine = chapter ? prologueBossLine(chapter, gameData?.weapons) : null;
    if (bossLine) node.bossLine = bossLine;
    if (chapter) {
      node.templateId = `${PROLOGUE_TEMPLATE_PREFIX}${chapter.id}`;
      node.encounterLocked = true;
    }
    return node;
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const [from, to] of Array.isArray(route.edges) ? route.edges : []) {
    const node = byId.get(from);
    if (node && byId.has(to) && !node.edges.includes(to)) node.edges.push(to);
  }
  const start = nodes.find((n) => n.row === 0) || nodes[0];
  return {
    actId: PROLOGUE_ACT_ID,
    nodes,
    startNodeId: start?.id || null,
    bossNodeId: prologueFinalNodeId(prologue),
    prologue: { title: route.title || 'The Prologue' },
  };
}

// --- Loot --------------------------------------------------------------------------

/** The loot category a catalogue item draws from (what the reward screen expects). */
function lootCategoryOf(item, lootTables, actId) {
  const table = lootTables?.[actId] || lootTables?.act1 || null;
  if (item?.type === 'Scroll') return 'skillScroll';
  if (item?.type !== 'Consumable') return 'weapon';
  for (const category of ['healing', 'statBooster', 'promotion']) {
    if (Array.isArray(table?.[category]) && table[category].includes(item.name)) return category;
  }
  if (item?.effect === 'statBoost') return 'statBooster';
  return 'healing';
}

/**
 * A chapter's authored reward offer as reward choices (PendingBattleRewards): the
 * shape generateLootChoices returns, so the reward screen renders and claims them
 * unchanged. `[{ item, quantity? } | { gold }]`; item uids come from `rng`.
 * @param {object[]} loot - chapter.loot
 * @param {object} gameData - { weapons, consumables, lootTables }
 * @param {{ actId?: string, rng?: () => number }} [options]
 */
export function buildPrologueLootChoices(loot, gameData, { actId = PROLOGUE_ACT_ID, rng } = {}) {
  const draw = typeof rng === 'function' ? rng : Math.random;
  return (Array.isArray(loot) ? loot : []).map((entry) => {
    if (isInt(entry?.gold)) {
      return {
        type: 'gold',
        goldAmount: Math.max(0, entry.gold),
        xpAmount: LOOT_GOLD_TEAM_XP[actId] || LOOT_GOLD_TEAM_XP.act1 || 0,
      };
    }
    const found = findItem(gameData, entry?.item);
    if (!found) throw new Error(`Unknown prologue loot item "${entry?.item}"`);
    const item = ensureItemUidWith(structuredClone(found.data), draw);
    const choice = { type: lootCategoryOf(found.data, gameData.lootTables, actId), item };
    if (isInt(entry.quantity) && entry.quantity > 1) choice.quantity = entry.quantity;
    return choice;
  });
}

// --- Service nodes and arrivals ------------------------------------------------------

/**
 * A prologue shop's fixed wares as shop entries (the shape generateShopInventory
 * returns: { item, price, type }): one entry per listed name, priced as a real shop
 * of the act prices it (actShopPrice; the caller then applies the run's own price
 * rules, as for any shop). Never random: item uids come from `rng`.
 * @param {string[]} stock - route node `stock`
 * @param {object} gameData - { weapons, consumables }
 * @param {{ rng?: () => number, actId?: string }} [options]
 */
export function buildPrologueShopStock(stock, gameData, { rng, actId = PROLOGUE_ACT_ID } = {}) {
  const draw = typeof rng === 'function' ? rng : Math.random;
  return (Array.isArray(stock) ? stock : []).map((name) => {
    const found = findItem(gameData, name);
    if (!found) throw new Error(`Unknown prologue shop item "${name}"`);
    const item = ensureItemUidWith(structuredClone(found.data), draw);
    return { item, price: actShopPrice(item.price, actId), type: shopEntryTypeForItem(item) };
  });
}

/** The unit keys (and special ids) that join on arrival at a route node. */
export function prologueJoinsAtNode(prologue, nodeId) {
  const list = prologue?.joins?.atNode?.[nodeId];
  return Array.isArray(list) ? [...list] : [];
}

/** True when some route node's arrival brings `key` in (Tamsin at the fork). */
export function isArrivalJoin(prologue, key) {
  const atNode = prologue?.joins?.atNode;
  return (
    isPlainObject(atNode) && Object.values(atNode).some((l) => Array.isArray(l) && l.includes(key))
  );
}

// --- Protected units -----------------------------------------------------------------

/**
 * The names whose fall restarts the chapter: every unit of its roster (unit keys
 * are names; a special character id resolves to its name) — the spec's "every named
 * unit is protected", plus the commander whatever the roster says.
 */
export function prologueProtectedNames(chapter, gameData) {
  const specials = gameData?.specialChars || [];
  const names = new Set();
  for (const key of Array.isArray(chapter?.roster) ? chapter.roster : []) {
    const special = specials.find((s) => s?.id === key);
    names.add(special ? special.name : key);
  }
  if (chapter?.npc?.unit) names.add(chapter.npc.unit);
  return [...names];
}

/**
 * The roster keys (unit keys and special ids) the prologue's joins brought in by the
 * chapters won so far: a unit the prologue already introduced needs no run-start
 * introduction later (NodeMapScene's veteran intro).
 * @param {object} prologue - data/prologue.json
 * @param {Iterable<string>} chaptersCompleted - chapter ids (meta.prologue.chaptersCompleted)
 * @returns {Set<string>}
 */
/**
 * The run being played is the slot's first real run (narrative context: runsStarted
 * counts it as it starts, as NarrativeDirector's maxRunsStarted 1 reads it). Who the
 * prologue introduced comes from prologueJoinedKeys (the chapters this slot won).
 * @param {{ runsStarted?: number }} ctx - buildNarrativeContext's
 */
export function firstRunAfterPrologue(ctx) {
  const started = Number(ctx?.runsStarted);
  return Number.isFinite(started) && started <= 1;
}

export function prologueJoinedKeys(prologue, chaptersCompleted = []) {
  const won = new Set(chaptersCompleted || []);
  const out = new Set();
  const after = prologue?.joins?.afterChapter;
  if (!isPlainObject(after)) return out;
  for (const [chapterId, keys] of Object.entries(after)) {
    if (!won.has(chapterId) || !Array.isArray(keys)) continue;
    for (const key of keys) out.add(key);
  }
  return out;
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
  targetTerrain: (want, e) => e.targetTerrain === want,
  dangerFrom: (want, e) =>
    Array.isArray(e.dangerFrom) &&
    (want === '*' ? e.dangerFrom.length > 0 : e.dangerFrom.includes(want)),
  nth: (want, e) => e.nth === want,
  concept: (want, e) => Array.isArray(e.concepts) && e.concepts.includes(want),
  pct: (want, e) => Number.isFinite(e.hpPct) && e.hpPct <= want,
  kill: (want, e) => Boolean(e.kill) === want,
  hurt: (want, e) => Boolean(e.hurt) === want,
  safe: (want, e) => Array.isArray(e.dangerFrom) && (e.dangerFrom.length === 0) === want,
  inRange: (want, e) => Boolean(e.inRange) === want,
  foeDistance: (want, e) => Array.isArray(e.foeDistances) && e.foeDistances.includes(want),
  besideAlly: (want, e) => Boolean(e.besideAlly) === want,
  afterRewind: (want, e) => Boolean(e.afterRewind) === want,
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

const readsAloud = (beat) =>
  (Array.isArray(beat?.do) ? beat.do : []).some((a) => a && ('note' in a || 'dialogue' in a));

/**
 * The actions a chapter's beats take for one event. Pure: `state` is not mutated.
 * Beats match in authored order and their actions come out in that order, each tagged
 * with its beat id. A `once` beat fires at most once: the returned state records it.
 * With `oneNote` (every forecastOpened event: one concept per forecast), only the first
 * matching beat that shows a note or a line fires; later note beats are neither run
 * nor spent, so they wait for a later event they match.
 * @param {object} chapter
 * @param {{ type: string }} event - see the module header for each trigger's fields
 * @param {{ fired?: string[] }} [state]
 * @param {{ oneNote?: boolean }} [options]
 * @returns {{ actions: object[], fired: string[], state: { fired: string[] } }}
 */
export function prologueBeatsFor(chapter, event, state = {}, { oneNote = false } = {}) {
  const done = new Set(Array.isArray(state?.fired) ? state.fired : []);
  const actions = [];
  const fired = [];
  let spoke = false;
  if (event && typeof event.type === 'string') {
    for (const beat of Array.isArray(chapter?.beats) ? chapter.beats : []) {
      if (!beat || (beat.once && done.has(beat.id))) continue;
      if (!beatMatches(beat, event)) continue;
      const speaks = readsAloud(beat);
      if (oneNote && speaks && spoke) continue;
      if (speaks) spoke = true;
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
 * @param {{ name?: string, level?: number, items?: string[] }} [options] - the unit's
 *   name when the spec has no lord; `level` raises an authored-stats unit above its
 *   spec's level with seeded level-ups (a replay entering a later chapter at its
 *   expected level); `items` are added to the authored kit (a replay's rosterItems)
 */
export function buildPrologueUnit(
  spec,
  gameData,
  rng,
  { name = null, level: toLevel = null, items = null } = {},
) {
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
  // Above the spec's level (a replay's expected level): seeded level-ups from there.
  const target = Math.max(level, Math.trunc(Number(toLevel) || 0));
  for (let l = unit.level; l < target; l++) {
    const gains = levelUp(unit, rng);
    if (gains) applyLevelUpGains(unit, gains);
  }
  unit.xp = 0;
  unit.mov = unit.stats.MOV;
  unit.currentHP = unit.stats.HP;
  unit.traits = Array.isArray(spec.traits) ? [...spec.traits] : [];
  unit.traitRulesVersion = TRAIT_RULES_VERSION;
  if (Array.isArray(spec.skills)) unit.skills = [...spec.skills];

  unit.inventory = [];
  unit.consumables = [];
  const kit = [
    ...(Array.isArray(spec.inventory) ? spec.inventory : []),
    ...(Array.isArray(items) ? items : []),
  ];
  for (const itemName of kit) {
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
export function buildPrologueUnits(
  prologue,
  gameData,
  keys = Object.keys(prologue?.units || {}),
  { levels = null, items = null } = {},
) {
  return keys.map((key) => {
    const spec = prologue?.units?.[key];
    if (!spec) throw new Error(`Unknown prologue unit "${key}"`);
    return buildPrologueUnit(spec, gameData, prologueUnitRng(prologue.seed, key), {
      name: key,
      level: isInt(levels?.[key]) ? levels[key] : null,
      items: Array.isArray(items?.[key]) ? items[key] : null,
    });
  });
}

/**
 * The authored green unit of a chapter (P3's Sera) for a battle config's `npcSpawn`
 * (`prologueUnit` names its `units` key): built from its authored spec on its own
 * stream (never the recruit node's roster-average level), green, on its tile. The one
 * builder BattleScene and the headless harness both use. Null for any other spawn.
 * @param {object} npcSpawn - battleConfig.npcSpawn
 * @param {object} gameData - with `prologue`
 */
export function buildPrologueNpcUnit(npcSpawn, gameData) {
  const key = npcSpawn?.prologueUnit;
  if (typeof key !== 'string' || !key) return null;
  const prologue = gameData?.prologue;
  if (!prologue?.units?.[key]) throw new Error(`Unknown prologue NPC unit "${key}"`);
  const [unit] = buildPrologueUnits(prologue, gameData, [key]);
  unit.faction = 'npc';
  unit.col = npcSpawn.col;
  unit.row = npcSpawn.row;
  unit.hasMoved = false;
  unit.hasActed = false;
  return unit;
}

/** True when a chapter roster entry names a special character (Gaspar), not a unit spec. */
export function isSpecialRosterKey(key, gameData) {
  return (gameData?.specialChars || []).some((s) => s?.id === key);
}

/**
 * The units a chapter is fought with when played on its own (the title's replay):
 * its roster in order — authored units at the chapter's `rosterLevels` (seeded), and
 * special characters built as the run builds them (createSpecialCharacter on Normal,
 * no meta). The prologue run never calls this: its roster is the run's.
 * @param {object} prologue - data/prologue.json
 * @param {object} gameData
 * @param {object} chapter
 * @param {{ difficultyId?: string }} [options]
 */
export function buildPrologueRoster(prologue, gameData, chapter, { difficultyId = 'normal' } = {}) {
  const levels = chapter?.rosterLevels || null;
  const items = chapter?.rosterItems || null;
  const equips = isPlainObject(chapter?.rosterEquip) ? chapter.rosterEquip : {};
  return (Array.isArray(chapter?.roster) ? chapter.roster : []).map((key) => {
    let unit;
    if (isSpecialRosterKey(key, gameData)) {
      unit = createSpecialCharacter(key, gameData, { difficultyId });
      if (!unit) throw new Error(`Unknown prologue special character "${key}"`);
    } else unit = buildPrologueUnits(prologue, gameData, [key], { levels, items })[0];
    const held = equips[key] && (unit.inventory || []).find((w) => w?.name === equips[key]);
    if (held && unit.weapon !== held) equipWeapon(unit, held);
    return unit;
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
    if (spec.join !== undefined) validateJoinSpec(`${where}.join`, spec.join, gameData, errors);
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

/** A dialogue.json `prologue` key: checked against the lines when gameData has them. */
function validateLineKey(where, key, gameData, errors) {
  if (typeof key !== 'string' || !ID_PATTERN.test(key)) {
    errors.push(`${where} must be a snake_case dialogue key`);
    return;
  }
  const lines = gameData?.dialogue?.prologue;
  if (lines && !(Array.isArray(lines[key]) && lines[key].length))
    errors.push(`${where} "${key}" has no lines in dialogue.json prologue`);
}

function validateJoinSpec(where, join, gameData, errors) {
  if (!isPlainObject(join)) {
    errors.push(`${where} must be { line, needs?, lineIfGranted? }`);
    return;
  }
  for (const key of Object.keys(join))
    if (!JOIN_KEYS.has(key)) errors.push(`${where} has unknown field "${key}"`);
  validateLineKey(`${where}.line`, join.line, gameData, errors);
  if (join.needs !== undefined && !findItem(gameData, join.needs))
    errors.push(`${where}.needs "${join.needs}" is not a weapon or consumable`);
  if ((join.needs === undefined) !== (join.lineIfGranted === undefined))
    errors.push(`${where}: needs and lineIfGranted go together`);
  if (join.lineIfGranted !== undefined)
    validateLineKey(`${where}.lineIfGranted`, join.lineIfGranted, gameData, errors);
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
    case 'kill':
    case 'hurt':
    case 'safe':
    case 'inRange':
    case 'besideAlly':
    case 'afterRewind':
      if (typeof value !== 'boolean') errors.push(`${where}.${key} must be true or false`);
      break;
    case 'foeDistance':
      if (!isInt(value) || value < 1) errors.push(`${where}.foeDistance must be an integer >= 1`);
      break;
    case 'tile':
      if (!ctx.inBounds(value)) errors.push(`${where}.tile is not a tile on the map`);
      break;
    case 'terrain':
    case 'targetTerrain':
      if (!ctx.terrainNames.has(value)) errors.push(`${where}.${key} "${value}" is not a terrain`);
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
    case 'grantVision':
    case 'clearCoach':
      if (value !== true) errors.push(`${where}.${kind} must be true`);
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
      if (!unitKeys.has(key) && !isSpecialRosterKey(key, gameData))
        errors.push(`${where}.roster: unknown unit "${key}"`);
      else if (seenUnits.has(key)) errors.push(`${where}.roster: "${key}" twice`);
      seenUnits.add(key);
    }
    if (
      Array.isArray(chapter.playerSpawns) &&
      chapter.roster.length > chapter.playerSpawns.length &&
      chapter.deploy === undefined
    ) {
      errors.push(`${where}.roster has more units than playerSpawns (and no deploy rule)`);
    }
    if (chapter.rosterLevels !== undefined) {
      if (!isPlainObject(chapter.rosterLevels)) {
        errors.push(`${where}.rosterLevels must be an object of unit key -> level`);
      } else {
        for (const [key, level] of Object.entries(chapter.rosterLevels)) {
          if (!unitKeys.has(key) || !chapter.roster.includes(key))
            errors.push(`${where}.rosterLevels: "${key}" is not an authored unit of this roster`);
          if (!isInt(level) || level < 1)
            errors.push(`${where}.rosterLevels.${key} must be an integer >= 1`);
        }
      }
    }
  }
  if (chapter.rosterItems !== undefined) {
    if (!isPlainObject(chapter.rosterItems)) {
      errors.push(`${where}.rosterItems must be an object of unit key -> [item names]`);
    } else {
      for (const [key, names] of Object.entries(chapter.rosterItems)) {
        const spec = prologue?.units?.[key];
        if (!spec || !(chapter.roster || []).includes(key)) {
          errors.push(`${where}.rosterItems: "${key}" is not an authored unit of this roster`);
          continue;
        }
        if (!Array.isArray(names) || !names.length) {
          errors.push(`${where}.rosterItems.${key} must be a non-empty array of item names`);
          continue;
        }
        for (const name of names)
          if (!findItem(gameData, name))
            errors.push(`${where}.rosterItems.${key}: unknown item "${name}"`);
      }
    }
  }
  if (chapter.rosterEquip !== undefined) {
    if (!isPlainObject(chapter.rosterEquip)) {
      errors.push(`${where}.rosterEquip must be an object of unit key -> weapon name`);
    } else {
      for (const [key, name] of Object.entries(chapter.rosterEquip)) {
        if (!(chapter.roster || []).includes(key))
          errors.push(`${where}.rosterEquip: "${key}" is not in this roster`);
        else if (!(gameData.weapons || []).some((w) => w.name === name))
          errors.push(`${where}.rosterEquip.${key}: unknown weapon "${name}"`);
        else {
          // The unit must carry it (built as the replay builds it).
          let unit = null;
          try {
            unit = buildPrologueRoster(prologue, gameData, { ...chapter, rosterEquip: {} }).find(
              (_, i) => chapter.roster[i] === key,
            );
          } catch {
            unit = null;
          }
          if (unit && !(unit.inventory || []).some((w) => w?.name === name))
            errors.push(`${where}.rosterEquip.${key}: "${name}" is not in its kit`);
        }
      }
    }
  }
  if (chapter.showPar !== undefined && typeof chapter.showPar !== 'boolean') {
    errors.push(`${where}.showPar must be true or false`);
  }
  if (chapter.deploy !== undefined) {
    const deploy = chapter.deploy;
    const spawns = Array.isArray(chapter.playerSpawns) ? chapter.playerSpawns.length : 0;
    if (!isPlainObject(deploy)) errors.push(`${where}.deploy must be { min, note? }`);
    else {
      for (const key of Object.keys(deploy))
        if (key !== 'min' && key !== 'note')
          errors.push(`${where}.deploy has unknown field "${key}"`);
      if (!isInt(deploy.min) || deploy.min < 1 || deploy.min > spawns)
        errors.push(`${where}.deploy.min must be an integer from 1 to the spawn count (${spawns})`);
      if (deploy.note !== undefined && !isId(deploy.note))
        errors.push(`${where}.deploy.note must be a note id`);
      if ((chapter.roster || []).length <= spawns)
        errors.push(`${where}.deploy: the roster fits its spawns (nothing to choose)`);
    }
  }
  if (chapter.loot != null) {
    if (!Array.isArray(chapter.loot) || chapter.loot.length === 0 || chapter.loot.length > 3) {
      errors.push(`${where}.loot must be null or an array of 1 to 3 offers`);
    } else {
      chapter.loot.forEach((entry, i) => {
        const at = `${where}.loot[${i}]`;
        if (!isPlainObject(entry)) {
          errors.push(`${at} must be { item, quantity? } or { gold }`);
          return;
        }
        if (isInt(entry.gold)) {
          if (entry.gold < 0 || Object.keys(entry).length !== 1)
            errors.push(`${at}: a gold offer is { gold: <integer >= 0> } alone`);
          return;
        }
        for (const key of Object.keys(entry))
          if (key !== 'item' && key !== 'quantity') errors.push(`${at} has unknown field "${key}"`);
        const item = findItem(gameData, entry.item);
        if (!item) errors.push(`${at}.item "${entry.item}" is not a weapon or consumable`);
        if (entry.quantity !== undefined && (!isInt(entry.quantity) || entry.quantity < 1))
          errors.push(`${at}.quantity must be an integer >= 1`);
        if (entry.quantity !== undefined && item && item.kind !== 'consumable')
          errors.push(`${at}: only a consumable offer has a quantity`);
      });
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

  if (chapter.formation !== undefined) {
    const tiles = chapter.formation?.tiles;
    if (
      !isPlainObject(chapter.formation) ||
      Object.keys(chapter.formation).some((k) => k !== 'tiles')
    )
      errors.push(`${where}.formation must be { tiles: [{ col, row }] }`);
    if (!Array.isArray(tiles) || !tiles.length)
      errors.push(`${where}.formation.tiles must be a non-empty array of tiles`);
    else {
      const taken = new Set([
        ...(chapter.playerSpawns || []).filter(isTile).map(tileKey),
        ...(chapter.enemies || []).filter(isTile).map(tileKey),
        ...(isTile(chapter.npc) ? [tileKey(chapter.npc)] : []),
      ]);
      tiles.forEach((t, i) => {
        const at = `${where}.formation.tiles[${i}]`;
        if (!inBounds(t)) errors.push(`${at} is off the map`);
        else {
          for (const moveType of PLAYER_SPAWN_MOVE_TYPES)
            if (!passableAt(t, moveType))
              errors.push(`${at} (${tileKey(t)}) is impassable for ${moveType}`);
          if (taken.has(tileKey(t))) errors.push(`${at} (${tileKey(t)}) is already taken`);
          if (parsed.mapLayout && parsed.mapLayout[t.row][t.col] === TERRAIN.Throne)
            errors.push(`${at} (${tileKey(t)}) is the throne`);
          taken.add(tileKey(t));
        }
      });
    }
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

  // A chapter's boss is the prologue's own (never a real act's), as authored there.
  const bosses = (Array.isArray(chapter.enemies) ? chapter.enemies : []).filter((e) => e?.isBoss);
  if (bosses.length > 1) errors.push(`${where}: at most one enemy isBoss`);
  for (const b of bosses) {
    const def = prologue?.boss;
    if (!isPlainObject(def))
      errors.push(`${where}: boss "${b.name}" needs the prologue's boss entry`);
    else
      for (const field of ['name', 'className', 'level', 'weapon'])
        if (b[field] !== def[field])
          errors.push(
            `${where}: boss ${field} "${b[field]}" differs from boss.${field} "${def[field]}"`,
          );
  }

  const npcNames = new Set();
  if (chapter.npc) {
    for (const key of Object.keys(chapter.npc))
      if (!NPC_KEYS.has(key)) errors.push(`${where}.npc has unknown field "${key}"`);
    if (chapter.npc.line !== undefined)
      validateLineKey(`${where}.npc.line`, chapter.npc.line, gameData, errors);
    if ((chapter.roster || []).includes(chapter.npc.unit))
      errors.push(`${where}.npc "${chapter.npc.unit}" is also in the roster`);
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
  if (chapter.villageTile != null) {
    const tile = chapter.villageTile;
    for (const key of Object.keys(tile))
      if (!['col', 'row', 'reward'].includes(key))
        errors.push(`${where}.villageTile has unknown field "${key}"`);
    if (
      inBounds(tile) &&
      parsed.mapLayout &&
      parsed.mapLayout[tile.row][tile.col] !== TERRAIN.Village
    )
      errors.push(`${where}.villageTile (${tileKey(tile)}) is not a Village tile`);
    if (tile.reward !== undefined && !findItem(gameData, tile.reward))
      errors.push(`${where}.villageTile.reward "${tile.reward}" is not a weapon or consumable`);
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

  // Beats name player units by name: authored keys, and a roster special character's
  // name (the standard veteran's id is Gaspar).
  const rosterSpecialNames = (Array.isArray(chapter.roster) ? chapter.roster : [])
    .map((key) => (gameData.specialChars || []).find((s) => s?.id === key)?.name)
    .filter(Boolean);
  const ctx = {
    unitNames: new Set([...Object.keys(prologue?.units || {}), ...rosterSpecialNames]),
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
  if (typeof boss.epithet !== 'string' || !boss.epithet.trim() || boss.epithet.length > 60)
    errors.push('boss.epithet must be a string of at most 60 characters');
  if (boss.lore !== undefined && (typeof boss.lore !== 'string' || boss.lore.length > 240))
    errors.push('boss.lore must be a string of at most 240 characters');
  for (const key of Object.keys(boss))
    if (!['name', 'className', 'level', 'weapon', 'epithet', 'lore'].includes(key))
      errors.push(`boss has unknown field "${key}"`);
}

function validateJoins(joins, prologue, gameData, errors) {
  if (joins == null) return;
  if (!isPlainObject(joins)) {
    errors.push('joins must be an object or null');
    return;
  }
  const chapterIds = new Set((prologue.chapters || []).map((c) => c?.id));
  const nodeIds = new Set((prologue.route?.nodes || []).map((n) => n?.id));
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
      if (section === 'atNode' && !nodeIds.has(at)) {
        errors.push(`joins.atNode: unknown route node "${at}"`);
      }
      if (!Array.isArray(list)) {
        errors.push(`joins.${section}.${at} must be an array`);
        continue;
      }
      for (const who of list) {
        if (!joinable.has(who)) errors.push(`joins.${section}.${at}: unknown unit "${who}"`);
        else if (section === 'atNode' && !isPlainObject(prologue.units?.[who]?.join))
          errors.push(`joins.atNode.${at}: "${who}" needs a join spec (units.${who}.join)`);
      }
      if (section === 'atNode') {
        const node = (prologue.route?.nodes || []).find((n) => n?.id === at);
        if (node && node.chapter)
          errors.push(`joins.atNode: "${at}" is a chapter node (arrivals join at service nodes)`);
      }
    }
  }
}

function validateRoute(route, prologue, gameData, errors) {
  if (route == null) return;
  if (!isPlainObject(route) || !Array.isArray(route.nodes)) {
    errors.push('route must be null or { title, nodes: [...], edges: [...] }');
    return;
  }
  if (typeof route.title !== 'string' || !route.title.trim())
    errors.push('route.title must be a non-empty string');
  const chapters = Array.isArray(prologue.chapters) ? prologue.chapters : [];
  const chapterById = new Map(chapters.map((c) => [c?.id, c]));
  const nodes = new Map();
  let maxRow = -1;
  route.nodes.forEach((node, i) => {
    const at = `route.nodes[${i}]${node?.id ? ` (${node.id})` : ''}`;
    if (!isPlainObject(node)) {
      errors.push(`${at} must be an object`);
      return;
    }
    for (const key of Object.keys(node))
      if (!ROUTE_NODE_KEYS.has(key)) errors.push(`${at} has unknown field "${key}"`);
    if (typeof node.id !== 'string' || !node.id) errors.push(`${at}.id must be a node id`);
    else if (nodes.has(node.id)) errors.push(`${at}: duplicate node id`);
    else nodes.set(node.id, node);
    if (!isInt(node.row) || node.row < 0) errors.push(`${at}.row must be an integer >= 0`);
    else maxRow = Math.max(maxRow, node.row);
    if (node.col !== undefined && (!isInt(node.col) || node.col < 0 || node.col > 4))
      errors.push(`${at}.col must be an integer from 0 to 4`);
    if (node.title !== undefined && typeof node.title !== 'string')
      errors.push(`${at}.title must be a string`);
    if (
      node.preview !== undefined &&
      (typeof node.preview !== 'string' || !node.preview.trim() || node.preview.length > 160)
    )
      errors.push(`${at}.preview must be a string of at most 160 characters`);
    if (node.lines !== undefined) validateLineKey(`${at}.lines`, node.lines, gameData, errors);
    if (node.stock !== undefined) {
      if (node.type !== NODE_TYPES.SHOP && node.type !== NODE_TYPES.RUINS)
        errors.push(`${at}: only a shop or a ruins node has a stock`);
      if (!Array.isArray(node.stock) || !node.stock.length || node.stock.length > 8)
        errors.push(`${at}.stock must be an array of 1 to 8 item names`);
      else
        for (const name of node.stock) {
          const item = findItem(gameData, name);
          if (!item) errors.push(`${at}.stock: unknown item "${name}"`);
          else if (!(item.data.price > 0)) errors.push(`${at}.stock: "${name}" has no price`);
        }
    }
    if (node.chapter !== undefined) {
      const chapter = chapterById.get(node.chapter);
      if (!chapter) errors.push(`${at}.chapter "${node.chapter}" is not a chapter`);
      else if (chapter.node !== node.id)
        errors.push(`${at}: chapter "${node.chapter}" fights node "${chapter.node}", not this one`);
      if (
        node.type !== undefined &&
        node.type !== NODE_TYPES.BATTLE &&
        node.type !== NODE_TYPES.BOSS
      )
        errors.push(`${at}.type must be "battle" or "boss" for a chapter node`);
    } else if (!PROLOGUE_ROUTE_SERVICE_TYPES.includes(node.type)) {
      errors.push(
        `${at} needs a chapter or a service type (${PROLOGUE_ROUTE_SERVICE_TYPES.join(', ')})`,
      );
    }
  });
  for (const chapter of chapters) {
    if (chapter?.node && !route.nodes.some((n) => n?.chapter === chapter.id))
      errors.push(`route has no node for chapter "${chapter.id}" (its node "${chapter.node}")`);
  }
  const rowZero = route.nodes.filter((n) => n?.row === 0);
  if (rowZero.length !== 1) errors.push('route row 0 must hold exactly one node');
  else if (!rowZero[0].chapter)
    errors.push('route row 0 must be a chapter node (the first battle)');
  if (maxRow >= 0 && !route.nodes.some((n) => n?.row === maxRow && n?.chapter))
    errors.push(
      `route row ${maxRow} (the last) needs a chapter node: its victory ends the prologue`,
    );
  const incoming = new Set();
  const outgoing = new Set();
  if (!Array.isArray(route.edges)) errors.push('route.edges must be an array of [from, to]');
  else
    route.edges.forEach((edge, i) => {
      const at = `route.edges[${i}]`;
      if (!Array.isArray(edge) || edge.length !== 2) {
        errors.push(`${at} must be [from, to]`);
        return;
      }
      const [from, to] = edge;
      const a = nodes.get(from);
      const b = nodes.get(to);
      if (!a) errors.push(`${at}: unknown node "${from}"`);
      if (!b) errors.push(`${at}: unknown node "${to}"`);
      if (a && b && b.row !== a.row + 1)
        errors.push(`${at}: "${to}" is not on the row after "${from}"`);
      outgoing.add(from);
      incoming.add(to);
    });
  for (const node of nodes.values()) {
    if (node.row > 0 && !incoming.has(node.id))
      errors.push(`route node "${node.id}" is unreachable`);
    if (node.row < maxRow && !outgoing.has(node.id))
      errors.push(`route node "${node.id}" leads nowhere`);
  }
}

function validateEnding(ending, gameData, errors) {
  if (ending == null) return;
  if (!isPlainObject(ending)) {
    errors.push('ending must be null or { music?, scenes, titleCard }');
    return;
  }
  for (const key of Object.keys(ending))
    if (!['dialogue', 'scenes', 'music', 'titleCard'].includes(key))
      errors.push(`ending has unknown field "${key}"`);
  if (ending.dialogue !== undefined && ending.scenes !== undefined)
    errors.push('ending has both dialogue and scenes (scenes replace the legacy dialogue)');
  if (ending.scenes === undefined)
    validateLineKey('ending.dialogue', ending.dialogue, gameData, errors);
  else if (!Array.isArray(ending.scenes) || !ending.scenes.length)
    errors.push('ending.scenes must be a non-empty array');
  else
    ending.scenes.forEach((scene, i) => {
      const at = `ending.scenes[${i}]`;
      if (!isPlainObject(scene)) {
        errors.push(`${at} must be { dialogue, cue?, shake?, veil? }`);
        return;
      }
      for (const key of Object.keys(scene))
        if (!['dialogue', 'cue', 'shake', 'veil'].includes(key))
          errors.push(`${at} has unknown field "${key}"`);
      validateLineKey(`${at}.dialogue`, scene.dialogue, gameData, errors);
      if (scene.cue !== undefined && !isId(scene.cue))
        errors.push(`${at}.cue must be a stinger name`);
      if (scene.shake !== undefined && typeof scene.shake !== 'boolean')
        errors.push(`${at}.shake must be true or false`);
      if (scene.veil !== undefined && !ENDING_VEILS.includes(scene.veil))
        errors.push(`${at}.veil must be one of ${ENDING_VEILS.join(', ')}`);
    });
  if (
    ending.music !== undefined &&
    (typeof ending.music !== 'string' || !/^music_[a-z0-9_]+$/.test(ending.music))
  )
    errors.push('ending.music must be a music track key (music_...)');
  if (
    typeof ending.titleCard !== 'string' ||
    !ending.titleCard.trim() ||
    ending.titleCard.length > 240
  )
    errors.push('ending.titleCard must be a string of at most 240 characters');
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
  validateRoute(prologue.route, prologue, gameData, errors);
  validateJoins(prologue.joins, prologue, gameData, errors);
  validateEnding(prologue.ending, gameData, errors);
  validateBoss(prologue.boss, gameData, errors);
  return { valid: errors.length === 0, errors };
}
