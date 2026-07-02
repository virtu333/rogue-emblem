// Cleans Imagen raws that drew a fake checkerboard "transparency" pattern
// instead of a solid background. Flood-fills from the borders through the
// top-3 dominant border colors (white + light grays), then keeps only the
// largest opaque connected component to drop checker squares that became
// islands. The figure's dark outline stops the fill from eating the art.
//
// Usage: node tools/imagen-pipeline/fix-checkerboard.js <inDir> <outDir> <name...>
// (names without .png; run before process-unit48.js)
import sharp from 'sharp';
import path from 'path';

const ROOT = process.cwd();
const [inDir, outDir, ...files] = process.argv.slice(2);

function borderColors(data, w, h, ch, topN) {
  const counts = new Map();
  const push = (x, y) => {
    const i = (y * w + x) * ch;
    if (data[i + 3] === 0) return;
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([k]) => k.split(',').map(Number));
}

(async () => {
  for (const name of files) {
    const raw = path.join(ROOT, inDir, `${name}.png`);
    const { data, info } = await sharp(raw)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: ch } = info;
    const bgs = borderColors(data, w, h, ch, 3);
    const tolSq = 60 * 60;
    const isBg = (i) =>
      bgs.some(([r, g, b]) => {
        const dr = data[i] - r,
          dg = data[i + 1] - g,
          db = data[i + 2] - b;
        return dr * dr + dg * dg + db * db <= tolSq;
      });
    const visited = new Uint8Array(w * h);
    const queue = [];
    const enq = (x, y) => {
      const p = y * w + x;
      if (visited[p]) return;
      visited[p] = 1;
      if (isBg(p * ch)) queue.push(p);
    };
    for (let x = 0; x < w; x++) {
      enq(x, 0);
      enq(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
      enq(0, y);
      enq(w - 1, y);
    }
    const out = Buffer.from(data);
    while (queue.length) {
      const p = queue.pop();
      out[p * ch + 3] = 0;
      const x = p % w,
        y = (p / w) | 0;
      if (x > 0) enq(x - 1, y);
      if (x < w - 1) enq(x + 1, y);
      if (y > 0) enq(x, y - 1);
      if (y < h - 1) enq(x, y + 1);
    }
    // Keep only the largest opaque connected component (drops leftover
    // checker squares that became islands after the white was removed).
    const comp = new Int32Array(w * h).fill(-1);
    let best = -1,
      bestSize = 0,
      nComp = 0;
    for (let start = 0; start < w * h; start++) {
      if (comp[start] !== -1 || out[start * ch + 3] === 0) continue;
      const stack = [start];
      comp[start] = nComp;
      let size = 0;
      while (stack.length) {
        const p = stack.pop();
        size++;
        const x = p % w,
          y = (p / w) | 0;
        for (const [nx, ny] of [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ]) {
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const np = ny * w + nx;
          if (comp[np] === -1 && out[np * ch + 3] > 0) {
            comp[np] = nComp;
            stack.push(np);
          }
        }
      }
      if (size > bestSize) {
        bestSize = size;
        best = nComp;
      }
      nComp++;
    }
    for (let p = 0; p < w * h; p++) if (comp[p] !== -1 && comp[p] !== best) out[p * ch + 3] = 0;
    await sharp(out, { raw: info })
      .png()
      .toFile(path.join(ROOT, outDir, `${name}.png`));
    console.log(name, 'bg colors:', JSON.stringify(bgs), 'components:', nComp, 'kept:', bestSize);
  }
})();
