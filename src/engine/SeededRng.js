// SeededRng.js - the shared mulberry32 stream factory. A leaf module (imports nothing), so
// any engine file can seed a stream without joining an import cycle. BlessingEngine and
// ReinforcementScheduler re-export it for their older importers.

export function createSeededRng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
