// Generate map preview PNGs for castle biome templates
// Usage: node tools/generateMapPreviews.js [--template <id>] [--all]
// Outputs to test-results/map-previews/

import sharp from 'sharp';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dataDir = join(root, 'data');
const tileDir = join(root, 'assets', 'sprites', 'tilesets');
const outDir = join(root, 'test-results', 'map-previews');

const TILE_SIZE = 32;

// ---------- Data loading (same pattern as tests/testData.js) ----------

function loadJSON(filename) {
  return JSON.parse(readFileSync(join(dataDir, filename), 'utf-8'));
}

function loadGameData() {
  return {
    terrain: loadJSON('terrain.json'),
    classes: loadJSON('classes.json'),
    weapons: loadJSON('weapons.json'),
    mapSizes: loadJSON('mapSizes.json'),
    mapTemplates: loadJSON('mapTemplates.json'),
    enemies: loadJSON('enemies.json'),
    recruits: loadJSON('recruits.json'),
    affixes: loadJSON('affixes.json'),
    difficulty: loadJSON('difficulty.json'),
  };
}

// ---------- Terrain name normalization (mirrors Grid.js) ----------

function normalizeTerrainName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/ /g, '_');
}

// ---------- Tile buffer cache ----------

const tileCache = new Map();

async function getTileBuffer(terrainName, biome) {
  const baseName = normalizeTerrainName(terrainName);

  // Try biome variant first (e.g., wall_castle)
  if (biome) {
    const biomeKey = `${baseName}_${biome}`;
    if (!tileCache.has(biomeKey)) {
      try {
        const buf = await sharp(join(tileDir, `${biomeKey}.png`)).toBuffer();
        tileCache.set(biomeKey, buf);
      } catch {
        // Fall through to base
      }
    }
    if (tileCache.has(biomeKey)) return tileCache.get(biomeKey);
  }

  // Base tile
  if (!tileCache.has(baseName)) {
    try {
      const buf = await sharp(join(tileDir, `${baseName}.png`)).toBuffer();
      tileCache.set(baseName, buf);
    } catch {
      // Generate a colored fallback rectangle
      const TERRAIN_COLORS = {
        plain: [126, 200, 80],
        forest: [45, 106, 30],
        mountain: [139, 115, 85],
        fort: [184, 160, 122],
        throne: [218, 165, 32],
        wall: [74, 74, 74],
        water: [34, 102, 170],
        bridge: [139, 108, 66],
        sand: [212, 185, 106],
        village: [196, 112, 53],
        ice: [153, 204, 238],
        lava_crack: [204, 68, 0],
        floor: [144, 144, 160],
        pillar: [96, 104, 120],
      };
      const [r, g, b] = TERRAIN_COLORS[baseName] || [128, 128, 128];
      const buf = await sharp({
        create: { width: TILE_SIZE, height: TILE_SIZE, channels: 3, background: { r, g, b } },
      })
        .png()
        .toBuffer();
      tileCache.set(baseName, buf);
    }
  }
  return tileCache.get(baseName);
}

// ---------- Spawn marker generation ----------

