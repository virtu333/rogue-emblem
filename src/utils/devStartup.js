import {
  createUnit,
  equipAccessory,
  normalizeEquippedFirst,
  promoteUnit,
  resolvePromotionTargets,
} from '../engine/UnitManager.js';
import { applyPromotionOath, commitBattleDeeds, emptyBattleDeeds } from '../engine/DeedSystem.js';
import { findCommander } from '../engine/Commander.js';
import { MetaProgressionManager } from '../engine/MetaProgressionManager.js';
import { RunManager } from '../engine/RunManager.js';
import { NODE_TYPES } from './constants.js';
import { PINNED_BATTLE_STREAM_KEY } from '../engine/BattleScout.js';
import { addBurden } from '../engine/Burdens.js';
import { normalizeContract } from '../engine/Contracts.js';
import { DEV_EVENT_FIXTURES } from './devEventFixtures.js';
import { withDevSetPiece } from './devSetPieceFixtures.js';
import { applyDevDescent, withDevDescent } from './devDescentFixtures.js';
import { findSetPiece, setPieceDeployCap } from '../engine/SetPieces.js';
import { addReviewArmy } from './devReviewArmy.js';
import { applyNgPlusReviewMeta } from './devNgPlusFixtures.js';

const DEV_META_STORAGE_KEY = 'emblem_rogue_dev_meta';
const DEV_SCENE_ALIASES = {
  title: 'Title',
  homebase: 'HomeBase',
  difficulty: 'DifficultySelect',
  blessing: 'BlessingSelect',
  nodemap: 'NodeMap',
  battle: 'Battle',
  shopui: 'NodeMap',
  accessoryui: 'NodeMap',
  equipui: 'Battle',
  attackui: 'Battle',
  lootui: 'Battle',
  // Review route: the run-complete screen for a won run (`&route=` picks the ending).
  victory: 'RunComplete',
};
// `&route=` for devScene=victory: where the won run ended, and on which rung. Dusk's road runs
// on past the Emperor to the Lieutenant (`dusk`); `emperor` is a Dusk run saved before that,
// which still ends at him (its own act list, as a loaded save keeps it).
const DEV_VICTORY_ROUTES = {
  lieutenant: { difficultyId: 'normal' },
  dusk: { difficultyId: 'dusk' },
  emperor: { difficultyId: 'dusk', acts: ['act1', 'act2', 'act3', 'act4'] },
  entity: { difficultyId: 'hard' },
};
const DEV_PRESETS = new Set([
  'fresh',
  'weapon_arts',
  'late_act',
  'battle_smoke',
  'combat_actions',
  'soulreaver_mast',
  'eclipse',
  // Phone review setups (playtest 2026-09-28): see docs/playtest-triage-2026-09-28.md.
  'fog_ambush',
  'roster_checks',
  // The Roster overview review (PR #385): a full, varied army on the route map.
  'roster_review',
  // Playtest 2026-09-29 #11: Zombie remains, the countdown and Smash (devScenarios.js).
  'zombie_remains',
  'ladder',
  // The event review route (docs/specs/event-nodes.md §17): see applyEventPreset.
  'event',
  // NG+ review (docs/specs/ng-plus.md): a Black Sun win's survivors at Home Base.
  'ngplus',
]);
// Presets built on the combat_actions loadout (Edric, Sera and three utility units).
const COMBAT_LOADOUT_PRESETS = new Set(['combat_actions', 'fog_ambush', 'zombie_remains']);
const DEV_QA_SEQUENCE = [
  {
    step: 1,
    sceneKey: 'HomeBase',
    preset: 'weapon_arts',
    description: 'Meta upgrade descriptions and purchase visibility',
  },
  {
    step: 2,
    sceneKey: 'DifficultySelect',
    preset: 'weapon_arts',
    description: 'Difficulty card copy, lock states, and navigation',
  },
  {
    step: 3,
    sceneKey: 'BlessingSelect',
    preset: 'weapon_arts',
    description: 'Blessing options, skip flow, and confirm flow',
  },
  {
    step: 4,
    sceneKey: 'NodeMap',
    preset: 'weapon_arts',
    description: 'Shop/roster/convoy/scroll interactions',
  },
  {
    step: 5,
    sceneKey: 'Battle',
    preset: 'battle_smoke',
    description: 'Weapon art battle flow, forecast, and loot exit',
  },
  {
    step: 6,
    sceneKey: 'NodeMap',
    preset: 'late_act',
    description: 'Late-act economy and progression transitions',
  },
  {
    step: 7,
    sceneKey: 'Battle',
    preset: 'late_act',
    description: 'Late-act combat pacing and defeat/exit handling',
  },
  {
    step: 8,
    sceneKey: 'NodeMap',
    preset: 'weapon_arts',
    description: 'Shop buy-list hover details (including unaffordable rows)',
  },
  {
    step: 9,
    sceneKey: 'NodeMap',
    preset: 'weapon_arts',
    description: 'Accessory equip/swap picker UX and item detail checks',
  },
  {
    step: 10,
    sceneKey: 'Battle',
    preset: 'battle_smoke',
    description: 'Battle equip menu weapon stat lines and equipped marker',
  },
  {
    step: 11,
    sceneKey: 'Battle',
    preset: 'battle_smoke',
    description: 'Attack picker includes weight and compact weapon detail rows',
  },
  {
    step: 12,
    sceneKey: 'Battle',
    preset: 'late_act',
    description: 'Post-battle loot/reward card UI pass (icons, categories, details)',
  },
];

