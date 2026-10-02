// Hold-position garrisons on seize and escape maps (docs/specs/dusk-pressure.md §2b,
// engine/HoldActivation.js). Ways it can go wrong, one test each:
//   - the wrong enemies hold (share, nearest the objective, a lone holder, the boss, the
//     exit half), First Light gets them, or assigning them moves the map;
//   - a holder sleeps through a player inside its Danger tiles, or wakes outside them;
//   - one woken member leaves its pack asleep;
//   - a fogged holder wakes from a zone the player cannot see, or a hidden unit changes
//     the zone (PlayerKnowledge);
//   - a blow, a status or a shove leaves it asleep;
//   - anti-turtle aggression releases holders, or boss enrage does not;
//   - a resume, a locked map or an old save changes who holds; arrivals copy a hold;
//   - the seize par offset is not locked with the map.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { generateBattle } from '../src/engine/MapGenerator.js';
import { resolveDifficultyMode, validateDifficultyConfig } from '../src/engine/DifficultyEngine.js';
import {
  applyHoldSpawn,
  assignHolders,
  HOLD_PACK_RADIUS,
  wakeHolders,
} from '../src/engine/HoldActivation.js';
import { computeDangerTiles } from '../src/engine/ThreatForecast.js';
import { createPlayerKnowledge } from '../src/engine/PlayerKnowledge.js';
import { AIController } from '../src/engine/AIController.js';
import { buildReinforcementTemplatePool } from '../src/engine/ReinforcementSpawns.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { calculatePar } from '../src/engine/TurnBonusCalculator.js';
import { RunManager } from '../src/engine/RunManager.js';
import { applyCombatSideHP, damageUnit, healUnitFully } from '../src/engine/UnitHealth.js';
import { applyCondition, clearAllConditions } from '../src/engine/StatusConditionSystem.js';
import { settleMoves } from '../src/engine/ActionMovement.js';
import { HeadlessGrid } from './harness/HeadlessGrid.js';
import { HeadlessBattle, HEADLESS_STATES } from './harness/HeadlessBattle.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const T = Object.fromEntries(data.terrain.map((t, i) => [t.name, i]));
const manhattan = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);

afterEach(() => restoreMathRandom());

// The owner's shares, written out by hand (spec §2b).
const SHARES = {
  dusk: { seize: 0.35, escape: 0.3 },
  hard: { seize: 0.45, escape: 0.4 },
  lunatic: { seize: 0.55, escape: 0.5 },
};

function pacing(difficultyId) {
  const m = resolveDifficultyMode(data.difficulty, difficultyId).modifiers;
  return {
    difficultyId,
    holdShare: m.holdShare,
    objectiveParOffset: m.objectiveParOffset,
  };
}

function gen(params, seed) {
  installSeed(seed);
  try {
    return generateBattle({ deployCount: 5, ...params }, data);
  } finally {
    restoreMathRandom();
  }
}

