// Drives the game's real src/ui/WeatheredTerrain.js drawWeatheredTile() from
// Node through a tiny Canvas2D shim, so the comparison renders use exactly the
// same atlas cells, masks and fills as the phone BattlefieldLab path.
//
// The shim implements only what drawWeatheredTile / softenGrassTexture use:
// save/restore, translate/rotate, rect clip, fillRect (hex + rgba), drawImage
// (3/5/9 args, nearest-neighbour because the game sets
// imageSmoothingEnabled = false) and getImageData.
import { drawWeatheredTile, WEATHERED_TILE_SIZE } from '../../../../src/ui/WeatheredTerrain.js';
import { readRgba } from './image.mjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const ATLASES = [
  'meadow-weathered',
  'structures-weathered',
  'fort-compact',
  'hazards-weathered',
  'meadow-tundra',
  'meadow-volcano',
];

export async function loadWeatheredAtlases() {
  const art = {};
  for (const name of ATLASES) {
    const { data, w, h } = await readRgba(join(ROOT, 'assets/terrain/weathered', `${name}.png`));
    art[name] = { data, width: w, height: h };
  }
  return art;
}

function parseColor(style) {
  if (style.startsWith('#')) {
    const n = parseInt(style.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = style.match(/rgba?\(([^)]+)\)/);
  const parts = m[1].split(',').map((s) => parseFloat(s));
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}

const mul = (a, b) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const invert = (m) => {
  const det = m[0] * m[3] - m[1] * m[2];
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
};
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export class ShimContext {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    this.data = Buffer.alloc(w * h * 4);
    this.m = [1, 0, 0, 1, 0, 0];
    this.clipBox = [0, 0, w, h];
    this.stack = [];
    this.path = [];
    this.fillStyle = '#000000';
    this.globalCompositeOperation = 'source-over';
    this.imageSmoothingEnabled = true;
  }
  save() {
    this.stack.push({ m: this.m, clipBox: this.clipBox, fillStyle: this.fillStyle, gco: this.globalCompositeOperation });
  }
  restore() {
    const s = this.stack.pop();
    Object.assign(this, { m: s.m, clipBox: s.clipBox, fillStyle: s.fillStyle, globalCompositeOperation: s.gco });
  }
  translate(x, y) {
    this.m = mul(this.m, [1, 0, 0, 1, x, y]);
  }
  rotate(a) {
    const c = Math.cos(a),
      s = Math.sin(a);
    this.m = mul(this.m, [c, s, -s, c, 0, 0]);
  }
  beginPath() {
    this.path = [];
  }
  rect(x, y, w, h) {
    this.path.push([x, y, w, h]);
  }
  clip() {
    // Axis-aligned rect clips only (all the game uses).
    let [x0, y0, x1, y1] = this.clipBox;
    for (const [x, y, w, h] of this.path) {
      const a = apply(this.m, x, y),
        b = apply(this.m, x + w, y + h);
      x0 = Math.max(x0, Math.min(a[0], b[0]));
      y0 = Math.max(y0, Math.min(a[1], b[1]));
      x1 = Math.min(x1, Math.max(a[0], b[0]));
      y1 = Math.min(y1, Math.max(a[1], b[1]));
    }
    this.clipBox = [x0, y0, x1, y1];
  }
  // Iterate device pixels whose centre maps inside the user-space rect.
  forRect(x, y, w, h, fn) {
    const inv = invert(this.m);
    const corners = [
      apply(this.m, x, y),
      apply(this.m, x + w, y),
      apply(this.m, x, y + h),
      apply(this.m, x + w, y + h),
    ];
    const [cx0, cy0, cx1, cy1] = this.clipBox;
    const X0 = Math.max(Math.floor(Math.min(...corners.map((c) => c[0]))), Math.ceil(cx0 - 0.5), 0);
    const X1 = Math.min(Math.ceil(Math.max(...corners.map((c) => c[0]))), Math.floor(cx1 + 0.5), this.width);
    const Y0 = Math.max(Math.floor(Math.min(...corners.map((c) => c[1]))), Math.ceil(cy0 - 0.5), 0);
    const Y1 = Math.min(Math.ceil(Math.max(...corners.map((c) => c[1]))), Math.floor(cy1 + 0.5), this.height);
    for (let Y = Y0; Y < Y1; Y++)
      for (let X = X0; X < X1; X++) {
        if (X + 0.5 < cx0 || X + 0.5 > cx1 || Y + 0.5 < cy0 || Y + 0.5 > cy1) continue;
        const [u, v] = apply(inv, X + 0.5, Y + 0.5);
        if (u < x || u >= x + w || v < y || v >= y + h) continue;
        fn(X, Y, u, v);
      }
  }
  blend(X, Y, r, g, b, a) {
    const d = (Y * this.width + X) * 4;
    if (this.globalCompositeOperation === 'source-atop' && this.data[d + 3] === 0) return;
    const da = this.data[d + 3] / 255;
    const oa = a + da * (1 - a);
    if (oa <= 0) return;
    this.data[d] = Math.round((r * a + this.data[d] * da * (1 - a)) / oa);
    this.data[d + 1] = Math.round((g * a + this.data[d + 1] * da * (1 - a)) / oa);
    this.data[d + 2] = Math.round((b * a + this.data[d + 2] * da * (1 - a)) / oa);
    this.data[d + 3] = Math.round(oa * 255);
  }
  fillRect(x, y, w, h) {
    const [r, g, b, a] = parseColor(this.fillStyle);
    this.forRect(x, y, w, h, (X, Y) => this.blend(X, Y, r, g, b, a));
  }
  drawImage(img, ...args) {
    let sx = 0,
      sy = 0,
      sw = img.width,
      sh = img.height,
      dx,
      dy,
      dw = img.width,
      dh = img.height;
    if (args.length === 2) [dx, dy] = args;
    else if (args.length === 4) [dx, dy, dw, dh] = args;
    else [sx, sy, sw, sh, dx, dy, dw, dh] = args;
    this.forRect(dx, dy, dw, dh, (X, Y, u, v) => {
      const px = Math.min(img.width - 1, Math.floor(sx + ((u - dx) / dw) * sw));
      const py = Math.min(img.height - 1, Math.floor(sy + ((v - dy) / dh) * sh));
      const s = (py * img.width + px) * 4;
      const a = img.data[s + 3] / 255;
      if (a > 0) this.blend(X, Y, img.data[s], img.data[s + 1], img.data[s + 2], a);
    });
  }
  getImageData(x, y, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const s = ((y + j) * this.width + x + i) * 4;
        out.set(this.data.subarray(s, s + 4), (j * w + i) * 4);
      }
    return { data: out, width: w, height: h };
  }
}

