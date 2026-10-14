import { describe, it, expect } from 'vitest';
import {
  ATMOSPHERE_GRADES,
  LIGHT_PRESETS,
  NIGHT_CHANCE,
  WALL_TORCHES,
  resolveAtmosphere,
  resolveTimeOfDay,
} from '../src/art/atmosphereConfig.js';
import { BattleLightLayer, wallTorchSites } from '../src/art/BattleLightLayer.js';
import {
  CLOUD_SHADOW_SPEC,
  cloudPositionsAt,
  cloudSeed,
  cloudShadowsFor,
  planCloudShadows,
} from '../src/art/cloudShadows.js';
import { resolveWeather, weatherKindFor, WEATHER_SPECS } from '../src/art/weatherConfig.js';

// Day/night outdoors, torchlit halls, cloud shadows: presentation only (map lighting).

describe('resolveTimeOfDay', () => {
  const seeds = Array.from({ length: 4000 }, (_, i) => (i * 2654435761) >>> 0);

  it('is a pure function of the battle seed', () => {
    for (const battleSeed of seeds.slice(0, 50)) {
      const ctx = { act: 'act2', biome: 'grassland', battleSeed, row: 3 };
      expect(resolveTimeOfDay(ctx)).toBe(resolveTimeOfDay({ ...ctx }));
    }
  });

  it('about a quarter of outdoor Act I-III battles fall at night', () => {
    const nights = seeds.filter(
      (battleSeed) =>
        resolveTimeOfDay({ act: 'act3', biome: null, battleSeed, row: 4 }) === 'night',
    ).length;
    expect(NIGHT_CHANCE).toBe(0.25);
    expect(nights / seeds.length).toBeGreaterThan(0.22);
    expect(nights / seeds.length).toBeLessThan(0.28);
  });

  it('never at night: scripted, indoors, Act IV and later, no seed, a run opening map', () => {
    const night = seeds.find(
      (battleSeed) =>
        resolveTimeOfDay({ act: 'act1', biome: null, battleSeed, row: 2 }) === 'night',
    );
    expect(night).toBeDefined();
    const base = { act: 'act1', biome: 'grassland', battleSeed: night, row: 2 };
    expect(resolveTimeOfDay(base)).toBe('night');
    expect(resolveTimeOfDay({ ...base, isScripted: true })).toBe('day');
    expect(resolveTimeOfDay({ ...base, biome: 'castle' })).toBe('day');
    expect(resolveTimeOfDay({ ...base, biome: 'volcano' })).toBe('day');
    expect(resolveTimeOfDay({ ...base, act: 'act4' })).toBe('day');
    expect(resolveTimeOfDay({ ...base, act: 'finalBoss' })).toBe('day');
    expect(resolveTimeOfDay({ ...base, battleSeed: null })).toBe('day');
    expect(resolveTimeOfDay({ ...base, battleSeed: undefined })).toBe('day');
    expect(resolveTimeOfDay({ ...base, row: 0 })).toBe('day');
    // Row 0 of a later act can fall at night.
    expect(resolveTimeOfDay({ ...base, act: 'act2', row: 0 })).toBe(
      resolveTimeOfDay({ ...base, act: 'act2', row: 5 }),
    );
  });

  it('the dev override forces either, but only where night can fall', () => {
    const ctx = { act: 'act1', biome: 'swamp', battleSeed: 1, row: 0 };
    expect(resolveTimeOfDay({ ...ctx, timeOverride: 'night' })).toBe('night');
    expect(resolveTimeOfDay({ ...ctx, timeOverride: 'day' })).toBe('day');
    expect(resolveTimeOfDay({ ...ctx, biome: 'castle', timeOverride: 'night' })).toBe('day');
    expect(resolveTimeOfDay({ ...ctx, isScripted: true, timeOverride: 'night' })).toBe('day');
  });
});