function parseBool(value) {
  if (typeof value !== 'string') return false;
  const raw = value.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function parseSeed(value) {
  if (typeof value !== 'string' || value.trim().length <= 0) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function parsePositiveInt(value) {
  if (typeof value !== 'string' || value.trim().length <= 0) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i > 0 ? i : null;
}

function normalizePreset(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return DEV_PRESETS.has(raw) ? raw : 'fresh';
}

function cloneItem(item) {
  return item ? structuredClone(item) : null;
}

function addTeamWeaponArtScrolls(runManager, gameData, maxCount = 4) {
  const scrolls = (gameData?.weapons || [])
    .filter((item) => item?.type === 'Scroll' && typeof item.teachesWeaponArtId === 'string')
    .slice(0, maxCount)
    .map(cloneItem)
    .filter(Boolean);
  runManager.scrolls.push(...scrolls);
}

function applyMetaPreset(meta, preset, gameData) {
  if (!meta) return;
  if (preset === 'fresh' || preset === 'event') return;

  meta.totalValor = 20000;
  meta.totalSupply = 20000;
  meta.milestones = new Set(['beatAct1', 'beatAct2', 'beatAct3', 'beatGame']);
  // The ladder with Dusk won: Dusk and Nightfall open, Black Sun still says why not.
  if (preset === 'ladder') meta.milestones.add('beatDusk');
  if (preset === 'ngplus') applyNgPlusReviewMeta(meta, gameData);

  if (
    preset === 'weapon_arts' ||
    preset === 'battle_smoke' ||
    preset === 'soulreaver_mast' ||
    preset === 'eclipse'
  ) {
    meta.purchasedUpgrades.iron_arms = 1;
    meta.purchasedUpgrades.steel_arms = 1;
    meta.purchasedUpgrades.art_adept = 1;
  }
}

function createRunPreset(gameData, meta, config) {
  const metaEffects =
    meta?.getActiveEffects({
      weaponArtCatalog: gameData?.weaponArts?.arts || [],
    }) || null;
  // The synthetic loadout must not depend on a player's saved lord selection.
  const runEffects = COMBAT_LOADOUT_PRESETS.has(config.preset)
    ? { ...metaEffects, startingLords: { commander: 'Edric', partner: 'Sera' } }
    : metaEffects;
  const runManager = new RunManager(gameData, runEffects);
  runManager.startRun({
    runSeed: Number.isFinite(config.seed) ? config.seed : Date.now(),
    difficultyId: config.difficultyId || 'normal',
  });

  if (config.preset === 'weapon_arts') {
    runManager.addGold(15000);
    addTeamWeaponArtScrolls(runManager, gameData, 4);
  }

  if (
    config.preset === 'late_act' ||
    config.preset === 'battle_smoke' ||
    config.preset === 'roster_review' ||
    config.preset === 'eclipse'
  ) {
    if (runManager.actIndex < runManager.actSequence.length - 1) runManager.advanceAct();
    runManager.addGold(12000);
    addTeamWeaponArtScrolls(runManager, gameData, 2);
  }

  if (
    config.preset === 'battle_smoke' ||
    config.preset === 'roster_review' ||
    config.preset === 'eclipse'
  ) {
    const firstNode = runManager.getAvailableNodes()[0];
    if (firstNode) runManager.markNodeComplete(firstNode.id);
  }

  // Eclipse review route: a darkened run (`&shadow=`, `&actShadow=`) whose fallen
  // knots have not played their fall yet (the Loom ceremony runs on arrival).
  if (config.preset === 'eclipse' && runManager.isEclipseActive()) {
    const shadow = Number.isFinite(config.shadow) ? config.shadow : 58;
    const act = Number.isFinite(config.actShadow) ? config.actShadow : 14;
    runManager.eclipse = {
      ...runManager.eclipse,
      shadow,
      actStartShadow: Math.max(0, shadow - act),
      actShadow: Math.max(0, act),
    };
    runManager.applyEclipseNow();
  }

  if (config.preset === 'soulreaver_mast') {
    runManager.addGold(20000);
    addTeamWeaponArtScrolls(runManager, gameData, 4);
    // Anchor on the commander, whoever it is — a dev slot with a non-Edric
    // commander selection would otherwise silently skip the preset.
    const commander = findCommander(runManager.roster);
    if (commander) {
      commander.tier = 'promoted';
      commander.level = Math.max(10, Number(commander.level) || 1);
      if (Array.isArray(commander.proficiencies)) {
        commander.proficiencies = commander.proficiencies.map((prof) => ({
          ...prof,
          rank: 'Mast',
        }));
      }
      const soulreaver = (gameData?.weapons || []).find((weapon) => weapon?.name === 'Namethief');
      if (
        soulreaver &&
        Array.isArray(commander.inventory) &&
        !commander.inventory.some((weapon) => weapon?.name === 'Namethief')
      ) {
        commander.inventory.push(structuredClone(soulreaver));
      }
      const equippedSoulreaver = Array.isArray(commander.inventory)
        ? commander.inventory.find((weapon) => weapon?.name === 'Namethief')
        : null;
      if (equippedSoulreaver) {
        commander.weapon = equippedSoulreaver;
        normalizeEquippedFirst(commander);
      }
      if (Number.isFinite(commander?.stats?.HP)) {
        commander.currentHP = Math.min(
          commander.stats.HP,
          Math.max(1, commander.currentHP || commander.stats.HP),
        );
      }
    }
  }

  if (COMBAT_LOADOUT_PRESETS.has(config.preset)) {
    runManager.advanceAct();
    // Deliberately synthetic loadouts; real combat rules and costs still apply.
    // Keep this five-unit action laboratory independent of the ordinary starter roster.
    runManager.roster = runManager.roster.filter((unit) => !unit.specialCharId);
    const item = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));
    const edric = runManager.roster.find((u) => u.name === 'Edric');
    edric.inventory = [item('Iron Sword')];
    edric.weapon = edric.inventory[0];
    edric.weapon.weaponArtIds = ['sword_wrath_strike', 'sword_dueling_blade'];
    edric.currentHP = edric.stats.HP;
    const sera = runManager.roster.find((u) => u.name === 'Sera');
    sera.proficiencies = [
      { type: 'Light', rank: 'Prof' },
      { type: 'Staff', rank: 'Mast' },
    ];
    sera.inventory = ['Glimmer', 'Heal', 'Restore', 'Rescue Staff', 'Warp Staff'].map(item);
    sera.weapon = sera.inventory[0];
    for (const [name, className, skills] of [
      ['Utility', 'Mage', ['blink', 'rally_cry_skill', 'healing_circle', 'ensnare']],
      ['Support', 'Dancer', ['dance', 'shove', 'pull']],
      ['Patient', 'Fighter', []],
    ]) {
      const unit = createUnit(
        gameData.classes.find((c) => c.name === className),
        1,
        gameData.weapons,
        { name },
      );
      unit.skills = skills;
      if (name === 'Patient') unit.currentHP = Math.max(1, unit.stats.HP - 12);
      runManager.roster.push(unit);
    }
    // The fog review: Sera has Canto, to Rescue and move on before the fog lifts.
    if (config.preset === 'fog_ambush' && !sera.skills.includes('canto')) sera.skills.push('canto');
    runManager.ensurePortraitVariants();
  }

  if (config.preset === 'roster_checks') addRosterChecks(runManager, gameData);
  if (config.preset === 'roster_review') addRosterReview(runManager, gameData);

  if (config.preset === 'event') applyEventPreset(runManager, config);
  // Any other review route (a battle, the route map) may carry the contract too: `&contract=` on
  // `?devScene=battle&preset=battle_smoke` is a battle the contract will settle on.
  else addReviewContract(runManager, config.contract);
  // `&descent=1`: the run goes on into Act V (devDescentFixtures.js).
  if (config.descent) applyDevDescent(runManager, config);

  return runManager;
}

