// The legendary arts rework (docs/specs/legendary-arts-rework.md): Oathblade's dash (§4) and
// the save update for relics looted before it (§6). Expected tiles and numbers are worked by
// hand from the board drawn in each test and the catalog stats quoted inline.
//
// Ways it can fail, each caught below:
//   - the dash lands on an occupied tile, skips past a wall, or does nothing when it could go;
//   - it moves a rooted user, or moves at all on a miss / from range;
//   - the preview's landing reads a hidden unit, or disagrees with execution;
//   - an old Oathblade keeps "Attacks twice", a forge step is lost, a fresh copy is changed,
//     or a second load changes it again; a Hermit's Bow keeps Starfall Volley.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { resolveCombat } from '../src/engine/Combat.js';
import { getWeaponArtCombatMods } from '../src/engine/WeaponArtSystem.js';
import { postCombatEffects } from '../src/engine/PostCombatEffects.js';
import { resolvePostCombatMove } from '../src/engine/WeaponArtPostCombat.js';
import { previewAreaArt, areaForecastLines } from '../src/engine/AreaPreview.js';
import { migrateSavedLegendaryRelics } from '../src/engine/LegendaryRelicMigration.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const art = (id) => data.weaponArts.arts.find((a) => a.id === id);

const unit = (name, faction, col, row, stats = {}, extra = {}) => ({
  name,
  faction,
  col,
  row,
  level: 10,
  moveType: 'Infantry',
  weaponRank: 'Mast',
  currentHP: stats.HP ?? 40,
  stats: { HP: 40, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0, MOV: 5, ...stats },
  ...extra,
});

/** A 9x9 board; `walls` impassable to everyone, `water` to walkers only. */
function worldOf(units, { walls = [], water = [] } = {}) {
  const has = (list, col, row) => list.some(([c, r]) => c === col && r === row);
  return {
    affixes: data.affixes,
    cols: 9,
    rows: 9,
    getMoveCost: (col, row, moveType) =>
      has(walls, col, row)
        ? Infinity
        : has(water, col, row) && moveType !== 'Flying'
          ? Infinity
          : 1,
    getTerrainAt: () => null,
    getUnitAt: (col, row) =>
      units.find((u) => u.col === col && u.row === row && !u._removing) || null,
    hostilesOf: (u) => units.filter((o) => o.faction !== u.faction && o.faction !== 'npc'),
    alliesOf: (u) => units.filter((o) => o.faction === u.faction),
    turnNumber: 1,
  };
}

function strike(attacker, defender, units, { random = () => 0.01, world } = {}) {
  const prev = Math.random;
  Math.random = random;
  let result;
  try {
    result = resolveCombat(attacker, attacker.weapon, defender, defender.weapon, 1, null, null, {
      atkWeaponArtMods: getWeaponArtCombatMods(art('legend_phantom_rush')),
    });
  } finally {
    Math.random = prev;
  }
  defender.currentHP = result.defenderHP;
  attacker.currentHP = result.attackerHP;
  const beats = [
    ...postCombatEffects(
      { attacker, defender, result, attackerWeaponArt: art('legend_phantom_rush') },
      world || worldOf(units),
    ),
  ];
  return { result, beats };
}

const dash = (source, target, units, opts) =>
  resolvePostCombatMove({
    sourceUnit: source,
    targetUnit: target,
    mode: 'dash',
    distance: 3,
    cols: 9,
    rows: 9,
    getMoveCost: worldOf(units, opts).getMoveCost,
    getUnitAt: worldOf(units, opts).getUnitAt,
  });
const landing = (r) => (r.ok ? [r.assignments[0].col, r.assignments[0].row] : r.reason);