describe('resolveAtmosphere — lighting', () => {
  it.each([
    ['act1', 'act1_night', 'Moonrise'],
    ['act2', 'act2_night', 'Storm Night'],
    ['act3', 'act3_night', 'Pale Moon'],
  ])('%s at night is %s with a moonlit night layer', (act, gradeKey, label) => {
    const r = resolveAtmosphere({ act, biome: 'grassland', timeOverride: 'night', battleSeed: 1 });
    expect(r.gradeKey).toBe(gradeKey);
    expect(r.label).toBe(label);
    expect(r.night).toBe(true);
    expect(r.lighting).toBe('night');
    expect(r.timeOfDay).toBe('night');
    expect(r.lightPreset).toBe('moonlit');
    expect(r.lightOptions.darkness).toBe(LIGHT_PRESETS.moonlit.darkness);
    // A moon night is cool: the highlight leans blue.
    const hl = parseInt(ATMOSPHERE_GRADES[gradeKey].highlight.slice(1), 16);
    expect(hl & 0xff).toBeGreaterThanOrEqual((hl >> 16) & 0xff);
  });

  it('by day the outdoor acts keep their grade and no night layer', () => {
    const r = resolveAtmosphere({ act: 'act1', biome: 'grassland', timeOverride: 'day' });
    expect(r).toMatchObject({
      gradeKey: 'act1',
      night: false,
      lighting: 'day',
      lightOptions: null,
    });
  });

  it('a castle by day is lit by its wall sconces, with pillar shadows and no night', () => {
    const r = resolveAtmosphere({ act: 'act2', biome: 'castle', battleSeed: 7 });
    expect(r.gradeKey).toBe('act2');
    expect(r.night).toBe(false);
    expect(r.lighting).toBe('indoor');
    expect(r.lightPreset).toBe('hall');
    expect(r.lightOptions.wallTorches).toEqual(WALL_TORCHES);
    expect(r.lightOptions.castShadows).toBe(true);
    // Lighter than any night.
    for (const key of ['moonlit', 'ashfall', 'rime', 'throne', 'deep'])
      expect(r.lightOptions.darkness).toBeLessThan(LIGHT_PRESETS[key].darkness);
  });

  it('a castle at night keeps the night preset and gains the sconces', () => {
    const r = resolveAtmosphere({ act: 'act4', biome: 'castle' });
    expect(r.lightPreset).toBe('ashfall');
    expect(r.lighting).toBe('night');
    expect(r.lightOptions.darkness).toBe(LIGHT_PRESETS.ashfall.darkness);
    expect(r.lightOptions.wallTorches).toEqual(WALL_TORCHES);
    expect(r.lightOptions.emitters.Pillar).toBeDefined();
    expect(r.lightOptions.emitters['Lava Crack']).toEqual(
      LIGHT_PRESETS.ashfall.emitters['Lava Crack'],
    );
    // Outdoors the Act IV night has neither.
    const outdoors = resolveAtmosphere({ act: 'act4', biome: 'grassland' });
    expect(outdoors.lightOptions.wallTorches).toBeUndefined();
    expect(outdoors.lightOptions.emitters.Pillar).toBeUndefined();
  });

  it('a scripted battle in a castle stays the plain dusk with no light layer', () => {
    const r = resolveAtmosphere({ act: 'act2', biome: 'castle', isScripted: true });
    expect(r).toMatchObject({ gradeKey: 'act1', lighting: 'day', lightOptions: null });
  });
});

describe('wallTorchSites', () => {
  const mapOf = (rows) => ({
    cols: rows[0].length,
    rows: rows.length,
    nameAt: (c, r) => ({ W: 'Wall', '.': 'Floor', P: 'Pillar' })[rows[r]?.[c]],
  });

  it('hangs sconces on the south face of a wall run, one in from its end, every `spacing`', () => {
    const map = mapOf(['WWWWWWWWWW', '..........']);
    expect(wallTorchSites(map, { spacing: 4 }).map((s) => s.col)).toEqual([1, 5, 9]);
    for (const s of wallTorchSites(map, { spacing: 4 }))
      expect([s.faceCol, s.faceRow]).toEqual([s.col, 1]);
  });

  it('a wall block lights only its south face; a one-cell stub still gets one', () => {
    const map = mapOf(['WWW..', 'WWW.W', 'WWW..', '.....']);
    const sites = wallTorchSites(map, { spacing: 4 });
    expect(sites).toEqual([
      { col: 4, row: 1, faceCol: 4, faceRow: 2 },
      { col: 1, row: 2, faceCol: 1, faceRow: 3 },
    ]);
  });

  it('a wall facing a pillar or the map edge carries none', () => {
    expect(wallTorchSites(mapOf(['WWW', 'PPP']), { spacing: 1 })).toEqual([]);
    expect(wallTorchSites(mapOf(['...', 'WWW']), { spacing: 1 })).toEqual([]);
  });
});