/**
 * The event review route (`?devScene=nodemap&preset=event&seed=42[&event=<id>]`): a fresh
 * Act I run whose next step is an Event. A battle/shop/church node of row 2 or later is
 * made an event node (no battle params, as the generator leaves one), every node on the
 * way to it is walked, and the party stands on the node before it, so one click enters the
 * event. `&event=<id>` narrows the catalog to that event (plus the fallback), so the pick
 * the arrival makes (EventCommands.arriveAtEvent, seeded as ever) can only be that one.
 * 1000 gold, so costed choices are open. Review/QA only: a real run never reads this.
 */
function applyEventPreset(runManager, config) {
  // `&act=2`: the review starts in a later act (the new act's map), for the events that wait there.
  for (let act = 1; act < (config.eventAct || 1); act++) {
    if (runManager.actIndex < runManager.actSequence.length - 1) runManager.advanceAct();
  }
  const nodes = runManager.nodeMap?.nodes || [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const convertible = new Set([NODE_TYPES.BATTLE, NODE_TYPES.SHOP, NODE_TYPES.CHURCH]);
  const target = [...nodes]
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .find((node) => node.row >= 2 && convertible.has(node.type));
  if (!target) return;
  // The node the party walks to: an event (the default), or a church or the colosseum, to review
  // the Cleanse vow and the arena's bouts (`&as=church`, `&as=colosseum`).
  const kind = EVENT_REVIEW_NODES[config.eventNodeAs] || NODE_TYPES.EVENT;
  target.type = kind;
  target.battleParams = null;
  delete target.fogEnabled;
  delete target.templateId;
  // A Dark Omen (`&omen=1`): the event node the Eclipse took and left its story.
  if (kind === NODE_TYPES.EVENT && config.omen) {
    target.darkOmen = true;
    target.eclipse = { fellAtShadow: 30, fromType: 'event', label: 'Dark Omen', seen: true };
  }
  // The shortest road from the start to it (breadth first over the forward edges).
  const parent = new Map([[runManager.nodeMap.startNodeId, null]]);
  const queue = [runManager.nodeMap.startNodeId];
  while (queue.length && !parent.has(target.id)) {
    const id = queue.shift();
    for (const edge of byId.get(id)?.edges || []) {
      if (parent.has(edge)) continue;
      parent.set(edge, id);
      queue.push(edge);
    }
  }
  const road = [];
  for (let id = parent.get(target.id); id; id = parent.get(id)) road.unshift(id);
  for (const id of road) runManager.markNodeComplete(id);
  runManager.addGold(1000);
  const events = runManager.gameData?.events;
  const fixture = DEV_EVENT_FIXTURES[config.event] || null;
  if (config.event && Array.isArray(events?.events)) {
    // A review fixture (utils/devEventFixtures.js) is the only event on the road, with the fallback.
    const pool = fixture
      ? [fixture.event, ...events.events.filter((event) => event.fallback)]
      : events.events.filter((event) => event.id === config.event || event.fallback);
    runManager.gameData = { ...runManager.gameData, events: { ...events, events: pool } };
  }
  addReviewUnits(runManager, [
    ...(fixture?.units || []),
    ...String(config.units || '')
      .split(',')
      .map((className) => ({ className: className.trim() }))
      .filter((unit) => unit.className),
  ]);
  addReviewBurdens(runManager, config.burdens);
  addReviewContract(runManager, config.contract);
}

// `&as=` values for the event review route's target node.
const EVENT_REVIEW_NODES = {
  event: NODE_TYPES.EVENT,
  church: NODE_TYPES.CHURCH,
  colosseum: NODE_TYPES.COLOSSEUM,
};

/** Roster additions for the review: [{ className, name? }] (an unknown class is skipped). */
function addReviewUnits(runManager, specs) {
  const gameData = runManager.gameData;
  for (const spec of specs) {
    const classData = gameData.classes.find((c) => c.name === spec.className);
    if (!classData) continue;
    const unit = createUnit(classData, 3, gameData.weapons, { name: spec.name || spec.className });
    runManager.assignUnitUid(unit);
    runManager.roster.push(unit);
  }
  if (specs.length) runManager.ensurePortraitVariants();
}

/**
 * `&burdens=ill_omen,debt:450,hunted,sworn_enemy,wounded`: the run carries them ("id" or
 * "id:number", the number being Debt's owed gold or the battles left). A wound falls on the
 * first lord's STR.
 */
function addReviewBurdens(runManager, list) {
  for (const entry of String(list || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const [id, figure] = entry.split(':');
    const n = Number(figure);
    const params = {};
    if (id === 'debt' && Number.isFinite(n)) params.owed = n;
    else if (Number.isFinite(n)) params.battles = n;
    if (id === 'wounded') {
      const unit = runManager.roster.find((u) => u.isLord) || runManager.roster[0];
      Object.assign(params, { unitUid: unit?.unitUid, unitName: unit?.name, stat: 'STR' });
    }
    addBurden(runManager, id, params);
  }
}

/** `&contract=underPar|noLosses`: an open contract, 600 G kept, 300 G of Debt broken (any dev route). */
function addReviewContract(runManager, goal) {
  if (!goal) return;
  runManager.contract = normalizeContract({
    goal,
    reward: [{ type: 'gold', value: 600 }],
    penalty: [{ type: 'burden', id: 'debt', params: { owed: 300 } }],
    eventId: 'dev_contract',
    nodeId: 'dev',
    act: runManager.currentAct,
  });
}

/**
 * Roster review units: a full unit promoted with its Oath sworn into the Oath's own slot and
 * its new class skill (Colossus) waiting on the bench (Bramwell), one
 * who will meet the cap when promoted with his Master Seal (Corwin), and Edric in a
 * Seraph Robe at 1 HP with an Elixir and a Vulnerary (the robe's HP debt).
 */
function addRosterChecks(runManager, gameData) {
  const cls = (name) => gameData.classes.find((c) => c.name === name);
  const consumable = (name) =>
    structuredClone(gameData.consumables.find((c) => c.name === name) || null);
  const heldTheBridge = (unit) => {
    unit._battleDeeds = {
      ...emptyBattleDeeds(),
      heldPhases: 3,
      heldPlaces: ['Bridge', 'Bridge', 'Bridge'],
    };
    commitBattleDeeds([unit], gameData.deeds, { battleKey: `review:${unit.name}` });
    unit.skills = ['sol', 'luna', 'astra', 'vantage', 'wrath'];
    return unit;
  };
  const bramwell = heldTheBridge(
    createUnit(cls('Fighter'), 10, gameData.weapons, { name: 'Bramwell' }),
  );
  const target = resolvePromotionTargets(bramwell, gameData.classes, gameData.lords)[0];
  if (target) {
    promoteUnit(bramwell, target, target.promotionBonuses, gameData.skills);
    applyPromotionOath(bramwell, gameData);
  }
  const corwin = heldTheBridge(
    createUnit(cls('Fighter'), 10, gameData.weapons, { name: 'Corwin' }),
  );
  const seal = consumable('Master Seal');
  if (seal) corwin.consumables = [seal];
  runManager.roster.push(bramwell, corwin);

  const edric = runManager.roster.find((u) => u.name === 'Edric');
  const robe = structuredClone(gameData.accessories.find((a) => a.name === 'Seraph Robe') || null);
  if (edric && robe) {
    equipAccessory(edric, robe);
    edric.currentHP = 1;
    edric.consumables = [consumable('Elixir'), consumable('Vulnerary')].filter(Boolean);
  }
  runManager.ensureUnitUids();
  runManager.ensurePortraitVariants();
}

/**
 * The Roster overview review: ten units of mixed classes and levels, some hurt, one near a
 * level, one ready to promote, one with a Lingering Injury, one unarmed, and one fallen.
 */
function addRosterReview(runManager, gameData) {
  const cls = (name) => gameData.classes.find((c) => c.name === name);
  const recruits = [
    ['Bramwell', 'Fighter', 10, { hp: 0.6, xp: 15 }],
    ['Daska', 'Archer', 6, { xp: 85 }],
    ['Oriane', 'Cavalier', 7, { hp: 0.4, xp: 30 }],
    ['Kip', 'Thief', 5, { unarmed: true, xp: 50 }],
    ['Ilse', 'Cleric', 4, { xp: 40 }],
    ['Thessaly', 'Knight', 9, { hp: 0.25, xp: 5 }],
    ['Morrow', 'Mage', 8, { xp: 70 }],
    ['Corwin', 'Mercenary', 3, { hp: 0.8 }],
  ];
  for (const [name, className, level, opts] of recruits) {
    const classData = cls(className);
    if (!classData) continue;
    const unit = createUnit(classData, level, gameData.weapons, { name });
    unit.faction = 'player';
    unit.xp = opts.xp || 0;
    if (opts.hp) unit.currentHP = Math.max(1, Math.round(unit.stats.HP * opts.hp));
    if (opts.unarmed) unit.inventory = [];
    runManager.roster.push(unit);
  }
  const soldier = cls('Soldier');
  if (soldier) {
    const fallen = createUnit(soldier, 5, gameData.weapons, { name: 'Garrow' });
    fallen.faction = 'player';
    fallen.currentHP = 0;
    runManager.fallenUnits.push(fallen);
  }
  runManager.ensureUnitUids();
  runManager.ensurePortraitVariants();
  const oriane = runManager.roster.find((u) => u.name === 'Oriane');
  if (oriane)
    addBurden(runManager, 'wounded', {
      unitUid: oriane.unitUid,
      unitName: oriane.name,
      stat: 'STR',
    });
}

/** A won run for the run-complete review: the ending follows `route`'s road. */
function createVictoryRun(gameData, meta, config) {
  const road = DEV_VICTORY_ROUTES[config.route] || DEV_VICTORY_ROUTES.lieutenant;
  const runManager = new RunManager(gameData, meta?.getActiveEffects?.() || null);
  runManager.startRun({
    runSeed: Number.isFinite(config.seed) ? config.seed : 1,
    difficultyId: road.difficultyId,
  });
  if (road.acts) runManager.actSequence = [...road.acts];
  runManager.actIndex = runManager.actSequence.length - 1;
  runManager.completedBattles = 20;
  runManager.status = 'victory';
  return runManager;
}

function pickBattleNode(runManager, nodeType = null) {
  // Review routes: devNode=boss enters the current act's boss battle directly: the map's own
  // boss node (the Descent's finale, never its gate, which is the first boss node on its map).
  if (nodeType === NODE_TYPES.BOSS) {
    const nodes = runManager.nodeMap?.nodes || [];
    const boss =
      nodes.find((node) => node?.id === runManager.nodeMap?.bossNodeId) ||
      nodes.find((node) => node?.type === NODE_TYPES.BOSS);
    if (boss) return boss;
  }
  // devNode=recruit: the act's first recruit knot (the Loom preview's own battle).
  if (nodeType === NODE_TYPES.RECRUIT) {
    const recruit = (runManager.nodeMap?.nodes || []).find(
      (node) => node?.type === NODE_TYPES.RECRUIT && node.battleParams,
    );
    if (recruit) return recruit;
  }
  const available = runManager.getAvailableNodes();
  const preferred = available.find(
    (node) =>
      node?.type === NODE_TYPES.BATTLE ||
      node?.type === NODE_TYPES.BOSS ||
      node?.type === NODE_TYPES.RECRUIT,
  );
  return preferred || available[0] || runManager.nodeMap?.nodes?.[0] || null;
}

/**
 * HintManager's interface, kept in memory: the review routes own no save slot. Only
 * the lessons named in `teach` are taught (once); every other one reads as already
 * seen, so a review opens on what it is there to show.
 */
export function sessionHints(registry, teach = []) {
  const lessons = new Set(teach);
  const told = new Set();
  const enabled = () => registry?.get?.('settings')?.getHints?.() !== false;
  const hasSeen = (id) => !lessons.has(id) || told.has(id);
  return {
    isNew: false,
    shouldShow(id) {
      if (!enabled() || hasSeen(id)) return false;
      told.add(id);
      return true;
    },
    hasSeen,
    markSeen: (id) => void told.add(id),
    reset: () => told.clear(),
  };
}

function ensureMetaRegistry(registry, gameData, preset) {
  let meta = registry.get('meta');
  if (!meta) {
    meta = new MetaProgressionManager(gameData.metaUpgrades, DEV_META_STORAGE_KEY);
    registry.set('meta', meta);
  }
  applyMetaPreset(meta, preset, gameData);
  return meta;
}

/**
 * Dev routes (`?devScene=`, `?qaStep=`) run in the dev server and in Netlify deploy
 * previews (netlify.toml sets VITE_DEV_ROUTES there, so a PR can be tried straight
 * from its preview link). The production site never sets it.
 */
export function devRoutesEnabled(env = import.meta.env) {
  return Boolean(env?.DEV) || env?.VITE_DEV_ROUTES === 'true';
}

export function parseDevStartupConfig(search, options = {}) {
  const devMode = options.devMode ?? devRoutesEnabled();
  if (!devMode) return null;
  const params = new URLSearchParams(search || '');
  const qaStep = parsePositiveInt(params.get('qaStep'));
  const qaConfig = Number.isInteger(qaStep)
    ? DEV_QA_SEQUENCE.find((entry) => entry.step === qaStep)
    : null;

  const rawScene = params.get('devScene');
  const sceneKey = rawScene
    ? DEV_SCENE_ALIASES[String(rawScene).trim().toLowerCase()] || null
    : qaConfig?.sceneKey || null;
  if (!sceneKey) return null;

  return {
    enabled: true,
    sceneKey,
    preset: normalizePreset(params.get('preset') || qaConfig?.preset || 'fresh'),
    seed: parseSeed(params.get('seed')),
    difficultyId: params.get('difficulty') || 'normal',
    devTools: parseBool(params.get('devTools')),
    ...(params.get('route') ? { route: params.get('route') } : {}),
    ...(params.get('event') ? { event: params.get('event') } : {}),
    // Event review extras (applyEventPreset): the node's kind, the burdens and contract the run
    // carries, a Dark Omen, and roster additions.
    ...(parsePositiveInt(params.get('act'))
      ? { eventAct: parsePositiveInt(params.get('act')) }
      : {}),
    ...(params.get('as') ? { eventNodeAs: params.get('as') } : {}),
    ...(params.get('burdens') ? { burdens: params.get('burdens') } : {}),
    ...(params.get('contract') ? { contract: params.get('contract') } : {}),
    // A battle whose turn par is this many turns (devScenarios.js `short_par`): the contract's
    // "Under par" can be broken in a few real turns.
    ...(parsePositiveInt(params.get('par')) ? { devPar: parsePositiveInt(params.get('par')) } : {}),
    ...(parseBool(params.get('omen')) ? { omen: true } : {}),
    ...(params.get('units') ? { units: params.get('units') } : {}),
    // `&setPiece=<id>` on the battle route: that event set piece (docs/specs/event-set-pieces.md).
    ...(params.get('setPiece') ? { setPiece: params.get('setPiece') } : {}),
    // `&template=<id>` on the battle route: that map template, switched off or not
    // (docs/specs/map-variety.md), with `&act=N` for its act.
    ...(params.get('template') ? { template: params.get('template') } : {}),
    // `&army=N` on the template review: the army it fields (0 keeps the starter roster; default
    // the act's full deploy, utils/devReviewArmy.js).
    ...(params.has('army') && Number.isInteger(Number(params.get('army')))
      ? { army: Number(params.get('army')) }
      : {}),
    // Act V review (devDescentFixtures.js): `&descent=1` switches the Descent on for this page and
    // enters Act V; `&rite=N` sets the Rite's words, `&descentRow=N` walks the route to row N.
    ...(parseBool(params.get('descent')) ? { descent: true } : {}),
    ...(parseSeed(params.get('rite')) != null ? { riteWords: parseSeed(params.get('rite')) } : {}),
    ...(parseSeed(params.get('descentRow')) != null
      ? { descentRow: parseSeed(params.get('descentRow')) }
      : {}),
    qaStep: qaConfig?.step || null,
    qaDescription: qaConfig?.description || null,
    nodeType:
      params.get('devNode') === 'boss'
        ? NODE_TYPES.BOSS
        : params.get('devNode') === 'recruit'
          ? NODE_TYPES.RECRUIT
          : null,
    // Eclipse review route overrides (only present when given).
    ...(parseSeed(params.get('shadow')) != null ? { shadow: parseSeed(params.get('shadow')) } : {}),
    ...(parseSeed(params.get('actShadow')) != null
      ? { actShadow: parseSeed(params.get('actShadow')) }
      : {}),
  };
}

/** The objective pool a map template sits in (rout | seize | escape), or null. */
function templateObjective(mapTemplates, id) {
  for (const [objective, list] of Object.entries(mapTemplates || {}))
    if (Array.isArray(list) && list.some((t) => t?.id === id)) return objective;
  return null;
}

/**
 * The act a template review reaches with no `&act=`: the run's first act the template lists
 * (`acts`, e.g. Snowbound Woods' act4 on a rung that has an Act IV), as a 1-based act number;
 * null when it lists none, the run has none of them, or the id is unknown.
 */
function templateReviewAct(mapTemplates, id, actSequence) {
  for (const list of Object.values(mapTemplates || {})) {
    const template = Array.isArray(list) ? list.find((t) => t?.id === id) : null;
    if (!template) continue;
    if (!Array.isArray(template.acts) || !template.acts.length) return null;
    const index = (actSequence || []).findIndex((act) => template.acts.includes(act));
    return index >= 0 ? index + 1 : null;
  }
  return null;
}

export function buildDevStartupRoute(sourceGameData, registry, config) {
  if (!sourceGameData || !registry || !config?.enabled) return null;
  // `&setPiece=dev_vigil`: a review-only set piece (utils/devSetPieceFixtures.js) joins this
  // page's game data; any other id leaves it as loaded.
  const withPiece = config.setPiece
    ? withDevSetPiece(sourceGameData, config.setPiece)
    : sourceGameData;
  // `&descent=1`: the Descent is on for this page's data only (devDescentFixtures.js).
  const gameData = config.descent ? withDevDescent(withPiece) : withPiece;

  registry.set('devToolsEnabled', Boolean(config.devTools));
  // A `?devScene=` review route's battles keep the run seed's one stream (BattleScout.js
  // openingBattleStreamSeed `pinned`): its fixtures and browser specs are tuned on it.
  registry.set(PINNED_BATTLE_STREAM_KEY, true);
  if (config.qaStep) registry.set('qaStep', config.qaStep);
  const baseData = { gameData };
  if (config.sceneKey === 'Title') {
    return { key: 'Title', data: baseData };
  }

  // QA encounters and review routes never belong to a real save slot.
  if (
    COMBAT_LOADOUT_PRESETS.has(config.preset) ||
    config.preset === 'roster_checks' ||
    config.preset === 'roster_review' ||
    config.sceneKey === 'RunComplete'
  )
    registry.set('activeSlot', null);
  // Roster review: first-time lessons (the skill bench's) teach as in a fresh save,
  // remembered for this page only, never in a slot.
  if (config.preset === 'roster_checks' && !registry.get('hints'))
    registry.set('hints', sessionHints(registry, ['roster_skill_benched']));
  // Event review: the first event's note teaches as in a fresh save (this page only).
  if (config.preset === 'event' && !registry.get('hints'))
    registry.set('hints', sessionHints(registry, ['guide_first_event']));

  const meta = ensureMetaRegistry(registry, gameData, config.preset);

  if (
    config.sceneKey === 'HomeBase' ||
    config.sceneKey === 'DifficultySelect' ||
    config.sceneKey === 'BlessingSelect'
  ) {
    return { key: config.sceneKey, data: baseData };
  }

  if (config.sceneKey === 'RunComplete') {
    return {
      key: 'RunComplete',
      data: {
        ...baseData,
        runManager: createVictoryRun(gameData, meta, config),
        result: 'victory',
      },
    };
  }

  const runManager = createRunPreset(gameData, meta, config);
  if (config.sceneKey === 'NodeMap') {
    return {
      key: 'NodeMap',
      data: {
        ...baseData,
        runManager,
        difficultyId: config.difficultyId || runManager.difficultyId || 'normal',
      },
    };
  }

  // The set-piece and template reviews fight in Act N with `&act=N` (that act's map; never back).
  // A template review with no `&act=` reaches at least the template's first act.
  const reviewAct =
    config.eventAct ||
    (config.template && !config.setPiece
      ? templateReviewAct(gameData.mapTemplates, config.template, runManager.actSequence)
      : null);
  if ((config.setPiece || config.template) && reviewAct) {
    const last = runManager.actSequence.length - 1;
    while (runManager.actIndex < Math.min(reviewAct - 1, last)) runManager.advanceAct();
  }
  // The template review fights with the act's full army (the enemy count follows the deploy).
  if (config.template && !config.setPiece && config.army !== 0) {
    addReviewArmy(runManager, {
      act: runManager.currentAct,
      seed: runManager.runSeed,
      army: config.army ?? null,
    });
  }
  const battleNode = pickBattleNode(runManager, config.nodeType);
  const battleParams = (battleNode && runManager.getBattleParams(battleNode)) || {
    act: runManager.currentAct || 'act1',
    objective: 'rout',
  };
  // The fog review: a foggy battle with an enemy hidden on Edric's road (devScenarios.js).
  if (config.preset === 'fog_ambush') {
    battleParams.fogEnabled = true;
    battleParams.devScenario = 'fog_ambush';
  }
  // `&par=N`: the battle's par is N turns (devScenarios.js), for the contract's HUD line.
  if (config.devPar && !battleParams.devScenario) {
    battleParams.devScenario = 'short_par';
    battleParams.devPar = config.devPar;
  }
  // The set-piece review (`&setPiece=toll_house`): the battle is built as an event's fight builds
  // it (NodeMapGenerator.convertNodeToSetPieceBattle): its id, objective, deploy cap and forced fog.
  const setPiece = config.setPiece ? findSetPiece(gameData.setPieces, config.setPiece) : null;
  if (setPiece) {
    battleParams.setPiece = setPiece.id;
    battleParams.objective = setPiece.objective || 'rout';
    battleParams.isEventBattle = true;
    battleParams.firstBattleFightersOnly = false;
    const cap = setPieceDeployCap(setPiece);
    if (cap) battleParams.deployCap = cap;
    if (typeof setPiece.fog === 'boolean') battleParams.fogEnabled = setPiece.fog;
    delete battleParams.templateId;
  }
  // The template review (`&template=corner_camp`): the battle is drawn on that template, on the
  // objective its pool names (a template switched off is still played when a battle names it).
  const templatePool = config.template
    ? templateObjective(gameData.mapTemplates, config.template)
    : null;
  if (templatePool && !setPiece) {
    battleParams.templateId = config.template;
    battleParams.objective = templatePool;
    // The act's whole pool, never the opening battle's Fighters-only draw: the review shows the
    // shape with the foes it meets in a run.
    battleParams.firstBattleFightersOnly = false;
  }
  // The remains review: a Rout down to one weak Zombie beside Edric (devScenarios.js).
  if (config.preset === 'zombie_remains') {
    battleParams.objective = 'rout';
    battleParams.devScenario = 'zombie_remains';
  }
  return {
    key: 'Battle',
    data: {
      ...baseData,
      runManager,
      roster: runManager.getRoster(),
      nodeId: battleNode?.id || null,
      battleParams,
      isBoss: battleNode?.type === NODE_TYPES.BOSS,
      isElite: Boolean(battleNode?.battleParams?.isElite),
    },
  };
}