async function makeMarker(color, size = TILE_SIZE) {
  const half = Math.floor(size / 2);
  // Create a semi-transparent colored circle-ish marker
  const svg = `<svg width="${size}" height="${size}">
    <rect x="4" y="4" width="${size - 8}" height="${size - 8}" rx="4" ry="4"
          fill="${color}" fill-opacity="0.7" stroke="white" stroke-width="1"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ---------- Map rendering ----------

async function renderMap(battleConfig, biome, gameData) {
  const { mapLayout, cols, rows, playerSpawns, enemySpawns, npcSpawn, thronePos } = battleConfig;

  const width = cols * TILE_SIZE;
  const height = rows * TILE_SIZE;

  // Build composite operations: terrain tiles
  const composites = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const terrainIdx = mapLayout[r][c];
      const terrainEntry = gameData.terrain[terrainIdx];
      const terrainName = terrainEntry ? terrainEntry.name : 'Plain';
      const tileBuf = await getTileBuffer(terrainName, biome);
      composites.push({
        input: tileBuf,
        left: c * TILE_SIZE,
        top: r * TILE_SIZE,
      });
    }
  }

  // Spawn markers
  const playerMarker = await makeMarker('#3366cc');
  const enemyMarker = await makeMarker('#cc3333');
  const npcMarker = await makeMarker('#33cc66');
  const throneMarker = await makeMarker('#daa520');

  if (thronePos) {
    composites.push({
      input: throneMarker,
      left: thronePos.col * TILE_SIZE,
      top: thronePos.row * TILE_SIZE,
    });
  }

  for (const sp of playerSpawns || []) {
    composites.push({ input: playerMarker, left: sp.col * TILE_SIZE, top: sp.row * TILE_SIZE });
  }

  for (const sp of enemySpawns || []) {
    composites.push({ input: enemyMarker, left: sp.col * TILE_SIZE, top: sp.row * TILE_SIZE });
  }

  if (npcSpawn) {
    composites.push({
      input: npcMarker,
      left: npcSpawn.col * TILE_SIZE,
      top: npcSpawn.row * TILE_SIZE,
    });
  }

  // Compose final image
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  });

  return base.composite(composites).png().toBuffer();
}

// ---------- Main ----------

async function main() {
  const args = process.argv.slice(2);
  const templateIdArg = args.includes('--template') ? args[args.indexOf('--template') + 1] : null;
  const allMode = args.includes('--all');

  const gameData = loadGameData();

  // Dynamic import of MapGenerator (ES module)
  const { generateBattle, pickTemplate, rollBiome } = await import(
    'file://' + join(root, 'src', 'engine', 'MapGenerator.js').replace(/\\/g, '/')
  );

  mkdirSync(outDir, { recursive: true });

  // Determine which templates to render
  const castleTemplates = [
    ...gameData.mapTemplates.rout.filter((t) => t.biome === 'castle'),
    ...gameData.mapTemplates.seize.filter((t) => t.biome === 'castle'),
  ];

  let templates;
  if (templateIdArg) {
    const all = [...gameData.mapTemplates.rout, ...gameData.mapTemplates.seize];
    const match = all.find((t) => t.id === templateIdArg);
    if (!match) {
      console.error(
        `Template "${templateIdArg}" not found. Available: ${all.map((t) => t.id).join(', ')}`,
      );
      process.exit(1);
    }
    templates = [match];
  } else if (allMode) {
    templates = [...gameData.mapTemplates.rout, ...gameData.mapTemplates.seize];
  } else {
    templates = castleTemplates;
  }

  if (templates.length === 0) {
    console.log('No templates to render.');
    return;
  }

  const summary = [];

  for (const template of templates) {
    const objective = gameData.mapTemplates.rout.includes(template) ? 'rout' : 'seize';
    const biome = template.biome || 'grassland';
    const act = template.acts ? template.acts[0] : 'act2';

    console.log(`Generating: ${template.id} (${biome}, ${objective}, act=${act})...`);

    const deps = {
      terrain: gameData.terrain,
      mapSizes: gameData.mapSizes,
      mapTemplates: gameData.mapTemplates,
      enemies: gameData.enemies,
      recruits: gameData.recruits,
      classes: gameData.classes,
      weapons: gameData.weapons,
      affixes: gameData.affixes,
      difficulty: gameData.difficulty,
    };

    const bc = generateBattle(
      { act, objective, templateId: template.id, difficultyId: 'normal' },
      deps,
    );

    const pngBuf = await renderMap(bc, biome, gameData);
    const filename = `${template.id}.png`;
    const filepath = join(outDir, filename);
    writeFileSync(filepath, pngBuf);

    summary.push({
      file: filepath,
      templateId: template.id,
      biome,
      objective,
      size: `${bc.cols}x${bc.rows}`,
    });

    console.log(`  -> ${filename} (${bc.cols}x${bc.rows})`);
  }

  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\nDone! ${summary.length} previews saved to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
