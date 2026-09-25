// Generates ../graph-data.js from the REAL act generator (src/engine/NodeMapGenerator.js)
// and real data files. Math.random is swapped for a seeded Mulberry32 so the board is
// reproducible; the generator itself is imported unchanged.
//
//   node docs/art-direction/board/loom/gen/generate-graph.mjs [seed] [actId]
//
// Defaults: seed 6, act1 (a map that exercises every node type: battle, elite,
// recruit, village, church, colosseum, ruins, boss).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(repo, p), 'utf8'));

const seed = Number(process.argv[2] ?? 6) >>> 0;
const actId = process.argv[3] || 'act1';

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const { generateNodeMap } = await import(path.join(repo, 'src/engine/NodeMapGenerator.js'));
const { ACT_CONFIG } = await import(path.join(repo, 'src/utils/constants.js'));
const mapTemplates = readJson('data/mapTemplates.json');
const colosseum = readJson('data/colosseum.json');
const dialogue = readJson('data/dialogue.json');
const regions = readJson('data/regions.json');
const lords = readJson('data/lords.json');

// Same option shape RunManager passes on Normal difficulty with no meta upgrades.
const realRandom = Math.random;
Math.random = mulberry32(seed);
const map = generateNodeMap(actId, ACT_CONFIG[actId], mapTemplates, {
  fogChanceBonus: 0,
  halfFogChance: true,
  villageAmbushChance: 0,
  colosseumConfig: colosseum.nodeGeneration ?? null,
  caravanChanceBonus: 0,
});
Math.random = realRandom;

const templates = Object.values(mapTemplates).flat();
const hash = (s) => {
  let h = 0x811c9dc5;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return (h ^ (h >>> 15)) >>> 0;
};
// Rotate through each flavor list in node order (seeded offset) so neighbours differ.
const rotation = new Map();
const pick = (list, id) => {
  if (!list || !list.length) return null;
  const i = rotation.has(list) ? rotation.get(list) + 1 : hash(`${seed}:${id}`) % list.length;
  rotation.set(list, i);
  return list[i % list.length];
};

function flavorFor(node) {
  const nf = dialogue.nodeFlavor || {};
  if (node.type === 'battle')
    return pick((node.battleParams?.isElite ? nf.elite : nf.battle)?.[actId], node.id);
  if (node.type === 'boss') return pick(nf.boss?.[actId], node.id);
  if (node.type === 'recruit') return pick(nf.recruit?.[actId], node.id);
  if (node.type === 'shop') return pick(dialogue.shopFlavor?.[actId], node.id);
  return null;
}

const nodes = map.nodes.map((n) => {
  const t = templates.find((x) => x.id === n.templateId);
  return {
    id: n.id,
    row: n.row,
    col: n.col,
    type: n.type,
    edges: n.edges,
    elite: !!n.battleParams?.isElite,
    objective: n.battleParams?.objective || null,
    levelRange: n.battleParams?.levelRange || null,
    fog: !!n.fogEnabled,
    village: !!n.battleParams?.hasVillage,
    caravan: !!n.battleParams?.hasCaravan,
    template: t ? { id: t.id, name: t.name, lore: t.lore } : null,
    flavor: flavorFor(n),
  };
});

// Board states. Paths are chosen from real edges, not invented.
const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
function walk(ids) {
  for (let i = 1; i < ids.length; i++)
    if (!byId[ids[i - 1]].edges.includes(ids[i]))
      throw new Error(`No edge ${ids[i - 1]} -> ${ids[i]} for seed ${seed}`);
  return ids;
}
const start = map.startNodeId;
const states = { start: { completed: [], current: null, selected: start } };
if (seed === 6 && actId === 'act1') {
  states.choice = { completed: walk([start]), current: start, selected: 'act1_1_2' };
  states.mid = {
    completed: walk([start, 'act1_1_2', 'act1_2_2', 'act1_3_2']),
    current: 'act1_3_2',
    selected: 'act1_4_1',
  };
  states.future = { ...states.mid, selected: 'act1_5_2' };
  states.cut = { ...states.mid, selected: 'act1_5_4' };
} else {
  const first = byId[start].edges[0];
  states.choice = { completed: [start], current: start, selected: first };
}

const lordList = Array.isArray(lords) ? lords : lords.lords || Object.values(lords);
const lordStat = (name) => lordList.find((l) => l.name === name) || {};
const party = ['Edric', 'Sera'].map((name) => {
  const l = lordStat(name);
  return { name, className: l.class || l.className || '', maxHP: l.baseStats?.HP ?? 20 };
});

const out = {
  generatedBy: 'gen/generate-graph.mjs',
  seed,
  actId,
  actIndex: Object.keys(ACT_CONFIG).indexOf(actId),
  actName: ACT_CONFIG[actId].name,
  region: regions[actId] || '',
  rows: ACT_CONFIG[actId].rows,
  startNodeId: map.startNodeId,
  bossNodeId: map.bossNodeId,
  nodes,
  states,
  party,
};
const js = `// Generated by gen/generate-graph.mjs (seed ${seed}, ${actId}). Do not edit by hand.\nwindow.LOOM_DATA = ${JSON.stringify(out, null, 1)};\n`;
fs.writeFileSync(path.join(here, '..', 'graph-data.js'), js);
console.log(`wrote graph-data.js: ${nodes.length} nodes, seed ${seed}, ${actId}`);
