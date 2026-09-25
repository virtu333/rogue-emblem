// Deterministic late-game battle used to measure rewind history budgets.
// Real classes, weapons, consumables and the production capture/preview code;
// only the "game" (who moves where, who takes damage) is scripted.
import { createUnit, createEnemyUnit } from '../../src/engine/UnitManager.js';
import { captureBattleState } from '../../src/ui/BattleCheckpointAdapter.js';
import { battleTimelinePreview } from '../../src/engine/BattleTimelineFacts.js';
import { createBattleRng } from '../../src/engine/BattleRng.js';

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {object} data loadGameData()
 * @param {{ cols?, rows?, players?, reserves?, enemies?, fog?, seed?, policy? }} options
 */
export function createRewindBattleSim(data, options = {}) {
  const {
    cols = 18,
    rows = 13,
    players = 6,
    reserves = 6,
    enemies = 13,
    fog = true,
    seed = 7,
    policy = 'fixed-v1',
  } = options;
  const roll = mulberry(seed);
  const pick = (list) => list[Math.floor(roll() * list.length)];
  const realMathRandom = Math.random;
  Math.random = roll; // unit factories roll growths; keep the fixture deterministic
  try {
    const promoted = data.classes.filter((c) => c.growthRanges && c.weaponProficiencies);
    const base = promoted;
    const weapons = data.weapons.filter((w) => w.type !== 'Scroll' && w.price > 0);
    const consumables = data.consumables.filter((c) => c.price > 0);
    let nextId = 1;
    const identify = (unit) => Object.assign(unit, { battleEntityId: `u${nextId++}` });
    const makePlayer = (index, deployed) => {
      const unit = createUnit(pick(promoted), 12 + (index % 6), data.weapons, {
        name: `Hero ${index}`,
      });
      unit.inventory = [...(unit.inventory || [])];
      while (unit.inventory.length < 5)
        unit.inventory.push({
          ...structuredClone(pick(weapons)),
          uid: `w${index}-${unit.inventory.length}`,
        });
      unit.weapon = unit.inventory[0];
      unit.consumables = Array.from({ length: 3 }, (_, i) => ({
        ...structuredClone(pick(consumables)),
        uid: `c${index}-${i}`,
      }));
      unit.accessory = structuredClone(pick(data.accessories));
      unit.skills = [...(unit.skills || []), 'canto', 'vantage'].slice(0, 5);
      unit.faction = 'player';
      unit.col = deployed ? index % 3 : 0;
      unit.row = deployed ? Math.floor(index / 3) + 4 : 0;
      unit.isCommander = index === 0;
      return identify(unit);
    };
    const scene = {
      playerUnits: Array.from({ length: players }, (_, i) => makePlayer(i, true)),
      nonDeployedUnits: Array.from({ length: reserves }, (_, i) => makePlayer(players + i, false)),
      escapedUnits: [],
      npcUnits: [],
      enemyUnits: [],
      _battleRewindPolicy: policy,
      turnManager: { currentPhase: 'player', turnNumber: 1 },
      grid: {
        fogEnabled: fog,
        visibleSet: new Set(),
        everSeenSet: new Set(),
        mapLayout: Array.from({ length: rows }, () =>
          Array.from({ length: cols }, () => pick([0, 0, 0, 1, 1, 2, 3, 5])),
        ),
        temporaryTerrains: [],
      },
      runManager: {
        convoy: {
          weapons: Array.from({ length: 12 }, () => structuredClone(pick(weapons))),
          consumables: Array.from({ length: 6 }, () => structuredClone(pick(consumables))),
        },
        accessories: Array.from({ length: 4 }, () => structuredClone(pick(data.accessories))),
        gold: 4200,
      },
      goldEarned: 0,
      _nextBattleEntityId: 0,
    };
    for (let i = 0; i < enemies; i++) {
      const enemy = createEnemyUnit(pick(base), 14, data.weapons, 1, data.skills, 'act4');
      Object.assign(enemy, { faction: 'enemy', col: cols - 1 - (i % 4), row: i % rows });
      scene.enemyUnits.push(identify(enemy));
    }
    scene._nextBattleEntityId = nextId;
    const rng = createBattleRng(seed);
    let cursor = seed;
    scene._battleRng = { getState: () => ({ algorithm: 'mulberry32-v1', cursor }) };
    const refreshFog = () => {
      if (!fog) return;
      scene.grid.visibleSet = new Set();
      for (const unit of scene.playerUnits)
        for (let dc = -3; dc <= 3; dc++)
          for (let dr = -3; dr <= 3; dr++) {
            const c = unit.col + dc,
              r = unit.row + dr;
            if (c >= 0 && r >= 0 && c < cols && r < rows) scene.grid.visibleSet.add(`${c},${r}`);
          }
      for (const key of scene.grid.visibleSet) scene.grid.everSeenSet.add(key);
    };
    refreshFog();
    const state = () => captureBattleState(scene, { rngSeed: seed, checkpointIndex: 0 });
    const preview = (s) => battleTimelinePreview(s, data.terrain);
    return {
      scene,
      state,
      preview,
      /** One scripted player action: move, fight, spend a use. */
      playerAct(unit) {
        cursor = (cursor + 7) >>> 0;
        unit.col = Math.min(cols - 1, unit.col + 1 + Math.floor(rng() * 2));
        unit.row = Math.max(0, Math.min(rows - 1, unit.row + (rng() < 0.5 ? -1 : 1)));
        unit.hasMoved = true;
        unit.hasActed = true;
        if (unit.weapon && Number.isFinite(unit.weapon.uses)) unit.weapon.uses -= 1;
        const target = scene.enemyUnits[Math.floor(rng() * scene.enemyUnits.length)];
        if (target) {
          target.currentHP = Math.max(0, target.currentHP - 7);
          unit.currentHP = Math.max(1, unit.currentHP - 3);
          unit.xp = (unit.xp || 0) + 11;
          if (target.currentHP <= 0) {
            scene.enemyUnits.splice(scene.enemyUnits.indexOf(target), 1);
            scene.goldEarned += 150;
          }
        }
        refreshFog();
      },
      enemyAct(enemy) {
        cursor = (cursor + 3) >>> 0;
        enemy.col = Math.max(0, enemy.col - 1);
        const victim = scene.playerUnits[Math.floor(rng() * scene.playerUnits.length)];
        if (victim) victim.currentHP = Math.max(1, victim.currentHP - 2);
      },
      beginPlayerPhase(turn) {
        scene.turnManager.turnNumber = turn;
        scene.turnManager.currentPhase = 'player';
        for (const unit of scene.playerUnits) {
          unit.hasActed = false;
          unit.hasMoved = false;
        }
      },
      beginEnemyPhase() {
        scene.turnManager.currentPhase = 'enemy';
      },
    };
  } finally {
    Math.random = realMathRandom;
  }
}
