// The combat FX generator (tools/art/combat-fx) is deterministic: a rebuild is
// byte-identical, and the committed atlas, atlas JSON and animation table match it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { buildAtlas } from '../tools/art/combat-fx/lib/atlas.mjs';
import { ART_RAMPS } from '../src/art/combatFx/fxPalette.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('combat FX generator', () => {
  it('rebuilds byte-identically and matches the committed files', async () => {
    const [a, b] = [await buildAtlas(), await buildAtlas()];
    expect(Buffer.compare(a.files.png, b.files.png)).toBe(0);
    expect(a.files.json).toBe(b.files.json);
    expect(a.files.anims).toBe(b.files.anims);
    expect(readFileSync(join(ROOT, 'assets/sprites/fx/fx_atlas.json'), 'utf8')).toBe(a.files.json);
    expect(readFileSync(join(ROOT, 'src/art/combatFx/fxAnims.json'), 'utf8')).toBe(a.files.anims);
    // Compare decoded pixels (robust to zlib builds), plus exact bytes on this toolchain.
    const decode = async (buf) => (await sharp(buf).ensureAlpha().raw().toBuffer()).toString('hex');
    const committed = readFileSync(join(ROOT, 'assets/sprites/fx/fx_atlas.png'));
    expect(await decode(committed)).toBe(await decode(a.files.png));
    expect(
      readFileSync(join(ROOT, 'public/assets/sprites/fx/fx_atlas.png')).equals(committed),
    ).toBe(true);
  }, 30000);

  it('stays one small atlas in the Ink & Ember palette with hard edges', async () => {
    const built = await buildAtlas();
    const { width, height, decodedBytes } = built.stats;
    expect(width).toBeLessThanOrEqual(1024);
    expect(height).toBeLessThanOrEqual(1024);
    expect(decodedBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    const allowed = new Set([...Object.values(ART_RAMPS).flat(), '#ffffff']);
    for (const hex of built.palette.hex.slice(1)) expect(allowed.has(hex), hex).toBe(true);
    const { data, info } = await sharp(built.files.png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let i = 3; i < info.width * info.height * 4; i += 4) {
      if (data[i] !== 0 && data[i] !== 255) throw new Error(`soft alpha at ${i}`);
    }
  }, 30000);

  it('keeps the old effect keys and gives every effect exact frame timing', async () => {
    const { anims } = await buildAtlas();
    for (const key of [
      'fx_slash',
      'fx_chop',
      'fx_thrust',
      'fx_arrow',
      'fx_magic',
      'fx_light',
      'fx_heal',
      'fx_crit',
      'fx_pierce',
      'fx_drain',
      'fx_shield',
      'fx_flurry',
      'fx_buff',
      'fx_status',
      'fx_ring',
      'fx_sig_sword',
      'fx_sig_lance',
      'fx_sig_axe',
      'fx_sig_bow',
      'fx_sig_magic',
      'fx_sig_entity',
      'fx_sig_enrage',
    ])
      expect(anims[key], key).toBeTruthy();
    for (const [key, anim] of Object.entries(anims)) {
      expect(anim.durations.length, key).toBe(anim.frames);
      if (anim.role === 'impact') expect(anim.frames, key).toBeGreaterThanOrEqual(6);
      if (anim.role === 'signature') expect(anim.frames, key).toBeGreaterThanOrEqual(10);
    }
  }, 30000);
});