describe('who holds', () => {
  it('the rung share of the garrison, nearest the throne, in packs of two or more', () => {
    for (const [rung, shares] of Object.entries(SHARES)) {
      for (const act of ['act2', 'act3']) {
        for (let seed = 1; seed <= 6; seed++) {
          const bc = gen({ act, objective: 'seize', ...pacing(rung) }, seed);
          const label = `${rung} ${act} seed ${seed}`;
          const nonBoss = bc.enemySpawns.filter((s) => !s.isBoss);
          const holders = nonBoss.filter((s) => s.aiMode === 'hold');
          const target = Math.round(shares.seize * nonBoss.length);
          expect(holders.length, label).toBeLessThanOrEqual(target + 1);
          expect(bc.enemySpawns.find((s) => s.isBoss)?.aiMode, label).not.toBe('hold');
          expect(
            nonBoss.some((s) => s.aiMode === 'guard'),
            label,
          ).toBe(false);
          // No holder stands alone; a pack is linked by holders within 3 tiles.
          for (const h of holders) {
            const mates = holders.filter((o) => o !== h && manhattan(o, h) <= HOLD_PACK_RADIUS);
            expect(mates.length, label).toBeGreaterThan(0);
            expect(
              mates.every((m) => m.holdPack === h.holdPack),
              label,
            ).toBe(true);
            // Each holder knows how many stood in its pack at spawn.
            expect(h.holdPackSize, label).toBe(
              holders.filter((o) => o.holdPack === h.holdPack).length,
            );
          }
          // The nearest candidate with a partner within 3 always holds.
          const eligible = nonBoss.filter((x) => x.aiMode !== 'heal');
          const firstPaired = [...eligible]
            .sort(
              (a, b) =>
                manhattan(a, bc.thronePos) - manhattan(b, bc.thronePos) ||
                a.col - b.col ||
                a.row - b.row,
            )
            .find((x) => eligible.some((o) => o !== x && manhattan(o, x) <= HOLD_PACK_RADIUS));
          if (target >= 2 && firstPaired) expect(firstPaired.aiMode, label).toBe('hold');
          // Holders are the nearest the throne: any closer non-holder had no partner.
          const far = Math.max(-1, ...holders.map((h) => manhattan(h, bc.thronePos)));
          for (const s of nonBoss.filter((x) => x.aiMode !== 'hold' && x.aiMode !== 'heal')) {
            if (manhattan(s, bc.thronePos) >= far) continue;
            const partners = nonBoss.filter(
              (o) => o !== s && o.aiMode !== 'heal' && manhattan(o, s) <= HOLD_PACK_RADIUS,
            );
            expect(
              holders.length >= target || partners.length === 0,
              `${label}: (${s.col},${s.row}) skipped`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('on escape maps, holders stand in the exit half', () => {
    let seen = 0;
    for (const rung of Object.keys(SHARES)) {
      for (let seed = 1; seed <= 6; seed++) {
        const bc = gen({ act: 'act2', objective: 'escape', ...pacing(rung) }, seed);
        const exit = bc.escapeTiles.reduce((a, t) => a + t.col, 0) / bc.escapeTiles.length;
        const start = bc.playerSpawns.reduce((a, t) => a + t.col, 0) / bc.playerSpawns.length;
        const mid = (exit + start) / 2;
        for (const h of bc.enemySpawns.filter((s) => s.aiMode === 'hold')) {
          seen++;
          expect(exit > start ? h.col >= mid : h.col <= mid).toBe(true);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('First Light keeps its guards and has no holders; no rung draws the map differently', () => {
    let keptGuards = 0;
    let replacedGuards = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const fl = gen({ act: 'act2', objective: 'seize', ...pacing('normal') }, seed);
      expect(fl.enemySpawns.some((s) => s.aiMode === 'hold')).toBe(false);
      const before = gen({ act: 'act2', objective: 'seize', difficultyId: 'normal' }, seed);
      expect(fl).toEqual(before);
    }
    // The run's own battle params (Act I caps the garrison by the deploy count, so some
    // Dusk Act I maps are too small for a pack).
    for (const act of ['act1', 'act2']) {
      for (let seed = 1; seed <= 12; seed++) {
        for (const rung of Object.keys(SHARES)) {
          const label = `${rung} ${act} seed ${seed}`;
          const params = {
            ...resolveDifficultyMode(data.difficulty, rung).modifiers,
            difficultyId: rung,
            act,
            objective: 'seize',
            deployCount: 6,
            row: 5,
          };
          const now = gen(params, seed);
          const old = gen({ ...params, holdShare: null }, seed);
          expect(now.mapLayout, label).toEqual(old.mapLayout);
          const oldGuards = old.enemySpawns.filter((s) => s.aiMode === 'guard').length;
          if (!now.enemySpawns.some((s) => s.aiMode === 'hold')) {
            // No pack formed: the garrison is exactly the one the rung drew before, guards
            // and all (a map with neither holders nor guards would be softer than First Light).
            expect(now.enemySpawns, label).toEqual(old.enemySpawns);
            if (oldGuards) keptGuards++;
            continue;
          }
          // Holds replace guards; nothing else about the garrison changes.
          expect(
            now.enemySpawns.some((s) => s.aiMode === 'guard'),
            label,
          ).toBe(false);
          if (oldGuards) replacedGuards++;
          const strip = (spawns) =>
            spawns.map(({ aiMode, holdPack: _pack, holdPackSize: _size, ...rest }) => ({
              ...rest,
              aiMode: aiMode === 'hold' || aiMode === 'guard' ? undefined : aiMode,
            }));
          expect(strip(now.enemySpawns), label).toEqual(strip(old.enemySpawns));
        }
      }
    }
    // Both branches ran: some maps kept their guards, some traded them for holds.
    expect(keptGuards).toBeGreaterThan(0);
    expect(replacedGuards).toBeGreaterThan(0);
  });

  it('escape: only enemies in the exit half count, and only they hold', () => {
    // Players start west (col 0), the exits are east (col 12): the exit half is col >= 6.
    const spawns = [
      { className: 'Fighter', col: 8, row: 0 },
      { className: 'Fighter', col: 8, row: 9 },
      { className: 'Fighter', col: 4, row: 4 }, // player half, a close pair
      { className: 'Fighter', col: 4, row: 5 },
    ];
    const n = assignHolders({
      spawns,
      objective: 'escape',
      share: 1,
      escapeTiles: [{ col: 12, row: 4 }],
      playerSpawns: [{ col: 0, row: 4 }],
    });
    // The two exit-half enemies stand 9 apart: no pack. The pair is in the player half.
    expect(n).toBe(0);
    expect(spawns.every((sp) => sp.aiMode === undefined)).toBe(true);
  });

  it('a lone candidate never holds; a share too small for a pair assigns none', () => {
    const spawns = [
      { className: 'Fighter', col: 10, row: 0 },
      { className: 'Fighter', col: 0, row: 9 },
      { className: 'Fighter', col: 1, row: 9 },
    ];
    assignHolders({ spawns, objective: 'seize', share: 0.5, thronePos: { col: 10, row: 1 } });
    // Target 2: the nearest has no partner within 3, so the pair behind it holds.
    expect(spawns.map((s) => s.aiMode || null)).toEqual([null, 'hold', 'hold']);
    const few = [{ col: 1, row: 1 }, { col: 2, row: 1 }]; // prettier-ignore
    expect(assignHolders({ spawns: few, objective: 'seize', share: 0.3, thronePos: { col: 0, row: 0 } })).toBe(0); // prettier-ignore
  });
});

// A small open field: holder pack at the east, a player walking in from the west.
function field({ fog = false, width = 14, height = 7 } = {}) {
  const layout = Array.from({ length: height }, () => Array(width).fill(T.Plain));
  const grid = new HeadlessGrid(width, height, data.terrain, layout, fog);
  const lance = data.weapons.find((w) => w.name === 'Iron Lance');
  const foe = (name, col, row, pack = 0) =>
    applyHoldSpawn(
      {
        name,
        faction: 'enemy',
        className: 'Soldier',
        col,
        row,
        currentHP: 20,
        stats: { HP: 20, MOV: 4 },
        mov: 4,
        moveType: 'Infantry',
        weapon: structuredClone(lance),
        inventory: [],
        skills: [],
      },
      { aiMode: 'hold', holdPack: pack, holdPackSize: 2 },
    );
  const enemies = [foe('A', 11, 3), foe('B', 13, 3)];
  const hero = { name: 'Hero', faction: 'player', col: 0, row: 3, currentHP: 20, stats: { HP: 20 } }; // prettier-ignore
  const ctxFor = (playerUnits, extraUnits = []) => {
    const knowledge = createPlayerKnowledge({
      grid,
      units: [...playerUnits, ...enemies, ...extraUnits],
    });
    return {
      grid,
      enemyUnits: [...enemies, ...extraUnits.filter((u) => u.faction === 'enemy')],
      ballistas: [],
      positions: () => knowledge.positions(),
    };
  };
  const wake = (playerUnits, opts = {}) => {
    if (fog) grid.updateFogOfWar(playerUnits);
    return wakeHolders({
      enemyUnits: enemies,
      playerUnits,
      threatContext: ctxFor(playerUnits, opts.extra || []),
      bossEnraged: opts.enraged === true,
    });
  };
  return { grid, enemies, hero, wake, ctxFor };
}

// A counter that hits B for 5, then B's counter drains it back to full.
function drainCombat(unit) {
  return {
    events: [
      { type: 'strike', attackerSide: 'attacker', targetHPAfter: unit.currentHP - 5 },
      { type: 'strike', attackerSide: 'defender', strikerHealTo: unit.currentHP, heal: 5 },
    ],
    attackerHP: 20,
    defenderHP: unit.currentHP,
  };
}

describe('when a pack wakes', () => {
  it("red zone = wake zone: inside A's Danger tiles wakes the whole pack, outside does not", () => {
    const probe = field();
    const danger = new Set(
      computeDangerTiles(probe.ctxFor([probe.hero]), { onlyEnemy: probe.enemies[0] })
        .filter((t) => t.damageThreat)
        .map((t) => `${t.col},${t.row}`),
    );
    expect(danger.size).toBeGreaterThan(0);
    let inside = 0;
    for (let col = 0; col < 11; col++) {
      for (let row = 0; row < 7; row++) {
        const f = field();
        const hero = { ...f.hero, col, row };
        const woken = f.wake([hero]);
        const inZone = danger.has(`${col},${row}`) || manhattan(hero, f.enemies[1]) <= 5;
        if (danger.has(`${col},${row}`)) {
          inside++;
          expect(woken.map((w) => w.unit.name).sort(), `${col},${row}`).toEqual(['A', 'B']);
        } else if (!inZone) {
          expect(woken, `${col},${row}`).toEqual([]);
        }
      }
    }
    expect(inside).toBeGreaterThan(0);
  });

  it('a fogged holder ignores the zone until the player sees it', () => {
    const f = field({ fog: true });
    // Eight tiles west of A: inside its 4 + 1 reach only when A is seen.
    const scout = { ...f.hero, col: 6, row: 3, moveType: 'Infantry' };
    // Infantry sees 3 tiles: A at 11 is hidden.
    expect(f.wake([scout])).toEqual([]);
    expect(f.enemies.every((e) => e.aiMode === 'hold')).toBe(true);
    const flier = { ...scout, moveType: 'Flying' }; // sees farther
    f.grid.updateFogOfWar([flier]);
    const seesA = f.grid.isVisible(11, 3);
    const woken = f.wake([flier]);
    expect(woken.length > 0).toBe(seesA);
  });

  it('a unit the player cannot see never changes the zone (PlayerKnowledge)', () => {
    // A (Soldier, 4 moves, lance) reaches the hero at (6,3) only by stopping on (7,3).
    // A fogged enemy stands on (7,3): in the world A could not stop there, but the
    // player cannot know that, so the red zone, and the wake, ignore it.
    const f = field({ fog: true });
    const hidden = { name: 'Hidden', faction: 'enemy', col: 7, row: 3, currentHP: 10, stats: { HP: 10 } }; // prettier-ignore
    f.grid.visibleSet = new Set();
    for (let c = 0; c < 14; c++) for (let r = 0; r < 7; r++) f.grid.visibleSet.add(`${c},${r}`);
    f.grid.visibleSet.delete('7,3');
    const hero = { ...f.hero, col: 6, row: 3 };
    const knowledge = createPlayerKnowledge({ grid: f.grid, units: [hero, ...f.enemies, hidden] });
    const woken = wakeHolders({
      enemyUnits: f.enemies,
      playerUnits: [hero],
      threatContext: {
        grid: f.grid,
        enemyUnits: f.enemies,
        positions: () => knowledge.positions(),
      },
    });
    expect(woken.map((w) => w.unit.name).sort()).toEqual(['A', 'B']);
  });

  it('a blow, a status or a shove wakes the pack, even once healed or cured', () => {
    // Each disturbance goes through the hook the game uses (combat and area blows set HP
    // through UnitHealth, staves and arts apply conditions, shoves settle moves), then the
    // evidence is erased before the enemy phase checks, as a fort, Renewal, Regenerator
    // or status recovery would. The pack still wakes.
    const B = (f) => f.enemies[1];
    const cases = [
      ['hurt', (f) => damageUnit(B(f), 1), (f) => healUnitFully(B(f))],
      [
        'hurt',
        (f) => applyCombatSideHP(B(f), 'defender', drainCombat(B(f))),
        () => {}, // a counter that drained back to full in the same exchange
      ],
      ['status', (f) => applyCondition(B(f), 'silence', 2), (f) => clearAllConditions(B(f))],
      [
        'moved',
        (f) => settleMoves([{ unit: B(f), to: { col: 12, row: 3 } }]),
        (f) => settleMoves([{ unit: B(f), to: { col: 13, row: 3 } }]),
      ],
    ];
    for (const [reason, disturb, erase] of cases) {
      const f = field();
      disturb(f);
      erase(f);
      expect(B(f).currentHP).toBe(20);
      expect(B(f)._conditions || []).toEqual([]);
      expect({ col: B(f).col, row: B(f).row }).toEqual(B(f).holdPost);
      const woken = f.wake([f.hero]);
      expect(woken.map((w) => w.unit.name).sort(), reason).toEqual(['A', 'B']);
      expect(woken.every((w) => w.reason === reason)).toBe(true);
    }
    // A holder that starts below full HP was never struck: it stays.
    const quiet = field();
    quiet.enemies[1].currentHP = 15;
    expect(quiet.wake([quiet.hero])).toEqual([]);
  });

  it('a fallen packmate wakes the rest: no picking a pack off one unit at a time', () => {
    // Killed out of reach of the others' zones (a Canto rider, a Breachbolt, a ballista):
    // gone from the board, or still on it at 0 HP while it falls.
    for (const fall of [(f) => f.enemies.pop(), (f) => (f.enemies[1].currentHP = 0)]) {
      const f = field();
      fall(f);
      const woken = f.wake([f.hero]);
      expect(woken.map((w) => [w.unit.name, w.reason])).toEqual([['A', 'fallen']]);
      expect(f.enemies[0].aiMode).toBeUndefined();
    }
    // A whole pack stays asleep; so does a pack beside one that lost a member.
    const f = field();
    expect(f.wake([f.hero])).toEqual([]);
    const other = applyHoldSpawn(
      { ...structuredClone(f.enemies[0]), name: 'C', col: 12, row: 0, aiMode: undefined },
      { aiMode: 'hold', holdPack: 1, holdPackSize: 2 },
    );
    f.enemies.push(other);
    expect(f.wake([f.hero]).map((w) => w.unit.name)).toEqual(['C']);
    expect(f.enemies.slice(0, 2).every((e) => e.aiMode === 'hold')).toBe(true);
  });

  it('a holder keeps its pack size through a snapshot', () => {
    const f = field();
    const copy = JSON.parse(JSON.stringify(serializeBattleUnit(f.enemies[0])));
    expect(copy.holdPackSize).toBe(2);
  });

  it('boss enrage wakes every pack; anti-turtle aggression wakes none', async () => {
    const f = field();
    const ai = new AIController(f.grid, data, { objective: 'seize' });
    ai._delay = () => Promise.resolve();
    ai.setHoldContext(() => f.ctxFor([f.hero]));
    ai.setAggressiveMode(true);
    const reasons = [];
    const callbacks = {
      onDecision: (_e, d) => reasons.push(d.reason),
      onMoveUnit: async () => {},
      onAttack: async () => {},
      onUnitDone: async (e) => (e.hasActed = true),
    };
    await ai.processEnemyPhase(f.enemies, [f.hero], [], callbacks);
    expect(reasons).toEqual(['hold', 'hold']);
    expect(f.enemies.every((e) => e.col === e.holdPost.col && e.row === e.holdPost.row)).toBe(true);
    for (const e of f.enemies) e.hasActed = false;
    ai.setBossEnraged(true);
    reasons.length = 0;
    await ai.processEnemyPhase(f.enemies, [f.hero], [], callbacks);
    expect(reasons).not.toContain('hold');
    expect(f.enemies.every((e) => e.holdWoke === 'enrage')).toBe(true);
  });

  it('a holder survives a snapshot round trip and keeps its post', () => {
    const f = field();
    const copy = JSON.parse(JSON.stringify(serializeBattleUnit(f.enemies[0])));
    expect(copy).toMatchObject({ aiMode: 'hold', holdPack: 0, holdPost: { col: 11, row: 3 } });
  });
});

describe('in a battle (headless harness, as the scene)', () => {
  function seizeBattle(rung, seed) {
    installSeed(seed);
    const battle = new HeadlessBattle(data, {
      act: 'act2',
      objective: 'seize',
      battleSeed: 500 + seed,
      deployCount: 5,
      ...pacing(rung),
    });
    battle.init();
    restoreMathRandom();
    return battle;
  }

  it('holders stand their posts through an enemy phase the player stays out of', async () => {
    let checked = 0;
    for (let seed = 1; seed <= 8 && checked < 3; seed++) {
      const battle = seizeBattle('hard', seed);
      const holders = battle.enemyUnits.filter((e) => e.aiMode === 'hold');
      if (!holders.length) continue;
      // As BattleScene.addEnemyFromSpawn: each holder knows its pack and its post.
      for (const h of holders) {
        expect(Number.isInteger(h.holdPack)).toBe(true);
        expect(h.holdPackSize).toBe(holders.filter((o) => o.holdPack === h.holdPack).length);
        expect(h.holdPost).toEqual({ col: h.col, row: h.row });
      }
      // Keep the player far: back to the spawn corner, out of every reach.
      const posts = holders.map((h) => ({ col: h.col, row: h.row }));
      battle.turnManager.currentPhase = 'enemy';
      battle.battleState = HEADLESS_STATES.ENEMY_PHASE;
      const zone = new Set(
        holders.flatMap((h) =>
          computeDangerTiles(battle._playerThreatContext(), { onlyEnemy: h }).map(
            (t) => `${t.col},${t.row}`,
          ),
        ),
      );
      if (battle.playerUnits.some((u) => zone.has(`${u.col},${u.row}`))) continue;
      await battle._processEnemyPhase();
      const awake = holders.filter((h) => h.currentHP > 0 && h.aiMode !== 'hold');
      if (awake.length) continue; // a stray blow can wake one; this seed proves nothing
      expect(holders.map((h) => ({ col: h.col, row: h.row }))).toEqual(posts);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("the harness wakes holders on the player's board: fogged units are not in it", () => {
    const battle = seizeBattle('hard', 2);
    battle.grid.fogEnabled = true;
    battle.grid.visibleSet = new Set(battle.playerUnits.map((u) => `${u.col},${u.row}`));
    const keys = [...battle._playerThreatContext().positions().keys()];
    expect(keys.sort()).toEqual(battle.playerUnits.map((u) => `${u.col},${u.row}`).sort());
  });

  it('reinforcements never copy a hold', () => {
    const templates = buildReinforcementTemplatePool({
      battleConfig: {
        enemySpawns: [
          { className: 'Fighter', level: 5, col: 1, row: 1, aiMode: 'hold', holdPack: 0 },
          { className: 'Fighter', level: 6, col: 2, row: 1, aiMode: 'guard' },
        ],
      },
      battleParams: { act: 'act2', difficultyId: 'hard' },
      gameData: data,
    });
    expect(templates.map((t) => t.aiMode)).toEqual([null, 'guard']);
  });
});

describe('locked maps, saves and par', () => {
  it('a Dusk run hands its shares and seize offset to new maps; a save from before holds none', () => {
    const rm = new RunManager(data);
    rm.startRun({ difficultyId: 'dusk', applyBlessingsAtStart: false });
    const node = rm.nodeMap.nodes.find((n) => n.battleParams);
    const params = rm.getBattleParams(node);
    expect(params.holdShare).toEqual(SHARES.dusk);
    expect(params.objectiveParOffset).toEqual(data.difficulty.modes.dusk.objectiveParOffset);
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    delete saved.difficultyModifiers.holdShare;
    delete saved.difficultyModifiers.objectiveParOffset;
    const old = RunManager.fromJSON(saved, data).getBattleParams(node);
    expect(old.holdShare).toBeNull();
    const bc = gen({ ...old, act: 'act2', objective: 'seize' }, 4);
    expect(bc.enemySpawns.some((s) => s.aiMode === 'hold')).toBe(false);
    expect(bc.parOffset).toBeUndefined();
  });

  it('a locked map keeps its holders and par offset', () => {
    const rm = new RunManager(data);
    rm.startRun({ difficultyId: 'hard', applyBlessingsAtStart: false });
    const node = rm.nodeMap.nodes.find((n) => n.battleParams);
    const bc = gen(
      { ...rm.getBattleParams(node), act: 'act2', objective: 'seize', objectiveParOffset: { seize: -2 } },
      7,
    ); // prettier-ignore
    expect(bc.parOffset).toBe(-2);
    rm.lockBattleConfig(node.id, bc);
    const back = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    const locked = back.getLockedBattleConfig(node.id);
    expect(locked.parOffset).toBe(-2);
    expect(locked.enemySpawns.filter((s) => s.aiMode === 'hold')).toEqual(
      bc.enemySpawns.filter((s) => s.aiMode === 'hold'),
    );
  });

  it('difficulty data: shares and offsets per rung validate, bad shapes do not', () => {
    expect(validateDifficultyConfig(data.difficulty)).toEqual({ valid: true, errors: [] });
    const m = data.difficulty.modes;
    expect(m.normal.holdShare).toBeNull();
    expect(m.normal.objectiveParOffset).toBeNull();
    for (const [rung, shares] of Object.entries(SHARES)) expect(m[rung].holdShare).toEqual(shares);
    const bad = structuredClone(data.difficulty);
    bad.modes.dusk.holdShare = { seize: 1.5, rout: 0.2 };
    bad.modes.hard.objectiveParOffset = { seize: 0.5 };
    const errors = validateDifficultyConfig(bad).errors.join('\n');
    expect(errors).toMatch(/dusk\.holdShare\.seize must be a share/);
    expect(errors).toMatch(/dusk\.holdShare\.rout is not a seize\/escape objective/);
    expect(errors).toMatch(/hard\.objectiveParOffset\.seize must be an integer/);
  });

  it('par takes the locked offset, never below 1', () => {
    const map = { cols: 12, rows: 10, enemyCount: 8, objective: 'seize', mapLayout: [], terrainData: data.terrain }; // prettier-ignore
    const base = calculatePar(map, data.turnBonus, 'hard');
    expect(calculatePar({ ...map, parOffset: -2 }, data.turnBonus, 'hard')).toBe(base - 2);
    expect(calculatePar({ ...map, parOffset: -99 }, data.turnBonus, 'hard')).toBe(1);
    expect(calculatePar({ ...map, parOffset: undefined }, data.turnBonus, 'hard')).toBe(base);
  });
});
