// A fixed Entity splash board for tests/EntitySplashStep.test.js: the scene's splash run on
// it under a seeded battle stream, summarised as one line per seed. The golden lines in that
// test were captured from BattleScene._applyEntitySplash before the splash moved into
// engine/EntitySystem.js (rollSplashTiles + rollSplashDamage inline in the scene), so the
// moved step is held to the very draws, damage and falls the scene made before.
import { vi } from 'vitest';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { presentationFailureProxy as rendering } from './harness/PresentationFailureProxy.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { registerBattleEntity } from '../src/engine/BattleEntityIdentity.js';
import { createBattleBlessings } from '../src/engine/BattleBlessings.js';

const body = { HP: 30, STR: 12, MAG: 0, SKL: 9, SPD: 9, DEF: 7, RES: 3, LCK: 5, MOV: 5 };

export function splashUnit(name, faction, col, row, hp, extra = {}) {
  return {
    name,
    level: 5,
    tier: 'base',
    faction,
    col,
    row,
    xp: 0,
    currentHP: hp,
    stats: { ...body, HP: 40 },
    moveType: 'Infantry',
    className: 'Myrmidon',
    weapon: null,
    inventory: [],
    skills: [],
    accessory: null,
    affixes: [],
    ...extra,
  };
}

/**
 * The boards: the Entity's 3x3 body at (1..3, 3..5) on a 9x9 map.
 *  - 'flank': the target at (4,4), its west neighbour is the body (3 candidates); an ally,
 *    a green unit and a foe (never splashed, never a draw) on them.
 *  - 'open': the target at (6,6), four allies around it, two of them frail.
 *  - 'corner': the target at (0,0) (2 candidates, both allies; one frail).
 *  - 'banner': 'open' with the Unbroken Banner held: the first lethal splash is held at 1.
 */
export function splashBoard(kind) {
  const entity = splashUnit('The Entity', 'enemy', 1, 3, 200, { isEntity: true, isBoss: true });
  const edric = { isCommander: true, isLord: true };
  const boards = {
    flank: () => ({
      target: splashUnit('Edric', 'player', 4, 4, 40, edric),
      others: [
        splashUnit('Ally', 'player', 4, 3, 6),
        splashUnit('Green', 'npc', 5, 4, 20),
        splashUnit('Foe', 'enemy', 4, 5, 20),
      ],
    }),
    open: () => ({
      target: splashUnit('Edric', 'player', 6, 6, 40, edric),
      others: [
        splashUnit('North', 'player', 6, 5, 7),
        splashUnit('East', 'player', 7, 6, 30),
        splashUnit('South', 'player', 6, 7, 9),
        splashUnit('West', 'player', 5, 6, 30),
      ],
    }),
    corner: () => ({
      target: splashUnit('Edric', 'player', 0, 0, 40, edric),
      others: [splashUnit('Right', 'player', 1, 0, 6), splashUnit('Below', 'player', 0, 1, 30)],
    }),
  };
  const { target, others } = boards[kind === 'banner' ? 'open' : kind]();
  const blessings = kind === 'banner' ? createBattleBlessings({ lastStand: 1 }) : null;
  return { entity, target, others, blessings };
}

/** A scene holding `board`, its splash run under `seed`; returns the summary line. */
export async function sceneSplashLine(kind, seed, { config = {} } = {}) {
  const { entity, target, others, blessings } = splashBoard(kind);
  const scene = journeyBattleScene({}, {});
  scene.runManager = null;
  scene._battleRewindPolicy = 'legacy-v1';
  Object.assign(scene.grid, {
    cols: 9,
    rows: 9,
    fogEnabled: false,
    clearTemporaryTerrainsBySource: () => {},
  });
  scene.battleConfig = { objective: 'rout', ...config };
  scene.gameData = { affixes: [], dialogue: {}, deeds: null };
  const all = [entity, target, ...others];
  scene.playerUnits = all.filter((u) => u.faction === 'player');
  scene.enemyUnits = all.filter((u) => u.faction === 'enemy');
  scene.npcUnits = all.filter((u) => u.faction === 'npc');
  scene._battleBlessings = blessings;
  for (const u of all) registerBattleEntity(scene, u);
  rendering(scene, 0);
  scene.sys = { isActive: () => true };
  scene.scene = { isActive: () => true };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const removed = [];
  const realRemove = scene.removeUnit.bind(scene);
  scene.removeUnit = async (unit, options) => {
    removed.push(`${unit.name}<${options?.killer?.name ?? '-'}`);
    return realRemove(unit, options);
  };
  const stream = createBattleRng(seed);
  let draws = 0;
  const prev = Math.random;
  Math.random = () => {
    draws++;
    return stream();
  };
  try {
    await scene._applyEntitySplash(entity, target);
  } finally {
    Math.random = prev;
  }
  const hp = all.map((u) => `${u.name}:${u.currentHP}`).join(',');
  const spent = blessings ? `|spent:${blessings.spent.join('+') || '-'}` : '';
  return `d${draws}|${hp}|rm:${removed.join('+') || '-'}${spent}|next:${stream().toFixed(6)}`;
}
