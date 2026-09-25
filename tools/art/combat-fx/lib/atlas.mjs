// In-memory build of the whole FX atlas (used by the CLI, review sheets and tests).
import { Palette } from './raster.mjs';
import { renderAnim } from './build.mjs';
import { packAtlas } from './pack.mjs';
import { ALL_ANIMS } from './anims.mjs';

async function formatJson(value) {
  const prettier = await import('prettier');
  return prettier.format(JSON.stringify(value), {
    parser: 'json',
    printWidth: 100,
  });
}

/** Render every effect; returns rendered frames, the palette and the packed atlas. */
export function renderAll() {
  const palette = new Palette();
  const rendered = ALL_ANIMS.map((def) => renderAnim(def, palette));
  return { palette, rendered };
}

export async function buildAtlas() {
  const { palette, rendered } = renderAll();
  const packed = packAtlas(rendered, palette);
  const anims = {
    version: 1,
    atlas: 'fx_atlas',
    size: [packed.stats.width, packed.stats.height],
    anims: packed.anims,
  };
  return {
    palette,
    rendered,
    anims: packed.anims,
    stats: packed.stats,
    files: {
      png: packed.png,
      json: await formatJson(packed.json),
      anims: await formatJson(anims),
    },
  };
}
