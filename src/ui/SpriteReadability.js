// A small palette lift for legacy player art. Keep transparent pixels and the
// darkest ink intact; warm skin/hair retain their hue. No source assets change.
export function liftPlayerPalette(pixels) {
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    const r = pixels[i],
      g = pixels[i + 1],
      b = pixels[i + 2];
    const light = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (light < 22 || light > 225) continue;
    const weight = Math.min(1, (light - 22) / 30, (225 - light) / 55);
    const lift = 24 * weight;
    const cool = b > r * 1.06 && b >= g * 0.9;
    for (let c = 0; c < 3; c++) {
      const accent = cool ? [0, 5, 14][c] * weight : 0;
      pixels[i + c] = Math.round(
        Math.max(0, Math.min(255, light + (pixels[i + c] - light) * 1.2 + lift + accent)),
      );
    }
  }
  return pixels;
}

export function usesPlayerPaletteLift(key) {
  return /^(rebuilt-)?(archer|myrmidon|duelist|knight)$/.test(key);
}
