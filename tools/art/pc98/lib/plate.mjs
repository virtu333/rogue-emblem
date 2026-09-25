// Faction backdrop plates: two 12-bit tones from the art-bible ramps,
// dithered top -> bottom through PC-98 pattern levels (pure).
import { snap12, parseHex } from './color.mjs';
import { bayer } from './raster.mjs';

// ART_BIBLE ramps (docs/art-direction/ART_BIBLE.md). Top tone is the dark ink
// of the scene; bottom tone is the faction's light, as if lit from below.
export const FACTION_PLATES = Object.freeze({
  ember: { label: 'Lords (ember-ink)', top: '#16131e', bottom: '#4f2c16' },
  steel: { label: 'Player units (steel)', top: '#0e0c14', bottom: '#1c2f4f' },
  blood: { label: 'Enemies & bosses (blood)', top: '#16131e', bottom: '#44111c' },
  verdigris: { label: 'Allies (verdigris)', top: '#0e0c14', bottom: '#1b4239' },
  unlight: { label: 'Corrupted (unlight)', top: '#07060b', bottom: '#2c1645' },
});

export const FACTIONS = Object.freeze(Object.keys(FACTION_PLATES));

export function plateColours(faction) {
  const plate = FACTION_PLATES[faction] || FACTION_PLATES.steel;
  return { top: snap12(parseHex(plate.top)), bottom: snap12(parseHex(plate.bottom)) };
}

/** Pattern level (0, .25, .5, .75, 1) of the bottom tone at a row. */
export function plateLevel(y, size) {
  const v = (y + 0.5) / size;
  const t = Math.min(1, Math.max(0, (v - 0.22) / 0.7));
  return Math.round(t * 4) / 4;
}

/** Index map (0 = top tone, 1 = bottom tone) for a size x size plate. */
export function renderPlate(size) {
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    const level = plateLevel(y, size);
    for (let x = 0; x < size; x++) out[y * size + x] = level > bayer(x, y) ? 1 : 0;
  }
  return out;
}
