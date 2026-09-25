#!/usr/bin/env node
// Write tools/art/icons/hero/selections.json from the curation decisions below: every
// item with a hero subject gets its reviewed candidate (the first take unless a later
// take was picked), and the model that produced it is recorded from its provenance.
//   node tools/art/icons/hero/select.mjs
// Review notes live here so the next curation pass can see why a take was chosen.
import fs from 'node:fs';
import prettier from 'prettier';
import { HERO_SUBJECTS } from './prompts.mjs';

const RAW = 'References/items-art/hero/raw';
const OUT = 'tools/art/icons/hero/selections.json';

/** id -> [source take, note]. Everything else: take 1, approved at display size. */
const PICKS = {
  'iron-bow': ['flash-t2', 'Take 1 was a hairline at 96 px; take 2 carries an arrow and reads.'],
  longbow: ['flash-t2', 'Take 2 is the clearer silhouette; bows stay thin by nature.'],
  'counter-seal': ['flash-t1', 'Re-prompted: the first take drew a war-medal cross.'],
  sunflare: ['flash-t1', 'Re-prompted: a sunburst instead of a star that read as an emblem.'],
  tomahawk: ['flash-t1', 'Re-prompted without feathers.'],
  'recoil-guard': ['flash-t1', 'Re-prompted: a boss instead of a crusader cross.'],
  'vanguard-crest': ['flash-t1', 'Re-prompted: a spearhead instead of a red star.'],
  remedy: ['flash-t1', 'Re-prompted twice: striped tins were palette artefacts.'],
  'barrier-ring': ['flash-t1', 'Re-prompted for a plain band.'],
  'skill-ring': ['flash-t1', 'Re-prompted for a plain band.'],
  'shield-ring': ['flash-t1', 'Re-prompted for a plain band.'],
  'silence-staff': ['flash-t1', 'Re-prompted: no rainbow ring.'],
  'tempest-blade': ['flash-t1', 'Re-prompted: no wind ribbons.'],
  'silver-sword': ['flash-t1', 'Re-prompted: the first take striped the blade red and gold.'],
  'binding-imbuing-stone': ['flash-t1', 'Re-prompted: earth-brown snapped to gold; now olive.'],
};

const items = {};
for (const id of Object.keys(HERO_SUBJECTS)) {
  const [take, note] = PICKS[id] || ['flash-t1', null];
  const source = `${id}-${take}`;
  const rec = `${RAW}/${source}.gen.json`;
  if (!fs.existsSync(rec)) {
    items[id] = { approved: false, reason: 'no candidate' };
    continue;
  }
  const { model, hash } = JSON.parse(fs.readFileSync(rec, 'utf8'));
  items[id] = { approved: true, source, model, hash, ...(note ? { note } : {}) };
}
const doc = {
  note: 'Painted heroes (direction B) approved at 96 px on the detail-pane plate. Candidates: References/items-art/hero/cand; raw + provenance: References/items-art/hero/raw.',
  items,
};
fs.writeFileSync(
  OUT,
  await prettier.format(JSON.stringify(doc), {
    ...(await prettier.resolveConfig(OUT)),
    parser: 'json',
  }),
);
const approved = Object.values(items).filter((i) => i.approved).length;
console.log(`${approved}/${Object.keys(items).length} approved -> ${OUT}`);
