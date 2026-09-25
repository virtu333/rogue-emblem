// png — a tiny deterministic PNG codec for the icon atlases (Node only).
//
// encodeIndexed writes an 8-bit palette PNG (colour type 3 + tRNS) with an exact
// palette: no quantisation, so every pixel the renderer drew survives bit for bit, and
// the bytes depend only on the pixels and node:zlib (no image library version drift).
// decodePng reads what encodeIndexed writes (and plain 8-bit RGBA / RGB / palette PNGs
// with any filter), for the determinism test.
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * @param {Uint8Array|Uint8ClampedArray} rgba w*h*4; fully transparent pixels collapse to one index
 * @returns {Buffer} PNG bytes
 */
export function encodeIndexed(rgba, w, h) {
  const index = new Map();
  const palette = [];
  const key = (i) =>
    rgba[i + 3] === 0
      ? 0
      : ((rgba[i] << 24) | (rgba[i + 1] << 16) | (rgba[i + 2] << 8) | rgba[i + 3]) >>> 0;
  // Transparent first so it is index 0 and tRNS stays short; then colours in first-seen order.
  index.set(0, 0);
  palette.push([0, 0, 0, 0]);
  for (let i = 0; i < w * h * 4; i += 4) {
    const k = key(i);
    if (!index.has(k)) {
      index.set(k, palette.length);
      palette.push([rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]);
    }
  }
  if (palette.length > 256) throw new Error(`atlas has ${palette.length} colours (max 256)`);
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = index.get(key((y * w + x) * 4));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // indexed
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach((c, i) => plte.set(c.slice(0, 3), i * 3));
  let lastAlpha = 0;
  palette.forEach((c, i) => {
    if (c[3] !== 255) lastAlpha = i;
  });
  const trns = Buffer.from(palette.slice(0, lastAlpha + 1).map((c) => c[3]));
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('tRNS', trns),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9, memLevel: 9, strategy: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** @returns {{ width:number, height:number, rgba:Uint8Array }} */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let off = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let type = 0;
  let plte = null;
  let trns = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const t = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (t === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      if (data[12]) throw new Error('interlaced PNG not supported');
    } else if (t === 'PLTE') plte = data;
    else if (t === 'tRNS') trns = data;
    else if (t === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (depth !== 8) throw new Error(`bit depth ${depth} not supported`);
  const bpp = { 2: 3, 3: 1, 6: 4 }[type];
  if (!bpp) throw new Error(`colour type ${type} not supported`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      const pred =
        f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
      px[y * stride + x] = (src[x] + pred) & 0xff;
    }
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (type === 3) {
      const k = px[i];
      rgba[i * 4] = plte[k * 3];
      rgba[i * 4 + 1] = plte[k * 3 + 1];
      rgba[i * 4 + 2] = plte[k * 3 + 2];
      rgba[i * 4 + 3] = trns && k < trns.length ? trns[k] : 255;
    } else {
      rgba[i * 4] = px[i * bpp];
      rgba[i * 4 + 1] = px[i * bpp + 1];
      rgba[i * 4 + 2] = px[i * bpp + 2];
      rgba[i * 4 + 3] = type === 6 ? px[i * bpp + 3] : 255;
    }
  }
  return { width: w, height: h, rgba };
}
