import { detectMobileRuntime } from '../utils/runtimeFlags.js';

// Development-only A/B switch; production always uses the readability pass.
export function battleContrastEnabled() {
  const query = new URLSearchParams(globalThis.location?.search || '');
  if (import.meta.env.DEV && query.get('battleContrast') === 'original') return false;
  return detectMobileRuntime() || (import.meta.env.DEV && query.get('battleLab') === '1');
}

// Cache a one-source-pixel charcoal contour. Original colors, texture dimensions,
// anchors, and display sizing are preserved; no blur or extra render objects.
export function contrastSpriteKey(scene, sourceKey) {
  if (!battleContrastEnabled()) return sourceKey;
  const key = `contrast-${sourceKey}`;
  if (scene.textures.exists(key)) return key;
  const source = scene.textures.get(sourceKey)?.getSourceImage();
  if (!source || typeof document === 'undefined') return sourceKey;
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (const [x, y] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    ctx.drawImage(source, x, y);
  }
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = 'rgba(24, 34, 35, 0.82)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(source, 0, 0);
  scene.textures.addCanvas(key, canvas);
  return key;
}

// Reduce grass contrast around its own average color, preserving the biome's hue.
// Applied only to Plain: trees, cliffs, banks, forts and hazards retain their detail.
export function softenGrassTexture(ctx, size) {
  const pixels = ctx.getImageData(0, 0, size, size).data;
  let red = 0,
    green = 0,
    blue = 0,
    weight = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    red += pixels[i] * alpha;
    green += pixels[i + 1] * alpha;
    blue += pixels[i + 2] * alpha;
    weight += alpha;
  }
  if (!weight) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = `rgba(${Math.round(red / weight)}, ${Math.round(green / weight)}, ${Math.round(blue / weight)}, 0.30)`;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
}
