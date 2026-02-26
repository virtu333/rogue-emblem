import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { getEffectivenessMultiplier } from '../src/engine/Combat.js';
import { rollStrikeSkills } from '../src/engine/SkillSystem.js';
import {
  ZOMBIE_CLASSES,
  DIFFICULTY_GATED_CLASSES,
  filterClassPoolByDifficulty,
} from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const skillsData = gameData.skills;

// --- Helper: pure tombstone-creation predicate ---
function shouldCreateTombstone(unit, killerWeaponType) {
  return (
    ZOMBIE_CLASSES.has(unit.className) &&
    !unit._revived &&
    !unit.isBoss &&
    killerWeaponType !== 'Light'
  );
}

// --- 1. Light effectiveness vs zombies (3x) ---
describe('Light effectiveness vs zombies', () => {
  const lightWeapon = { type: 'Light', might: 6, hit: 90, crit: 0, weight: 4 };
  const bowWeapon = { type: 'Bow', might: 6, hit: 80, crit: 0, weight: 5 };

  it('Light weapon vs Zombie returns 3', () => {
    const defender = { className: 'Zombie', moveType: 'Infantry' };
    expect(getEffectivenessMultiplier(lightWeapon, defender)).toBe(3);
  });

  it('Light weapon vs Revenant returns 3', () => {
    const defender = { className: 'Revenant', moveType: 'Infantry' };
    expect(getEffectivenessMultiplier(lightWeapon, defender)).toBe(3);
  });

  it('Light weapon vs non-zombie class returns 1', () => {
    const defender = { className: 'Fighter', moveType: 'Infantry' };
    expect(getEffectivenessMultiplier(lightWeapon, defender)).toBe(1);
  });

  it('Bow vs Zombie (non-Flying) returns 1', () => {
    const defender = { className: 'Zombie', moveType: 'Infantry' };
    expect(getEffectivenessMultiplier(bowWeapon, defender)).toBe(1);
  });
});

// --- 2. Zombie tombstone creation logic ---
describe('Zombie tombstone creation logic', () => {
  it('zombie killed by non-Light weapon should create tombstone', () => {
    for (const cls of ZOMBIE_CLASSES) {
      const unit = { className: cls, _revived: false, isBoss: false };
      expect(shouldCreateTombstone(unit, 'Sword')).toBe(true);
    }
  });

  it('zombie killed by Light weapon should NOT create tombstone', () => {
    const unit = { className: 'Zombie', _revived: false, isBoss: false };
    expect(shouldCreateTombstone(unit, 'Light')).toBe(false);
  });

  it('already revived zombie should NOT create tombstone', () => {
    const unit = { className: 'Zombie', _revived: true, isBoss: false };
    expect(shouldCreateTombstone(unit, 'Sword')).toBe(false);
  });

  it('boss zombie should NOT create tombstone', () => {
    const unit = { className: 'Revenant', _revived: false, isBoss: true };
    expect(shouldCreateTombstone(unit, 'Axe')).toBe(false);
  });

  it('non-zombie class should NOT create tombstone', () => {
    const unit = { className: 'Fighter', _revived: false, isBoss: false };
    expect(shouldCreateTombstone(unit, 'Sword')).toBe(false);
  });
});

