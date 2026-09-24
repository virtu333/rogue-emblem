// Skin-tone test in OKLab (pure): warm hues, moderate chroma, mid-light.
import { chroma, hue } from './color.mjs';

export function isSkinLab(lab) {
  const c = chroma(lab);
  const h = hue(lab);
  return lab[0] > 0.42 && lab[0] < 0.93 && c > 0.018 && c < 0.17 && h > 25 && h < 95;
}