describe("Oathblade's dash: where it lands", () => {
  // A at (1,4) attacks T at (2,4), eastward: tiles 1-3 are (2..4,4), tile 4 is (5,4).
  it('lands just past the line when that tile is free, passing every unit on the line', () => {
    const a = unit('A', 'player', 1, 4);
    const t = unit('T', 'enemy', 2, 4);
    const f2 = unit('F2', 'enemy', 3, 4);
    const f3 = unit('F3', 'enemy', 4, 4);
    expect(landing(dash(a, t, [a, t, f2, f3]))).toEqual([5, 4]);
  });

  it('a unit on the landing tile: the farthest free tile inside the line', () => {
    const a = unit('A', 'player', 1, 4);
    const t = unit('T', 'enemy', 2, 4);
    const past = unit('Past', 'enemy', 5, 4);
    const f3 = unit('F3', 'enemy', 4, 4);
    // Tile 4 and tile 3 are taken: tile 2 (3,4) is the farthest free one.
    expect(landing(dash(a, t, [a, t, past, f3]))).toEqual([3, 4]);
  });

  it('a wall ends the run before it, and the target holds its tile while it stands', () => {
    const a = unit('A', 'player', 1, 4);
    const t = unit('T', 'enemy', 2, 4);
    // Wall on tile 3: candidates are tiles 1-2; tile 2 is free.
    expect(landing(dash(a, t, [a, t], { walls: [[4, 4]] }))).toEqual([3, 4]);
    // Wall on tile 2: only the target's tile, which a living target holds.
    expect(landing(dash(a, t, [a, t], { walls: [[3, 4]] }))).toBe('blocked');
    // The same with the target fallen: the user takes its tile.
    t.currentHP = 0;
    expect(landing(dash(a, t, [a, t], { walls: [[3, 4]] }))).toEqual([2, 4]);
  });

  it('ground the user cannot stand on is passed, not landed on', () => {
    const a = unit('A', 'player', 1, 4);
    const t = unit('T', 'enemy', 2, 4);
    // Water on tile 4 (5,4): an infantry user lands on tile 3 (4,4) instead.
    expect(landing(dash(a, t, [a, t], { water: [[5, 4]] }))).toEqual([4, 4]);
    // Water on tile 2 but tile 4 is dry: it leaps the water and lands past the line.
    expect(landing(dash(a, t, [a, t], { water: [[3, 4]] }))).toEqual([5, 4]);
  });

  it('never from range, and never while rooted; the board edge ends the run', () => {
    const a = unit('A', 'player', 1, 4);
    const far = unit('T', 'enemy', 3, 4);
    expect(landing(dash(a, far, [a, far]))).toBe('not_adjacent');
    const rooted = unit('R', 'player', 1, 4);
    applyCondition(rooted, 'root', 2);
    const t = unit('T', 'enemy', 2, 4);
    expect(landing(dash(rooted, t, [rooted, t]))).toBe('rooted');
    // Facing the east edge from (6,4): tiles (7,4), (8,4); the board ends there.
    const edge = unit('E', 'player', 6, 4);
    const t2 = unit('T2', 'enemy', 7, 4);
    expect(landing(dash(edge, t2, [edge, t2]))).toEqual([8, 4]);
  });
});

describe('Phantom Rush end to end', () => {
  it('strikes the target, the line takes 75% blows, then the user lands past it', () => {
    // Oathblade: Mt 15, Crit 20. Art: Atk +4, Hit +10, Crit +10. STR 20 vs an axe user:
    // the sword's triangle edge at Master rank is +2. On a DEF 5 victim:
    // 20 + 15 + 4 + 2 - 5 = 36 a strike; the line's blow is 36 × 0.75 = 27.
    const a = unit('A', 'player', 1, 4, { STR: 20, SKL: 30, SPD: 20, LCK: 30 }, { weapon: weapon('Oathblade') }); // prettier-ignore
    const t = unit('T', 'enemy', 2, 4, { HP: 80, DEF: 5 }, { weapon: weapon('Iron Axe') });
    const f2 = unit('F2', 'enemy', 3, 4, { HP: 80, DEF: 5 }, { weapon: weapon('Iron Axe') });
    const f3 = unit('F3', 'enemy', 4, 4, { HP: 80, DEF: 5 }, { weapon: weapon('Iron Axe') });
    const units = [a, t, f2, f3];
    // random 0.5: every strike hits (Hit far above 50) and none crits (Crit well below 50).
    const { beats } = strike(a, t, units, { random: () => 0.5 });
    expect(t.currentHP).toBe(80 - 36); // one strike: the art never follows up
    expect(f2.currentHP).toBe(80 - 27);
    expect(f3.currentHP).toBe(80 - 27);
    expect([a.col, a.row]).toEqual([5, 4]);
    expect(beats.some((b) => b.kind === 'moved' && b.units.includes(a))).toBe(true);
  });

  it('a miss is a plain attack: no line, no dash', () => {
    const a = unit('A', 'player', 1, 4, { STR: 20 }, { weapon: weapon('Oathblade') });
    const t = unit('T', 'enemy', 2, 4, { HP: 80, DEF: 5 }, { weapon: weapon('Iron Lance') });
    const f2 = unit('F2', 'enemy', 3, 4, { HP: 80, DEF: 5 }, { weapon: weapon('Iron Lance') });
    strike(a, t, [a, t, f2], { random: () => 0.999 });
    expect(f2.currentHP).toBe(80);
    expect([a.col, a.row]).toEqual([1, 4]);
  });
});

