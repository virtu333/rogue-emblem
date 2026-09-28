// "Under the Broken Sun" as events, transcribed from its score
// (tools/music/scores/battle_broken_sun.py on the music branch): the drum patterns, the
// band's hits and the choir's tune, in seconds of the track. Cuts, shakes and flashes
// lock to these, not to guesses from the audio.

export const BPM = 150;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;
/** Seconds into the track of bar n, beat b (both 1-based; b may be fractional). */
export const T = (bar, beat = 1) => (bar - 1) * BAR + (beat - 1) * BEAT;

const steps = (bar, pattern, step = 0.25) =>
  [...pattern].flatMap((ch, i) =>
    ch === '.' ? [] : [{ t: T(bar, 1 + i * step), accent: ch === 'X' }],
  );

const CHORUS_BEAT = { kick: 'x.....x.x.....x.', snare: '....x.......x...' };
const KIT = {};
const add = (bar, parts, step) => {
  for (const [name, pat] of Object.entries(parts))
    (KIT[name] ||= []).push(...steps(bar, pat, step));
};

// 28: the band's hit, then an accelerating snare roll (eighths, triplets, 16ths, sextuplets)
add(28, { kick: 'X...............', crash: 'X...............' });
KIT.roll = [
  0,
  0.5,
  ...[0, 1, 2].map((i) => 1 + i / 3),
  ...[0, 1, 2, 3].map((i) => 2 + i / 4),
  ...[0, 1, 2, 3, 4, 5].map((i) => 3 + i / 6),
].map((b) => ({ t: T(28, 1 + b), accent: false }));
// 29-43: the sabi
for (let bar = 29; bar <= 43; bar++) {
  const g = { ...CHORUS_BEAT };
  if ([29, 33, 37, 41].includes(bar)) g.crash = 'X...............';
  if (bar === 35) {
    g.kick = 'x.....x.X.....x.';
    g.crash = '........X.......';
  }
  if ([32, 36, 40].includes(bar)) g.snare = '....x.......x.xx';
  if (bar === 43) {
    g.kick = 'x.....x.X.......';
    g.snare = '....x...X...xxxx';
    g.tom = '..........xx....';
    g.crash = '........X.......';
  }
  add(bar, g);
}
// 44: one hit, and the choir holds
add(44, { kick: 'X...............', crash: 'X...............', snare: 'X...............' });
// 45-48: the hymn, a kick in quarters
for (let bar = 45; bar <= 48; bar++) add(bar, { kick: 'x...x...x...x...' });
add(48, { snare: '............xxxx', tom: '........x.x.....' });
// 49-54: the band is back
for (let bar = 49; bar <= 54; bar++)
  add(bar, { ...CHORUS_BEAT, ...(bar === 49 ? { crash: 'X...............' } : {}) });
// 55: the climb; 56: the last hit, then silence
add(55, { kick: 'x.x.x.x.x.x.x.x.', snare: 'x.x.x.x.xxxxxxxx', crash: 'X...............' });
add(56, { kick: 'X...', snare: 'X...', crash: 'X...' }, 0.25);

for (const k of Object.keys(KIT)) KIT[k].sort((a, b) => a.t - b.t);
export { KIT };

/** Every drum hit at or after t0 and before t1, as seconds. */
export const hitsIn = (name, t0, t1) =>
  KIT[name].filter((h) => h.t >= t0 && h.t < t1).map((h) => h.t);

// the choir's tune in the sabi, from its pickup on bar 28 beat 3 (note:beats)
const CHORUS =
  'B3:0.5 E4:0.5 F#4:0.5 B4:1.5 A4:0.5 G4:0.5 G4:0.5 E4:1 A4:1 B4:0.5 D5:0.5 E5:1 ' +
  'F#5:1 E5:1 D5:2.5 r:1.5 G4:0.5 A4:0.5 B4:1 D5:0.5 D5:0.5 E5:1 r:0.5 E5:0.5 E5:0.5 ' +
  'D5:0.5 E5:1 G5:1 F#5:1 E5:0.5 D5:0.5 D5:0.5 r:0.5 B4:1.5 r:2 F#4:0.5 A4:0.5 B4:1 ' +
  'B4:0.5 D5:0.5 E5:0.5 D5:0.5 B4:1 r:1.5 E5:0.5 E5:0.5 F#5:0.5 G5:0.5 F#5:2.5 r:1 ' +
  'D5:0.5 E5:1 D5:0.5 B4:1 D5:0.5 E5:0.5 F#5:0.5 E5:1.5 r:1.5 B4:0.5 D5:0.5 E5:1 D5:0.5 ' +
  'E5:0.5 F#5:5.5 r:1';
const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const TUNE = (() => {
  const out = [];
  let beat = T(28, 3) / BEAT;
  for (const tok of CHORUS.split(' ')) {
    const [n, d] = tok.split(':');
    const dur = Number(d);
    if (n !== 'r') {
      const m = /^([A-G])(#?)(\d)$/.exec(n);
      out.push({
        t: beat * BEAT,
        dur: dur * BEAT,
        midi: 12 * (Number(m[3]) + 1) + PITCH[m[1]] + (m[2] ? 1 : 0),
      });
    }
    beat += dur;
  }
  return out;
})();

/**
 * A decaying envelope from the most recent event in `times` (seconds): 1 on the hit,
 * falling to 0 over `decay` s. Use it to kick a zoom, a flash, a flare.
 */
export function pulse(t, times, decay = 0.2) {
  let best = Infinity;
  for (const h of times) if (h <= t && t - h < best) best = t - h;
  return best === Infinity ? 0 : Math.exp(-best / decay);
}
