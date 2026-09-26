// A BattleScene that runs a player attack through production code from the
// forecast's Confirm to the end of resolution: confirmForecastCombat →
// executeCombat → _commitCombatIntent → _prepareCombatContext →
// _runCombatResolution (weapon-art cost, buildSkillCtx with Gambler's Coin,
// resolveCombat, the strike loop with a Teleporter warp, post-combat effects,
// Phoenix Brooch). Only rendering (Phaser objects, tweens, banners, sound) is
// stubbed. The run stops where the attack's XP is awarded; level-ups and unit
// removal are later paths.
//
// Callers must mock 'phaser' (vi.mock) before importing BattleScene.
import { BattleScene } from '../../src/scenes/BattleScene.js';
import { applyImbue, getImbueById } from '../../src/engine/ImbueSystem.js';
import { equipAccessory } from '../../src/engine/UnitManager.js';
import { loadGameData } from '../testData.js';

const data = loadGameData();
const plain = data.terrain.find((t) => t.name === 'Plain');

function weapon(name, uid, imbueId = null) {
  const copy = { ...structuredClone(data.weapons.find((w) => w.name === name)), uid };
  if (imbueId) applyImbue(copy, getImbueById(data.imbues, imbueId));
  return copy;
}

function chain() {
  const obj = {};
  for (const key of ['setOrigin', 'setDepth', 'setVisible', 'setAlpha', 'setPosition']) {
    obj[key] = () => obj;
  }
  obj.destroy = () => {};
  return obj;
}

function graphics() {
  return { x: 0, y: 0, setAlpha() {}, setTint() {}, clearTint() {} };
}

function unit(overrides) {
  const stats = {
    HP: 30,
    STR: 10,
    MAG: 2,
    SKL: 12,
    SPD: 10,
    DEF: 6,
    RES: 3,
    LCK: 6,
    MOV: 5,
    ...(overrides.stats || {}),
  };
  const u = {
    className: 'Myrmidon',
    tier: 'base',
    level: 5,
    xp: 0,
    moveType: 'Infantry',
    skills: [],
    affixes: [],
    consumables: [],
    accessory: null,
    hasMoved: false,
    hasActed: false,
    graphic: graphics(),
    label: graphics(),
    factionIndicator: null,
    hpBar: { bg: graphics(), fill: graphics() },
    ...overrides,
    stats,
  };
  u.currentHP = overrides.currentHP ?? stats.HP;
  u.inventory = overrides.inventory || [u.weapon];
  return u;
}

/**
 * The attack fixtures. Each returns fresh units; `art` names a weapon art to
 * select before confirming.
 */
export const ATTACKS = {
  // Offensive and defensive procs, Gambler's Coin on both sides, Binding imbue.
  procs: () => {
    const attacker = unit({
      name: 'Sera',
      battleEntityId: 'u1',
      faction: 'player',
      isCommander: true,
      col: 4,
      row: 4,
      stats: { SKL: 30, LCK: 20, SPD: 16, HP: 34 },
      currentHP: 20,
      skills: ['sol', 'luna', 'adept', 'lethality'],
      weapon: weapon('Steel Sword', 'itm_a1', 'binding'),
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    });
    const defender = unit({
      name: 'Brigand',
      battleEntityId: 'u2',
      faction: 'enemy',
      className: 'Fighter',
      col: 5,
      row: 4,
      stats: { HP: 48, SKL: 30, LCK: 25, SPD: 8 },
      skills: ['pavise', 'miracle'],
      weapon: weapon('Iron Axe', 'itm_e1'),
      proficiencies: [{ type: 'Axe', rank: 'Prof' }],
    });
    return { attacker, defender, coins: true };
  },
  // The defender is a Teleporter: the hit that lands warps it to a random far tile.
  teleporter: () => {
    const attacker = unit({
      name: 'Edric',
      battleEntityId: 'u1',
      faction: 'player',
      isCommander: true,
      col: 4,
      row: 4,
      stats: { SKL: 20, SPD: 18 },
      weapon: weapon('Steel Sword', 'itm_a1'),
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    });
    const defender = unit({
      name: 'Warper',
      battleEntityId: 'u2',
      faction: 'enemy',
      className: 'Fighter',
      col: 5,
      row: 4,
      stats: { HP: 60 },
      affixes: ['teleporter'],
      weapon: weapon('Iron Axe', 'itm_e1'),
      proficiencies: [{ type: 'Axe', rank: 'Prof' }],
    });
    return { attacker, defender };
  },
  // A weapon art (multi-hit) on the equipped weapon: HP cost, then the art's mods.
  art: () => {
    const attacker = unit({
      name: 'Edric',
      battleEntityId: 'u1',
      faction: 'player',
      isCommander: true,
      col: 4,
      row: 4,
      stats: { SKL: 18, HP: 30 },
      weapon: { ...weapon('Iron Sword', 'itm_a1'), weaponArtIds: ['sword_astra_strike'] },
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    });
    const defender = unit({
      name: 'Brigand',
      battleEntityId: 'u2',
      faction: 'enemy',
      className: 'Fighter',
      col: 5,
      row: 4,
      stats: { HP: 50, SKL: 20 },
      skills: ['vantage'],
      weapon: weapon('Iron Axe', 'itm_e1', 'keen'),
      proficiencies: [{ type: 'Axe', rank: 'Prof' }],
    });
    return { attacker, defender, art: 'sword_astra_strike' };
  },
};

