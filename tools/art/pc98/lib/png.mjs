// Minimal deterministic indexed-colour PNG encoder (colour type 3).
// Palette PNGs keep portraits exact (no re-quantization by an encoder) and
// small: 4-bit when the palette fits in 16 entries.
import { deflateSync } from 'zlib';

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
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * @param {number} w
 * @param {number} h
 * @param {Uint8Array} indices palette index per pixel
 * @param {number[][]} palette [[r,g,b], ...] (<= 256)
 * @param {number[]} [alpha] per-entry alpha (tRNS), trailing opaque entries omitted
 */
export function encodeIndexedPng(w, h, indices, palette, alpha = []) {
  if (palette.length < 1 || palette.length > 256) throw new Error('palette size');
  const depth = palette.length <= 2 ? 1 : palette.length <= 4 ? 2 : palette.length <= 16 ? 4 : 8;
  const perByte = 8 / depth;
  const stride = Math.ceil(w / perByte);
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (stride + 1);
    raw[row] = 0; // filter: none (best for indexed images)
    for (let x = 0; x < w; x++) {
      const v = indices[y * w + x];
      if (v >= palette.length) throw new Error(`index ${v} out of palette`);
      const byte = row + 1 + Math.floor(x / perByte);
      const shift = 8 - depth * ((x % perByte) + 1);
      raw[byte] |= v << shift;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = depth;
  ihdr[9] = 3;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach((c, i) => plte.set(c.map((v) => Math.round(v)), i * 3));
  const chunks = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
  ];
  let lastAlpha = -1;
  alpha.forEach((a, i) => {
    if (a < 255) lastAlpha = i;
  });
  if (lastAlpha >= 0) chunks.push(chunk('tRNS', Buffer.from(alpha.slice(0, lastAlpha + 1))));
  chunks.push(chunk('IDAT', deflateSync(raw, { level: 9 })));
  chunks.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}