describe('cloud shadows', () => {
  it('only daylit outdoor Ember Dusk and Bleached Rite have them', () => {
    expect(cloudShadowsFor({ gradeKey: 'act1', biome: 'grassland', lighting: 'day' })).toBe(true);
    expect(cloudShadowsFor({ gradeKey: 'act3', biome: 'swamp', lighting: 'day' })).toBe(true);
    expect(cloudShadowsFor({ gradeKey: 'act2', biome: 'grassland', lighting: 'day' })).toBe(false);
    expect(cloudShadowsFor({ gradeKey: 'act1_night', biome: 'grassland', lighting: 'night' })).toBe(
      false,
    );
    expect(cloudShadowsFor({ gradeKey: 'act2', biome: 'castle', lighting: 'indoor' })).toBe(false);
    expect(cloudShadowsFor({ gradeKey: 'act4', biome: 'volcano', lighting: 'night' })).toBe(false);
    expect(
      cloudShadowsFor({ gradeKey: 'act1', biome: 'grassland', lighting: 'day', isScripted: true }),
    ).toBe(false);
  });

  it('the plan is seeded: same seed, same clouds; another seed, other clouds', () => {
    const a = planCloudShadows({ cols: 20, rows: 13, seed: cloudSeed(42) });
    expect(planCloudShadows({ cols: 20, rows: 13, seed: cloudSeed(42) })).toEqual(a);
    expect(planCloudShadows({ cols: 20, rows: 13, seed: cloudSeed(43) })).not.toEqual(a);
    expect(cloudSeed(42)).not.toBe(cloudSeed(43));
  });

  it('enough clouds cross even a small map, at the spec strength', () => {
    for (const [cols, rows] of [
      [8, 8],
      [12, 12],
      [20, 13],
    ]) {
      const plan = planCloudShadows({ cols, rows, seed: 9 });
      expect(plan.clouds.length).toBeGreaterThanOrEqual(3);
      for (const c of plan.clouds) {
        expect(c.alpha).toBeGreaterThanOrEqual(CLOUD_SHADOW_SPEC.alpha[0]);
        expect(c.alpha).toBeLessThanOrEqual(CLOUD_SHADOW_SPEC.alpha[1]);
        expect(c.vx).toBeGreaterThan(0);
      }
    }
  });

  it('positions drift with time and wrap around the map with the margin', () => {
    const plan = planCloudShadows({ cols: 12, rows: 10, seed: 5 });
    const start = cloudPositionsAt(plan, 0);
    const later = cloudPositionsAt(plan, 3);
    expect(later[0].x).toBeCloseTo(start[0].x + plan.clouds[0].vx * 3);
    for (const t of [0, 10, 100, 1000, 100000]) {
      for (const p of cloudPositionsAt(plan, t)) {
        expect(p.x).toBeGreaterThanOrEqual(-plan.margin);
        expect(p.x).toBeLessThan(plan.cols + plan.margin);
        expect(p.y).toBeGreaterThanOrEqual(-plan.margin);
        expect(p.y).toBeLessThan(plan.rows + plan.margin);
      }
    }
    // A full loop of the wind brings a cloud back where it was.
    const loop = (plan.cols + plan.margin * 2) / plan.clouds[0].vx;
    expect(cloudPositionsAt(plan, loop)[0].x).toBeCloseTo(start[0].x, 6);
    expect(cloudPositionsAt(plan, NaN)).toEqual(start);
  });
});

describe('night weather', () => {
  it('a clear Act I or III night has fireflies; the Act II night keeps its rain', () => {
    expect(weatherKindFor({ gradeKey: 'act1_night', biome: 'grassland' })).toBe('fireflies');
    expect(weatherKindFor({ gradeKey: 'act3_night', biome: 'swamp' })).toBe('fireflies');
    expect(weatherKindFor({ gradeKey: 'act2_night', biome: 'grassland' })).toBe('rain');
    expect(WEATHER_SPECS.fireflies.lifeMs).toBeTruthy();
    expect(
      resolveWeather({ act: 'act1', biome: 'grassland', timeOverride: 'night', battleSeed: 3 }),
    ).toBe('fireflies');
    expect(resolveWeather({ act: 'act1', biome: 'grassland', timeOverride: 'day' })).toBe('none');
  });
});