/**
 * Build the scene for one attack. `policy` is the battle's rewind policy
 * ('fixed-v1' for battles started now, 'legacy-v1' for old saves); `seed` and
 * `cursor` place the battle RNG exactly as a checkpoint would.
 */
export function attackScene(
  name,
  { policy = 'fixed-v1', seed = 42, cursor = null, reduceMotion = false, speed = 'normal' } = {},
) {
  // Presentation settings the attack reads (strike tempo, reduced motion).
  const settings = { getReduceMotion: () => reduceMotion, getBattleSpeed: () => speed };
  const fixture = ATTACKS[name]();
  const { attacker, defender } = fixture;
  if (fixture.coins) {
    const coin = data.accessories.find(
      (a) => a.combatEffects?.gambler || a.combatEffects?.gamblerCoin,
    );
    equipAccessory(attacker, structuredClone(coin));
    equipAccessory(defender, structuredClone(coin));
  }
  const scene = new BattleScene();
  const commits = [];
  const hits = [];
  Object.assign(scene, {
    gameData: data,
    battleParams: { act: 'act1', tutorialMode: false },
    _battleRewindPolicy: policy,
    visionBaseSeed: seed,
    turnManager: { currentPhase: 'player', turnNumber: 2 },
    playerUnits: [attacker],
    enemyUnits: [defender],
    npcUnits: [],
    battleState: 'SHOWING_FORECAST',
    selectedUnit: attacker,
    forecastTarget: defender,
    _forecastWeapon: attacker.weapon,
    registry: { get: (key) => (key === 'settings' ? settings : null) },
    add: { text: () => chain() },
    tweens: { add: () => chain() },
    grid: {
      cols: 10,
      rows: 10,
      fogEnabled: false,
      getTerrainAt: () => plain,
      getMoveCost: () => 1,
      clearAttackHighlights() {},
      clearHighlights() {},
      isVisible: () => true,
      gridToPixel: (col, row) => ({ x: col * 32 + 16, y: row * 32 + 16 }),
    },
    runManager: {
      rngSeed: seed,
      battleInProgress: { checkpoint: null },
      blessingRuntimeModifiers: {},
      getActHitBonusForUnit: () => 0,
      getTerrainCombatBonuses: () => [],
    },
    // Rendering stand-ins. The choreography reports contact or a miss, as the
    // real one does; everything drawn is dropped.
    _procBanner: {
      showStrikeProcChips() {},
      async showCutIn() {},
      async showSkillBanner() {},
    },
    _combatChoreo: {
      async playStrike({ event, onMiss, onContact }) {
        hits.push(event.miss ? 'miss' : 'contact');
        if (event.miss) onMiss();
        else onContact();
      },
    },
    _combatFx: {
      finishStrike() {},
      playStrikeSound() {},
      playStatus() {},
      reset() {},
    },
    _battleBeats: { onCritStrike() {}, async checkBossHalfHealth() {} },
    _deedController: { onCombat() {} },
    _visionController: { commitSnapshotIfPending: () => false },
    _getPortraitKey: () => null,
    updateHPBar() {},
    updateUnitPosition() {},
    async _awaitSceneTween() {},
    async animateHeal() {},
    async showPoisonDamage() {},
    showMinorHintAt() {},
    _addConditionIcon() {},
    _removeConditionIcon() {},
    undimUnit() {},
    dimUnit() {},
    resetFortHealStreak() {},
    refreshEndTurnControl() {},
    showActionMenu() {
      throw new Error('confirm aborted to the action menu');
    },
    // A checkpoint write: record what it would save.
    _captureSuspendCheckpoint(opts) {
      commits.push({ opts, rngState: scene._battleRng?.getState?.() || null });
      return true;
    },
  });
  scene.reseedBattleRng(seed, cursor ? { algorithm: 'mulberry32-v1', cursor } : null);
  scene._battleDecisionRngState = scene._battleRng.getState();
  if (fixture.art) scene._setSelectedWeaponArt(attacker, fixture.art, attacker.weapon);
  return {
    scene,
    attacker,
    defender,
    commits,
    hits,
    dist: 1,
    atkTerrain: plain,
    defTerrain: plain,
  };
}

