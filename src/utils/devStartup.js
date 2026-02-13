import { MetaProgressionManager } from '../engine/MetaProgressionManager.js';
import { RunManager } from '../engine/RunManager.js';
import { NODE_TYPES } from './constants.js';

const DEV_META_STORAGE_KEY = 'emblem_rogue_dev_meta';
const DEV_SCENE_ALIASES = {
  title: 'Title',
  homebase: 'HomeBase',
  difficulty: 'DifficultySelect',
  blessing: 'BlessingSelect',
  nodemap: 'NodeMap',
  battle: 'Battle',
};
const DEV_PRESETS = new Set([
  'fresh',
  'weapon_arts',
  'late_act',
  'battle_smoke',
  'soulreaver_mast',
]);
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

function applyMetaPreset(meta, preset) {
  if (!meta) return;
  if (preset === 'fresh') return;

  meta.totalValor = 20000;
  meta.totalSupply = 20000;
  meta.milestones = new Set(['beatAct1', 'beatAct2', 'beatAct3', 'beatGame']);

  if (preset === 'weapon_arts' || preset === 'battle_smoke' || preset === 'soulreaver_mast') {
    meta.purchasedUpgrades.iron_arms = 1;
    meta.purchasedUpgrades.steel_arms = 1;
    meta.purchasedUpgrades.art_adept = 1;
  }
}

function createRunPreset(gameData, meta, config) {
  const metaEffects = meta?.getActiveEffects({
    weaponArtCatalog: gameData?.weaponArts?.arts || [],
  }) || null;
  const runManager = new RunManager(gameData, metaEffects);
  runManager.startRun({
    runSeed: Number.isFinite(config.seed) ? config.seed : Date.now(),
    difficultyId: config.difficultyId || 'normal',
  });

  if (config.preset === 'weapon_arts') {
    runManager.addGold(15000);
    addTeamWeaponArtScrolls(runManager, gameData, 4);
  }

  if (config.preset === 'late_act' || config.preset === 'battle_smoke') {
    if (runManager.actIndex < runManager.actSequence.length - 1) runManager.advanceAct();
    runManager.addGold(12000);
    addTeamWeaponArtScrolls(runManager, gameData, 2);
  }

  if (config.preset === 'battle_smoke') {
    const firstNode = runManager.getAvailableNodes()[0];
    if (firstNode) runManager.markNodeComplete(firstNode.id);
  }

  if (config.preset === 'soulreaver_mast') {
    runManager.addGold(20000);
    addTeamWeaponArtScrolls(runManager, gameData, 4);
    const edric = runManager.roster.find((unit) => unit?.name === 'Edric');
    if (edric) {
      edric.tier = 'promoted';
      edric.level = Math.max(10, Number(edric.level) || 1);
      if (Array.isArray(edric.proficiencies)) {
        edric.proficiencies = edric.proficiencies.map((prof) => ({
          ...prof,
          rank: 'Mast',
        }));
      }
      const soulreaver = (gameData?.weapons || []).find((weapon) => weapon?.name === 'Soulreaver');
      if (soulreaver && Array.isArray(edric.inventory) && !edric.inventory.some((weapon) => weapon?.name === 'Soulreaver')) {
        edric.inventory.push(structuredClone(soulreaver));
      }
      const equippedSoulreaver = Array.isArray(edric.inventory)
        ? edric.inventory.find((weapon) => weapon?.name === 'Soulreaver')
        : null;
      if (equippedSoulreaver) edric.weapon = equippedSoulreaver;
      if (Number.isFinite(edric?.stats?.HP)) {
        edric.currentHP = Math.min(edric.stats.HP, Math.max(1, edric.currentHP || edric.stats.HP));
      }
    }
  }

  return runManager;
}

function pickBattleNode(runManager) {
  const available = runManager.getAvailableNodes();
  const preferred = available.find((node) =>
    node?.type === NODE_TYPES.BATTLE
    || node?.type === NODE_TYPES.BOSS
    || node?.type === NODE_TYPES.RECRUIT
  );
  return preferred || available[0] || runManager.nodeMap?.nodes?.[0] || null;
}

function ensureMetaRegistry(registry, gameData, preset) {
  let meta = registry.get('meta');
  if (!meta) {
    meta = new MetaProgressionManager(gameData.metaUpgrades, DEV_META_STORAGE_KEY);
    registry.set('meta', meta);
  }
  applyMetaPreset(meta, preset);
  return meta;
}

export function parseDevStartupConfig(search, options = {}) {
  const devMode = options.devMode ?? import.meta.env.DEV;
  if (!devMode) return null;
  const params = new URLSearchParams(search || '');
  const qaStep = parsePositiveInt(params.get('qaStep'));
  const qaConfig = Number.isInteger(qaStep)
    ? DEV_QA_SEQUENCE.find((entry) => entry.step === qaStep)
    : null;

  const rawScene = params.get('devScene');
  const sceneKey = rawScene
    ? (DEV_SCENE_ALIASES[String(rawScene).trim().toLowerCase()] || null)
    : (qaConfig?.sceneKey || null);
  if (!sceneKey) return null;

  return {
    enabled: true,
    sceneKey,
    preset: normalizePreset(params.get('preset') || qaConfig?.preset || 'fresh'),
    seed: parseSeed(params.get('seed')),
    difficultyId: params.get('difficulty') || 'normal',
    devTools: parseBool(params.get('devTools')),
    qaStep: qaConfig?.step || null,
    qaDescription: qaConfig?.description || null,
  };
}

export function buildDevStartupRoute(gameData, registry, config) {
  if (!gameData || !registry || !config?.enabled) return null;

  registry.set('devToolsEnabled', Boolean(config.devTools));
  if (config.qaStep) registry.set('qaStep', config.qaStep);
  const baseData = { gameData };
  if (config.sceneKey === 'Title') {
    return { key: 'Title', data: baseData };
  }

  const meta = ensureMetaRegistry(registry, gameData, config.preset);

  if (config.sceneKey === 'HomeBase' || config.sceneKey === 'DifficultySelect' || config.sceneKey === 'BlessingSelect') {
    return { key: config.sceneKey, data: baseData };
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

  const battleNode = pickBattleNode(runManager);
  const battleParams = battleNode ? runManager.getBattleParams(battleNode) : {
    act: runManager.currentAct || 'act1',
    objective: 'rout',
  };
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
