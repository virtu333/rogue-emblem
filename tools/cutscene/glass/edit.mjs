// The cut of "The Far Side of the Glass": which clip plays when. Film times are
// seconds on the score's clock (60 bpm, so a beat is a second; see score.py LINES);
// `from` is where in the clip the shot starts and `speed` how fast its drawings run
// (below 1 the drawings hold longer, never tween). pixel.py traces only the frames a
// shot uses (trace.mjs reads this list), so trimming here also shrinks the data.
//
// Shots with no clip (`kind`) are drawn by the player itself.

export const EDIT = [
  // I. The Morning
  { t0: 0, t1: 10, kind: 'void' },
  { t0: 10, t1: 20, shot: 'weave', from: 0, speed: 0.8 },
  { t0: 20, t1: 26, shot: 'dragons', from: 1 },
  { t0: 26, t1: 32, shot: 'first_names', from: 0 },
  // II. The Spending
  { t0: 32, t1: 38, shot: 'turning', from: 0 },
  { t0: 38, t1: 46, shot: 'kneel', from: 0 },
  { t0: 46, t1: 54, shot: 'starfall', from: 0 },
  { t0: 54, t1: 60, shot: 'dragons_lie', from: 0, speed: 0.42, pan: [0, -6] },
  { t0: 60, t1: 72, shot: 'hollow', from: 0, speed: 0.5 },
  // III. The Unsworn Night
  { t0: 72, t1: 82, shot: 'oath', from: 0, speed: 0.8 },
  { t0: 82, t1: 88, shot: 'stair', from: 0 },
  { t0: 88, t1: 92, shot: 'list', from: 0.5 },
  { t0: 92, t1: 100, shot: 'hearth', from: 0 },
  { t0: 100, t1: 108, shot: 'unsworn', from: 0, speed: 0.62 },
  { t0: 108, t1: 116, shot: 'wall', from: 0 },
  // IV. The Roll
  { t0: 116, t1: 122, shot: 'siege', from: 0 },
  { t0: 122, t1: 127.5, shot: 'king', from: 0 },
  { t0: 127.5, t1: 133, shot: 'crown', from: 0 },
  { t0: 133, t1: 139, shot: 'ledger', from: 0 },
  { t0: 139, t1: 144, shot: 'read', from: 0.5 },
  // V. The officers: one every two beats, then the Emperor
  { t0: 144, t1: 146, shot: 'o_captain', from: 1.0, title: 'THE IRON CAPTAIN' },
  { t0: 146, t1: 148, shot: 'o_commander', from: 0.2, title: 'THE KNIGHT COMMANDER' },
  { t0: 148, t1: 150, shot: 'o_archmage', from: 1.5, title: 'THE ARCHMAGE' },
  { t0: 150, t1: 152, shot: 'o_rider', from: 0.5, title: 'THE DARK RIDER' },
  { t0: 152, t1: 154, shot: 'o_blade', from: 0.5, title: 'THE BLADE LORD' },
  { t0: 154, t1: 156, shot: 'o_wall', from: 0, title: 'THE IRON WALL' },
  { t0: 156, t1: 158, shot: 'o_berserker', from: 0.5, title: 'THE BERSERKER KING' },
  { t0: 158, t1: 164, shot: 'o_emperor', from: 0, title: 'THE EMPEROR' },
  // VI. The one who counts
  { t0: 164, t1: 175, shot: 'wendhall', from: 0, speed: 0.72 },
  { t0: 175, t1: 184.5, shot: 'counting', from: 0, speed: 0.62 },
  { t0: 184.5, t1: 191.5, shot: 'glass', from: 0, speed: 0.7 },
  // the Glass: Sera above, and below her in the water, not her reflection but him
  { t0: 191.5, t1: 196, kind: 'mirror', shot: 'below', from: 3, top: 'glass', topAt: 4.9 },
  // VII. Every way it ends
  { t0: 196, t1: 198.5, kind: 'thread' },
  { t0: 198.5, t1: 200.2, shot: 'd_ford', from: 0.8, death: true },
  { t0: 200.2, t1: 201.7, shot: 'd_bridge', from: 0.3, death: true },
  { t0: 201.7, t1: 203.4, shot: 'd_fens', from: 1.0, death: true },
  { t0: 203.4, t1: 205, shot: 'd_feet', from: 0, death: true },
  { t0: 205, t1: 209.5, shot: 'rewind', from: 1 },
  { t0: 209.5, t1: 216, shot: 'camp', from: 0 },
  // VIII. The far side
  { t0: 216, t1: 222, shot: 'sink', from: 0 },
  { t0: 222, t1: 232, shot: 'reveal', from: 0, speed: 0.8 },
  { t0: 232, t1: 248, kind: 'title' },
];

/** The clip time a shot has reached at film time t. */
export const clipTime = (e, t) => (e.from || 0) + (t - e.t0) * (e.speed ?? 1);

/** The range of each clip the cut uses (for tracing): { shot: [from, to] }. */
export function usedRanges() {
  const r = {};
  for (const e of EDIT) {
    if (!e.shot) continue;
    const a = e.from || 0;
    const b = clipTime(e, e.t1) + 0.1;
    const cur = r[e.shot];
    r[e.shot] = cur ? [Math.min(cur[0], a), Math.max(cur[1], b)] : [a, b];
  }
  // the mirror's top half holds a frame of the Glass
  for (const e of EDIT) if (e.top) r[e.top][1] = Math.max(r[e.top][1], e.topAt + 0.1);
  return r;
}
