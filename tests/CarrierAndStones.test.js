// Revival Stones (3D) and carried items (3G) meet in two places: a boss never carries (a
// stoned boss is still a boss), and the pip row above a unit holds the stone gems, the
// affix pips and the carrier's sack side by side, each at its own slot, each hidden in fog.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { Grid } from '../src/engine/Grid.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { resolveDifficultyMode } from '../src/engine/DifficultyEngine.js';
import { applyEnemySpawnGear } from '../src/engine/EnemySpawnGear.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
afterEach(() => restoreMathRandom());
const T = Object.fromEntries(data.terrain.map((t, i) => [t.name, i]));
const modifiers = (rung) => resolveDifficultyMode(data.difficulty, rung).modifiers;

describe('a boss with Revival Stones never carries', () => {
  it('in generated maps, even when every roll would hit', () => {
    let stoned = 0;
    for (const act of ['act2', 'act3', 'act4']) {
      for (let seed = 1; seed <= 25; seed++) {
        installSeed(seed);
        const bc = generateBattle(
          {
            deployCount: 6,
            row: 3,
            ...modifiers('lunatic'),
            // A chance of 1 with room for everyone: the only thing left to keep a boss
            // empty-handed is the rule itself.
            carryConfig: { perBattle: true, act2: 1, act3: 1, act4: 1, act1: 1, finalBoss: 1, maxPerBattle: 40 }, // prettier-ignore
            difficultyId: 'lunatic',
            act,
            objective: 'seize',
            isBoss: true,
          },
          data,
        );
        restoreMathRandom();
        const bosses = bc.enemySpawns.filter((s) => s.isBoss);
        expect(bosses.length).toBeGreaterThan(0);
        for (const boss of bosses) {
          expect(boss.carries, `${act} ${seed}`).toBeUndefined();
          if (boss.revivalStones > 0) stoned++;
        }
        // The rest of the garrison does carry (the roll was live).
        expect(bc.enemySpawns.some((s) => !s.isBoss && s.carries)).toBe(true);
      }
    }
    expect(stoned).toBeGreaterThan(0);
  });

  it('in the gear step: stones are applied, the item is not built', () => {
    const boss = { name: 'Boss', className: 'Knight', inventory: [], consumables: [], weapon: null, isBoss: true }; // prettier-ignore
    const spawn = { className: 'Knight', col: 3, row: 3, level: 9, isBoss: true, revivalStones: 2, carries: 'Elixir' }; // prettier-ignore
    applyEnemySpawnGear(boss, spawn, { weapons: data.weapons, consumables: data.consumables, battleKey: 'k' }); // prettier-ignore
    expect(boss.revivalStones).toBe(2);
    expect(boss.revivalStonesMax).toBe(2);
    expect(boss.carriedItem).toBeUndefined();
  });
});

function mockGfx() {
  const stub = new Proxy({}, { get: (t, p) => (p === 'destroy' ? () => {} : () => stub) });
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: () => stub, image: () => stub, text: () => stub, container: () => stub },
    textures: { exists: () => false },
  };
}

/** A scene that records every pip drawn: slot position, kind (by fill colour) and visibility. */
function pipScene(hidden = new Set()) {
  const grid = new Grid(mockGfx(), 12, 1, data.terrain, [Array(12).fill(T.Plain)], true);
  grid.isVisible = (col, row) => !hidden.has(`${col},${row}`);
  grid.gridToPixel = (col, row) => ({ x: col * 32, y: row * 32 });
  const scene = Object.create(BattleScene.prototype);
  const rect = (x, y, w, h, color) => {
    const pip = { x, color, visible: true };
    const chain = {
      setStrokeStyle: () => chain,
      setDepth: () => chain,
      setAngle: () => chain,
      setVisible: (v) => {
        pip.visible = v;
        return chain;
      },
      destroy: () => {},
      pip,
    };
    return chain;
  };
  Object.assign(scene, { grid, gameData: { affixes: data.affixes }, add: { rectangle: rect } });
  return scene;
}
const row = (unit) => unit.affixPips.map((p) => p.pip);
const GEM = 0x8fb8d6; // UI_HEX.info
const SACK = 0xfff0bd; // UI_HEX.emberPale

describe('the pip row', () => {
  const affix = data.affixes.affixes[0].id;
  const base = { col: 6, row: 0, faction: 'enemy', currentHP: 20, stats: { HP: 20 } };

  it('a stoned boss draws its gems then its affix pips, one slot each', () => {
    const scene = pipScene();
    const boss = { ...base, isBoss: true, revivalStones: 2, revivalStonesMax: 2, affixes: [affix] };
    scene.updateAffixPips.call(scene, boss);
    const pips = row(boss);
    expect(pips.map((p) => p.color === GEM)).toEqual([true, true, false]);
    expect(new Set(pips.map((p) => p.x)).size).toBe(3);
    expect([...pips.map((p) => p.x)].sort((a, b) => a - b)).toEqual(pips.map((p) => p.x));
  });

  it('a carrier draws its affix pips then the sack, one slot each', () => {
    const scene = pipScene();
    const foe = { ...base, affixes: [affix], carriedItem: { name: 'Elixir', uid: 'i1' } };
    scene.updateAffixPips.call(scene, foe);
    const pips = row(foe);
    expect(pips.map((p) => p.color === SACK)).toEqual([false, true]);
    expect(new Set(pips.map((p) => p.x)).size).toBe(2);
  });

  it('gems, affix pips and a sack on one unit take distinct slots in a centred row', () => {
    // Never produced by generation (a boss does not carry); the row must still be sound.
    const scene = pipScene();
    const both = {
      ...base,
      revivalStones: 2,
      revivalStonesMax: 2,
      affixes: [affix],
      carriedItem: { name: 'Elixir', uid: 'i1' },
    };
    scene.updateAffixPips.call(scene, both);
    const pips = row(both);
    expect(pips).toHaveLength(4);
    expect(pips.map((p) => p.color)).toEqual([GEM, GEM, pips[2].color, SACK]);
    expect(pips[2].color).not.toBe(GEM);
    expect(pips[2].color).not.toBe(SACK);
    const xs = pips.map((p) => p.x);
    expect(new Set(xs).size).toBe(4);
    // Evenly spaced and centred on the unit's tile (6 * 32 = 192).
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    expect(new Set(gaps).size).toBe(1);
    expect((xs[0] + xs[3]) / 2).toBe(192);
  });

  it('every pip hides with its unit in fog, and shows once the unit is in view', () => {
    const unit = () => ({
      ...base,
      revivalStones: 1,
      revivalStonesMax: 1,
      affixes: [affix],
      carriedItem: { name: 'Elixir', uid: 'i1' },
    });
    const dark = pipScene(new Set(['6,0']));
    const hiddenUnit = unit();
    dark.updateAffixPips.call(dark, hiddenUnit);
    // The affix pip follows the existing visibility sweep; gems and the sack are born hidden.
    expect(row(hiddenUnit).filter((p) => p.color === GEM || p.color === SACK).map((p) => p.visible)).toEqual([false, false]); // prettier-ignore
    const lit = pipScene();
    const shownUnit = unit();
    lit.updateAffixPips.call(lit, shownUnit);
    expect(row(shownUnit).map((p) => p.visible)).toEqual([true, true, true]);
  });
});
