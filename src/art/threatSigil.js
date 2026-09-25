// threatSigil — pixel art for "this enemy can reach that tile" (pure, no Phaser).
//
// A crimson eye that opens above a threatening enemy's head: the player's request
// was literally "turn the enemies' eyes red". Drawn on the 1-px art grid (the
// battle world is 640x480 art pixels): ink outline and a soft outer glow so it
// reads over every act grade and terrain, a bright iris with a slit pupil and a
// warm glint so it cannot be mistaken for an HP pip or an affix. The status
// variant (sleep / silence staves) is violet.

const EYE = [
  '......#####......',
  '...###RRRRR###...',
  '.##RRRROOORRRR##.',
  '#RRRROOOPOOORRRR#',
  '#RRRROOWPOOORRRR#',
  '#RRRROOOPOOORRRR#',
  '.##RRRROOORRRR##.',
  '...###RRRRR###...',
  '......#####......',
];

// RGBA. Ink = --re-threat-ink, lid = --re-threat-fill, iris = --re-threat-edge,
// glint = --re-ember-pale, glow = threat-edge at low alpha. Status: unlight ramp.
const PALETTES = {
  damage: {
    '#': [28, 6, 9, 255],
    R: [200, 50, 44, 255],
    O: [255, 106, 72, 255],
    P: [28, 6, 9, 255],
    W: [255, 240, 189, 255],
    glow: [255, 106, 72, 110],
  },
  status: {
    '#': [23, 12, 36, 255],
    R: [118, 58, 160, 255],
    O: [185, 142, 224, 255],
    P: [23, 12, 36, 255],
    W: [244, 236, 219, 255],
    glow: [185, 142, 224, 110],
  },
};

const PAD = 1; // one pixel of glow around the outline
export const THREAT_SIGIL_SIZE = Object.freeze({
  width: EYE[0].length + PAD * 2,
  height: EYE.length + PAD * 2,
});

/** @returns {{ width: number, height: number, data: Uint8ClampedArray }} */
export function rasterizeThreatSigil(variant = 'damage') {
  const palette = PALETTES[variant] || PALETTES.damage;
  const { width, height } = THREAT_SIGIL_SIZE;
  const data = new Uint8ClampedArray(width * height * 4);
  const solid = (x, y) => {
    const line = EYE[y - PAD];
    const ch = line?.[x - PAD];
    return Boolean(ch && ch !== '.');
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = EYE[y - PAD]?.[x - PAD];
      let color = ch && ch !== '.' ? palette[ch] : null;
      if (!color) {
        const touches = solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1);
        if (touches) color = palette.glow;
      }
      if (color) data.set(color, (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

export function threatSigilTextureKey(variant = 'damage') {
  return `threat-sigil-${variant === 'status' ? 'status' : 'damage'}`;
}

/** Build (once) the canvas texture for a sigil variant; returns its key or null. */
export function ensureThreatSigilTexture(scene, variant = 'damage') {
  const key = threatSigilTextureKey(variant);
  const textures = scene?.textures;
  if (!textures?.exists) return null;
  if (textures.exists(key)) return key;
  if (typeof textures.createCanvas !== 'function') return null;
  const img = rasterizeThreatSigil(variant);
  const tex = textures.createCanvas(key, img.width, img.height);
  const ctx = tex?.getContext?.();
  if (!ctx) return null;
  const imageData = ctx.createImageData(img.width, img.height);
  imageData.data.set(img.data);
  ctx.putImageData(imageData, 0, 0);
  tex.refresh();
  return key;
}