// Same maths as src/ui/BattleContrast.js softenGrassTexture (applied to Plain
// on the phone/BattlefieldLab path). Re-stated here because that module reads
// import.meta.env, which does not exist under plain Node.
function softenGrassTexture(ctx, size) {
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

/**
 * Render a whole layout with the current weathered atlases at 48px per cell,
 * mirroring BattlefieldLab.paintTerrain (one 48px canvas per cell).
 * Cells the weathered renderer does not handle are left in the lab's
 * camera background colour (#263e40).
 */
export function renderWeathered(names, biome, art) {
  const rows = names.length,
    cols = names[0].length,
    S = WEATHERED_TILE_SIZE;
  const W = cols * S,
    H = rows * S;
  const out = Buffer.alloc(W * H * 4);
  const at = (c, r) => names[r]?.[c];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const ctx = new ShimContext(S, S);
      ctx.fillStyle = '#263e40';
      ctx.fillRect(0, 0, S, S);
      const drawn = drawWeatheredTile(ctx, art, at, c, r, { biome });
      if (drawn && at(c, r) === 'Plain') softenGrassTexture(ctx, S);
      for (let y = 0; y < S; y++) ctx.data.copy(out, ((r * S + y) * W + c * S) * 4, y * S * 4, (y + 1) * S * 4);
    }
  return { data: out, w: W, h: H };
}
