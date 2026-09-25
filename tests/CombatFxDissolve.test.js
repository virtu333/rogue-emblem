import { describe, it, expect } from 'vitest';
import { buildDissolve, paintDissolve, pickMotes } from '../src/art/combatFx/deathDissolve.js';

function sprite(w, h) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 4; y < h - 2; y++)
    for (let x = 6; x < w - 6; x++) {
      const i = (y * w + x) * 4;
      px[i] = 40 + x;
      px[i + 1] = 60 + y;
      px[i + 2] = 90;
      px[i + 3] = 255;
    }
  return px;
}

const opaque = (buf) => {
  let n = 0;
  for (let i = 3; i < buf.length; i += 4) if (buf[i]) n++;
  return n;
};

describe('death dissolve (fading to embers)', () => {
  it('is deterministic for a seed and removes every pixel by the end', () => {
    const src = sprite(32, 32);
    const a = buildDissolve(src, 32, 32, { block: 2, seed: 7 });
    const b = buildDissolve(src, 32, 32, { block: 2, seed: 7 });
    expect(Array.from(a.thr)).toEqual(Array.from(b.thr));
    const out = new Uint8ClampedArray(src.length);
    let last = Infinity;
    for (let s = 0; s <= 8; s++) {
      paintDissolve(a, src, out, s / 8, 0xf3cb6c);
      const n = opaque(out);
      expect(n).toBeLessThanOrEqual(last);
      last = n;
    }
    expect(last).toBe(0);
    paintDissolve(a, src, out, 0, 0xf3cb6c);
    expect(opaque(out)).toBe(opaque(src));
  });

  it('lifts the top away first; the Entity collapses from its rim', () => {
    const src = sprite(32, 32);
    const d = buildDissolve(src, 32, 32, { block: 2, seed: 3 });
    const mean = (rows) => {
      const bs = d.blocks.filter((b) => rows(b.by));
      return bs.reduce((s, b) => s + b.t, 0) / bs.length;
    };
    expect(mean((y) => y < 6)).toBeLessThan(mean((y) => y > 10));
    const e = buildDissolve(src, 32, 32, { block: 2, seed: 3, inward: true });
    const rim = e.blocks.filter((b) => b.bx <= 4 || b.bx >= 11);
    const core = e.blocks.filter((b) => b.bx >= 7 && b.bx <= 8 && b.by >= 7 && b.by <= 9);
    const avg = (l) => l.reduce((s, b) => s + b.t, 0) / l.length;
    expect(avg(rim)).toBeLessThan(avg(core));
  });

  it('burns the front at the edge colour and keeps motes within budget, carrying pixel colours', () => {
    const src = sprite(32, 32);
    const d = buildDissolve(src, 32, 32, { block: 2, seed: 11 });
    const out = new Uint8ClampedArray(src.length);
    paintDissolve(d, src, out, 0.4, 0xabcdef);
    let edge = 0;
    for (let i = 0; i < out.length; i += 4)
      if (out[i + 3] && out[i] === 0xab && out[i + 1] === 0xcd && out[i + 2] === 0xef) edge++;
    expect(edge).toBeGreaterThan(0);
    const motes = pickMotes(d, 60, 5);
    expect(motes.length).toBeLessThanOrEqual(60);
    expect(pickMotes(d, 60, 5)).toEqual(motes);
    for (let i = 1; i < motes.length; i++)
      expect(motes[i].t).toBeGreaterThanOrEqual(motes[i - 1].t);
    for (const m of motes) expect(m.color).toBeGreaterThan(0);
  });
});