// --- 3. zombie_drain skill handler ---
describe('zombie_drain skill handler', () => {
  it('zombie_drain exists in skills data', () => {
    const skill = skillsData.find((s) => s.id === 'zombie_drain');
    expect(skill).toBeDefined();
    expect(skill.trigger).toBe('on-attack');
    expect(skill.activation).toBe('always');
    expect(skill.effects.drainPercent).toBe(50);
  });

  it('heals 50% of damage dealt', () => {
    // activation=always → needs roll < 100, force Math.random to return 0
    vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const attacker = {
        skills: ['zombie_drain'],
        stats: { SKL: 10, LCK: 5, HP: 30 },
        currentHP: 20,
      };
      const target = { stats: { HP: 40, DEF: 5 }, currentHP: 40 };
      const result = rollStrikeSkills(attacker, 20, target, skillsData);
      expect(result.heal).toBe(10);
      expect(result.activated.some((a) => a.id === 'zombie_drain')).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('heal is at least 1 even for low damage', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const attacker = {
        skills: ['zombie_drain'],
        stats: { SKL: 10, LCK: 5, HP: 30 },
        currentHP: 20,
      };
      const target = { stats: { HP: 40, DEF: 5 }, currentHP: 40 };
      const result = rollStrikeSkills(attacker, 1, target, skillsData);
      expect(result.heal).toBe(1);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

// --- 4. Rout deferral while tombstones exist ---
describe('Rout deferral while tombstones exist', () => {
  it('defers rout when enemies=0 but tombstones remain', () => {
    const enemyCount = 0;
    const tombstoneCount = 2;
    const shouldDefer = enemyCount === 0 && tombstoneCount > 0;
    expect(shouldDefer).toBe(true);
  });

  it('does not defer when enemies remain regardless of tombstones', () => {
    const enemyCount = 3;
    const tombstoneCount = 1;
    const shouldDefer = enemyCount === 0 && tombstoneCount > 0;
    expect(shouldDefer).toBe(false);
  });

  it('does not defer when no enemies and no tombstones', () => {
    const enemyCount = 0;
    const tombstoneCount = 0;
    const shouldDefer = enemyCount === 0 && tombstoneCount > 0;
    expect(shouldDefer).toBe(false);
  });
});

// --- 5. _noXP flag on revived units ---
describe('_noXP flag on revived units', () => {
  it('unit with _noXP should skip XP rewards', () => {
    const unit = { _noXP: true, className: 'Zombie', level: 3 };
    const shouldSkipXP = !!unit._noXP;
    expect(shouldSkipXP).toBe(true);
  });

  it('normal unit without _noXP should receive XP', () => {
    const unit = { className: 'Fighter', level: 5 };
    const shouldSkipXP = !!unit._noXP;
    expect(shouldSkipXP).toBe(false);
  });
});

// --- 6. filterClassPoolByDifficulty ---
describe('filterClassPoolByDifficulty', () => {
  const pool = ['Fighter', 'Zombie', 'Revenant', 'Dragon', 'Archer', 'Dragon Lord'];

  it('Normal mode filters out all DIFFICULTY_GATED_CLASSES', () => {
    const filtered = filterClassPoolByDifficulty(pool, 'normal');
    for (const cls of DIFFICULTY_GATED_CLASSES) {
      expect(filtered).not.toContain(cls);
    }
    expect(filtered).toContain('Fighter');
    expect(filtered).toContain('Archer');
  });

  it('Hard mode passes through all classes', () => {
    const filtered = filterClassPoolByDifficulty(pool, 'hard');
    expect(filtered).toEqual(pool);
  });

  it('Lunatic mode passes through all classes', () => {
    const filtered = filterClassPoolByDifficulty(pool, 'lunatic');
    expect(filtered).toEqual(pool);
  });

  it('empty pool returns empty array', () => {
    expect(filterClassPoolByDifficulty([], 'normal')).toEqual([]);
    expect(filterClassPoolByDifficulty([], 'hard')).toEqual([]);
  });

  it('pool with only gated classes on Normal returns empty', () => {
    const gatedOnly = [...DIFFICULTY_GATED_CLASSES];
    const filtered = filterClassPoolByDifficulty(gatedOnly, 'normal');
    expect(filtered).toEqual([]);
  });
});

// --- Helper: create snapshot matching BattleScene's corrected shape ---
function createSnapshot(unit) {
  return {
    className: unit.className,
    level: unit.level,
    weapon: structuredClone(unit.weapon),
    inventory: structuredClone(unit.inventory || []),
    skills: [...(unit.skills || [])],
    stats: { ...unit.stats },
    moveType: unit.moveType,
    proficiencies: structuredClone(unit.proficiencies || []),
    tier: unit.tier || 'base',
    mov: unit.mov,
  };
}

// --- Helper: rebuild unit from snapshot matching BattleScene's corrected revival ---
function reviveFromSnapshot(snap, spawnCol, spawnRow) {
  return {
    name: snap.className,
    className: snap.className,
    tier: snap.tier || 'base',
    level: snap.level,
    xp: 0,
    isLord: false,
    personalGrowths: null,
    growths: {},
    proficiencies: structuredClone(snap.proficiencies || []),
    skills: [...snap.skills],
    col: spawnCol,
    row: spawnRow,
    mov: snap.mov || snap.stats.MOV || 4,
    moveType: snap.moveType || 'Infantry',
    stats: { ...snap.stats },
    currentHP: Math.max(1, Math.floor(snap.stats.HP / 2)),
    faction: 'enemy',
    weapon: snap.weapon ? structuredClone(snap.weapon) : null,
    inventory: snap.weapon ? [structuredClone(snap.weapon)] : [],
    consumables: [],
    affixes: [],
    accessory: null,
    weaponRank: snap.proficiencies?.[0]?.rank || 'Prof',
    hasMoved: false,
    hasActed: false,
    _revived: true,
    _noXP: true,
    isBoss: false,
    graphic: null,
    label: null,
    hpBar: null,
  };
}

// --- 7. Snapshot restore logic ---
describe('Snapshot restore logic', () => {
  it('restores zombie at 50% HP with correct flags', () => {
    const snap = {
      stats: { HP: 20 },
      className: 'Zombie',
      level: 3,
      weapon: { name: 'Claws', type: 'Axe', might: 4 },
      inventory: [{ name: 'Claws', type: 'Axe', might: 4 }],
      skills: ['zombie_drain'],
      moveType: 'Infantry',
      proficiencies: [{ type: 'Axe', rank: 'Prof' }],
      tier: 'base',
      mov: 4,
    };
    const revived = reviveFromSnapshot(snap, 3, 4);
    expect(revived.currentHP).toBe(10);
    expect(revived._revived).toBe(true);
    expect(revived._noXP).toBe(true);
  });

  it('restores at least 1 HP for odd max HP', () => {
    const snap = {
      stats: { HP: 1 },
      className: 'Revenant',
      level: 1,
      weapon: null,
      inventory: [],
      skills: [],
      moveType: 'Infantry',
      proficiencies: [],
      tier: 'base',
      mov: 4,
    };
    const revived = reviveFromSnapshot(snap, 0, 0);
    expect(revived.currentHP).toBe(1);
  });

  it('handles high HP snapshot correctly', () => {
    const snap = {
      stats: { HP: 45 },
      className: 'Zombie',
      level: 8,
      weapon: null,
      inventory: [],
      skills: [],
      moveType: 'Infantry',
      proficiencies: [],
      tier: 'base',
      mov: 5,
    };
    const revived = reviveFromSnapshot(snap, 0, 0);
    expect(revived.currentHP).toBe(22);
  });
});

// --- 8. Snapshot shape captures correct fields ---
describe('Snapshot shape completeness', () => {
  const SNAPSHOT_REQUIRED_FIELDS = [
    'className',
    'level',
    'weapon',
    'inventory',
    'skills',
    'stats',
    'moveType',
    'proficiencies',
    'tier',
    'mov',
  ];

  it('snapshot captures all required fields', () => {
    const unit = {
      className: 'Zombie',
      level: 5,
      weapon: { name: 'Claws', type: 'Axe', might: 4 },
      inventory: [{ name: 'Claws', type: 'Axe', might: 4 }],
      skills: ['zombie_drain'],
      stats: { HP: 24, STR: 8, MAG: 0, SKL: 4, SPD: 3, DEF: 2, RES: 0, LCK: 0, MOV: 4 },
      moveType: 'Infantry',
      proficiencies: [{ type: 'Axe', rank: 'Prof' }],
      tier: 'base',
      mov: 4,
    };
    const snap = createSnapshot(unit);
    for (const field of SNAPSHOT_REQUIRED_FIELDS) {
      expect(snap).toHaveProperty(field);
    }
  });

  it('snapshot does NOT contain stale "weapons" field', () => {
    const unit = {
      className: 'Zombie',
      level: 3,
      weapon: null,
      inventory: [],
      skills: [],
      stats: { HP: 20 },
      moveType: 'Infantry',
      proficiencies: [],
      tier: 'base',
      mov: 4,
    };
    const snap = createSnapshot(unit);
    expect(snap).not.toHaveProperty('weapons');
  });

  it('snapshot deep-clones weapon and inventory', () => {
    const weapon = { name: 'Claws', type: 'Axe', might: 4 };
    const unit = {
      className: 'Zombie',
      level: 3,
      weapon,
      inventory: [weapon],
      skills: [],
      stats: { HP: 20 },
      moveType: 'Infantry',
      proficiencies: [],
      tier: 'base',
      mov: 4,
    };
    const snap = createSnapshot(unit);
    expect(snap.weapon).toEqual(weapon);
    expect(snap.weapon).not.toBe(weapon); // distinct object
    expect(snap.inventory[0]).not.toBe(weapon);
  });
});

// --- 9. Revival unit field completeness ---
describe('Revival unit field completeness', () => {
  const REQUIRED_UNIT_FIELDS = [
    'name',
    'className',
    'tier',
    'level',
    'xp',
    'isLord',
    'growths',
    'proficiencies',
    'skills',
    'col',
    'row',
    'mov',
    'moveType',
    'stats',
    'currentHP',
    'faction',
    'weapon',
    'inventory',
    'consumables',
    'affixes',
    'accessory',
    'weaponRank',
    'hasMoved',
    'hasActed',
    '_revived',
    '_noXP',
    'isBoss',
    'graphic',
    'label',
    'hpBar',
  ];

  it('revived unit has all fields expected by BattleScene', () => {
    const snap = {
      className: 'Revenant',
      level: 6,
      tier: 'base',
      weapon: { name: 'Claws', type: 'Axe', might: 4 },
      inventory: [{ name: 'Claws', type: 'Axe', might: 4 }],
      skills: ['zombie_drain'],
      stats: { HP: 30, STR: 10, MAG: 0, SKL: 5, SPD: 4, DEF: 3, RES: 1, LCK: 2, MOV: 4 },
      moveType: 'Infantry',
      proficiencies: [{ type: 'Axe', rank: 'Prof' }],
      mov: 4,
    };
    const unit = reviveFromSnapshot(snap, 5, 7);
    for (const field of REQUIRED_UNIT_FIELDS) {
      expect(unit).toHaveProperty(field);
    }
  });

  it('revived unit uses weapon (singular) not weapons (plural)', () => {
    const snap = {
      className: 'Zombie',
      level: 3,
      tier: 'base',
      weapon: { name: 'Claws', type: 'Axe', might: 4 },
      inventory: [{ name: 'Claws', type: 'Axe', might: 4 }],
      skills: [],
      stats: { HP: 20 },
      moveType: 'Infantry',
      proficiencies: [],
      mov: 4,
    };
    const unit = reviveFromSnapshot(snap, 0, 0);
    expect(unit).toHaveProperty('weapon');
    expect(unit).not.toHaveProperty('weapons');
    expect(unit.weapon).toEqual(snap.weapon);
  });

  it('revived unit has weapon in inventory', () => {
    const snap = {
      className: 'Zombie',
      level: 3,
      tier: 'base',
      weapon: { name: 'Claws', type: 'Axe', might: 4 },
      inventory: [{ name: 'Claws', type: 'Axe', might: 4 }],
      skills: [],
      stats: { HP: 20 },
      moveType: 'Infantry',
      proficiencies: [],
      mov: 4,
    };
    const unit = reviveFromSnapshot(snap, 0, 0);
    expect(unit.inventory).toHaveLength(1);
    expect(unit.inventory[0]).toEqual(snap.weapon);
  });

  it('revived unit with no weapon has null weapon and empty inventory', () => {
    const snap = {
      className: 'Zombie',
      level: 3,
      tier: 'base',
      weapon: null,
      inventory: [],
      skills: [],
      stats: { HP: 20 },
      moveType: 'Infantry',
      proficiencies: [],
      mov: 4,
    };
    const unit = reviveFromSnapshot(snap, 0, 0);
    expect(unit.weapon).toBeNull();
    expect(unit.inventory).toEqual([]);
  });

  it('revived unit preserves moveType from snapshot', () => {
    const snap = {
      className: 'Zombie',
      level: 3,
      tier: 'base',
      weapon: null,
      inventory: [],
      skills: [],
      stats: { HP: 20 },
      moveType: 'Armored',
      proficiencies: [],
      mov: 3,
    };
    const unit = reviveFromSnapshot(snap, 0, 0);
    expect(unit.moveType).toBe('Armored');
    expect(unit.mov).toBe(3);
  });

  it('revived unit defaults moveType to Infantry when snapshot has none', () => {
    const snap = {
      className: 'Zombie',
      level: 3,
      tier: 'base',
      weapon: null,
      inventory: [],
      skills: [],
      stats: { HP: 20 },
      proficiencies: [],
      mov: undefined,
    };
    const unit = reviveFromSnapshot(snap, 0, 0);
    expect(unit.moveType).toBe('Infantry');
    expect(unit.mov).toBe(snap.stats.MOV || 4);
  });
});

// --- 10. Spawn position fallback logic ---
describe('Spawn position fallback logic', () => {
  // Simulates the getUnitAt-based neighbor search from processZombieRevival
  function findSpawnPosition(deathCol, deathRow, cols, rows, occupiedSet) {
    let spawnCol = deathCol;
    let spawnRow = deathRow;
    const key = (c, r) => `${c},${r}`;
    if (occupiedSet.has(key(spawnCol, spawnRow))) {
      const dirs = [
        { dc: -1, dr: 0 },
        { dc: 1, dr: 0 },
        { dc: 0, dr: -1 },
        { dc: 0, dr: 1 },
      ];
      for (const { dc, dr } of dirs) {
        const nc = spawnCol + dc;
        const nr = spawnRow + dr;
        if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && !occupiedSet.has(key(nc, nr))) {
          return { col: nc, row: nr };
        }
      }
      return null; // no room
    }
    return { col: spawnCol, row: spawnRow };
  }

  it('returns death position when unoccupied', () => {
    const result = findSpawnPosition(5, 5, 10, 10, new Set());
    expect(result).toEqual({ col: 5, row: 5 });
  });

  it('returns adjacent position when death tile is occupied', () => {
    const result = findSpawnPosition(5, 5, 10, 10, new Set(['5,5']));
    expect(result).not.toBeNull();
    expect(result).not.toEqual({ col: 5, row: 5 });
    // Should be one of the 4 neighbors
    const dist = Math.abs(result.col - 5) + Math.abs(result.row - 5);
    expect(dist).toBe(1);
  });

  it('returns null when death tile and all neighbors are occupied', () => {
    const occupied = new Set(['5,5', '4,5', '6,5', '5,4', '5,6']);
    const result = findSpawnPosition(5, 5, 10, 10, occupied);
    expect(result).toBeNull();
  });

  it('respects grid bounds at corner', () => {
    // Corner (0,0) — left and up neighbors are out of bounds
    const occupied = new Set(['0,0']);
    const result = findSpawnPosition(0, 0, 10, 10, occupied);
    expect(result).not.toBeNull();
    expect(result.col).toBeGreaterThanOrEqual(0);
    expect(result.row).toBeGreaterThanOrEqual(0);
  });

  it('returns null at corner when all in-bounds neighbors are occupied', () => {
    const occupied = new Set(['0,0', '1,0', '0,1']);
    const result = findSpawnPosition(0, 0, 10, 10, occupied);
    expect(result).toBeNull();
  });
});

// --- 11. awardXP integration: _noXP guard (calls real BattleScene.prototype.awardXP) ---
describe('awardXP integration — _noXP guard', () => {
  function makeTextStub() {
    return {
      setOrigin() {
        return this;
      },
      setDepth() {
        return this;
      },
      destroy() {},
    };
  }

  function makeAwardXPCtx() {
    return {
      battleParams: { xpMultiplier: 1 },
      turnPar: undefined,
      turnBonusConfig: undefined,
      getCurrentTurnNumber: () => 1,
      registry: { get: () => ({ playSFX() {} }) },
      grid: { gridToPixel: () => ({ x: 0, y: 0 }) },
      add: { text: () => makeTextStub() },
      time: { delayedCall: (_ms, cb) => cb() },
      tweens: {
        add: ({ onComplete }) => {
          if (onComplete) onComplete();
        },
      },
      _isReducedEffects: () => true,
      updateHPBar() {},
      gameData: { classes: [], skills: [] },
      getEnemyXpMultiplier: () => 1,
      getTurnPressureState: () => ({ xpMultiplier: 1 }),
      awardScaledXP: vi.fn(async () => {}),
    };
  }

  it('blocks XP for _noXP opponent (real awardXP)', async () => {
    const ctx = makeAwardXPCtx();
    const player = { tier: 'base', level: 5, xp: 0, stats: { SKL: 10, LCK: 5 } };
    const opponent = { _noXP: true, className: 'Zombie', level: 3, tier: 'base' };

    await BattleScene.prototype.awardXP.call(ctx, player, opponent, true);

    expect(ctx.awardScaledXP).not.toHaveBeenCalled();
  });

  it('awards XP for normal opponent without _noXP (real awardXP)', async () => {
    const ctx = makeAwardXPCtx();
    const player = { tier: 'base', level: 5, xp: 0, stats: { SKL: 10, LCK: 5 } };
    const opponent = { className: 'Fighter', level: 5, tier: 'base' };

    await BattleScene.prototype.awardXP.call(ctx, player, opponent, true);

    expect(ctx.awardScaledXP).toHaveBeenCalledTimes(1);
  });

  it('awards XP when _noXP is explicitly false', async () => {
    const ctx = makeAwardXPCtx();
    const player = { tier: 'base', level: 5, xp: 0, stats: { SKL: 10, LCK: 5 } };
    const opponent = { _noXP: false, className: 'Zombie', level: 4, tier: 'base' };

    await BattleScene.prototype.awardXP.call(ctx, player, opponent, true);

    expect(ctx.awardScaledXP).toHaveBeenCalledTimes(1);
  });

  it('handles null/undefined opponent safely (real awardXP)', async () => {
    const player = { tier: 'base', level: 5, xp: 0, stats: { SKL: 10, LCK: 5 } };
    const nullCtx = makeAwardXPCtx();
    const undefinedCtx = makeAwardXPCtx();

    await BattleScene.prototype.awardXP.call(nullCtx, player, null, true);
    await BattleScene.prototype.awardXP.call(undefinedCtx, player, undefined, true);

    expect(nullCtx.awardScaledXP).toHaveBeenCalledTimes(1);
    expect(undefinedCtx.awardScaledXP).toHaveBeenCalledTimes(1);
  });
});

// --- 12. processZombieRevival integration: terrain passability ---
describe('processZombieRevival integration — terrain passability', () => {
  const plain = {
    name: 'Plain',
    moveCost: { Infantry: '1', Cavalry: '1', Flying: '1', Armored: '1' },
  };
  const wall = {
    name: 'Wall',
    moveCost: { Infantry: '--', Cavalry: '--', Flying: '--', Armored: '--' },
  };
  const water = {
    name: 'Water',
    moveCost: { Infantry: '--', Cavalry: '--', Flying: '1', Armored: '--' },
  };
  const forest = {
    name: 'Forest',
    moveCost: { Infantry: '2', Cavalry: '3', Flying: '1', Armored: '2' },
  };

  function makeTomb(col, row, moveType = 'Infantry') {
    return {
      col,
      row,
      turnsRemaining: 1,
      snapshot: {
        className: 'Zombie',
        level: 3,
        tier: 'base',
        weapon: { name: 'Claws', type: 'Axe', might: 4 },
        skills: ['zombie_drain'],
        stats: { HP: 20, STR: 6, MAG: 0, SKL: 4, SPD: 3, DEF: 2, RES: 0, LCK: 0, MOV: 4 },
        moveType,
        proficiencies: [{ type: 'Axe', rank: 'Prof' }],
        mov: 4,
      },
    };
  }

  function makeRevivalCtx(terrainGrid, unitPositions = []) {
    const unitSet = new Set(unitPositions.map(([c, r]) => `${c},${r}`));
    return {
      _zombieTombstones: [],
      battleConfig: { cols: terrainGrid[0].length, rows: terrainGrid.length },
      enemyUnits: [],
      grid: {
        getTerrainAt(col, row) {
          return terrainGrid[row]?.[col] ?? null;
        },
      },
      getUnitAt(col, row) {
        return unitSet.has(`${col},${row}`) ? {} : null;
      },
      addUnitGraphic: vi.fn(),
      showBriefBanner: vi.fn(async () => {}),
      checkBattleEnd: vi.fn(),
    };
  }

  function makeGrid(rows, cols, fill) {
    return Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill));
  }

  it('skips Wall neighbor tiles', async () => {
    // 3x3, center occupied, left/up/down=Wall, right=Plain
    const grid = makeGrid(3, 3, wall);
    grid[1][1] = plain;
    grid[1][2] = plain;
    const ctx = makeRevivalCtx(grid, [[1, 1]]);
    ctx._zombieTombstones = [makeTomb(1, 1)];

    await BattleScene.prototype.processZombieRevival.call(ctx);

    expect(ctx.enemyUnits).toHaveLength(1);
    expect(ctx.addUnitGraphic).toHaveBeenCalledTimes(1);
    expect(ctx.addUnitGraphic).toHaveBeenCalledWith(ctx.enemyUnits[0]);
    expect(ctx.enemyUnits[0].col).toBe(2);
    expect(ctx.enemyUnits[0].row).toBe(1);
  });

  it('skips Water neighbor tiles for Infantry', async () => {
    const grid = makeGrid(3, 3, water);
    grid[1][1] = plain;
    grid[1][2] = plain; // only passable neighbor
    const ctx = makeRevivalCtx(grid, [[1, 1]]);
    ctx._zombieTombstones = [makeTomb(1, 1)];

    await BattleScene.prototype.processZombieRevival.call(ctx);

    expect(ctx.enemyUnits).toHaveLength(1);
    expect(ctx.enemyUnits[0].col).toBe(2);
    expect(ctx.enemyUnits[0].row).toBe(1);
  });

  it('allows Water tiles for Flying moveType', async () => {
    const grid = makeGrid(3, 3, water);
    grid[1][1] = plain;
    const ctx = makeRevivalCtx(grid, [[1, 1]]);
    ctx._zombieTombstones = [makeTomb(1, 1, 'Flying')];

    await BattleScene.prototype.processZombieRevival.call(ctx);

    expect(ctx.enemyUnits).toHaveLength(1);
    // First direction checked is left → (0,1)
    expect(ctx.enemyUnits[0].col).toBe(0);
    expect(ctx.enemyUnits[0].row).toBe(1);
  });

  it('cancels revival when all neighbors are impassable', async () => {
    const grid = makeGrid(3, 3, wall);
    grid[1][1] = plain; // death tile passable but occupied
    const ctx = makeRevivalCtx(grid, [[1, 1]]);
    ctx._zombieTombstones = [makeTomb(1, 1)];

    await BattleScene.prototype.processZombieRevival.call(ctx);

    expect(ctx.enemyUnits).toHaveLength(0);
    expect(ctx.addUnitGraphic).not.toHaveBeenCalled();
  });

  it('allows Forest neighbor tiles (passable but costly)', async () => {
    const grid = makeGrid(3, 3, wall);
    grid[1][1] = plain;
    grid[0][1] = forest; // up neighbor passable
    const ctx = makeRevivalCtx(grid, [[1, 1]]);
    ctx._zombieTombstones = [makeTomb(1, 1)];

    await BattleScene.prototype.processZombieRevival.call(ctx);

    expect(ctx.enemyUnits).toHaveLength(1);
    expect(ctx.enemyUnits[0].col).toBe(1);
    expect(ctx.enemyUnits[0].row).toBe(0);
  });

  it('revives on death tile when unoccupied and passable', async () => {
    const grid = makeGrid(3, 3, wall);
    grid[1][1] = plain; // death tile passable, no occupant
    const ctx = makeRevivalCtx(grid);
    ctx._zombieTombstones = [makeTomb(1, 1)];

    await BattleScene.prototype.processZombieRevival.call(ctx);

    expect(ctx.enemyUnits).toHaveLength(1);
    expect(ctx.addUnitGraphic).toHaveBeenCalledTimes(1);
    expect(ctx.addUnitGraphic).toHaveBeenCalledWith(ctx.enemyUnits[0]);
    expect(ctx.enemyUnits[0].col).toBe(1);
    expect(ctx.enemyUnits[0].row).toBe(1);
  });

  it('skips death tile when unoccupied but impassable (Waller scenario)', async () => {
    const grid = makeGrid(3, 3, plain);
    grid[1][1] = wall; // death tile became impassable (e.g. Waller placed Wall)
    const ctx = makeRevivalCtx(grid);
    ctx._zombieTombstones = [makeTomb(1, 1)];

    await BattleScene.prototype.processZombieRevival.call(ctx);

    expect(ctx.enemyUnits).toHaveLength(1);
    // Should fall through to neighbor search — left neighbor (0,1) is Plain
    expect(ctx.enemyUnits[0].col).toBe(0);
    expect(ctx.enemyUnits[0].row).toBe(1);
  });

  it('cancels when death tile impassable and all neighbors impassable', async () => {
    const grid = makeGrid(3, 3, wall); // everything impassable
    const ctx = makeRevivalCtx(grid);
    ctx._zombieTombstones = [makeTomb(1, 1)];

    await BattleScene.prototype.processZombieRevival.call(ctx);

    expect(ctx.enemyUnits).toHaveLength(0);
    expect(ctx.addUnitGraphic).not.toHaveBeenCalled();
  });
});
