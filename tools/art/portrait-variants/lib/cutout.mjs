// Cut a generated portrait out of its flat white backdrop (pure).
//
// The generations are pixel-art busts with a bold dark outline on pure
// white. The backdrop is flooded from the top edge and the upper part of
// the side edges (the bust is cut by the bottom edge with no outline, so a
// white robe there must never be a seed) through near-white pixels; the ink
// outline stops the flood. White pockets enclosed by the figure (between an
// arm and a weapon haft) are removed only when they are large and pure
// white, which painted cloth never is. The light anti-aliasing fringe along
// the outline is peeled so no white halo survives the downscale.

/** Near-white backdrop test on straight RGB bytes. */
export function isBackdrop(r, g, b, tolerance = 22) {
  const lo = Math.min(r, g, b);
  const hi = Math.max(r, g, b);
  return lo >= 255 - tolerance && hi - lo <= 14;
}

function components(mask, w, h) {
  const labels = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    labels[i] = id;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop();
      size++;
      const x = p % w;
      const y = (p / w) | 0;
      if (x > 0 && mask[p - 1] && labels[p - 1] < 0) ((labels[p - 1] = id), stack.push(p - 1));
      if (x < w - 1 && mask[p + 1] && labels[p + 1] < 0) ((labels[p + 1] = id), stack.push(p + 1));
      if (y > 0 && mask[p - w] && labels[p - w] < 0) ((labels[p - w] = id), stack.push(p - w));
      if (y < h - 1 && mask[p + w] && labels[p + w] < 0) ((labels[p + w] = id), stack.push(p + w));
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/**
 * @param {Uint8Array} rgba straight RGBA, w*h*4 (alpha ignored)
 * @param {object} [o]
 * @returns {{mask: Uint8Array, background: number, pockets: number, pocketPixels: number}}
 *   mask 1 = figure
 */
export function cutout(rgba, w, h, o = {}) {
  const {
    tolerance = 22,
    sideSeedFraction = 0.7,
    pocketMin = Math.round((w * h) / 6000),
    pocketPurity = 0.9,
    pockets = true,
    fringe = 3,
    minIsland = Math.round((w * h) / 4000),
  } = o;
  const n = w * h;
  const white = new Uint8Array(n);
  for (let i = 0; i < n; i++)
    white[i] = isBackdrop(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], tolerance) ? 1 : 0;
  const bg = new Uint8Array(n);
  const queue = [];
  const seed = (i) => {
    if (white[i] && !bg[i]) {
      bg[i] = 1;
      queue.push(i);
    }
  };
  for (let x = 0; x < w; x++) seed(x);
  for (let y = 0; y < Math.round(h * sideSeedFraction); y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (y > 0) seed(p - w);
    if (y < h - 1) seed(p + w);
  }
  // Enclosed pure-white pockets.
  let pocketCount = 0;
  let pocketPixels = 0;
  if (pockets) {
    const rest = new Uint8Array(n);
    for (let i = 0; i < n; i++) rest[i] = white[i] && !bg[i] ? 1 : 0;
    const comp = components(rest, w, h);
    const pure = new Int32Array(comp.sizes.length);
    for (let i = 0; i < n; i++) {
      const l = comp.labels[i];
      if (l >= 0 && Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) >= 250) pure[l]++;
    }
    const drop = comp.sizes.map((s, l) => s >= pocketMin && pure[l] / s >= pocketPurity);
    for (let i = 0; i < n; i++) if (comp.labels[i] >= 0 && drop[comp.labels[i]]) bg[i] = 1;
    drop.forEach((d, l) => {
      if (d) {
        pocketCount++;
        pocketPixels += comp.sizes[l];
      }
    });
  }
  let mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = bg[i] ? 0 : 1;
  // Peel the light anti-aliasing fringe next to the backdrop.
  for (let k = 0; k < fringe; k++) {
    const next = Uint8Array.from(mask);
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      const x = i % w;
      const y = (i / w) | 0;
      const nearBg =
        (x > 0 && !mask[i - 1]) ||
        (x < w - 1 && !mask[i + 1]) ||
        (y > 0 && !mask[i - w]) ||
        (y < h - 1 && !mask[i + w]);
      if (!nearBg) continue;
      const lum = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
      if (lum > 170) next[i] = 0;
    }
    mask = next;
  }
  // Drop specks not attached to the body.
  const figure = components(mask, w, h);
  if (figure.sizes.length > 1) {
    const main = figure.sizes.indexOf(Math.max(...figure.sizes));
    for (let i = 0; i < n; i++) {
      const l = figure.labels[i];
      if (l >= 0 && l !== main && figure.sizes[l] < minIsland) mask[i] = 0;
    }
  }
  let removed = 0;
  for (let i = 0; i < n; i++) if (!mask[i]) removed++;
  return { mask, background: removed / n, pockets: pocketCount, pocketPixels };
}

/**
 * Placement that puts the eye line and face centre where the approved
 * portraits have them and scales the face to their size, never leaving a
 * gap under the bust (fractions of the square).
 * @returns {{scale:number, dx:number, dy:number, eye:number, cx:number}}
 *   maps a source fraction p to p * scale + d
 */
export function framingTransform(
  { eye, cx, faceH },
  { targetEye = 0.36, targetCx = 0.52, targetFaceH = 0.38, minScale = 0.86, maxScale = 1.3 } = {},
) {
  const scale = faceH > 0 ? Math.min(maxScale, Math.max(minScale, targetFaceH / faceH)) : 1;
  let dy = targetEye - eye * scale;
  // The bust's bottom edge (source y = 1) must reach the frame's bottom.
  if (scale + dy < 1) dy = 1 - scale;
  let dx = targetCx - cx * scale;
  // Keep the source covering the frame horizontally when it can.
  if (scale >= 1) dx = Math.min(0, Math.max(1 - scale, dx));
  return {
    scale: Math.round(scale * 1000) / 1000,
    dx: Math.round(dx * 1000) / 1000,
    dy: Math.round(dy * 1000) / 1000,
    eye: Math.round((eye * scale + dy) * 1000) / 1000,
    cx: Math.round((cx * scale + dx) * 1000) / 1000,
  };
}