/**
 * Open the forecast the way AttackFlowController does (the planned weapon and
 * the selected art), `times` times. The forecast is read-only: in fixed-v1 it
 * must not change what the attack rolls.
 */
export function openForecast(ctx, times = 1) {
  const { scene, attacker, defender } = ctx;
  let forecast = null;
  for (let i = 0; i < times; i++) {
    const prepared = scene._prepareCombatContext(attacker, defender, { isPlayerInitiator: true });
    forecast = scene._computePlayerForecast(attacker, defender, prepared.selectedArt, {
      weapon: scene._forecastWeapon,
      dist: prepared.dist,
      atkTerrain: prepared.atkTerrain,
      defTerrain: prepared.defTerrain,
    });
  }
  return forecast;
}

/**
 * Press Confirm and run the attack to the moment its XP would be awarded.
 * Returns what the attack decided, including the battle RNG cursor.
 */
export async function confirmAttack(ctx) {
  const { scene, commits, hits } = ctx;
  let outcome = null;
  let xpAwards = 0;
  // Stop once resolution is applied: XP, level-ups and unit removal are later
  // paths. executeCombat calls this hook right after the XP award, whether or
  // not the attacker survived.
  scene.awardXP = async () => {
    xpAwards++;
  };
  scene._maybeShowTutorialPermadeathHint = async () => {
    outcome = snapshot(ctx);
    scene.battleState = 'BATTLE_END';
  };
  scene.removeUnit = async () => {};
  let running = null;
  const execute = scene.executeCombat.bind(scene);
  scene.executeCombat = (...args) => (running = execute(...args));
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.map((a) => a?.stack || String(a)).join(' '));
  try {
    scene.confirmForecastCombat();
    await running;
  } finally {
    console.error = originalError;
  }
  if (errors.length) throw new Error(`attack failed: ${errors.join('\n')}`);
  if (!outcome) throw new Error('the attack never reached its XP award');
  return { ...outcome, commits, hits, xpAwards };
}

function snapshot({ scene, attacker, defender }) {
  const side = (u) => ({
    hp: u.currentHP,
    at: [u.col, u.row],
    weapon: u.weapon?.uid || null,
    stats: { ...u.stats },
    conditions: structuredClone(u._conditions || []),
    deltas: structuredClone(u._battleDeltas || null),
    miracle: Boolean(u._miracleUsed),
    arts: structuredClone(u._battleWeaponArtUsage?.map || null),
  });
  return {
    attacker: side(attacker),
    defender: side(defender),
    cursor: scene._battleRng.getState().cursor,
    facts: [...(scene._timelineFacts || [])],
  };
}