describe('BattleLightLayer — hall sconces and pillar shadows', () => {
  // A 4x3 hall: a wall run on top, a pillar under the second sconce's floor.
  function hall({ fog = false, rotated = false } = {}) {
    const names = [
      ['Wall', 'Wall', 'Wall', 'Wall'],
      ['Floor', 'Floor', 'Floor', 'Floor'],
      ['Floor', 'Pillar', 'Floor', 'Floor'],
    ];
    const target = () => {
      const t = {
        texture: {},
        setOrigin: () => t,
        setDisplaySize: () => t,
        setDepth: () => t,
        setBlendMode: () => t,
        setAlpha: () => t,
        clear: () => t,
        fill: () => t,
        erase: () => t,
        draw: () => t,
        drawFrame: () => t,
        destroy() {},
      };
      return t;
    };
    const textures = new Set();
    const brush = {
      setDisplaySize() {},
      setAlpha() {},
      setTint() {},
      clearTint() {},
      setRotation() {},
      destroy() {},
    };
    const grid = {
      cols: 4,
      rows: 3,
      offsetX: 0,
      offsetY: 0,
      terrainRevision: 0,
      fogEnabled: fog,
      visibleSet: new Set(['1,0', '1,1', '1,2', '0,1']),
      isVisible(c, r) {
        return this.visibleSet.has(`${c},${r}`);
      },
      getTerrainAt: (c, r) => ({ name: names[r]?.[c] }),
    };
    if (rotated) {
      // A quarter turn as portrait play draws it: display (dc, dr) shows game (dr, rows-1-dc).
      grid.board = {
        displayCols: 3,
        displayRows: 4,
        fromDisplay: (dc, dr) => ({ col: dr, row: 2 - dc }),
        toDisplay: (c, r) => ({ col: 2 - r, row: c }),
      };
      grid.displayCellOf = (c, r) => grid.board.toDisplay(c, r);
    }
    const scene = {
      grid,
      playerUnits: [],
      npcUnits: [],
      enemyUnits: [],
      textures: {
        exists: (k) => textures.has(k),
        remove: (k) => textures.delete(k),
        addDynamicTexture: (k) => (textures.add(k), target()),
        createCanvas: (k) => {
          textures.add(k);
          return {
            getContext: () => ({
              createRadialGradient: () => ({ addColorStop() {} }),
              fillRect() {},
            }),
            refresh() {},
          };
        },
      },
      add: { renderTexture: () => target() },
      make: { image: () => brush },
      events: { on() {}, off() {} },
    };
    return scene;
  }

  it('hangs a lit sconce on the wall face and shades the pillar away from it', () => {
    const layer = new BattleLightLayer(hall(), LIGHT_PRESETS.hall).create();
    const flames = layer._emitters.filter((e) => e.flame);
    // Run of 4, spacing 4: one sconce, one cell in (col 1), on the wall's south face.
    expect(flames).toHaveLength(1);
    expect(flames[0].x).toBeCloseTo(1.5 * 32);
    expect(flames[0].y).toBeCloseTo(0.95 * 32);
    const shadows = layer._pillarShadows();
    expect(shadows).toHaveLength(1);
    // The pillar at (1,2) is straight below the sconce: its shadow falls further down.
    expect(shadows[0].x).toBeCloseTo(1.5 * 32);
    expect(shadows[0].y).toBeGreaterThan(2.5 * 32);
    expect(shadows[0].rotation).toBeCloseTo(Math.PI / 2);
  });

  it('a sconce over hidden floor stays dark, and so does a hidden pillar', () => {
    const scene = hall({ fog: true });
    scene.grid.visibleSet = new Set(['0,1']);
    const layer = new BattleLightLayer(scene, LIGHT_PRESETS.hall).create();
    expect(layer._emitters.filter((e) => e.flame)).toHaveLength(0);
    expect(layer._casters).toHaveLength(0);
  });

  it('no sconces or shadows without the hall options (an outdoor night)', () => {
    const layer = new BattleLightLayer(hall(), LIGHT_PRESETS.ashfall).create();
    expect(layer._emitters.filter((e) => e.flame)).toHaveLength(0);
    expect(layer._pillarShadows()).toEqual([]);
  });

  it('on a turned (portrait) board the sconce hangs on the face drawn facing down', () => {
    const layer = new BattleLightLayer(hall({ rotated: true }), LIGHT_PRESETS.hall).create();
    // Drawn, the wall is the right-hand column: no drawn wall cell has open floor below
    // it except the bottom of that column, which runs off the board. So none.
    const flames = layer._emitters.filter((e) => e.flame);
    for (const f of flames) {
      // Every sconce's drawn floor cell is just below its wall cell.
      const dc = Math.floor(f.x / 32);
      const dr = Math.floor((f.y - 0.45 * 32) / 32);
      const wall = layer.scene.grid.board.fromDisplay(dc, dr);
      const floor = layer.scene.grid.board.fromDisplay(dc, dr + 1);
      expect(layer.scene.grid.getTerrainAt(wall.col, wall.row).name).toBe('Wall');
      expect(layer.scene.grid.getTerrainAt(floor.col, floor.row).name).not.toBe('Wall');
    }
    expect(flames).toHaveLength(0);
  });
});
