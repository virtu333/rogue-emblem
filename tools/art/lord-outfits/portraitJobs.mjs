// The outfit portraits the PC-98 pass renders (tools/art/portrait-variants/prepare.mjs and
// tools/art/pc98/build.mjs): one job per picked take (picks.json), id
// `lord_<lord>[_promoted]__<outfit>` (engine/LordOutfits.outfitPortraitId), a lazily loaded
// figure like a portrait variant.
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { outfitPortraitId } from '../../../src/engine/LordOutfits.js';
import { OUTFIT_BY_ID } from './outfits.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
export const OUTFIT_RAW = join(ROOT, 'References/lord-outfits/raw');
const PICKS = join(ROOT, 'tools/art/lord-outfits/picks.json');

const rawOf = (name) =>
  ['.png', '.jpg'].map((e) => join(OUTFIT_RAW, name + e)).find((f) => existsSync(f)) || null;

/** `[{ id, mode: 'outfit', side: 'player', className, raw }]` for every picked take. */
export function outfitPortraitJobs() {
  const { picks = {} } = existsSync(PICKS) ? JSON.parse(readFileSync(PICKS, 'utf8')) : {};
  const jobs = [];
  for (const [outfitId, pick] of Object.entries(picks)) {
    const outfit = OUTFIT_BY_ID[outfitId];
    if (!outfit) throw new Error(`picks.json: unknown outfit ${outfitId}`);
    for (const promoted of [false, true]) {
      const take = promoted ? pick.promoted : pick.base;
      if (!take) continue;
      jobs.push({
        id: outfitPortraitId(outfit.lord, outfitId, { promoted }),
        mode: 'outfit',
        side: 'player',
        className: outfit.lord,
        raw: rawOf(`${outfitId}${promoted ? '_promoted' : ''}-t${take}`),
      });
    }
  }
  return jobs;
}
