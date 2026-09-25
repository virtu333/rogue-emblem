// CPU port of the battle grade (src/art/AtmosphereFX.js fragment shader) and the night
// darkness (src/art/BattleLightLayer.js), for review sheets only. Colour grading only:
// the vignette, grain and chromatic rim frame the whole screen, so small review crops
// leave them out.
import {
  resolveAtmosphere,
  gradeToUniforms,
  hexToRgb01,
} from '../../../../src/art/atmosphereConfig.js';

/** Grade + night preset for a review ground (pure). */
export function moodFor({ act, biome }) {
  const mood = resolveAtmosphere({ act, biome });
  return {
    label: mood.label,
    uniforms: gradeToUniforms(mood.grade, { reduced: false }),
    night: mood.night ? mood.lightOptions : null,
  };
}

/** Night darkness over the ground (before units and effects), in place. */
export function applyNight(rgba, w, h, night) {
  if (!night) return;
  const [cr, cg, cb] = hexToRgb01(night.color).map((v) => v * 255);
  const a = night.darkness;
  for (let i = 0; i < w * h * 4; i += 4) {
    rgba[i] = rgba[i] * (1 - a) + cr * a;
    rgba[i + 1] = rgba[i + 1] * (1 - a) + cg * a;
    rgba[i + 2] = rgba[i + 2] * (1 - a) + cb * a;
  }
}

/** The shader's colour pipeline (exposure, saturation, contrast, split tone, key light). */
export function applyGrade(rgba, w, h, u) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r = (rgba[i] / 255) * u.exposure;
      let g = (rgba[i + 1] / 255) * u.exposure;
      let b = (rgba[i + 2] / 255) * u.exposure;
      let l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * u.sat;
      g = l + (g - l) * u.sat;
      b = l + (b - l) * u.sat;
      r = (r - 0.5) * u.contrast + 0.5;
      g = (g - 0.5) * u.contrast + 0.5;
      b = (b - 0.5) * u.contrast + 0.5;
      l = Math.min(1, Math.max(0, 0.299 * r + 0.587 * g + 0.114 * b));
      const ws = (1 - l) * (1 - l);
      const wh = l * l;
      r += (u.shadow[0] * ws + u.highlight[0] * wh) * u.split;
      g += (u.shadow[1] * ws + u.highlight[1] * wh) * u.split;
      b += (u.shadow[2] * ws + u.highlight[2] * wh) * u.split;
      // Key light from the upper-left, measured over the crop.
      const fx = x / w - 0.5;
      const fy = 0.5 - y / h;
      const keyT = Math.min(1, Math.max(0, 0.5 + (-fx + fy) * 0.9));
      const kr = 0.88 + (1.12 - 0.88) * keyT;
      const kg = 0.9 + (1.0 - 0.9) * keyT;
      const kb = 1.04 + (0.84 - 1.04) * keyT;
      r *= 1 + (kr - 1) * u.key * 3;
      g *= 1 + (kg - 1) * u.key * 3;
      b *= 1 + (kb - 1) * u.key * 3;
      rgba[i] = Math.round(Math.min(1, Math.max(0, r)) * 255);
      rgba[i + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
      rgba[i + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
    }
}
