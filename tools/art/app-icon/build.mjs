// build.mjs — render the app-icon candidates and their comparison sheets.
//
//   node tools/art/app-icon/build.mjs            # candidates + sheets
//   node tools/art/app-icon/build.mjs --no-sheet # candidates only
//
// Writes docs/art-direction/app-icon/<id>.png (1024 x 1024, opaque, full-bleed, no text)
// and the sheets (see sheet.mjs). Deterministic: no Math.random anywhere.
// To ship a candidate: npm run gen:icons -- --from docs/art-direction/app-icon/<id>.png

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONCEPTS, renderConcept } from './concepts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const OUT_DIR = join(root, 'docs', 'art-direction', 'app-icon');

/**
 * Encode a 1024 master. The art has far fewer than 256 colours, so an indexed PNG is
 * lossless here — verified pixel-for-pixel before it is written (falls back to RGB).
 */
async function encodeMaster(plate) {
  const rgb = await sharp(await plate.png(1024))
    .removeAlpha()
    .raw()
    .toBuffer();
  const indexed = await sharp(rgb, { raw: { width: 1024, height: 1024, channels: 3 } })
    .png({ palette: true, colours: 256, dither: 0, compressionLevel: 9, effort: 10 })
    .toBuffer();
  const back = await sharp(indexed).removeAlpha().raw().toBuffer();
  if (back.equals(rgb)) return indexed;
  return sharp(rgb, { raw: { width: 1024, height: 1024, channels: 3 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

export async function buildCandidates() {
  await mkdir(OUT_DIR, { recursive: true });
  const files = [];
  for (const c of CONCEPTS) {
    const png = await encodeMaster(renderConcept(c));
    const file = join(OUT_DIR, `${c.id}.png`);
    await writeFile(file, png);
    files.push({ ...c, file });
    console.log(
      `wrote docs/art-direction/app-icon/${c.id}.png (${(png.length / 1024).toFixed(0)} KB)`,
    );
  }
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = await buildCandidates();
  if (!process.argv.includes('--no-sheet')) {
    const { buildSheets } = await import('./sheet.mjs');
    await buildSheets(files);
  }
}