describe('the dash preview reads only what the player knows', () => {
  it('a hidden unit on the landing tile does not change the preview; execution meets it', () => {
    const a = unit('A', 'player', 1, 4, { STR: 20 }, { weapon: weapon('Oathblade') });
    const t = unit('T', 'enemy', 2, 4, { HP: 80, DEF: 5 }, { weapon: weapon('Iron Lance') });
    const hidden = unit('Hidden', 'enemy', 5, 4, { HP: 80 }, { weapon: weapon('Iron Lance') });
    const world = worldOf([a, t, hidden]);
    const preview = (units) =>
      previewAreaArt({
        attacker: a,
        art: art('legend_phantom_rush'),
        target: t,
        knowledge: { units },
        world,
        strikeMods: getWeaponArtCombatMods(art('legend_phantom_rush')),
        dealt: 10,
      });
    const seen = preview([a, t]);
    const all = preview([a, t, hidden]);
    expect(seen.dash.to).toEqual({ col: 5, row: 4 }); // the player sees an empty tile
    expect(all.dash.to).toEqual({ col: 4, row: 4 }); // what the real board would do
    expect(areaForecastLines(seen)).toContain('Dash if it hits: 4 tiles on');
  });

  it('a foe the preview says falls frees its tile for the landing', () => {
    const a = unit('A', 'player', 1, 4, { STR: 20 }, { weapon: weapon('Oathblade') });
    const t = unit('T', 'enemy', 2, 4, { HP: 80, DEF: 5 }, { weapon: weapon('Iron Lance') });
    const weak = unit('Weak', 'enemy', 5, 4, { HP: 80 }, { weapon: weapon('Iron Lance') });
    weak.currentHP = 1;
    // (5,4) is tile 4, past the line: the line's blows don't reach it, so it still stands.
    const p = previewAreaArt({
      attacker: a,
      art: art('legend_phantom_rush'),
      target: t,
      knowledge: { units: [a, t, weak] },
      world: worldOf([a, t, weak]),
      strikeMods: getWeaponArtCombatMods(art('legend_phantom_rush')),
      dealt: 10,
    });
    expect(p.dash.to).toEqual({ col: 4, row: 4 });
    // Now on tile 3 (in the line), at 1 HP: the preview fells it and lands past it.
    weak.col = 4;
    const q = previewAreaArt({
      attacker: a,
      art: art('legend_phantom_rush'),
      target: t,
      knowledge: { units: [a, t, weak] },
      world: worldOf([a, t, weak]),
      strikeMods: getWeaponArtCombatMods(art('legend_phantom_rush')),
      dealt: 10,
    });
    expect(q.victims.find((v) => v.unit === weak)?.kills).toBe(true);
    expect(q.dash.to).toEqual({ col: 5, row: 4 });
  });
});

describe('saves from before the rework (LegendaryRelicMigration)', () => {
  const oldOathblade = (extra = {}) => ({
    ...weapon('Oathblade'),
    might: 9,
    crit: 0,
    special: 'Attacks twice consecutively',
    ...extra,
  });
  const oldHermit = (extra = {}) => ({
    ...weapon("Hermit's Bow"),
    weaponArtIds: ['legend_starfall_volley'],
    weaponArtSources: ['innate'],
    ...extra,
  });

  it('an old Oathblade takes the new Mt and Crit as deltas, so a forge step is kept', () => {
    // A +1 forge on Might: 9 + 1 = 10 saved; 10 + 6 = 16 after.
    const forged = oldOathblade({ name: 'Oathblade +1', _baseName: 'Oathblade', might: 10 });
    const plain = oldOathblade();
    const tree = {
      roster: [{ inventory: [forged], weapon: forged }],
      convoy: { weapons: [plain] },
    };
    expect(migrateSavedLegendaryRelics(tree)).toBe(2);
    expect([forged.might, forged.crit, forged.special]).toEqual([16, 20, '']);
    expect([plain.might, plain.crit, plain.special]).toEqual([15, 20, '']);
    // A second load changes nothing.
    expect(migrateSavedLegendaryRelics(tree)).toBe(0);
    expect(forged.might).toBe(16);
  });

  it('a copy made after the rework, a random legendary and other weapons are never touched', () => {
    const fresh = weapon('Oathblade');
    const random = oldOathblade({ _isRandomLegendary: true });
    const twin = weapon('Twinsworn');
    const tree = { items: [fresh, random, twin] };
    expect(migrateSavedLegendaryRelics(tree)).toBe(0);
    expect(fresh.might).toBe(15);
    expect(random.might).toBe(9);
    expect(twin.special).toBe('Attacks twice consecutively');
  });

  it("an old Hermit's Bow's innate art becomes Fan Shot; a scroll-bound art stays", () => {
    const bow = oldHermit({
      weaponArtIds: ['legend_starfall_volley', 'bow_curved_shot'],
      weaponArtSources: ['innate', 'scroll'],
    });
    expect(migrateSavedLegendaryRelics({ bow })).toBe(1);
    expect(bow.weaponArtIds).toEqual(['legend_hermit_fan', 'bow_curved_shot']);
    expect(bow.weaponArtSources).toEqual(['innate', 'scroll']);
    expect(migrateSavedLegendaryRelics({ bow })).toBe(0);
  });

  it('RunManager.fromJSON walks the battle checkpoint and pending rewards too', () => {
    const rm = new RunManager(data);
    rm.startRun();
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    saved.convoy = { weapons: [oldOathblade({ uid: 'itm_convoy' })], consumables: [] };
    saved.pendingBattleReward = {
      version: 1,
      choices: [{ type: 'weapon', item: oldHermit({ uid: 'itm_reward' }) }],
    };
    const checkpointBlade = oldOathblade();
    saved.battleInProgress = { checkpoint: { playerUnits: [{ inventory: [checkpointBlade] }] } };
    const restored = RunManager.fromJSON(saved, data);
    expect(restored.convoy.weapons[0].might).toBe(15);
    expect(saved.pendingBattleReward.choices[0].item.weaponArtIds).toEqual(['legend_hermit_fan']);
    expect(checkpointBlade.special).toBe('');
  });
});
